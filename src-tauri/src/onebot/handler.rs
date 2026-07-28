use std::sync::Arc;

use tauri::Emitter;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::agent::{self, ApprovalFn, TextNotifyFn};
use super::command::{self, SlashCommand};
use super::format;
use super::protocol::{MessageSegment, OneBotAction, OneBotEvent};
use super::session::{SessionKey, SessionKind};
use super::{call_api, SharedState};

pub async fn handle_message(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    conn_id: u64,
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
            // Fallback for clients that only send raw_message. In a group this
            // would bypass the @bot gate below, so ignore it there; a group
            // message with a null `message` array is anomalous anyway.
            if event.message_type.as_deref() == Some("group") {
                return vec![];
            }
            if let Some(ref raw) = event.raw_message {
                let parsed = format::ParsedMessage::from_text(raw);
                return handle_text_message(event, state, user_id, parsed, None, conn_id).await;
            }
            return vec![];
        }
    };

    let self_id = event.self_id.unwrap_or(0);
    let is_group = event.message_type.as_deref() == Some("group");

    if is_group && !format::is_at_bot(message, self_id) {
        let session_key = SessionKey::group(event.group_id.unwrap_or(0));
        // Only the user who triggered a pending approval may answer it without
        // @mentioning the bot; everyone else's un-addressed messages are ignored.
        let is_initiator = state.pending_approvals.lock().await
            .get(&session_key.to_string())
            .is_some_and(|(uid, _)| *uid == user_id);
        if is_initiator {
            let text = format::segments_to_text(message, Some(self_id));
            if !text.is_empty() {
                let parsed = format::ParsedMessage::from_text(&text);
                return handle_text_message(event, state, user_id, parsed, None, conn_id).await;
            }
        }
        return vec![];
    }

    let reply_message_id = format::extract_reply_message_id(message);
    let parsed = format::parse_segments(message, Some(self_id));
    if parsed.text.is_empty() && !parsed.has_media() {
        return vec![];
    }

    handle_text_message(event, state, user_id, parsed, reply_message_id, conn_id).await
}

async fn handle_text_message(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    user_id: i64,
    parsed: format::ParsedMessage,
    reply_to_message_id: Option<i64>,
    conn_id: u64,
) -> Vec<OneBotAction> {
    let text = parsed.text.as_str();
    let is_group = event.message_type.as_deref() == Some("group");
    let group_id = event.group_id;
    let event_message_id = event.message_id;

    let session_key = if is_group {
        SessionKey::group(group_id.unwrap_or(0))
    } else {
        SessionKey::private(user_id)
    };

    let is_admin = state.config.admin_users.contains(&user_id);

    // Admin decision on a pending friend/group request ("同意 N" / "拒绝 N [理由]").
    // Checked before the Y/N tool approval so a decision is never read as a tool
    // denial; only intercepts when the id actually refers to a pending request.
    if is_admin && !is_group {
        if let Some(decision) = command::parse_request_decision(text) {
            // Remove under the lock so two concurrent decisions on the same id
            // can't both fire the API; the loser sees None and reports missing.
            let (removed, had_any) = {
                let mut map = state.pending_requests.lock().await;
                let had_any = !map.is_empty();
                (map.remove(&decision.id), had_any)
            };
            match removed {
                Some(req) => return handle_request_decision(event, state, decision, req).await,
                None if had_any => {
                    return build_reply(
                        event,
                        &format!("没有找到编号 {} 的待处理请求", decision.id),
                        None,
                    );
                }
                None => {} // no pending requests at all — treat as normal chat
            }
        }
    }

    // Check for pending tool approval
    {
        let mut approvals = state.pending_approvals.lock().await;
        let is_initiator = approvals.get(&session_key.to_string())
            .is_some_and(|(uid, _)| *uid == user_id);
        if is_initiator {
            let (_, tx) = approvals.remove(&session_key.to_string()).unwrap();
            let approved = text.trim().eq_ignore_ascii_case("y")
                || text.trim().eq_ignore_ascii_case("yes");
            let _ = tx.send(approved);
            let reply = if approved { "已批准执行。" } else { "已拒绝。" };
            return build_reply(event, reply, None);
        }
    }

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

    // Acknowledge receipt: emoji reaction in groups, typing indicator in private.
    // Fire-and-forget; failures are silent.
    if is_group {
        let emoji = &state.config.ack_emoji_id;
        if !emoji.is_empty() && emoji != "0" {
            if let Some(mid) = event_message_id {
                super::send_action_nowait(state, &OneBotAction::set_msg_emoji_like(mid, emoji)).await;
            }
        }
    } else {
        super::send_action_nowait(state, &OneBotAction::set_input_status(user_id, 1)).await;
    }

    // Media processing needs the conversation; get_or_create is idempotent and
    // run_agent_turn will hit the cache for the same key.
    let (_, conversation_id, model_override) = {
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

    // Remember this message entered the AI context so a later recall of it is
    // worth reporting (recalls of never-seen messages stay silent).
    if let Some(mid) = event_message_id {
        super::record_seen_message(state, &session_key, mid).await;
    }

    // Identity travels structurally from here on, not as a body prefix a user
    // could type themselves.
    let sender = super::SenderContext {
        user_id,
        nickname: (nickname != "Unknown").then(|| nickname.to_string()),
        role: event.sender.as_ref().and_then(|s| s.role.clone()),
        is_admin,
        is_group,
    };

    let quoted = if let Some(reply_id) = reply_to_message_id {
        fetch_quoted_message(state, reply_id).await
    } else {
        None
    };

    let media = super::media::process_media(
        state, event, &parsed, &conversation_id, model_override.as_deref(),
    ).await;

    let enriched_text = format::format_enriched_message(
        &media.text,
        None,
        quoted.as_ref().map(|(s, c)| (s.as_str(), c.as_str())),
    );

    // With images the content becomes OpenAI-style parts JSON; the existing
    // resolve_file_uris_in_messages pipeline converts file:/// URIs to base64.
    let user_content = if media.image_uris.is_empty() {
        enriched_text
    } else {
        let mut parts = vec![serde_json::json!({ "type": "text", "text": enriched_text })];
        parts.extend(media.image_uris.iter().map(|uri| {
            serde_json::json!({ "type": "image_url", "image_url": { "url": uri } })
        }));
        serde_json::Value::Array(parts).to_string()
    };

    run_agent_turn(state, conn_id, &session_key, &title, sender, user_content, event_message_id).await
}

// ---------------------------------------------------------------------------
// Agent turn runner
// ---------------------------------------------------------------------------

/// Build the Y/N chat approval closure for tool calls in `session_key`,
/// addressed to `initiator_user_id` (the only user allowed to answer).
fn make_approval_fn(
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    initiator_user_id: i64,
) -> ApprovalFn {
    let state = state.clone();
    let session_str = session_key.to_string();
    let is_group = session_key.kind == SessionKind::Group;
    let group_id = session_key.id;

    Box::new(move |tc: crate::provider::ToolCall, sandbox_reason: Option<String>| {
        let state = state.clone();
        let session_str = session_str.clone();

        Box::pin(async move {
            // A sandbox reason means this is the second ask for the same call
            // (escalation to run without sandbox); say so, or it reads as a
            // duplicate of the prompt just answered.
            let prompt = match sandbox_reason {
                Some(reason) => format!(
                    "⚠️ 命令被沙箱拦截:\n工具: {}\n参数: {}\n拦截输出: {}\n\n回复 Y 在沙箱外重试，其他内容拒绝（60秒超时）",
                    tc.name,
                    truncate_args(&tc.arguments, 500),
                    truncate_args(&reason, 300),
                ),
                None => format!(
                    "🔧 工具调用请求:\n工具: {}\n参数: {}\n\n回复 Y 批准，其他内容拒绝（60秒超时）",
                    tc.name,
                    truncate_args(&tc.arguments, 500),
                ),
            };

            let approval_msg = if is_group {
                OneBotAction::send_group_msg(
                    group_id,
                    vec![
                        MessageSegment::at(initiator_user_id),
                        MessageSegment::text(&format!(" {prompt}")),
                    ],
                )
            } else {
                OneBotAction::send_private_msg(initiator_user_id, vec![MessageSegment::text(&prompt)])
            };

            super::send_action_nowait(&state, &approval_msg).await;

            let (tx, rx) = oneshot::channel();
            {
                let mut approvals = state.pending_approvals.lock().await;
                approvals.insert(session_str.clone(), (initiator_user_id, tx));
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
}

/// Build the callback that pushes mid-turn assistant text (the commentary a
/// model emits alongside tool calls) to the chat as it happens; the final
/// text still goes out through the normal turn-end reply.
fn make_interim_text_fn(state: &Arc<SharedState>, session_key: &SessionKey) -> TextNotifyFn {
    let state = state.clone();
    let session_key = session_key.clone();

    Box::new(move |text: String| {
        let state = state.clone();
        let session_key = session_key.clone();

        Box::pin(async move {
            for chunk in format::split_long_message(&text) {
                for action in build_session_reply(&session_key, &chunk, None) {
                    super::send_action_nowait(&state, &action).await;
                }
            }
        })
    })
}

/// Run one agent turn for a session, or queue the content when a turn is
/// already active (the running loop injects it between tool rounds). At turn
/// end, user messages that arrived too late for injection start a follow-up
/// turn; earlier turns' replies are sent inline so ordering is preserved.
pub(super) async fn run_agent_turn(
    state: &Arc<SharedState>,
    conn_id: u64,
    session_key: &SessionKey,
    title: &str,
    sender: super::SenderContext,
    user_content: String,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    let is_admin = sender.is_admin;
    let initiator_user_id = sender.user_id;

    let started = super::try_begin_turn(state, session_key, super::InboxItem {
        text: user_content.clone(),
        kind: super::InboxKind::UserMessage,
        created_at: crate::util::now_ms(),
        sender: Some(sender.clone()),
    }).await;
    if !started {
        // Queued into the running turn; its reply arrives with that turn.
        return vec![];
    }

    // Refresh this person's interaction clock. Its own short transaction: the
    // extraction pass that may write memories about them happens later, well
    // after this one has to be durable.
    {
        let pool = state.pool.clone();
        let scope_id = sender.scope_id();
        let display = sender.nickname.clone();
        let protected = sender.is_admin;
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(mut conn) = pool.get() {
                let _ = crate::db::ops::memory::touch_subject(
                    &mut conn, &scope_id, display.as_deref(), protected, crate::util::now_ms(),
                );
            }
        })
        .await;
    }

    let (project_id, conversation_id, model_override) = {
        let mut sessions = state.sessions.lock().await;
        match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok((pid, cid)) => {
                let ovr = sessions.get_model_override(session_key);
                (pid, cid, ovr)
            }
            Err(e) => {
                tracing::error!("Session error: {e}");
                super::release_turn(state, session_key).await;
                return build_session_reply(session_key, &format!("内部错误: {e}"), reply_to);
            }
        }
    };

    let approval_fn = make_approval_fn(state, session_key, initiator_user_id);
    let interim_text_fn = make_interim_text_fn(state, session_key);
    let cancel = CancellationToken::new();
    let qq_tools = super::qq_tools::QqToolExecutor::new(state.clone(), session_key.clone(), is_admin);
    let inbox = super::InboxHandle::new(state.clone(), session_key.clone());

    let mut incoming = vec![super::IncomingMessage::new(user_content, Some(sender.clone()))];
    let mut reply_anchor = reply_to;

    loop {
        let response = agent::headless_chat(
            &state.pool,
            &state.secrets,
            &state.tools,
            &state.mcp,
            &conversation_id,
            Some(project_id.as_str()),
            &incoming,
            state.config.assistant_id.as_deref(),
            model_override.as_deref(),
            is_admin,
            &approval_fn,
            Some(&interim_text_fn),
            &cancel,
            state.app_handle.as_ref(),
            Some(&qq_tools),
            Some(&inbox),
        )
        .await;

        if let Some(ref app) = state.app_handle {
            let _ = app.emit("conversation-updated", serde_json::json!({"id": conversation_id}));
        }

        let actions: Vec<OneBotAction> = match response {
            Ok(reply_text) if reply_text.is_empty() => vec![],
            Ok(reply_text) => {
                let chunks = format::split_long_message(&reply_text);
                chunks.iter().enumerate().flat_map(|(i, chunk)| {
                    let reply_id = if i == 0 { reply_anchor } else { None };
                    build_session_reply(session_key, chunk, reply_id)
                }).collect()
            }
            Err(e) => {
                tracing::error!("Chat error for {}: {e}", session_key);
                build_session_reply(session_key, &format!("处理消息时出错: {e}"), reply_anchor)
            }
        };

        match super::end_turn(state, session_key).await {
            super::TurnEnd::Done => return actions,
            super::TurnEnd::Continue(items) => {
                // Send this turn's reply before starting the follow-up so the
                // chat reads in order.
                super::send_to_conn(state, conn_id, actions).await;
                // Carried over one message per speaker. Flattening them into a
                // single string here would destroy the attribution the whole
                // identity pipeline exists to preserve.
                incoming = items.iter().map(super::IncomingMessage::from).collect();
                reply_anchor = None;
            }
        }
    }
}

/// Like `build_reply` but routed from the session key instead of an event
/// (used by poke-triggered turns and follow-up turns with no source event).
fn build_session_reply(
    session_key: &SessionKey,
    text: &str,
    reply_to_id: Option<i64>,
) -> Vec<OneBotAction> {
    let mut segments = Vec::new();
    if let Some(id) = reply_to_id {
        segments.push(MessageSegment::reply(id));
    }
    segments.extend(format::text_to_rich_segments(text));

    match session_key.kind {
        SessionKind::Group => vec![OneBotAction::send_group_msg(session_key.id, segments)],
        SessionKind::Private => vec![OneBotAction::send_private_msg(session_key.id, segments)],
    }
}

// ---------------------------------------------------------------------------
// Friend / group request approval flow
// ---------------------------------------------------------------------------

/// Handle an incoming request event: number it, stash it, notify admins.
pub async fn handle_request(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
) -> Vec<OneBotAction> {
    use super::{PendingRequest, RequestKind};

    let Some(flag) = event.flag.clone() else {
        tracing::warn!("request event without flag, ignoring");
        return vec![];
    };
    let user_id = event.user_id.unwrap_or(0);

    let kind = match event.request_type.as_deref() {
        Some("friend") => RequestKind::Friend,
        Some("group") => match event.sub_type.as_deref() {
            Some("add") => RequestKind::GroupAdd,
            Some("invite") => RequestKind::GroupInvite,
            other => {
                tracing::debug!("Unhandled group request sub_type: {other:?}");
                return vec![];
            }
        },
        other => {
            tracing::debug!("Unhandled request_type: {other:?}");
            return vec![];
        }
    };

    let id = state.request_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let now = crate::util::now_ms();
    {
        let mut pending = state.pending_requests.lock().await;
        pending.retain(|_, r| now - r.created_at < 24 * 3600 * 1000);
        pending.insert(id, PendingRequest {
            kind,
            flag,
            user_id,
            group_id: event.group_id,
            created_at: now,
        });
    }

    if state.config.admin_users.is_empty() {
        tracing::warn!("request #{id} received but no admin_users configured");
        return vec![];
    }

    let comment = event.comment.as_deref().filter(|s| !s.is_empty()).unwrap_or("(无)");
    let text = match kind {
        RequestKind::Friend => format!(
            "收到好友申请 #{id}\n申请人: {user_id}\n验证消息: {comment}\n来源: {}\n\n回复「同意 {id}」或「拒绝 {id} [理由]」处理",
            event.via.as_deref().filter(|s| !s.is_empty()).unwrap_or("(未知)"),
        ),
        RequestKind::GroupAdd => {
            let invitor = event.invitor_id
                .filter(|i| *i > 0)
                .map(|i| format!("\n邀请人: {i}"))
                .unwrap_or_default();
            format!(
                "收到入群申请 #{id}(群 {})\n申请人: {user_id}\n验证消息: {comment}{invitor}\n\n回复「同意 {id}」或「拒绝 {id} [理由]」处理",
                event.group_id.unwrap_or(0),
            )
        }
        RequestKind::GroupInvite => {
            let source = event.source_group_id
                .filter(|g| *g > 0)
                .map(|g| format!("\n来源群: {g}"))
                .unwrap_or_default();
            format!(
                "收到群邀请 #{id}\n邀请人: {user_id}\n目标群: {}{source}\n\n回复「同意 {id}」或「拒绝 {id}」处理",
                event.group_id.unwrap_or(0),
            )
        }
    };

    state.config.admin_users.iter()
        .map(|admin| OneBotAction::send_private_msg(*admin, format::text_to_rich_segments(&text)))
        .collect()
}

async fn handle_request_decision(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    decision: command::RequestDecision,
    req: super::PendingRequest,
) -> Vec<OneBotAction> {
    use super::RequestKind;

    let echo = uuid::Uuid::new_v4().to_string();
    let action = match req.kind {
        RequestKind::Friend => OneBotAction::set_friend_add_request(
            // llbot sets the remark via a separate call that throws on a rejected
            // stranger and fails the whole action, so only send it on approval.
            &req.flag,
            decision.approve,
            if decision.approve { decision.reason.as_deref() } else { None },
            echo,
        ),
        RequestKind::GroupAdd => OneBotAction::set_group_add_request(
            &req.flag, "add", decision.approve, decision.reason.as_deref(), echo,
        ),
        RequestKind::GroupInvite => OneBotAction::set_group_add_request(
            &req.flag, "invite", decision.approve, decision.reason.as_deref(), echo,
        ),
    };

    let verb = if decision.approve { "同意" } else { "拒绝" };
    let what = match req.kind {
        RequestKind::Friend => format!("好友申请 #{}(QQ {})", decision.id, req.user_id),
        RequestKind::GroupAdd => format!(
            "入群申请 #{}(QQ {} → 群 {})",
            decision.id, req.user_id, req.group_id.unwrap_or(0),
        ),
        RequestKind::GroupInvite => format!("群邀请 #{}(群 {})", decision.id, req.group_id.unwrap_or(0)),
    };

    match call_api(state, action).await {
        // The request was already removed at intercept time; nothing to do here.
        Ok(_) => build_reply(event, &format!("已{verb}{what}"), None),
        Err(e) => {
            // Put it back so the admin can retry; created_at is preserved, so the
            // 24h expiry sweep still applies.
            state.pending_requests.lock().await.insert(decision.id, req);
            build_reply(
                event,
                &format!("操作失败: {e}\n可稍后重试「{verb} {}」", decision.id),
                None,
            )
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
    // Resetting or compacting the conversation while a turn is writing to it
    // would corrupt the running loop's view of history.
    if matches!(cmd, SlashCommand::New | SlashCommand::Compact) {
        let busy = state.session_states.lock().await
            .get(&session_key.to_string())
            .is_some_and(|s| s.turn_active);
        if busy {
            return build_reply(event, "当前有任务正在处理,请稍后再试。", reply_to);
        }
    }

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
            let mut conn = crate::util::get_conn(&pool)?;
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

    match crate::agent::do_compact(pool, secrets.as_ref(), &conversation_id, assistant.as_ref(), keep_recent, custom_instructions.as_deref()).await {
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
        let mut conn = crate::util::get_conn(&pool)?;
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
        let mut conn = crate::util::get_conn(&pool)?;
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
            let tools_display = if is_admin { "已启用" } else { "仅本会话查询(聊天记录/群信息/成员资料)" };
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
    let shown = crate::util::take_bytes_at_char_boundary(args, max_len);
    if shown.len() < args.len() {
        format!("{shown}...")
    } else {
        shown.to_string()
    }
}

#[cfg(test)]
mod tests {
    use crate::onebot::{IncomingMessage, InboxItem, InboxKind, SenderContext};

    fn sender(user_id: i64, nick: &str) -> SenderContext {
        SenderContext {
            user_id,
            nickname: Some(nick.into()),
            role: None,
            is_admin: false,
            is_group: true,
        }
    }

    fn item(text: &str, sender: Option<SenderContext>) -> InboxItem {
        InboxItem { text: text.into(), kind: InboxKind::UserMessage, created_at: 0, sender }
    }

    /// Queued messages used to be concatenated into one string before the
    /// follow-up turn, which made it impossible to tell afterwards who said
    /// what. Each must survive as its own message with its own speaker.
    #[test]
    fn queued_messages_keep_their_own_speakers() {
        let items = vec![
            item("你好", Some(sender(1, "张三"))),
            item("我也要", Some(sender(2, "李四"))),
            item("[系统提示] 2 加入了群聊", None),
        ];

        let carried: Vec<IncomingMessage> = items.iter().map(IncomingMessage::from).collect();

        assert_eq!(carried.len(), 3);
        assert_eq!(carried[0].sender.as_ref().map(|s| s.user_id), Some(1));
        assert_eq!(carried[1].sender.as_ref().map(|s| s.user_id), Some(2));
        assert_eq!(carried[2].sender, None, "a notice is nobody's utterance");
        assert_eq!(carried[1].text, "我也要");
    }
}
