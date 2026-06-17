use std::sync::Arc;

use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::agent::{self, ApprovalFn};
use super::format;
use super::protocol::{MessageSegment, OneBotAction, OneBotEvent};
use super::session::{SessionKey, SessionKind};
use super::SharedState;

/// Process an incoming OneBot message event.
/// Returns a list of actions to send back (may be multiple for long messages).
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
            // Try raw_message as fallback
            if let Some(ref raw) = event.raw_message {
                return handle_text_message(event, state, user_id, raw).await;
            }
            return vec![];
        }
    };

    let self_id = event.self_id.unwrap_or(0);
    let is_group = event.message_type.as_deref() == Some("group");

    // In group chats, check for pending approval before the @mention gate —
    // approval replies ("Y") don't need to @mention the bot.
    if is_group && !format::is_at_bot(message, self_id) {
        let session_key = SessionKey::group(event.group_id.unwrap_or(0));
        let has_pending = state.pending_approvals.lock().await
            .contains_key(&session_key.to_string());
        if has_pending {
            let text = format::segments_to_text(message, Some(self_id));
            if !text.is_empty() {
                return handle_text_message(event, state, user_id, &text).await;
            }
        }
        return vec![];
    }

    let text = format::segments_to_text(message, Some(self_id));
    if text.is_empty() {
        return vec![];
    }

    handle_text_message(event, state, user_id, &text).await
}

async fn handle_text_message(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    user_id: i64,
    text: &str,
) -> Vec<OneBotAction> {
    let is_group = event.message_type.as_deref() == Some("group");
    let group_id = event.group_id;

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
            return build_reply(event, reply);
        }
    }

    let is_admin = state.config.admin_users.contains(&user_id);

    // Resolve conversation
    let conversation_id = {
        let mut sessions = state.sessions.lock().await;
        let nickname = event.sender.as_ref()
            .and_then(|s| s.card.as_deref().or(s.nickname.as_deref()))
            .unwrap_or("Unknown");
        let title = match session_key.kind {
            SessionKind::Private => format!("[QQ] {}", nickname),
            SessionKind::Group => format!("[QQ] 群{}", group_id.unwrap_or(0)),
        };
        match sessions.get_or_create(&session_key, &title, state.config.assistant_id.as_deref()) {
            Ok(id) => id,
            Err(e) => {
                tracing::error!("Session error: {e}");
                return build_reply(event, &format!("内部错误: {e}"));
            }
        }
    };

    // Build approval callback that sends a message via WS and waits for reply
    let approval_fn: ApprovalFn = {
        let state = state.clone();
        let session_str = session_key.to_string();
        let event_user_id = user_id;
        let event_group_id = group_id;
        let event_is_group = is_group;

        Box::new(move |tc: crate::provider::ToolCall| {
            let state = state.clone();
            let session_str = session_str.clone();
            let event_user_id = event_user_id;
            let event_group_id = event_group_id;
            let event_is_group = event_is_group;

            Box::pin(async move {
                let prompt = format!(
                    "🔧 工具调用请求:\n工具: {}\n参数: {}\n\n回复 Y 批准，其他内容拒绝（60秒超时）",
                    tc.name,
                    truncate_args(&tc.arguments, 500),
                );

                // Send approval request
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

                // Send the approval request via the WS sink
                {
                    let sinks = state.ws_sinks.lock().await;
                    for sink in sinks.values() {
                        let _ = sink.send(json.clone()).await;
                    }
                }

                // Register pending approval and wait
                let (tx, rx) = oneshot::channel();
                {
                    let mut approvals = state.pending_approvals.lock().await;
                    approvals.insert(session_str.clone(), tx);
                }

                // Wait with 60-second timeout
                match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
                    Ok(Ok(approved)) => approved,
                    _ => {
                        // Timeout or channel closed — remove pending and deny
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
        text,
        state.config.assistant_id.as_deref(),
        is_admin,
        &approval_fn,
        &cancel,
    )
    .await;

    match response {
        Ok(reply_text) => {
            if reply_text.is_empty() {
                return vec![];
            }
            let chunks = format::split_long_message(&reply_text);
            chunks.iter().flat_map(|chunk| build_reply(event, chunk)).collect()
        }
        Err(e) => {
            tracing::error!("Chat error for {}: {e}", session_key);
            build_reply(event, &format!("处理消息时出错: {e}"))
        }
    }
}

fn build_reply(event: &OneBotEvent, text: &str) -> Vec<OneBotAction> {
    let segments = format::text_to_segments(text);
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
