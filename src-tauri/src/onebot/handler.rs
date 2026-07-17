use std::sync::Arc;

use tauri::Emitter;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::agent::{self, ApprovalFn};
use super::command::{self, SlashCommand};
use super::format;
use super::protocol::{MessageSegment, OneBotAction, OneBotEvent};
use super::session::{SessionKey, SessionKind};
use super::{call_api, SharedState};

pub async fn handle_message(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
) -> Vec<OneBotAction> {
    let user_id = match event.user_id {
        Some(id) => id,
        None => return vec![],
    };

    let message = match event.message.as_ref().or_else(|| {
        event.raw_message.as_ref().map(|_| &serde_json::Value::Null)
    }) {
        Some(m) if !m.is_null() => m,
        _ => {
            if let Some(ref raw) = event.raw_message {
                return handle_text_message(event, state, user_id, raw, None).await;
            }
            return vec![];
        }
    };

    let self_id = event.self_id.unwrap_or(0);
    let is_group = event.message_type.as_deref() == Some("group");

    if is_group && !format::is_at_bot(message, self_id) {
        let session_key = SessionKey::group(event.group_id.unwrap_or(0));
        let has_pending = state.pending_approvals.lock().await
            .contains_key(&session_key.to_string());
        if has_pending {
            let text = format::segments_to_text(message, Some(self_id));
            if !text.is_empty() {
                return handle_text_message(event, state, user_id, &text, None).await;
            }
        }
        return vec![];
    }

    let reply_message_id = format::extract_reply_message_id(message);
    let text = format::segments_to_text(message, Some(self_id));
    if text.is_empty() {
        return vec![];
    }

    handle_text_message(event, state, user_id, &text, reply_message_id).await
}

async fn handle_text_message(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    user_id: i64,
    text: &str,
    reply_to_message_id: Option<i64>,
) -> Vec<OneBotAction> {
    let is_group = event.message_type.as_deref() == Some("group");
    let group_id = event.group_id;
    let event_message_id = event.message_id;

    let session_key = if is_group {
        SessionKey::group(group_id.unwrap_or(0))
    } else {
        SessionKey::private(user_id)
    };

    // Check for pending tool approval first
    {
        let mut approvals = state.pending_approvals.lock().await;
        if let Some(tx) = approvals.remove(&session_key.to_string()) {
            let approved = text.trim().eq_ignore_ascii_case("y")
                || text.trim().eq_ignore_ascii_case("yes");
            let _ = tx.send(approved);
            let reply = if approved { "已批准执行。" } else { "已拒绝。" };
            return build_reply(event, reply, None);
        }
    }

    let is_admin = state.config.admin_users.contains(&user_id);

    let nickname = event.sender.as_ref()
        .and_then(|s| s.card.as_deref().or(s.nickname.as_deref()))
        .unwrap_or("Unknown");
    let title = match session_key.kind {
        SessionKind::Private => format!("[QQ] {}", nickname),
        SessionKind::Group => format!("[QQ] 群{}", group_id.unwrap_or(0)),
    };

    // Slash command dispatch
    if let Some((cmd, args)) = command::parse_command(text) {
        return dispatch_command(
            event, state, &session_key, &title, is_admin, cmd, args, event_message_id,
        ).await;
    }

    // --- Normal message processing ---

    let (project_id, conversation_id, model_override) = {
        let mut sessions = state.sessions.lock().await;
        match sessions.get_or_create(&session_key, &title, state.config.assistant_id.as_deref()) {
            Ok((pid, cid)) => {
                let ovr = sessions.get_model_override(&session_key);
                (pid, cid, ovr)
            }
            Err(e) => {
                tracing::error!("Session error: {e}");
                return build_reply(event, &format!("内部错误: {e}"), event_message_id);
            }
        }
    };

    let sender_prefix = if is_group {
        Some(format!("{}({})", nickname, user_id))
    } else {
        None
    };

    let quoted = if let Some(reply_id) = reply_to_message_id {
        fetch_quoted_message(state, reply_id).await
    } else {
        None
    };

    let enriched_text = format::format_enriched_message(
        text,
        sender_prefix.as_deref(),
        quoted.as_ref().map(|(s, c)| (s.as_str(), c.as_str())),
    );

    let approval_fn: ApprovalFn = {
        let state = state.clone();
        let session_str = session_key.to_string();
        let event_user_id = user_id;
        let event_group_id = group_id;
        let event_is_group = is_group;

        Box::new(move |tc: crate::provider::ToolCall| {
            let state = state.clone();
            let session_str = session_str.clone();

            Box::pin(async move {
                let prompt = format!(
                    "🔧 工具调用请求:\n工具: {}\n参数: {}\n\n回复 Y 批准，其他内容拒绝（60秒超时）",
                    tc.name,
                    truncate_args(&tc.arguments, 500),
                );

                let approval_msg = if event_is_group {
                    OneBotAction::send_group_msg(
                        event_group_id.unwrap_or(0),
                        vec![
                            MessageSegment::at(event_user_id),
                            MessageSegment::text(&format!(" {prompt}")),
                        ],
                    )
                } else {
                    OneBotAction::send_private_msg(event_user_id, vec![MessageSegment::text(&prompt)])
                };

                let json = match serde_json::to_string(&approval_msg) {
                    Ok(j) => j,
                    Err(_) => return false,
                };

                {
                    let sinks = state.ws_sinks.lock().await;
                    for sink in sinks.values() {
                        let _ = sink.send(json.clone()).await;
                    }
                }

                let (tx, rx) = oneshot::channel();
                {
                    let mut approvals = state.pending_approvals.lock().await;
                    approvals.insert(session_str.clone(), tx);
                }

                match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
                    Ok(Ok(approved)) => approved,
                    _ => {
                        let mut approvals = state.pending_approvals.lock().await;
                        approvals.remove(&session_str);
                        false
                    }
                }
            })
        })
    };

    let cancel = CancellationToken::new();

    let response = agent::headless_chat(
        &state.pool,
        &state.secrets,
        &state.tools,
        &state.mcp,
        &conversation_id,
        Some(project_id.as_str()),
        &enriched_text,
        state.config.assistant_id.as_deref(),
        model_override.as_deref(),
        is_admin,
        &approval_fn,
        &cancel,
        state.app_handle.as_ref(),
    )
    .await;

    if let Some(ref app) = state.app_handle {
        let _ = app.emit("conversation-updated", serde_json::json!({"id": conversation_id}));
    }

    match response {
        Ok(reply_text) => {
            if reply_text.is_empty() {
                return vec![];
            }
            let chunks = format::split_long_message(&reply_text);
            chunks.iter().enumerate().flat_map(|(i, chunk)| {
                let reply_id = if i == 0 { event_message_id } else { None };
                build_reply(event, chunk, reply_id)
            }).collect()
        }
        Err(e) => {
            tracing::error!("Chat error for {}: {e}", session_key);
            build_reply(event, &format!("处理消息时出错: {e}"), event_message_id)
        }
    }
}

// ---------------------------------------------------------------------------
// Slash command dispatch
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn dispatch_command(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    title: &str,
    is_admin: bool,
    cmd: SlashCommand,
    args: &str,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    match cmd {
        SlashCommand::Help => {
            build_reply(event, &SlashCommand::help_text(), reply_to)
        }
        SlashCommand::New => {
            let mut sessions = state.sessions.lock().await;
            match sessions.reset_conversation(session_key, title, state.config.assistant_id.as_deref()) {
                Ok(_) => build_reply(event, "已重置对话。新的对话已创建。", reply_to),
                Err(e) => build_reply(event, &format!("重置失败: {e}"), reply_to),
            }
        }
        SlashCommand::Compact => {
            dispatch_compact(event, state, session_key, title, args, reply_to).await
        }
        SlashCommand::Model => {
            dispatch_model(event, state, session_key, title, args, reply_to).await
        }
        SlashCommand::Status => {
            dispatch_status(event, state, session_key, title, is_admin, reply_to).await
        }
    }
}

async fn dispatch_compact(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    title: &str,
    args: &str,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    let custom_instructions = if args.is_empty() { None } else { Some(args.to_string()) };

    let (_, conversation_id) = {
        let mut sessions = state.sessions.lock().await;
        match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok(ids) => ids,
            Err(e) => return build_reply(event, &format!("内部错误: {e}"), reply_to),
        }
    };

    let pool = &state.pool;
    let secrets = &state.secrets;
    let (assistant, keep_recent) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        match tokio::task::spawn_blocking(move || {
            let mut conn = crate::get_conn(&pool)?;
            let conv = crate::db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| crate::db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
            Ok::<_, String>((assistant, keep_recent))
        }).await {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return build_reply(event, &format!("Compact 失败: {e}"), reply_to),
            Err(e) => return build_reply(event, &format!("Compact 失败: {e}"), reply_to),
        }
    };

    match crate::do_compact(pool, secrets.as_ref(), &conversation_id, assistant.as_ref(), keep_recent, custom_instructions.as_deref()).await {
        Ok(_) => build_reply(event, "对话上下文已压缩。", reply_to),
        Err(e) => build_reply(event, &format!("Compact 失败: {e}"), reply_to),
    }
}

async fn dispatch_model(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    title: &str,
    args: &str,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    // Ensure session exists, get conversation_id and current override
    let (conversation_id, model_override) = {
        let mut sessions = state.sessions.lock().await;
        let (_, cid) = match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok(ids) => ids,
            Err(e) => return build_reply(event, &format!("内部错误: {e}"), reply_to),
        };

        if args.eq_ignore_ascii_case("reset") || args.eq_ignore_ascii_case("default") {
            sessions.set_model_override(session_key, None);
            return build_reply(event, "已恢复默认模型。", reply_to);
        }

        if !args.is_empty() {
            sessions.set_model_override(session_key, Some(args.to_string()));
            return build_reply(event, &format!("已切换模型: {}\n发送 /model reset 恢复默认", args), reply_to);
        }

        let ovr = sessions.get_model_override(session_key);
        (cid, ovr)
    };

    // Show current model info
    let pool = pool_clone(&state.pool);
    let assistant_id = state.config.assistant_id.clone();
    let conv_id = conversation_id;
    let info = tokio::task::spawn_blocking(move || {
        let mut conn = crate::get_conn(&pool)?;
        let conv = crate::db::ops::conversation::get_conversation(&mut conn, &conv_id)
            .map_err(|e| e.to_string())?;
        let effective_aid = assistant_id.as_deref().or(conv.assistant_id.as_deref());
        let assistant = effective_aid
            .and_then(|aid| crate::db::ops::assistant::get_assistant(&mut conn, aid).ok());
        let model = assistant.as_ref().and_then(|a| a.model_id.clone())
            .unwrap_or_else(|| "未配置".into());
        let name = assistant.as_ref().map(|a| a.name.clone());
        Ok::<_, String>((model, name))
    }).await;

    match info {
        Ok(Ok((default_model, assistant_name))) => {
            let reply = if let Some(ref ovr) = model_override {
                format!("当前模型: {} (手动切换)\n助手默认: {}\n发送 /model reset 恢复默认", ovr, default_model)
            } else {
                let source = assistant_name
                    .map(|n| format!("来源: 助手「{}」", n))
                    .unwrap_or_else(|| "来源: 系统默认".into());
                format!("当前模型: {}\n{}", default_model, source)
            };
            build_reply(event, &reply, reply_to)
        }
        Ok(Err(e)) => build_reply(event, &format!("获取模型信息失败: {e}"), reply_to),
        Err(e) => build_reply(event, &format!("获取模型信息失败: {e}"), reply_to),
    }
}

async fn dispatch_status(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    title: &str,
    is_admin: bool,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    let (conversation_id, model_override) = {
        let mut sessions = state.sessions.lock().await;
        let (_, cid) = match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok(ids) => ids,
            Err(e) => return build_reply(event, &format!("内部错误: {e}"), reply_to),
        };
        let ovr = sessions.get_model_override(session_key);
        (cid, ovr)
    };

    let pool = pool_clone(&state.pool);
    let assistant_id = state.config.assistant_id.clone();
    let conv_id = conversation_id;
    let info = tokio::task::spawn_blocking(move || {
        let mut conn = crate::get_conn(&pool)?;
        let conv = crate::db::ops::conversation::get_conversation(&mut conn, &conv_id)
            .map_err(|e| e.to_string())?;
        let effective_aid = assistant_id.as_deref().or(conv.assistant_id.as_deref());
        let assistant = effective_aid
            .and_then(|aid| crate::db::ops::assistant::get_assistant(&mut conn, aid).ok());
        let assistant_name = assistant.as_ref().map(|a| a.name.clone())
            .unwrap_or_else(|| "未配置".into());
        let model = assistant.as_ref().and_then(|a| a.model_id.clone())
            .unwrap_or_else(|| "未配置".into());
        let context_limit = assistant.as_ref().map(|a| a.context_limit).unwrap_or(128000);
        let msg_count = crate::db::ops::message::count_messages(&mut conn, &conv_id)
            .unwrap_or(0);
        Ok::<_, String>((assistant_name, model, context_limit, msg_count))
    }).await;

    match info {
        Ok(Ok((assistant_name, default_model, context_limit, msg_count))) => {
            let model_display = model_override
                .map(|ovr| format!("{} (手动切换)", ovr))
                .unwrap_or(default_model);
            let tools_display = if is_admin { "已启用" } else { "未启用" };
            let reply = format!(
                "助手: {}\n模型: {}\n消息: {} 条\n上下文上限: {}\n工具: {}",
                assistant_name, model_display, msg_count, context_limit, tools_display,
            );
            build_reply(event, &reply, reply_to)
        }
        Ok(Err(e)) => build_reply(event, &format!("获取状态失败: {e}"), reply_to),
        Err(e) => build_reply(event, &format!("获取状态失败: {e}"), reply_to),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn pool_clone(pool: &crate::db::DbPool) -> crate::db::DbPool {
    pool.clone()
}

async fn fetch_quoted_message(
    state: &Arc<SharedState>,
    message_id: i64,
) -> Option<(String, String)> {
    let echo = uuid::Uuid::new_v4().to_string();
    let action = OneBotAction::get_msg(message_id, echo);
    let data = call_api(state, action).await.ok()?;

    let sender = data.get("sender").and_then(|s| {
        s.get("card").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
            .or_else(|| s.get("nickname").and_then(|v| v.as_str()))
    }).unwrap_or("Unknown").to_string();

    let content = data.get("message").and_then(|m| {
        Some(format::segments_to_text(m, None))
    }).filter(|s| !s.is_empty())?;

    Some((sender, content))
}

fn build_reply(event: &OneBotEvent, text: &str, reply_to_id: Option<i64>) -> Vec<OneBotAction> {
    let mut segments = Vec::new();
    if let Some(id) = reply_to_id {
        segments.push(MessageSegment::reply(id));
    }
    segments.extend(format::text_to_rich_segments(text));

    let is_group = event.message_type.as_deref() == Some("group");
    if is_group {
        let group_id = event.group_id.unwrap_or(0);
        vec![OneBotAction::send_group_msg(group_id, segments)]
    } else {
        let user_id = event.user_id.unwrap_or(0);
        vec![OneBotAction::send_private_msg(user_id, segments)]
    }
}

fn truncate_args(args: &str, max_len: usize) -> String {
    if args.len() <= max_len {
        args.to_string()
    } else {
        format!("{}...", &args[..args.floor_char_boundary(max_len)])
    }
}
