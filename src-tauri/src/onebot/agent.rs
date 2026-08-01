use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::db::models::message::NewMessage;
use crate::mcp::McpManager;
use crate::provider::{self, ChatMessage, ChatParams, ChatStream, StreamEvent, ToolCall};
use crate::secrets::SecretsManager;
use crate::tools::{self, ToolRegistry};
use crate::util::{get_conn, now_ms};
use crate::agent::{build_messages_with_senders, is_context_window_error, is_retryable_stream_error, microcompact, mid_turn_compact, resolve_provider_config, trim_to_context_limit, StreamResult, TokenBudget, MAX_STREAM_RETRIES, STREAM_RETRY_BASE};

/// `(tool_call, sandbox_block_reason)` → approved. The reason is `Some` only
/// for the retry-without-sandbox escalation ask, so the prompt can say why a
/// second approval for the same call is being requested.
pub type ApprovalFn = Box<dyn Fn(ToolCall, Option<String>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// Called with each tool-calling iteration's assistant text before the tools
/// execute, so headless frontends can deliver mid-turn commentary in order
/// (the final iteration's text is the return value instead).
pub type TextNotifyFn = Box<dyn Fn(String) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

struct ErrorStopGuard<'a> {
    app: Option<&'a tauri::AppHandle>,
    conversation_id: &'a str,
    message_id: Option<String>,
}

impl Drop for ErrorStopGuard<'_> {
    fn drop(&mut self) {
        if let (Some(app), Some(message_id)) = (self.app, self.message_id.as_ref()) {
            let _ = app.emit("chat-stream", serde_json::json!({
                "type": "stop", "reason": "error", "done": true,
                "message_id": message_id,
                "conversation_id": self.conversation_id,
            }));
        }
    }
}

async fn consume_stream_headless(
    mut stream: ChatStream,
    cancel: &CancellationToken,
    app: Option<&tauri::AppHandle>,
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
                    Ok(Some(Ok(StreamEvent::Text { content: ref s }))) => {
                        let chunk = think_parser.push_str(s);
                        if !chunk.visible_text.is_empty() {
                            text.push_str(&chunk.visible_text);
                            if let Some(app) = app {
                                let _ = app.emit("chat-stream", serde_json::json!({
                                    "type": "text", "content": &chunk.visible_text, "message_id": message_id,
                                    "conversation_id": conversation_id,
                                }));
                            }
                        }
                        for tag in &chunk.extracted {
                            reasoning.push_str(&tag.content);
                            if let Some(app) = app {
                                let _ = app.emit("chat-stream", serde_json::json!({
                                    "type": "reasoning", "content": &tag.content, "message_id": message_id,
                                    "conversation_id": conversation_id,
                                }));
                            }
                        }
                    }
                    Ok(Some(Ok(StreamEvent::Reasoning { content: ref s }))) => {
                        reasoning.push_str(s);
                        if let Some(app) = app {
                            let _ = app.emit("chat-stream", serde_json::json!({
                                "type": "reasoning", "content": s, "message_id": message_id,
                                "conversation_id": conversation_id,
                            }));
                        }
                    }
                    Ok(Some(Ok(StreamEvent::ReasoningSignature { signature: ref s }))) => {
                        signature.push_str(s);
                    }
                    Ok(Some(Ok(StreamEvent::ToolCallStart { index, ref id, ref name }))) => {
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
                    Ok(Some(Ok(StreamEvent::ToolCallDelta { index, ref arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2.push_str(arguments);
                        }
                    }
                    Ok(Some(Ok(StreamEvent::ToolCallDone { index, ref arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2 = arguments.clone();
                        }
                    }
                    Ok(Some(Ok(StreamEvent::UsageUpdate { usage: ref u }))) => {
                        usage = Some(u.clone());
                    }
                    Ok(Some(Ok(StreamEvent::Stop { ref reason, usage: ref u }))) => {
                        if let Some(u) = u {
                            usage = Some(u.clone());
                        }
                        finish_reason = Some(reason.clone());
                    }
                    Ok(Some(Ok(StreamEvent::Error { ref message }))) => {
                        return Err(message.clone());
                    }
                    Ok(Some(Ok(StreamEvent::MessageStart { .. }))) => {}
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
        if let Some(app) = app {
            if !tail.visible_text.is_empty() {
                let _ = app.emit("chat-stream", serde_json::json!({
                    "type": "text", "content": &tail.visible_text, "message_id": message_id,
                    "conversation_id": conversation_id,
                }));
            }
            for tag in &tail.extracted {
                let _ = app.emit("chat-stream", serde_json::json!({
                    "type": "reasoning", "content": &tag.content, "message_id": message_id,
                    "conversation_id": conversation_id,
                }));
            }
        }
    }
    text.push_str(&tail.visible_text);
    for tag in tail.extracted {
        reasoning.push_str(&tag.content);
    }

    let tool_calls: Vec<provider::ToolCall> = if cancel.is_cancelled() {
        vec![]
    } else {
        tool_acc
            .into_iter()
            .filter(|(id, _, _)| !id.is_empty())
            .map(|(id, name, args)| provider::ToolCall { id, name, arguments: args })
            .collect()
    };

    Ok(StreamResult { text, reasoning, signature, tool_calls, usage, finish_reason })
}

/// One model call with no tools, no history and no persistence — used by the
/// post-turn extraction pass.
///
/// Kept separate from `headless_chat` on purpose: this must not be able to call
/// tools, write messages, or otherwise act on the conversation. It only reads
/// what happened and answers a question about it.
pub(super) async fn oneshot_completion(
    state: &Arc<super::SharedState>,
    conversation_id: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let assistant = {
        let pool = state.pool.clone();
        let conv_id = conversation_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = crate::db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(conv.assistant_id.and_then(|id| {
                crate::db::ops::assistant::get_assistant(&mut conn, &id).ok()
            }))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    let (provider_type, base_url, api_key, model, api_format) =
        resolve_provider_config(&state.secrets, &state.pool, assistant.as_ref())?;
    let provider =
        provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    let effective_model = assistant
        .as_ref()
        .and_then(|a| a.model_id.as_deref())
        .unwrap_or(&model);

    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: system_prompt.into(),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            signature: None,
            origin: provider::MessageOrigin::Assistant,
        },
        // The transcript is data being analysed, not an instruction being
        // followed, and it carries no speaker of its own.
        ChatMessage::system_context(user_prompt),
    ];

    // Resolved like any other turn: an extraction request that invents its own
    // temperature is rejected by models the chat path already talks to.
    let turn = crate::agent::resolve_turn_params(&state.pool, crate::agent::TurnParamsInput {
        assistant: assistant.as_ref(),
        provider_id: assistant.as_ref().and_then(|a| a.provider_id.as_deref()),
        provider_type: &provider_type,
        api_format: &api_format,
        model: effective_model,
        thinking_level: None,
        fast: false,
    })?;

    provider
        .chat(messages, crate::agent::without_thinking(turn.params))
        .await
        .map_err(|e| e.to_string())
}

/// Run a headless chat session with optional Tauri event streaming.
///
/// - `is_admin`: controls whether tools are available at all
/// - `approval_fn`: called for Ask-permission tools (admin only); returns true to approve
/// - `app`: when `Some`, emits `chat-stream` events for real-time UI updates
#[allow(clippy::too_many_arguments)]
pub async fn headless_chat(
    pool: &DbPool,
    secrets: &SecretsManager,
    tool_registry: &Arc<ToolRegistry>,
    mcp_manager: &Arc<Mutex<McpManager>>,
    conversation_id: &str,
    project_id: Option<&str>,
    // This turn's inbound messages, each keeping its own speaker. Several
    // arrive at once when messages queued up while a previous turn was running.
    incoming: &[super::IncomingMessage],
    assistant_id: Option<&str>,
    model_override: Option<&str>,
    is_admin: bool,
    approval_fn: &ApprovalFn,
    interim_text_fn: Option<&TextNotifyFn>,
    cancel: &CancellationToken,
    app: Option<&tauri::AppHandle>,
    qq_tools: Option<&super::qq_tools::QqToolExecutor>,
    session_inbox: Option<&super::InboxHandle>,
) -> Result<String, String> {
    // Keep the machine awake for the rest of the turn (RAII; missing pref = enabled).
    let _sleep_guard = {
        let sleep_pref = {
            let pool = pool.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                crate::db::ops::preference::get_preference(&mut conn, "sleep_inhibitor.enabled").ok().flatten()
            }).await.ok().flatten()
        };
        app.filter(|_| sleep_pref.as_deref() != Some("false"))
            .map(|a| a.state::<crate::sleep_inhibitor::AppSleepInhibitor>().begin_turn())
    };

    // Load assistant + the conversation's active path
    let (assistant, ctx) = {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let aid = assistant_id.map(String::from);
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = crate::db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let effective_aid = aid.as_deref().or(conv.assistant_id.as_deref());
            let assistant = effective_aid
                .and_then(|aid| crate::db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = crate::db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            // Resolved once and carried for the turn; see the desktop loop for
            // why the head is not re-read per row.
            let ctx = crate::db::ops::message::active_context(&history, conv.head_message_id.as_deref());
            Ok::<_, String>((assistant, ctx))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // Resolve provider
    let (provider_type, base_url, api_key, model, api_format) =
        resolve_provider_config(secrets, pool, assistant.as_ref())?;
    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    // The same resolver the desktop loop uses. Sharing it is what keeps a QQ
    // assistant's tool set honest: this path used to read `enabled_tools` only,
    // so an assistant configured with a tool preset quietly got a different set
    // here than in the app.
    //
    // Collaboration modes stay off: a headless turn has no way to switch them,
    // and a QQ session already cannot touch the filesystem (its file access is
    // an empty root set), so plan mode would guard nothing.
    let mcp_defs = if is_admin {
        let mgr = mcp_manager.lock().await;
        mgr.all_tool_definitions()
    } else {
        Vec::new()
    };
    let turn = {
        let pool2 = pool.clone();
        let registry = tool_registry.clone();
        let input = crate::agent::turn_config::TurnConfigInput {
            assistant: assistant.clone(),
            conversation_id: conversation_id.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            mode: crate::agent::modes::resolve(None),
            mcp_defs,
            // Non-admin sessions get no registry or MCP tools at all; the
            // scope-locked QQ tools are appended further down.
            include_tools: is_admin,
            persona: assistant.as_ref().map(|a| a.system_prompt.clone()).unwrap_or_default(),
            // Memory is absent on purpose — it ships as a user-role message.
            context_blocks: Vec::new(),
        };
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            Ok::<_, String>(crate::agent::turn_config::resolve(&mut conn, &registry, input))
        }).await.map_err(|e| e.to_string())??
    };
    let mut tool_defs = turn.tool_defs;
    let system_prompt = turn.system_prompt;
    let effective_model = model_override
        .or(assistant.as_ref().and_then(|a| a.model_id.as_deref()))
        .unwrap_or(&model);
    // Same resolution as the desktop chat command, so a per-model config the
    // user wrote applies here too. No per-request tier: OneBot turns run off
    // the assistant's stored defaults.
    let turn_params = crate::agent::resolve_turn_params(pool, crate::agent::TurnParamsInput {
        assistant: assistant.as_ref(),
        provider_id: assistant.as_ref().and_then(|a| a.provider_id.as_deref()),
        provider_type: &provider_type,
        api_format: &api_format,
        model: effective_model,
        thinking_level: None,
        fast: false,
    })?;
    let context_limit = turn_params.context_limit;

    // Who this turn may recall. A private chat is about the one person on the
    // other end; a group is about whoever actually spoke, filtered so nothing
    // learned one-to-one can surface in front of everyone.
    let is_group = incoming.iter().any(|m| m.sender.as_ref().is_some_and(|s| s.is_group));
    let subjects: Vec<crate::agent::MemorySubjectRef> = incoming
        .iter()
        .filter_map(|m| m.sender.as_ref())
        .map(|s| crate::agent::MemorySubjectRef::from_user(s.user_id, s.nickname.clone()))
        .collect();
    let budget_tokens = crate::agent::memory_budget(context_limit);
    let memory_request = if is_group {
        crate::agent::MemoryRequest::onebot_group(
            project_id.map(|s| s.to_string()),
            subjects,
            budget_tokens,
        )
    } else {
        match subjects.into_iter().next() {
            Some(subject) => crate::agent::MemoryRequest::onebot_private(subject, budget_tokens),
            None => crate::agent::MemoryRequest::desktop(
                project_id.map(|s| s.to_string()),
                budget_tokens,
            ),
        }
    };
    let memory_block = crate::agent::load_memory_block(pool, memory_request).await;
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);

    let mut budget = TokenBudget::new(
        &provider_type,
        effective_model,
        context_limit,
        turn_params.max_output,
        turn_params.compact_threshold,
    );

    // Nicknames are not on the message row (they change), so history is
    // re-attributed from the subject table.
    let sender_names = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let subjects = crate::db::ops::memory::list_subjects(&mut conn)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(
                subjects
                    .into_iter()
                    .filter_map(|s| {
                        let uid = s.user_id()?;
                        Some((uid, s.display_name?))
                    })
                    .collect::<crate::agent::SenderNames>(),
            )
        })
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default()
    };

    // Memory first, then what was just said: the block is background for
    // reading the message, not a reply to it.
    let mut trailing: Vec<provider::ChatMessage> = Vec::new();
    if let Some(block) = memory_block.as_deref().filter(|b| !b.trim().is_empty()) {
        trailing.push(provider::ChatMessage::system_context(block.trim_start()));
    }
    trailing.extend(incoming.iter().map(|m| match m.sender.as_ref() {
        Some(s) => provider::ChatMessage::user_from(&m.text, s.into()),
        None => provider::ChatMessage::user(&m.text),
    }));

    let mut chat_messages = build_messages_with_senders(
        &system_prompt,
        &ctx,
        trailing,
        &sender_names,
    );
    let files_root = app.and_then(|a| {
        use tauri::Manager;
        a.path().app_data_dir().ok()
    }).map(|d| crate::files::files_dir(&d));
    crate::agent::resolve_file_uris_in_messages(&mut chat_messages, files_root.as_deref());
    microcompact(&mut chat_messages, &budget, keep_recent);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let mut params = turn_params.params;

    // Session-scoped QQ tools are available to everyone (read-only, scope-locked)
    if let Some(qq) = qq_tools {
        tool_defs.extend(qq.definitions());
    }
    // Drop every tool when the effective model can't use them, so the provider
    // omits the tools field entirely (some models 400 on any tools param). Also
    // guards admins who pick a non-tool model.
    let caps = crate::provider::registry::get_capabilities(
        &provider_type, Some(&api_format), &params.model,
    );
    if !caps.supports_tools {
        tool_defs.clear();
    }
    // Only tools actually offered this turn may execute; blocks non-admin (and
    // enabled_tools-filtered) sessions from invoking registry/MCP tools by name.
    let offered: std::collections::HashSet<String> =
        tool_defs.iter().map(|t| t.name.clone()).collect();

    // Persist this turn's inbound messages, one row each so every speaker keeps
    // their own attribution. They share one timestamp because they were drained
    // as a single batch; every row written later in the turn stamps its own
    // now_ms() so relative times differ and the turn's elapsed time is derivable.
    let now = now_ms();
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let mut assistant_msg_id = String::new();
    // Walks down the branch as the turn writes. A group turn can open with
    // several user rows, and steering can add more mid-flight, so this has to be
    // a cursor rather than one precomputed parent.
    let mut parent_cursor: Option<String> = ctx.head_id.clone();
    {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let first_id = user_msg_id.clone();
        let rows: Vec<(String, String, Option<i64>)> = incoming
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let id = if i == 0 { first_id.clone() } else { uuid::Uuid::new_v4().to_string() };
                (id, m.text.clone(), m.sender.as_ref().map(|s| s.user_id))
            })
            .collect();
        let mut parent = parent_cursor.clone();
        parent_cursor = rows.last().map(|(id, _, _)| id.clone()).or(parent_cursor);
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            for (msg_id, msg, sender_id) in &rows {
                crate::db::ops::message::append_message(&mut conn, &NewMessage {
                    id: msg_id, conversation_id: &conv_id, role: "user", content: msg,
                    provider_id: None, model_id: None, input_tokens: None, output_tokens: None,
                    tool_calls: None, tool_call_id: None, sort_order: 0, created_at: now,
                    reasoning_content: None, rating: None, schema_version: 2, is_compact_summary: 0,
                    sender_id: *sender_id,
                    parent_id: None, compact_anchor_id: None, source: None,
                }, parent.as_deref()).map_err(|e| e.to_string())?;
                // Queued messages chain to each other, not all to the same parent.
                parent = Some(msg_id.clone());
            }
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Build tool context
    let (shell_type, sandbox_pref) = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let shell = crate::db::ops::preference::get_preference(&mut conn, "shell").ok().flatten();
            let sandbox = crate::db::ops::preference::get_preference(&mut conn, "sandbox.enabled").ok().flatten();
            Some((shell, sandbox))
        }).await.ok().flatten().unwrap_or((None, None))
    };
    // Missing preference means enabled. Headless sessions have no project dir,
    // so writable roots shrink to TEMP — failures surface as escalation asks.
    let sandbox_enabled = sandbox_pref.as_deref() != Some("false");
    #[cfg(target_os = "android")]
    let _ = sandbox_enabled;
    let tool_context = tools::ToolContext {
        working_directory: None,
        shell: shell_type.map(|s| tools::ShellType::from_str(&s))
            .unwrap_or_else(tools::ShellType::default_for_platform),
        // Headless (QQ) sessions have no project dir, and Unrestricted access
        // with no directory to be restricted to is the whole host filesystem.
        // An empty root set denies every path at the validation layer instead.
        file_access: tools::FileAccess::Roots(vec![]),
        project_id: project_id.map(|s| s.to_string()),
        conversation_id: Some(conversation_id.to_string()),
        assistant_id: assistant_id.map(|s| s.to_string()),
        db_pool: Some(pool.clone()),
        edit_session: None,
        #[cfg(not(target_os = "android"))]
        sandbox_policy: crate::sandbox::default_policy_if_enabled(sandbox_enabled, None),
        tool_secrets: {
            let pool2 = pool.clone();
            let secrets2 = secrets.clone();
            tokio::task::spawn_blocking(move || crate::agent::build_tool_secrets(&secrets2, &pool2))
                .await.map_err(|e| e.to_string())?
        },
        cancel: cancel.clone(),
    };

    // Agent loop: each iteration creates a new assistant message
    let mut total_input_tokens = 0i32;
    let mut total_output_tokens = 0i32;
    let mut last_assistant_text = String::new();
    let mut stop_guard = ErrorStopGuard { app, conversation_id, message_id: None };
    let mut loop_guard = crate::agent::ToolLoopGuard::default();
    let mut turn_aborted = false;

    loop {
        if cancel.is_cancelled() { break; }

        // Create a new assistant message for this iteration
        assistant_msg_id = uuid::Uuid::new_v4().to_string();
        {
            let pool = pool.clone();
            let conv_id = conversation_id.to_string();
            let msg_id = assistant_msg_id.clone();
            let model_clone = params.model.clone();
            let parent = parent_cursor.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = get_conn(&pool)?;
                crate::db::ops::message::append_message(&mut conn, &NewMessage {
                    id: &msg_id, conversation_id: &conv_id, role: "assistant", content: "",
                    provider_id: None, model_id: Some(&model_clone), input_tokens: None,
                    output_tokens: None, tool_calls: None, tool_call_id: None, sort_order: 0,
                    created_at: now_ms(), reasoning_content: None, rating: None, schema_version: 2,
                    is_compact_summary: 0, sender_id: None,
                    parent_id: None, compact_anchor_id: None, source: None,
                }, parent.as_deref()).map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }).await.map_err(|e| e.to_string())??;
        }
        parent_cursor = Some(assistant_msg_id.clone());

        if let Some(app) = app {
            let _ = app.emit("chat-stream", serde_json::json!({
                "type": "message_start", "message_id": &assistant_msg_id,
                "conversation_id": conversation_id,
            }));
            stop_guard.message_id = Some(assistant_msg_id.clone());
        }

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
                    // tell any attached UI to drop the partial content.
                    if let Some(app) = app {
                        let _ = app.emit("chat-stream", serde_json::json!({
                            "type": "reset", "message_id": &assistant_msg_id, "conversation_id": conversation_id,
                        }));
                    }
                }
                let stream_result = provider.stream_chat_with_tools(
                    chat_messages.clone(), tool_defs.clone(), params.clone()
                ).await;
                let try_result = match stream_result {
                    Ok(stream) => consume_stream_headless(stream, cancel, app, &assistant_msg_id, conversation_id).await,
                    Err(e) => Err(e.to_string()),
                };
                match try_result {
                    Ok(r) => break r,
                    Err(e) if is_context_window_error(&e) => {
                        let aggressive_keep = (keep_recent / 2).max(2);
                        trim_to_context_limit(&mut chat_messages, context_limit / 2, aggressive_keep);
                        if let Some(app) = app {
                            let _ = app.emit("chat-stream", serde_json::json!({
                                "type": "reset", "message_id": &assistant_msg_id, "conversation_id": conversation_id,
                            }));
                        }
                        let stream = provider.stream_chat_with_tools(
                            chat_messages.clone(), tool_defs.clone(), params.clone()
                        ).await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        break consume_stream_headless(stream, cancel, app, &assistant_msg_id, conversation_id)
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
            Some(crate::agent::serialize_tool_calls_openai(&result.tool_calls))
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
                    let _ = crate::db::ops::message::update_assistant_message(
                        &mut conn, &msg_id, &content,
                        reasoning.as_deref(), tc_json.as_deref(), inp, out,
                    );
                }
            }).await.map_err(|e| e.to_string())?;
        }

        last_assistant_text = result.text.clone();

        if !has_tool_calls { break; }

        // Mid-turn commentary would otherwise never leave the DB: only the
        // final iteration's text is returned to the caller.
        if !result.text.is_empty() {
            if let Some(notify) = interim_text_fn {
                (notify)(result.text.clone()).await;
            }
        }

        let mut assistant_msg = ChatMessage::assistant_with_tools(
            &result.text,
            if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) },
            result.tool_calls.clone(),
        );
        if !result.signature.is_empty() {
            assistant_msg.signature = Some(result.signature.clone());
        }
        chat_messages.push(assistant_msg);

        for tc in &result.tool_calls {
            if cancel.is_cancelled() { break; }

            if let Some(app) = app {
                let _ = app.emit("chat-stream", serde_json::json!({
                    "type": "tool_call",
                    "call_id": tc.id, "tool_name": tc.name,
                    "arguments": tc.arguments,
                    "message_id": &assistant_msg_id,
                    "conversation_id": conversation_id,
                }));
            }

            let is_mcp = tc.name.starts_with("mcp__");
            let tool = if !is_mcp { tool_registry.get(&tc.name) } else { None };

            // Loop detection runs before approval so a stuck model can't spam
            // the admin with approval prompts.
            let verdict = loop_guard.observe(&tc.name, &tc.arguments);
            let (tool_result, outcome): (String, &'static str) = if let crate::agent::LoopVerdict::Warn(n) = verdict {
                (crate::agent::loop_warning_message(&tc.name, n), "error")
            } else if let crate::agent::LoopVerdict::Abort(n) = verdict {
                turn_aborted = true;
                (crate::agent::loop_abort_message(&tc.name, n), "error")
            } else if !offered.contains(&tc.name) {
                (format!("Unknown tool: {}", tc.name), "error")
            } else if let Some(qq) = qq_tools.filter(|q| q.owns(&tc.name)) {
                // Query tools are scope-locked and read-only; action tools
                // (recall/ban/kick/…) go through the chat approval flow.
                let approved = !qq.requires_approval(&tc.name) || (approval_fn)(tc.clone(), None).await;
                if approved {
                    match qq.execute(&tc.name, &tc.arguments).await {
                        Ok(output) => (output, "success"),
                        Err(e) => (format!("Error: {e}"), "error"),
                    }
                } else {
                    ("Tool call denied by user.".to_string(), "denied")
                }
            } else if is_mcp {
                // External MCP tools require approval, same as Ask tools.
                if (approval_fn)(tc.clone(), None).await {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    let mut mgr = mcp_manager.lock().await;
                    match mgr.call_tool(&tc.name, args).await {
                        Ok(output) => (output, "success"),
                        Err(e) => (format!("MCP error: {e}"), "error"),
                    }
                } else {
                    ("Tool call denied by user.".to_string(), "denied")
                }
            } else if tc.name == "ask_user" {
                let approved = (approval_fn)(tc.clone(), None).await;
                if approved {
                    ("User approved.".to_string(), "success")
                } else {
                    ("User did not respond.".to_string(), "denied")
                }
            } else if let Some(tool) = tool {
                let permission = tool.default_permission();
                let approved = match permission {
                    tools::Permission::Always => true,
                    tools::Permission::Never => false,
                    tools::Permission::Ask => (approval_fn)(tc.clone(), None).await,
                };
                if approved {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    match tool.execute(args.clone(), &tool_context).await {
                        Ok(output) => (output, "success"),
                        Err(e) => match crate::tools::decode_sandbox_denied(&e) {
                            Some(blocked) => {
                                // Sandbox blocked the command — ask the admin
                                // (Y/N) whether to retry without sandbox.
                                let retry_tc = ToolCall {
                                    id: format!("{}:retry", tc.id),
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                };
                                if (approval_fn)(retry_tc, Some(blocked.to_string())).await {
                                    match tool.execute(args, &tool_context.without_sandbox()).await {
                                        Ok(o) => (o, "success"),
                                        Err(e2) => (format!("Error: {e2}"), "error"),
                                    }
                                } else {
                                    (
                                        format!("{blocked}\n[blocked by sandbox; user declined to retry without sandbox]"),
                                        "denied",
                                    )
                                }
                            }
                            None => (format!("Error: {e}"), "error"),
                        },
                    }
                } else {
                    ("Tool call denied by user.".to_string(), "denied")
                }
            } else {
                (format!("Unknown tool: {}", tc.name), "error")
            };
            let tool_result = crate::agent::formatted_truncate_text(&tool_result, crate::agent::TOOL_OUTPUT_TRUNCATION);

            if let Some(app) = app {
                let _ = app.emit("chat-stream", serde_json::json!({
                    "type": "tool_result",
                    "call_id": tc.id, "result": &tool_result,
                    "outcome": outcome,
                    "message_id": &assistant_msg_id,
                    "conversation_id": conversation_id,
                }));
            }

            {
                let pool = pool.clone();
                let conv_id = conversation_id.to_string();
                let tool_msg_id = uuid::Uuid::new_v4().to_string();
                let call_id = tc.id.clone();
                let result_clone = tool_result.clone();
                let parent = parent_cursor.clone();
                let written = tokio::task::spawn_blocking(move || {
                    let mut conn = pool.get().map_err(|e| e.to_string())?;
                    crate::db::ops::message::append_message(&mut conn, &NewMessage {
                        id: &tool_msg_id, conversation_id: &conv_id, role: "tool",
                        content: &result_clone, provider_id: None, model_id: None,
                        input_tokens: None, output_tokens: None,
                        tool_calls: None, tool_call_id: Some(&call_id),
                        sort_order: 0, created_at: now_ms(),
                        reasoning_content: None, rating: None, schema_version: 2,
                        is_compact_summary: 0, sender_id: None,
                        parent_id: None, compact_anchor_id: None, source: None,
                    }, parent.as_deref()).map(|_| tool_msg_id).map_err(|e| e.to_string())
                }).await;

                // Same trade as the desktop loop: the tool already ran, so keep
                // going and leave the cursor on the last row that landed.
                match written {
                    Ok(Ok(id)) => parent_cursor = Some(id),
                    Ok(Err(e)) => tracing::error!("failed to persist tool result: {e}"),
                    Err(e) => tracing::error!("tool result write panicked: {e}"),
                }
            }

            chat_messages.push(ChatMessage::tool_result(&tc.id, &tool_result));

            if turn_aborted { break; }
        }

        if cancel.is_cancelled() || turn_aborted { break; }

        // Steering: pull queued events (recalls, membership notes, user
        // messages that arrived mid-turn) into the conversation now that this
        // round's tool results are settled — the next request will see them.
        // Injecting only appends, so history and its prompt-cache prefix stay
        // intact.
        if let Some(inbox) = session_inbox {
            let items = inbox.drain().await;
            let injected_any = !items.is_empty();
            for item in items {
                let inject_msg_id = uuid::Uuid::new_v4().to_string();
                {
                    let pool = pool.clone();
                    let conv_id = conversation_id.to_string();
                    let content = item.text.clone();
                    let msg_id = inject_msg_id.clone();
                    let sender_id = item.sender.as_ref().map(|s| s.user_id);
                    let parent = parent_cursor.clone();
                    let written = tokio::task::spawn_blocking(move || {
                        let mut conn = pool.get().map_err(|e| e.to_string())?;
                        crate::db::ops::message::append_message(&mut conn, &NewMessage {
                                id: &msg_id, conversation_id: &conv_id, role: "user",
                                content: &content, provider_id: None, model_id: None,
                                input_tokens: None, output_tokens: None,
                                tool_calls: None, tool_call_id: None, sort_order: 0,
                                created_at: now_ms(), reasoning_content: None, rating: None,
                                schema_version: 2, is_compact_summary: 0, sender_id,
                                parent_id: None, compact_anchor_id: None, source: None,
                            }, parent.as_deref()).map(|_| msg_id).map_err(|e| e.to_string())
                    }).await;

                    match written {
                        Ok(Ok(id)) => parent_cursor = Some(id),
                        Ok(Err(e)) => tracing::error!("failed to persist steered message: {e}"),
                        Err(e) => tracing::error!("steered message write panicked: {e}"),
                    }
                }
                // The initial resolve pass ran before this message existed;
                // image parts inside it need their own file-URI resolution.
                // Notices carry no sender; queued user messages keep theirs.
                let mut injected = vec![match item.sender.as_ref() {
                    Some(s) => ChatMessage::user_from(&item.text, s.into()),
                    None => ChatMessage::system_context(&item.text),
                }];
                crate::agent::resolve_file_uris_in_messages(&mut injected, files_root.as_deref());
                chat_messages.extend(injected);
            }
            if injected_any {
                if let Some(app) = app {
                    let _ = app.emit("conversation-updated", serde_json::json!({"id": conversation_id}));
                }
            }
        }

        budget.update_estimate(&chat_messages);
        if budget.needs_compact() {
            microcompact(&mut chat_messages, &budget, keep_recent);
            budget.update_estimate(&chat_messages);
            if budget.needs_compact() {
                if let Err(e) = mid_turn_compact(&mut chat_messages, &budget, &*provider, &params, keep_recent).await {
                    tracing::warn!("OneBot mid-turn compact failed: {e}");
                    trim_to_context_limit(&mut chat_messages, context_limit / 2, (keep_recent / 2).max(2));
                }
                budget.update_estimate(&chat_messages);
            }
        }
    }

    stop_guard.message_id = None;
    if let Some(app) = app {
        let stop_reason = if turn_aborted { "loop_detected" } else { "end_turn" };
        let _ = app.emit("chat-stream", serde_json::json!({
            "type": "stop", "reason": stop_reason, "done": true,
            "message_id": &assistant_msg_id,
            "conversation_id": conversation_id,
            "input_tokens": total_input_tokens, "output_tokens": total_output_tokens,
        }));
    }

    Ok(last_assistant_text)
}
