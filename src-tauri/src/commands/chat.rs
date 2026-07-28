use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use crate::db;
use crate::db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use crate::db::models::conversation::Conversation;
use crate::db::models::message::{Message, NewMessage};
use crate::provider;
use crate::provider::{ChatMessage, ChatParams};
use crate::template;
use crate::tools;
use crate::state::{AppDb, AppSecrets, AppTools, AppMcp, ApprovalDecision, ApprovalWaiters, ActiveChats, EditSessions, CompactBreakers};
use crate::agent::{build_messages, build_file_access, file_access_prompt, estimate_tokens, microcompact, remove_orphan_tool_messages, resolve_file_uris_in_messages, trim_to_context_limit, extract_tool_calls_from_blocks, parse_openai_tool_calls, serialize_tool_calls_openai, provider_secret_name, get_provider_api_key, resolve_provider_config, do_compact, mid_turn_compact, CompactCircuitBreaker, COMPACT_PROMPT, StreamResult, MAX_STREAM_RETRIES, STREAM_RETRY_BASE, is_context_window_error, is_retryable_stream_error, instruction_budget, load_project_instructions, TokenBudget};
use crate::util::{get_conn, now_ms, take_bytes_at_char_boundary};

const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

async fn consume_stream(
    mut stream: provider::ChatStream,
    app: &tauri::AppHandle,
    cancel: &tokio_util::sync::CancellationToken,
    message_id: &str,
    conversation_id: &str,
) -> Result<StreamResult, String> {
    use futures::StreamExt;

    let mut text = String::new();
    let mut reasoning = String::new();
    let mut signature = String::new();
    let mut tool_acc: Vec<(String, String, String)> = Vec::new();
    let mut usage = None;
    let mut finish_reason = None;
    // Some OpenAI-compatible providers inline reasoning as <think> tags in the
    // text stream instead of a separate reasoning field; route it accordingly.
    let mut think_parser = crate::agent::InlineHiddenTagParser::new_streaming(vec![
        crate::agent::InlineTagSpec { tag: (), open: "<think>", close: "</think>" },
    ]);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => { break; }
            chunk = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()) => {
                match chunk {
                    Err(_) => {
                        return Err("Stream idle timeout".to_string());
                    }
                    Ok(Some(Ok(provider::StreamEvent::Text { content: ref s }))) => {
                        let chunk = think_parser.push_str(s);
                        if !chunk.visible_text.is_empty() {
                            text.push_str(&chunk.visible_text);
                            app.emit("chat-stream", serde_json::json!({
                                "type": "text", "content": &chunk.visible_text, "message_id": message_id,
                                "conversation_id": conversation_id,
                            })).map_err(|e| e.to_string())?;
                        }
                        for tag in &chunk.extracted {
                            reasoning.push_str(&tag.content);
                            app.emit("chat-stream", serde_json::json!({
                                "type": "reasoning", "content": &tag.content, "message_id": message_id,
                                "conversation_id": conversation_id,
                            })).map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(Some(Ok(provider::StreamEvent::Reasoning { content: ref s }))) => {
                        reasoning.push_str(s);
                        app.emit("chat-stream", serde_json::json!({
                            "type": "reasoning", "content": s, "message_id": message_id,
                            "conversation_id": conversation_id,
                        })).map_err(|e| e.to_string())?;
                    }
                    Ok(Some(Ok(provider::StreamEvent::ReasoningSignature { signature: ref s }))) => {
                        signature.push_str(s);
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallStart { index, ref id, ref name }))) => {
                        // Guard against a malformed/hostile endpoint sending a huge
                        // index that would balloon the Vec allocation.
                        if index >= 256 {
                            return Err(format!("tool call index {index} out of range"));
                        }
                        while tool_acc.len() <= index {
                            tool_acc.push((String::new(), String::new(), String::new()));
                        }
                        tool_acc[index] = (id.clone(), name.clone(), String::new());
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallDelta { index, ref arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2.push_str(arguments);
                        }
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallDone { index, ref arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2 = arguments.clone();
                        }
                    }
                    Ok(Some(Ok(provider::StreamEvent::UsageUpdate { usage: ref u }))) => {
                        usage = Some(u.clone());
                    }
                    Ok(Some(Ok(provider::StreamEvent::Stop { ref reason, usage: ref u }))) => {
                        if let Some(u) = u {
                            usage = Some(u.clone());
                        }
                        finish_reason = Some(reason.clone());
                    }
                    Ok(Some(Ok(provider::StreamEvent::Error { ref message }))) => {
                        return Err(message.clone());
                    }
                    Ok(Some(Ok(provider::StreamEvent::MessageStart { .. }))) => {}
                    Ok(Some(Err(e))) => {
                        return Err(e.to_string());
                    }
                    Ok(None) => { break; }
                }
            }
        }
    }

    let tail = think_parser.finish();
    if !cancel.is_cancelled() {
        if !tail.visible_text.is_empty() {
            app.emit("chat-stream", serde_json::json!({
                "type": "text", "content": &tail.visible_text, "message_id": message_id,
                "conversation_id": conversation_id,
            })).map_err(|e| e.to_string())?;
        }
        for tag in &tail.extracted {
            app.emit("chat-stream", serde_json::json!({
                "type": "reasoning", "content": &tag.content, "message_id": message_id,
                "conversation_id": conversation_id,
            })).map_err(|e| e.to_string())?;
        }
    }
    text.push_str(&tail.visible_text);
    for tag in tail.extracted {
        reasoning.push_str(&tag.content);
    }

    let tool_calls: Vec<provider::ToolCall> = if cancel.is_cancelled() {
        vec![]
    } else {
        tool_acc.into_iter()
            .filter(|(id, _, _)| !id.is_empty())
            .map(|(id, name, args)| provider::ToolCall { id, name, arguments: args })
            .collect()
    };

    Ok(StreamResult { text, reasoning, signature, tool_calls, usage, finish_reason })
}

/// Emits a terminal `stop` event if the turn exits via an early error return, so
/// the UI never stays stuck streaming (mirrors the OneBot headless guard). Armed
/// per iteration; disarmed once the normal stop event has been sent.
struct ErrorStopGuard<'a> {
    app: &'a tauri::AppHandle,
    conversation_id: &'a str,
    message_id: Option<String>,
}

impl Drop for ErrorStopGuard<'_> {
    fn drop(&mut self) {
        if let Some(message_id) = self.message_id.take() {
            let _ = self.app.emit("chat-stream", serde_json::json!({
                "type": "stop", "reason": "error", "done": true,
                "message_id": message_id,
                "conversation_id": self.conversation_id,
            }));
        }
    }
}

/// A sandbox-blocked command asking for an approved retry without sandbox.
struct EscalationReq<'a> {
    origin_call_id: &'a str,
    reason: &'a str,
}

/// Emit a tool approval request and wait for the user's decision. Returns
/// `None` when the chat is cancelled (stop button) before a decision arrives,
/// so approval/tool waits can't outlive the conversation.
async fn wait_for_approval(
    app: &tauri::AppHandle,
    cancel: &CancellationToken,
    tc: &provider::ToolCall,
    message_id: &str,
    conversation_id: &str,
    escalation: Option<EscalationReq<'_>>,
) -> Result<Option<ApprovalDecision>, String> {
    let (tx, rx) = oneshot::channel();
    {
        let waiters = app.state::<ApprovalWaiters>();
        let mut map = waiters.0.lock().await;
        map.insert(tc.id.clone(), tx);
    }
    let mut payload = serde_json::json!({
        "type": "tool_approval_req",
        "call_id": tc.id,
        "tool_name": tc.name,
        "arguments": tc.arguments,
        "message_id": message_id,
        "conversation_id": conversation_id,
    });
    if let Some(ref esc) = escalation {
        payload["escalation"] = serde_json::json!(true);
        payload["origin_call_id"] = serde_json::json!(esc.origin_call_id);
        payload["retry_reason"] = serde_json::json!(esc.reason);
    }
    app.emit("chat-stream", payload).map_err(|e| e.to_string())?;
    let decision = tokio::select! {
        _ = cancel.cancelled() => None,
        r = rx => r.ok(),
    };
    if decision.is_none() {
        // Cancelled or sender dropped: remove the stale waiter so a later
        // response for a reused call_id can't hit it.
        let waiters = app.state::<ApprovalWaiters>();
        waiters.0.lock().await.remove(&tc.id);
    }
    Ok(decision)
}

#[tauri::command]
pub async fn stop_chat(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let chats = app.state::<ActiveChats>();
    if let Some(token) = chats.0.lock().await.get(&conversation_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
    model_override: Option<String>,
    provider_override: Option<String>,
    thinking_level: Option<String>,
    assistant_id: Option<String>,
    fast: Option<bool>,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let pool = app.state::<AppDb>().0.clone();

    let cancel = CancellationToken::new();
    {
        let chats = app.state::<ActiveChats>();
        chats.0.lock().await.insert(conversation_id.clone(), cancel.clone());
    }

    // Load conversation + assistant + history + project path
    let (assistant, history, conv_title, project_path, project_id, compact_cursor, conv_prefs) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let aid_override = assistant_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let compact_cursor = conv.compact_cursor;
            let effective_aid = aid_override.as_deref()
                .or(conv.assistant_id.as_deref());
            let assistant = effective_aid
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let project = conv.project_id.as_deref()
                .and_then(|pid| db::ops::project::get_project(&mut conn, pid).ok());
            let project_path = project.as_ref().and_then(|p| p.path.clone());
            let project_id = project.as_ref().map(|p| p.id.clone());
            // Conversation-level reasoning prefs act as the fallback when the
            // request doesn't carry an explicit override.
            let conv_prefs = (conv.thinking_level.clone(), conv.fast_mode != 0);
            Ok::<_, String>((assistant, history, conv.title, project_path, project_id, compact_cursor, conv_prefs))
        }).await.map_err(|e| e.to_string())??
    };

    // Resolve provider config (with optional overrides)
    let (mut provider_type, mut base_url, mut api_key, model, mut api_format) =
        resolve_provider_config(&secrets.0, &pool, assistant.as_ref())?;

    let model = model_override.unwrap_or(model);

    if let Some(ref pid) = provider_override {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        let secrets2 = secrets.0.clone();
        let (pt, bu, ak, af) = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let p = db::ops::provider::get_provider(&mut conn, &pid2).map_err(|e| e.to_string())?;
            let ak = get_provider_api_key(&secrets2, &pid2)
                .ok_or_else(|| format!("API Key not set for provider '{}'", p.name))?;
            Ok::<_, String>((p.provider_type, p.base_url.trim_end_matches('/').to_string(), ak, p.api_format))
        }).await.map_err(|e| e.to_string())??;
        provider_type = pt;
        base_url = bu;
        api_key = ak;
        api_format = af;
    }

    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    // Build messages with history (resolve template variables in system prompt)
    let file_access = build_file_access(&pool).await;
    let raw_prompt = assistant.as_ref().map(|a| a.system_prompt.as_str()).unwrap_or("");
    let user_name = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::preference::get_preference(&mut conn, "user_name").ok().flatten()
        }).await.ok().flatten()
    };
    let mut tmpl_ctx = template::build_context(
        assistant.as_ref().map(|a| a.name.as_str()),
        user_name.as_deref(),
    );
    if let Some(ref a) = assistant {
        let pool2 = pool.clone();
        let aid = a.id.clone();
        let emoji_names: Option<String> = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::emoji::format_emoji_list_block(&mut conn, &aid)
        }).await.ok().flatten();
        if let Some(names) = emoji_names {
            tmpl_ctx.set("emoji_list", &names);
        }
    }
    let system_prompt_resolved = template::resolve(raw_prompt, &tmpl_ctx);
    let memory_block = if let Some(ref pid) = project_id {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let memories = db::ops::memory::list_memories(&mut conn, &pid2).ok()?;
            db::ops::memory::format_memory_block(&memories)
        }).await.ok().flatten()
    } else {
        None
    };
    // The running checklist has to survive compaction, so it is re-derived from
    // the database each turn rather than read back out of the transcript.
    let todo_block = {
        let pool2 = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let view = db::ops::todo::get_active_view(&mut conn, &conv_id).ok()??;
            db::ops::todo::format_todo_block(&view)
        }).await.ok().flatten()
    };
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let instruction_block = {
        let budget = instruction_budget(context_limit);
        if budget > 0 {
            load_project_instructions(project_path.as_deref(), budget).await
        } else {
            None
        }
    };
    // Get tool definitions (builtin + MCP) + per-assistant filtering. Resolved
    // before the system prompt so the built-in agent baseline can match the
    // tools actually enabled for this session.
    let tool_registry = app.state::<AppTools>();
    let mcp_defs = {
        let mcp = app.state::<AppMcp>();
        let mgr = mcp.0.lock().await;
        mgr.all_tool_definitions()
    };
    // Resolve tool filtering: preset > enabled_tools > all
    let enabled_tools: Option<Vec<String>> = if let Some(ref preset_id) = assistant.as_ref().and_then(|a| a.tool_preset_id.as_ref()) {
        let pool2 = pool.clone();
        let pid = preset_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            let preset = db::ops::tool_preset::get_preset(&mut conn, &pid).ok()?;
            serde_json::from_str(&preset.tool_names).ok()
        }).await.ok().flatten()
    } else {
        assistant.as_ref()
            .and_then(|a| a.enabled_tools.as_ref())
            .and_then(|json| serde_json::from_str(json).ok())
    };
    let mut tool_defs = crate::agent::tool_defs::collect(
        &tool_registry.0,
        mcp_defs,
        enabled_tools.as_deref(),
    );
    // Stage one of skill disclosure: which skills exist and what each is for.
    {
        let pool2 = pool.clone();
        let pid = project_id.clone();
        let aid = assistant.as_ref().map(|a| a.id.clone());
        let available = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::skill_binding::resolve_available(&mut conn, pid.as_deref(), aid.as_deref()).ok()
        }).await.ok().flatten().unwrap_or_default();
        crate::agent::tool_defs::apply_skill_catalog(&mut tool_defs, &available);
    }
    let tool_defs = tool_defs;

    let base_block = crate::agent::base_prompt(&tool_defs);
    // The checklist block goes last: it changes every turn, so anything after
    // it would be evicted from the provider's prompt cache on each update.
    let system_prompt = format!(
        "{}{}{}{}{}{}",
        base_block.map(|b| format!("{b}\n\n")).unwrap_or_default(),
        system_prompt_resolved,
        instruction_block.as_deref().unwrap_or(""),
        file_access_prompt(&file_access),
        memory_block.as_deref().unwrap_or(""),
        todo_block.as_deref().unwrap_or(""),
    );
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
    let auto_compact = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    let effective_provider_id = provider_override.clone()
        .or_else(|| assistant.as_ref().and_then(|a| a.provider_id.clone()));
    let model_config = if let Some(ref pid) = effective_provider_id {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        let mid = model.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::model_config::get_by_provider_and_model(&mut conn, &pid2, &mid).ok()?
        }).await.ok().flatten()
    } else {
        None
    };

    // Resolved after model_config so a user-authored capability override can be
    // layered on top of the built-in catalog.
    let mut caps = provider::capabilities::resolve(&provider_type, Some(&api_format), &model);
    provider::capabilities::apply_overrides(
        &mut caps,
        model_config.as_ref().and_then(|mc| mc.capability_overrides.as_deref()),
    );

    let context_limit = assistant.as_ref()
        .filter(|a| a.context_limit > 0)
        .map(|a| a.context_limit as usize)
        .or_else(|| model_config.as_ref().map(|mc| mc.context_window as usize))
        .unwrap_or_else(|| caps.max_context_tokens.map(|t| t as usize).unwrap_or(128_000));
    let max_output = model_config.as_ref()
        .and_then(|mc| mc.max_output_tokens.map(|t| t as usize))
        .or_else(|| caps.max_output_tokens.map(|t| t as usize))
        .unwrap_or(16_384);
    let compact_threshold_override = model_config.as_ref().map(|mc| mc.compact_threshold as usize);
    let mut budget = TokenBudget::new(&provider_type, &model, context_limit, max_output, compact_threshold_override);

    let circuit_breaker = {
        let breakers = app.state::<CompactBreakers>();
        let mut map = breakers.0.lock().await;
        map.entry(conversation_id.clone())
            .or_insert_with(|| Arc::new(CompactCircuitBreaker::new()))
            .clone()
    };

    // Auto-compact: if enabled and tokens exceed threshold, compact before sending
    let original_cursor = compact_cursor;
    let mut compact_cursor = compact_cursor;
    if auto_compact && circuit_breaker.can_compact() {
        let pre_msgs = build_messages(system_prompt.trim(), &history, &message, compact_cursor);
        budget.update_estimate(&pre_msgs);
        if budget.needs_compact() && history.len() > keep_recent * 2 + 2 {
            app.emit("compact-start", serde_json::json!({
                "conversation_id": &conversation_id,
                "mid_turn": false,
                "trigger": "threshold",
            })).ok();
            match do_compact(&pool, &secrets.0, &conversation_id, assistant.as_ref(), keep_recent, None).await {
                Ok(new_cursor) => {
                    compact_cursor = Some(new_cursor);
                    circuit_breaker.record_success();
                    app.emit("compact-done", serde_json::json!({
                        "conversation_id": &conversation_id,
                        "mid_turn": false,
                    })).ok();
                }
                Err(e) => {
                    tracing::warn!("Auto-compact failed: {e}");
                    circuit_breaker.record_failure();
                    app.emit("compact-done", serde_json::json!({
                        "conversation_id": &conversation_id,
                        "mid_turn": false,
                    })).ok();
                }
            }
        }
    }

    // Reload history if auto-compact changed the cursor
    let history = if compact_cursor != original_cursor {
        let pool2 = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::message::list_messages(&mut conn, &conv_id).ok()
        }).await.ok().flatten().unwrap_or(history)
    } else {
        history
    };

    let mut chat_messages = build_messages(system_prompt.trim(), &history, &message, compact_cursor);
    let files_root = app.path().app_data_dir().ok().map(|d| crate::files::files_dir(&d));
    resolve_file_uris_in_messages(&mut chat_messages, files_root.as_deref());
    remove_orphan_tool_messages(&mut chat_messages);
    microcompact(&mut chat_messages, &budget, keep_recent);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    // Precedence: per-request override > conversation preference > assistant default.
    let (conv_thinking_level, conv_fast_mode) = conv_prefs;
    let effective_level = thinking_level.as_deref().or(conv_thinking_level.as_deref());
    let (thinking_enabled, thinking_budget, thinking_effort) = provider::capabilities::resolve_thinking(
        assistant.as_ref().map(|a| a.thinking_enabled != 0).unwrap_or(false),
        assistant.as_ref().and_then(|a| a.thinking_budget),
        effective_level,
    );

    let mut params = ChatParams {
        model: model.clone(),
        temperature: assistant.as_ref().and_then(|a| a.temperature.map(|t| t as f64)),
        top_p: assistant.as_ref().and_then(|a| a.top_p.map(|t| t as f64)),
        max_tokens: assistant.as_ref().and_then(|a| a.max_tokens).or(Some(max_output as i32)),
        thinking_enabled,
        thinking_budget,
        thinking_effort,
        fast: fast.unwrap_or(conv_fast_mode),
        // thinking_style and verbosity are derived from the model catalog by
        // filter_params below, not supplied by the caller.
        ..Default::default()
    };
    provider::capabilities::filter_params(&mut params, &caps);

    // Persist user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let mut assistant_msg_id = String::new();
    let now = now_ms();

    {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg = message.clone();
        let msg_id = user_msg_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user", content: &msg,
                provider_id: None, model_id: None, input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None, sort_order: 0, created_at: now,
                reasoning_content: None, rating: None, schema_version: 2, is_compact_summary: 0,
                // Desktop chats have a single implicit speaker.
                sender_id: None,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Shell preference
    let (shell_type, sandbox_pref, sleep_pref) = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let shell = db::ops::preference::get_preference(&mut conn, "shell").ok().flatten();
            let sandbox = db::ops::preference::get_preference(&mut conn, "sandbox.enabled").ok().flatten();
            let sleep = db::ops::preference::get_preference(&mut conn, "sleep_inhibitor.enabled").ok().flatten();
            Some((shell, sandbox, sleep))
        }).await.ok().flatten().unwrap_or((None, None, None))
    };
    // Missing preference means enabled: sandbox-by-default on Windows.
    let sandbox_enabled = sandbox_pref.as_deref() != Some("false");
    // Keep the machine awake for the rest of the turn (RAII; missing pref = enabled).
    let _sleep_guard = (sleep_pref.as_deref() != Some("false"))
        .then(|| app.state::<crate::sleep_inhibitor::AppSleepInhibitor>().begin_turn());
    let tool_secrets = {
        let pool2 = pool.clone();
        let secrets2 = secrets.0.clone();
        tokio::task::spawn_blocking(move || crate::agent::build_tool_secrets(&secrets2, &pool2))
            .await.map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "android"))]
    let sandbox_policy = crate::sandbox::default_policy_if_enabled(sandbox_enabled, project_path.as_deref());
    #[cfg(target_os = "android")]
    let _ = sandbox_enabled;
    let tool_context = tools::ToolContext {
        working_directory: project_path,
        shell: shell_type.map(|s| tools::ShellType::from_str(&s)).unwrap_or_else(tools::ShellType::default_for_platform),
        file_access,
        project_id,
        conversation_id: Some(conversation_id.clone()),
        assistant_id: assistant.as_ref().map(|a| a.id.clone()),
        db_pool: Some(pool.clone()),
        edit_session: None,
        #[cfg(not(target_os = "android"))]
        sandbox_policy,
        tool_secrets,
        cancel: cancel.clone(),
    };

    let mut total_input_tokens = 0i32;
    let mut total_output_tokens = 0i32;
    let mut last_assistant_text = String::new();
    let mut loop_guard = crate::agent::ToolLoopGuard::default();
    let mut turn_aborted = false;
    let mut stop_guard = ErrorStopGuard { app: &app, conversation_id: &conversation_id, message_id: None };

    // Unified streaming agent loop: each iteration creates a new assistant message
    loop {
        if cancel.is_cancelled() { break; }

        // Create a new assistant message for this iteration
        assistant_msg_id = uuid::Uuid::new_v4().to_string();
        {
            let pool = pool.clone();
            let conv_id = conversation_id.clone();
            let msg_id = assistant_msg_id.clone();
            let model_clone = model.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = get_conn(&pool)?;
                db::ops::message::insert_message(&mut conn, &NewMessage {
                    id: &msg_id, conversation_id: &conv_id, role: "assistant", content: "",
                    provider_id: None, model_id: Some(&model_clone), input_tokens: None,
                    output_tokens: None, tool_calls: None, tool_call_id: None, sort_order: 0,
                    created_at: now, reasoning_content: None, rating: None, schema_version: 2,
                    is_compact_summary: 0, sender_id: None,
                }).map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }).await.map_err(|e| e.to_string())??;
        }

        app.emit("chat-stream", serde_json::json!({
            "type": "message_start", "message_id": &assistant_msg_id, "conversation_id": &conversation_id,
        })).map_err(|e| e.to_string())?;
        stop_guard.message_id = Some(assistant_msg_id.clone());

        let result = {
            let mut _last_err = String::new();
            let mut attempt = 0u32;
            let mut retry_delay: Option<std::time::Duration> = None;
            loop {
                if attempt > 0 {
                    let delay = retry_delay.take()
                        .unwrap_or_else(|| crate::client::backoff(STREAM_RETRY_BASE, attempt as u64));
                    tokio::time::sleep(delay).await;
                    // Retrying replays the whole stream under the same message id;
                    // tell the UI to drop the partial content it already appended.
                    app.emit("chat-stream", serde_json::json!({
                        "type": "reset", "message_id": &assistant_msg_id, "conversation_id": &conversation_id,
                    })).ok();
                }
                let stream_result = provider.stream_chat_with_tools(
                    chat_messages.clone(), tool_defs.clone(), params.clone()
                ).await;
                let try_result = match stream_result {
                    Ok(stream) => consume_stream(stream, &app, &cancel, &assistant_msg_id, &conversation_id).await,
                    Err(e) => Err(e.to_string()),
                };
                match try_result {
                    Ok(r) => break r,
                    Err(e) if is_context_window_error(&e) => {
                        tracing::warn!("Context window error, attempting reactive compact");
                        microcompact(&mut chat_messages, &budget, keep_recent);
                        budget.update_estimate(&chat_messages);
                        if budget.needs_compact() && circuit_breaker.can_compact() {
                            app.emit("compact-start", serde_json::json!({
                                "conversation_id": &conversation_id,
                                "mid_turn": true,
                                "trigger": "api_error",
                            })).ok();
                            match mid_turn_compact(&mut chat_messages, &budget, &*provider, &params, keep_recent).await {
                                Ok(_) => {
                                    circuit_breaker.record_success();
                                    budget.update_estimate(&chat_messages);
                                }
                                Err(_) => {
                                    circuit_breaker.record_failure();
                                    let aggressive_keep = (keep_recent / 2).max(2);
                                    trim_to_context_limit(&mut chat_messages, context_limit / 2, aggressive_keep);
                                }
                            }
                            app.emit("compact-done", serde_json::json!({
                                "conversation_id": &conversation_id,
                                "mid_turn": true,
                                "trigger": "api_error",
                            })).ok();
                        } else {
                            let aggressive_keep = (keep_recent / 2).max(2);
                            trim_to_context_limit(&mut chat_messages, context_limit / 2, aggressive_keep);
                        }
                        app.emit("chat-stream", serde_json::json!({
                            "type": "reset", "message_id": &assistant_msg_id, "conversation_id": &conversation_id,
                        })).ok();
                        let stream = provider.stream_chat_with_tools(
                            chat_messages.clone(), tool_defs.clone(), params.clone()
                        ).await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        break consume_stream(stream, &app, &cancel, &assistant_msg_id, &conversation_id)
                            .await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                    }
                    Err(e) if is_retryable_stream_error(&e) && attempt < MAX_STREAM_RETRIES => {
                        retry_delay = crate::agent::parse_retry_after(&e);
                        _last_err = e;
                        attempt += 1;
                        continue;
                    }
                    Err(e) => return Err(e),
                }
            }
        };

        if let Some(ref u) = result.usage {
            total_input_tokens += u.prompt_tokens.unwrap_or(0);
            total_output_tokens += u.completion_tokens.unwrap_or(0);
            budget.calibrate_from_usage(u);
        }

        let has_tool_calls = !result.tool_calls.is_empty()
            && !matches!(result.finish_reason.as_deref(), Some("length") | Some("max_tokens"));

        // Persist this iteration's assistant message in OpenAI format
        let tool_calls_json = if has_tool_calls {
            Some(serialize_tool_calls_openai(&result.tool_calls))
        } else {
            None
        };
        {
            let pool = pool.clone();
            let msg_id = assistant_msg_id.clone();
            let content = result.text.clone();
            let reasoning = if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) };
            let tc_json = tool_calls_json.clone();
            let inp = result.usage.as_ref().and_then(|u| u.prompt_tokens);
            let out = result.usage.as_ref().and_then(|u| u.completion_tokens);
            tokio::task::spawn_blocking(move || {
                if let Ok(mut conn) = pool.get() {
                    let _ = db::ops::message::update_assistant_message(
                        &mut conn, &msg_id, &content,
                        reasoning.as_deref(), tc_json.as_deref(), inp, out,
                    );
                }
            }).await.map_err(|e| e.to_string())?;
        }

        last_assistant_text = result.text.clone();

        if !has_tool_calls { break; }

        let mut assistant_msg = ChatMessage::assistant_with_tools(
            &result.text, if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) }, result.tool_calls.clone()
        );
        if !result.signature.is_empty() {
            assistant_msg.signature = Some(result.signature.clone());
        }
        chat_messages.push(assistant_msg);

        for tc in &result.tool_calls {
            if cancel.is_cancelled() { break; }

            app.emit("chat-stream", serde_json::json!({
                "type": "tool_call",
                "call_id": tc.id,
                "tool_name": tc.name,
                "arguments": tc.arguments,
                "message_id": &assistant_msg_id,
                "conversation_id": &conversation_id,
            })).map_err(|e| e.to_string())?;

            let tool_allowed = enabled_tools.as_ref()
                .map(|e| e.contains(&tc.name))
                .unwrap_or(true);
            let is_mcp = tc.name.starts_with("mcp__");
            let tool = if tool_allowed && !is_mcp { tool_registry.0.get(&tc.name) } else { None };
            // Loop detection runs before approval so a stuck model can't spam
            // the user with approval dialogs.
            let verdict = loop_guard.observe(&tc.name, &tc.arguments);
            let (result, outcome): (String, &'static str) = if let crate::agent::LoopVerdict::Warn(n) = verdict {
                (crate::agent::loop_warning_message(&tc.name, n), "error")
            } else if let crate::agent::LoopVerdict::Abort(n) = verdict {
                turn_aborted = true;
                (crate::agent::loop_abort_message(&tc.name, n), "error")
            } else if !tool_allowed {
                ("Tool not available for this assistant.".to_string(), "error")
            } else if tc.name == "ask_user" {
                match wait_for_approval(&app, &cancel, tc, &assistant_msg_id, &conversation_id, None).await? {
                    Some(ApprovalDecision::Response(text)) => (text, "success"),
                    _ => ("User did not respond.".to_string(), "denied"),
                }
            } else if is_mcp {
                // External MCP tools require explicit user approval, same as
                // built-in Ask tools — they must not bypass the authorizer.
                match wait_for_approval(&app, &cancel, tc, &assistant_msg_id, &conversation_id, None).await? {
                    Some(ApprovalDecision::Approved) => {
                        let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                            .unwrap_or_else(|_| serde_json::json!({}));
                        let mcp = app.state::<AppMcp>();
                        let mut mgr = mcp.0.lock().await;
                        match mgr.call_tool(&tc.name, args).await {
                            Ok(output) => (output, "success"),
                            Err(e) => (format!("MCP error: {e}"), "error"),
                        }
                    }
                    Some(ApprovalDecision::Denied(Some(reason))) =>
                        (format!("Tool call denied by user. Reason: {reason}"), "denied"),
                    _ => ("Tool call denied by user.".to_string(), "denied"),
                }
            } else if let Some(tool) = tool {
                let permission = tool.default_permission();
                let (approved, deny_reason): (bool, Option<String>) = match permission {
                    tools::Permission::Always => (true, None),
                    tools::Permission::Never => (false, None),
                    tools::Permission::Ask => {
                        match wait_for_approval(&app, &cancel, tc, &assistant_msg_id, &conversation_id, None).await? {
                            Some(ApprovalDecision::Approved) => (true, None),
                            Some(ApprovalDecision::Denied(reason)) => (false, reason),
                            _ => (false, None),
                        }
                    }
                };
                if approved {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    match tool.execute(args.clone(), &tool_context).await {
                        Ok(output) => (output, "success"),
                        Err(e) => match tools::decode_sandbox_denied(&e) {
                            Some(blocked) => {
                                // Sandbox blocked the command — offer a
                                // user-approved retry without sandbox
                                // (Codex-style escalation). The synthetic
                                // ":retry" id exists only in the approval
                                // channel; results keep the original id.
                                let retry_tc = provider::ToolCall {
                                    id: format!("{}:retry", tc.id),
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                };
                                let escalation = EscalationReq {
                                    origin_call_id: &tc.id,
                                    reason: blocked,
                                };
                                match wait_for_approval(
                                    &app, &cancel, &retry_tc,
                                    &assistant_msg_id, &conversation_id,
                                    Some(escalation),
                                ).await? {
                                    Some(ApprovalDecision::Approved) => {
                                        let escalated_ctx = tool_context.without_sandbox();
                                        match tool.execute(args, &escalated_ctx).await {
                                            Ok(o) => (o, "success"),
                                            Err(e2) => (format!("Error: {e2}"), "error"),
                                        }
                                    }
                                    _ => (
                                        format!("{blocked}\n[blocked by sandbox; user declined to retry without sandbox]"),
                                        "denied",
                                    ),
                                }
                            }
                            None => (format!("Error: {e}"), "error"),
                        },
                    }
                } else if let Some(reason) = deny_reason {
                    (format!("Tool call denied by user. Reason: {reason}"), "denied")
                } else {
                    ("Tool call denied by user.".to_string(), "denied")
                }
            } else {
                (format!("Unknown tool: {}", tc.name), "error")
            };
            let result = crate::agent::formatted_truncate_text(&result, crate::agent::TOOL_OUTPUT_TRUNCATION);

            app.emit("chat-stream", serde_json::json!({
                "type": "tool_result",
                "call_id": tc.id,
                "result": &result,
                "outcome": outcome,
                "message_id": &assistant_msg_id,
                "conversation_id": &conversation_id,
            })).map_err(|e| e.to_string())?;

            {
                let pool = pool.clone();
                let conv_id = conversation_id.clone();
                let tool_msg_id = uuid::Uuid::new_v4().to_string();
                let call_id = tc.id.clone();
                let tool_result = result.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::message::insert_message(&mut conn, &NewMessage {
                            id: &tool_msg_id, conversation_id: &conv_id, role: "tool",
                            content: &tool_result, provider_id: None, model_id: None,
                            input_tokens: None, output_tokens: None,
                            tool_calls: None, tool_call_id: Some(&call_id),
                            sort_order: 0, created_at: now,
                            reasoning_content: None, rating: None, schema_version: 2,
                            is_compact_summary: 0, sender_id: None,
                        });
                    }
                }).await;
            }

            chat_messages.push(ChatMessage::tool_result(&tc.id, &result));

            if turn_aborted { break; }
        }

        if cancel.is_cancelled() || turn_aborted { break; }

        // Mid-turn compaction check after tool calls
        budget.update_estimate(&chat_messages);
        if budget.needs_compact() && auto_compact && circuit_breaker.can_compact() {
            app.emit("compact-start", serde_json::json!({
                "conversation_id": &conversation_id,
                "mid_turn": true,
                "trigger": "threshold",
            })).ok();

            let reclaimed = microcompact(&mut chat_messages, &budget, keep_recent);
            budget.update_estimate(&chat_messages);

            if budget.needs_compact() {
                match mid_turn_compact(&mut chat_messages, &budget, &*provider, &params, keep_recent).await {
                    Ok(more) => {
                        circuit_breaker.record_success();
                        budget.update_estimate(&chat_messages);
                        app.emit("compact-done", serde_json::json!({
                            "conversation_id": &conversation_id,
                            "mid_turn": true,
                            "tokens_reclaimed": reclaimed + more,
                        })).ok();
                    }
                    Err(e) => {
                        tracing::warn!("Mid-turn compact failed: {e}");
                        circuit_breaker.record_failure();
                        trim_to_context_limit(&mut chat_messages, context_limit / 2, (keep_recent / 2).max(2));
                        budget.update_estimate(&chat_messages);
                        app.emit("compact-done", serde_json::json!({
                            "conversation_id": &conversation_id,
                            "mid_turn": true,
                            "fallback": true,
                        })).ok();
                    }
                }
            } else if reclaimed > 0 {
                app.emit("compact-done", serde_json::json!({
                    "conversation_id": &conversation_id,
                    "mid_turn": true,
                    "tokens_reclaimed": reclaimed,
                })).ok();
            } else {
                app.emit("compact-done", serde_json::json!({
                    "conversation_id": &conversation_id,
                    "mid_turn": true,
                })).ok();
            }
        }
    }

    // Clean up cancel token
    {
        let chats = app.state::<ActiveChats>();
        chats.0.lock().await.remove(&conversation_id);
    }

    let cost_info = model_config.as_ref()
        .filter(|mc| crate::agent::pricing::has_pricing(mc))
        .map(|mc| {
            let usage = crate::provider::TokenUsage {
                prompt_tokens: Some(total_input_tokens),
                completion_tokens: Some(total_output_tokens),
                total_tokens: Some(total_input_tokens + total_output_tokens),
                cache_hit_tokens: None,
                cache_miss_tokens: None,
            };
            crate::agent::pricing::compute_cost(&usage, mc)
        });

    let stop_reason = if turn_aborted { "loop_detected" } else { "end_turn" };
    let mut stop_payload = serde_json::json!({
        "type": "stop", "reason": stop_reason, "done": true,
        "message_id": &assistant_msg_id,
        "conversation_id": &conversation_id,
        "input_tokens": total_input_tokens, "output_tokens": total_output_tokens,
    });
    if let Some(cost) = cost_info {
        stop_payload["cost"] = serde_json::json!(cost.total_cost);
        stop_payload["cost_breakdown"] = serde_json::json!({
            "input": cost.input_cost,
            "output": cost.output_cost,
            "cache": cost.cache_cost,
        });
    }
    app.emit("chat-stream", stop_payload).map_err(|e| e.to_string())?;
    stop_guard.message_id = None;

    // Auto-generate title if first message
    if conv_title.is_none() {
        let title_messages = vec![ChatMessage::user(&format!(
            "Generate a short title (max 6 words, no quotes, no punctuation) for this conversation:\nUser: {}\nAssistant: {}",
            &message,
            take_bytes_at_char_boundary(&last_assistant_text, 300)
        ))];
        let title_params = ChatParams {
            model: params.model,
            temperature: Some(0.3),
            ..Default::default()
        };
        if let Ok(title) = provider.chat(title_messages, title_params).await {
            let title = title.trim().trim_matches('"').trim_matches('\'').to_string();
            if !title.is_empty() {
                let pool = pool.clone();
                let conv_id = conversation_id.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::conversation::update_title(&mut conn, &conv_id, &title, now_ms());
                    }
                }).await;
                app.emit("conversation-updated", serde_json::json!({
                    "id": conversation_id,
                })).ok();
            }
        }
    }

    Ok(())
}
