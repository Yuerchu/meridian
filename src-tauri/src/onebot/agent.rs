use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::db::models::message::NewMessage;
use crate::mcp::McpManager;
use crate::provider::{self, ChatMessage, ChatParams, ChatStream, StreamEvent, ToolCall};
use crate::secrets::SecretsManager;
use crate::tools::{self, ToolRegistry};
use crate::{build_messages, get_conn, is_context_window_error, is_retryable_stream_error, now_ms, resolve_provider_config, trim_to_context_limit, StreamResult, MAX_STREAM_RETRIES, STREAM_RETRY_BASE};

pub type ApprovalFn = Box<dyn Fn(ToolCall) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

async fn consume_stream_headless(
    mut stream: ChatStream,
    cancel: &CancellationToken,
) -> Result<StreamResult, String> {
    use futures::StreamExt;

    let mut text = String::new();
    let mut reasoning = String::new();
    let mut tool_acc: Vec<(String, String, String)> = Vec::new();
    let mut usage = None;
    let mut finish_reason = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => { break; }
            chunk = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()) => {
                match chunk {
                    Err(_) => {
                        return Err("Stream idle timeout".to_string());
                    }
                    Ok(Some(Ok(StreamEvent::Text { content: ref s }))) => {
                        text.push_str(s);
                    }
                    Ok(Some(Ok(StreamEvent::Reasoning { content: ref s }))) => {
                        reasoning.push_str(s);
                    }
                    Ok(Some(Ok(StreamEvent::ToolCallStart { index, ref id, ref name }))) => {
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
                    Ok(Some(Ok(StreamEvent::Error { .. }))) => {}
                    Ok(Some(Ok(StreamEvent::MessageStart { .. }))) => {}
                    Ok(Some(Err(e))) => {
                        return Err(e.to_string());
                    }
                    Ok(None) => { break; }
                }
            }
        }
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

    Ok(StreamResult { text, reasoning, tool_calls, usage, finish_reason })
}

/// Run a headless chat session (no Tauri events, no UI approval flow).
///
/// - `is_admin`: controls whether tools are available at all
/// - `approval_fn`: called for Ask-permission tools (admin only); returns true to approve
#[allow(clippy::too_many_arguments)]
pub async fn headless_chat(
    pool: &DbPool,
    secrets: &SecretsManager,
    tool_registry: &ToolRegistry,
    mcp_manager: &Arc<Mutex<McpManager>>,
    conversation_id: &str,
    project_id: Option<&str>,
    user_message: &str,
    assistant_id: Option<&str>,
    is_admin: bool,
    approval_fn: &ApprovalFn,
    cancel: &CancellationToken,
) -> Result<String, String> {
    // Load assistant + history
    let (assistant, history) = {
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
            Ok::<_, String>((assistant, history))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // Resolve provider
    let (provider_type, base_url, api_key, model, api_format) =
        resolve_provider_config(secrets, pool, assistant.as_ref())?;
    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    // Build messages with memory injection
    let raw_prompt = assistant.as_ref().map(|a| a.system_prompt.as_str()).unwrap_or("");
    let memory_block = if let Some(pid) = project_id {
        let pool2 = pool.clone();
        let pid2 = pid.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let memories = crate::db::ops::memory::list_memories(&mut conn, &pid2).ok()?;
            crate::db::ops::memory::format_memory_block(&memories)
        }).await.ok().flatten()
    } else {
        None
    };
    let system_prompt = match memory_block {
        Some(ref mem) => format!("{}{}", raw_prompt, mem),
        None => raw_prompt.to_string(),
    };
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);

    let mut chat_messages = build_messages(&system_prompt, &history, user_message);
    crate::resolve_file_uris_in_messages(&mut chat_messages);
    crate::remove_orphan_tool_messages(&mut chat_messages);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let params = ChatParams {
        model: assistant.as_ref().and_then(|a| a.model_id.clone()).unwrap_or(model),
        temperature: assistant.as_ref().and_then(|a| a.temperature.map(|t| t as f64)),
        top_p: assistant.as_ref().and_then(|a| a.top_p.map(|t| t as f64)),
        max_tokens: assistant.as_ref().and_then(|a| a.max_tokens),
        thinking_enabled: assistant.as_ref().map(|a| a.thinking_enabled != 0).unwrap_or(false),
        thinking_budget: assistant.as_ref().and_then(|a| a.thinking_budget),
        thinking_effort: None,
    };

    // Collect tool definitions: only for admin users
    let tool_defs: Vec<provider::ToolDefinition> = if is_admin {
        let enabled_tools: Option<Vec<String>> = assistant.as_ref()
            .and_then(|a| a.enabled_tools.as_ref())
            .and_then(|json| serde_json::from_str(json).ok());

        let mut all_defs = tool_registry.definitions();
        {
            let mgr = mcp_manager.lock().await;
            all_defs.extend(mgr.all_tool_definitions());
        }

        if let Some(ref enabled) = enabled_tools {
            all_defs.into_iter().filter(|t| enabled.contains(&t.name)).collect()
        } else {
            all_defs
        }
    } else {
        vec![]
    };

    // Persist user message
    let now = now_ms();
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let mut assistant_msg_id = String::new();
    {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let msg = user_message.to_string();
        let msg_id = user_msg_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            crate::db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user", content: &msg,
                provider_id: None, model_id: None, input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None, sort_order: 0, created_at: now,
                reasoning_content: None, rating: None, schema_version: 2,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Build tool context
    let shell_type = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            crate::db::ops::preference::get_preference(&mut conn, "shell").ok()?
        }).await.ok().flatten()
    };
    let tool_context = tools::ToolContext {
        working_directory: None,
        shell: shell_type.map(|s| tools::ShellType::from_str(&s))
            .unwrap_or_else(tools::ShellType::default_for_platform),
        file_access: tools::FileAccess::default(),
        project_id: project_id.map(|s| s.to_string()),
        db_pool: Some(pool.clone()),
        edit_session: None,
        #[cfg(not(target_os = "android"))]
        sandbox_policy: None,
    };

    // Agent loop: each iteration creates a new assistant message
    let mut total_input_tokens = 0i32;
    let mut total_output_tokens = 0i32;
    let mut last_assistant_text = String::new();

    loop {
        if cancel.is_cancelled() { break; }

        // Create a new assistant message for this iteration
        assistant_msg_id = uuid::Uuid::new_v4().to_string();
        {
            let pool = pool.clone();
            let conv_id = conversation_id.to_string();
            let msg_id = assistant_msg_id.clone();
            let model_clone = params.model.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = get_conn(&pool)?;
                crate::db::ops::message::insert_message(&mut conn, &NewMessage {
                    id: &msg_id, conversation_id: &conv_id, role: "assistant", content: "",
                    provider_id: None, model_id: Some(&model_clone), input_tokens: None,
                    output_tokens: None, tool_calls: None, tool_call_id: None, sort_order: 0,
                    created_at: now, reasoning_content: None, rating: None, schema_version: 2,
                }).map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }).await.map_err(|e| e.to_string())??;
        }

        let result = {
            let mut _last_err = String::new();
            let mut attempt = 0u32;
            loop {
                if attempt > 0 {
                    tokio::time::sleep(crate::client::backoff(STREAM_RETRY_BASE, attempt as u64)).await;
                }
                let stream_result = provider.stream_chat_with_tools(
                    chat_messages.clone(), tool_defs.clone(), params.clone()
                ).await;
                let try_result = match stream_result {
                    Ok(stream) => consume_stream_headless(stream, cancel).await,
                    Err(e) => Err(e.to_string()),
                };
                match try_result {
                    Ok(r) => break r,
                    Err(e) if is_context_window_error(&e) => {
                        let aggressive_keep = (keep_recent / 2).max(2);
                        trim_to_context_limit(&mut chat_messages, context_limit / 2, aggressive_keep);
                        let stream = provider.stream_chat_with_tools(
                            chat_messages.clone(), tool_defs.clone(), params.clone()
                        ).await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        break consume_stream_headless(stream, cancel)
                            .await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                    }
                    Err(e) if is_retryable_stream_error(&e) && attempt < MAX_STREAM_RETRIES => {
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
        }

        let has_tool_calls = !result.tool_calls.is_empty()
            && !matches!(result.finish_reason.as_deref(), Some("length") | Some("max_tokens"));

        // Persist this iteration's assistant message in OpenAI format
        let tool_calls_json = if has_tool_calls {
            Some(crate::serialize_tool_calls_openai(&result.tool_calls))
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

        chat_messages.push(ChatMessage::assistant_with_tools(
            &result.text,
            if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) },
            result.tool_calls.clone(),
        ));

        for tc in &result.tool_calls {
            if cancel.is_cancelled() { break; }

            let is_mcp = tc.name.starts_with("mcp__");
            let tool = if !is_mcp { tool_registry.get(&tc.name) } else { None };

            let tool_result = if is_mcp {
                let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let mut mgr = mcp_manager.lock().await;
                match mgr.call_tool(&tc.name, args).await {
                    Ok(output) => output,
                    Err(e) => format!("MCP error: {e}"),
                }
            } else if tc.name == "ask_user" {
                let approved = (approval_fn)(tc.clone()).await;
                if approved {
                    "User approved.".to_string()
                } else {
                    "User did not respond.".to_string()
                }
            } else if let Some(tool) = tool {
                let permission = tool.default_permission();
                let approved = match permission {
                    tools::Permission::Always => true,
                    tools::Permission::Never => false,
                    tools::Permission::Ask => (approval_fn)(tc.clone()).await,
                };
                if approved {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    match tool.execute(args, &tool_context).await {
                        Ok(output) => output,
                        Err(e) => format!("Error: {e}"),
                    }
                } else {
                    "Tool call denied by user.".to_string()
                }
            } else {
                format!("Unknown tool: {}", tc.name)
            };

            {
                let pool = pool.clone();
                let conv_id = conversation_id.to_string();
                let tool_msg_id = uuid::Uuid::new_v4().to_string();
                let call_id = tc.id.clone();
                let result_clone = tool_result.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = crate::db::ops::message::insert_message(&mut conn, &NewMessage {
                            id: &tool_msg_id, conversation_id: &conv_id, role: "tool",
                            content: &result_clone, provider_id: None, model_id: None,
                            input_tokens: None, output_tokens: None,
                            tool_calls: None, tool_call_id: Some(&call_id),
                            sort_order: 0, created_at: now,
                            reasoning_content: None, rating: None, schema_version: 2,
                        });
                    }
                }).await;
            }

            chat_messages.push(ChatMessage::tool_result(&tc.id, &tool_result));
        }

        if cancel.is_cancelled() { break; }
        trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);
    }

    Ok(last_assistant_text)
}
