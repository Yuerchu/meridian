use std::sync::Arc;

use tauri::Emitter;
use tokio::sync::oneshot;

use super::agent::{self, ApprovalFn, TextNotifyFn};
use crate::db::models::turn::{TurnStatus, ERROR_LOOP_DETECTED};
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
        let is_initiator = state.pending_approvals.lock()
            .get(&session_key.to_string())
            .is_some_and(|p| p.initiator == user_id);
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

    // Admin decision on anything numbered ("同意 N" / "拒绝 N [理由]"): friend and
    // group requests, and bot-wide memory proposals. Checked before the Y/N tool
    // approval so a decision is never read as a tool denial.
    //
    // Allowed in groups too: reaching this point already required an @mention,
    // which is intent enough, and it lets the operator confirm without leaving
    // the conversation the proposal came from.
    if is_admin {
        if let Some(decision) = command::parse_request_decision(text) {
            if let Some(actions) = dispatch_decision(event, state, decision, user_id).await {
                return actions;
            }
            // No queue knew the id — fall through and treat it as ordinary chat.
        }
    }

    // Check for pending tool approval
    {
        let mut approvals = state.pending_approvals.lock();
        let is_initiator = approvals.get(&session_key.to_string())
            .is_some_and(|p| p.initiator == user_id);
        if is_initiator {
            let pending = approvals.remove(&session_key.to_string()).unwrap();
            let approved = text.trim().eq_ignore_ascii_case("y")
                || text.trim().eq_ignore_ascii_case("yes");
            let _ = pending.responder.send(approved);
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
        super::record_seen_message(&state.session_states, &session_key, mid);
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
/// `turn_id` is stamped on every waiter this turn registers, so that when the
/// turn ends — however it ends — its guard can sweep them out in one pass. The
/// wait below is a 60-second timeout, and a task dropped mid-`await` never
/// reaches the timeout branch, so nothing else would ever take the entry out.
fn make_approval_fn(
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    initiator_user_id: i64,
    turn_id: &str,
) -> ApprovalFn {
    let state = state.clone();
    let session_str = session_key.to_string();
    let turn_id = turn_id.to_string();
    let is_group = session_key.kind == SessionKind::Group;
    let group_id = session_key.id;

    Box::new(move |tc: crate::provider::ToolCall, sandbox_reason: Option<String>| {
        let state = state.clone();
        let session_str = session_str.clone();
        let turn_id = turn_id.clone();

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
            state.pending_approvals.lock().insert(
                session_str.clone(),
                super::PendingApproval {
                    initiator: initiator_user_id,
                    turn_id: turn_id.clone(),
                    responder: tx,
                },
            );

            match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
                Ok(Ok(approved)) => approved,
                _ => {
                    // Timed out, or the sender was dropped — which is what the
                    // turn guard does on its way out. Either way the entry is
                    // ours to remove, and only if it is still ours: a later
                    // call for this session may have replaced it.
                    let mut approvals = state.pending_approvals.lock();
                    if approvals.get(&session_str).is_some_and(|p| p.turn_id == turn_id) {
                        approvals.remove(&session_str);
                    }
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

    // Resolved before the turn is claimed, because what gets claimed is the
    // conversation, not the session key. The message path already did this a
    // moment ago (media processing needs it) and the manager caches, so for an
    // ordinary message this costs nothing; the poke path pays one lookup.
    let (project_id, conversation_id, model_override) = {
        let mut sessions = state.sessions.lock().await;
        match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok((pid, cid)) => {
                let ovr = sessions.get_model_override(session_key);
                (pid, cid, ovr)
            }
            Err(e) => {
                tracing::error!("Session error: {e}");
                return build_session_reply(session_key, &format!("内部错误: {e}"), reply_to);
            }
        }
    };

    let turn = match super::try_begin_turn(
        &state.session_states,
        &state.coordinator,
        session_key,
        &conversation_id,
        super::InboxItem {
            text: user_content.clone(),
            kind: super::InboxKind::UserMessage,
            created_at: crate::util::now_ms(),
            sender: Some(sender.clone()),
        },
    ) {
        super::TurnStart::Started(turn) => turn,
        // Queued into the running turn; its reply arrives with that turn.
        super::TurnStart::Queued => return vec![],
        // Held from the desktop. Saying so beats silence: the inbox is drained
        // only by this runner, so a message put there now would wait for the
        // next QQ message rather than for the desktop turn to end.
        super::TurnStart::Elsewhere(busy) => {
            tracing::info!(
                session = %session_key,
                conversation_id = %conversation_id,
                reason = %busy,
                "OneBot turn refused: the conversation is held elsewhere"
            );
            return build_session_reply(
                session_key,
                "这个对话正在电脑端处理,请等它结束后再发。",
                reply_to,
            );
        }
    };

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

    // Everything the turn owes back, in one value that is dropped on every
    // exit — including the ones with no code after them. This task is detached:
    // drop it mid-await at runtime shutdown, or let a tool panic, and nothing
    // below this line runs.
    //
    // Built before anything else is awaited. Recording the turn first would
    // leave a gap where a dropped task released the session and the
    // conversation but announced nothing, which is the hole this value exists
    // to close.
    let mut running = super::RunningTurn::new(
        state.session_states.clone(),
        state.pending_approvals.clone(),
        session_key.clone(),
        turn,
        conversation_id.clone(),
        state.app_handle.clone().map(|app| -> super::StopSink {
            Box::new(move |payload| {
                let _ = app.emit("chat-stream", payload);
            })
        }),
    );
    // The coordinator's, not one of our own: this is what a desktop Stop on a
    // QQ conversation now reaches. It used to be a token nobody had
    // registered, which made that button a no-op.
    let cancel = running.cancel_token();
    let turn_id = running.turn_id().to_string();

    // The durable half. From here the row says `running`; a QQ turn killed by
    // the process going away leaves it that way, and the next launch reads it
    // as interrupted.
    //
    // These ids are minted by the coordinator rather than arriving from
    // outside, so the duplicate case is unreachable here — but it is worth
    // hearing about if it ever stops being. Returning drops `running`, which
    // announces the end and hands both claims back.
    if let Err(e) = running.open_record(&state.pool).await {
        tracing::error!(turn_id = %turn_id, error = %e, "OneBot turn id collided");
        return build_session_reply(session_key, "内部错误,请重试。", reply_to);
    }

    let approval_fn = make_approval_fn(state, session_key, initiator_user_id, &turn_id);
    let interim_text_fn = make_interim_text_fn(state, session_key);
    let qq_tools = super::qq_tools::QqToolExecutor::new(state.clone(), session_key.clone(), is_admin);
    let inbox = super::InboxHandle::new(state.session_states.clone(), session_key.clone());

    let mut incoming = vec![super::IncomingMessage::new(user_content, Some(sender.clone()))];
    let mut reply_anchor = reply_to;

    loop {
        let outcome = agent::headless_chat(
            &state.pool,
            &state.secrets,
            &state.tools,
            &state.mcp,
            &conversation_id,
            &turn_id,
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
            Some(&state.coordinator),
        )
        .await;

        if let Some(ref app) = state.app_handle {
            let _ = app.emit("conversation-updated", serde_json::json!({"id": conversation_id}));
        }

        let stop_reason = outcome.stop_reason();
        // Kept before the reply is consumed into a chat message: the turn's
        // record is the only place this survives, and it was being dropped.
        let failure = outcome.reply.as_ref().err().cloned();
        running.record(outcome.progress);

        let actions: Vec<OneBotAction> = match outcome.reply {
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

        // Learn from what just happened — detached, because it is a second model
        // call and nobody should wait on it to see their reply. Any operator
        // notice it produces is sent on its own.
        spawn_extraction(
            state.clone(),
            session_key.clone(),
            conversation_id.clone(),
            project_id.clone(),
            incoming.clone(),
        );

        // Ends the turn if it is over, releasing both claims before it says so.
        // A continuing round announces nothing: it has not ended, and a desktop
        // watching this conversation would take a stop as its cue to send —
        // into a turn that still holds it.
        match running.end_round(stop_reason) {
            None => {
                // Reached an ending, so say which. Anything that does not get
                // here leaves the row at `running` for the next launch to read
                // as interrupted, which is exactly right for a killed process.
                // The same three endings the desktop distinguishes. The loop
                // guard cutting a repeating model short is not a completed
                // turn, whatever the reply looked like.
                let (status, error) = match stop_reason {
                    "error" => (TurnStatus::Failed, failure.as_deref()),
                    "loop_detected" => (TurnStatus::Failed, Some(ERROR_LOOP_DETECTED)),
                    // A desktop Stop on a QQ conversation reaches this token;
                    // the turn was decided against, not lost.
                    _ if cancel.is_cancelled() => (TurnStatus::Cancelled, None),
                    _ => (TurnStatus::Done, None),
                };
                crate::agent::turn_record::finish(&state.pool, &turn_id, status, error).await;
                return actions;
            }
            Some(items) => {
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

/// Run the extraction pass for a finished turn, detached from the reply path.
///
/// Failures are logged and swallowed: not learning from a conversation is a
/// missed opportunity, not something to interrupt a chat over.
fn spawn_extraction(
    state: Arc<SharedState>,
    session_key: SessionKey,
    conversation_id: String,
    project_id: String,
    incoming: Vec<super::IncomingMessage>,
) {
    tokio::spawn(async move {
        let actions =
            run_extraction_pass(&state, &session_key, &conversation_id, &project_id, &incoming)
                .await;
        for action in actions {
            super::send_action_nowait(&state, &action).await;
        }
    });
}

async fn run_extraction_pass(
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    conversation_id: &str,
    project_id: &str,
    incoming: &[super::IncomingMessage],
) -> Vec<OneBotAction> {
    use super::extract;

    let is_group = session_key.kind == SessionKind::Group;
    // Only messages from this turn count as evidence, and only with the sender
    // we recorded — not one the model might infer from the text.
    let mut messages = std::collections::HashMap::new();
    let mut subjects = Vec::new();
    for (i, m) in incoming.iter().enumerate() {
        if let Some(s) = m.sender.as_ref() {
            messages.insert(format!("msg{i}"), s.user_id);
            if !subjects.contains(&s.user_id) {
                subjects.push(s.user_id);
            }
        }
    }
    if messages.is_empty() {
        return vec![];
    }

    // A greeting or an "ok" cannot carry a durable fact, and the pass costs a
    // full model call to be told so.
    let texts: Vec<&str> = incoming.iter().map(|m| m.text.as_str()).collect();
    if !extract::worth_extracting(&texts) {
        return vec![];
    }

    let facts = extract::TurnFacts {
        messages: messages.clone(),
        is_group,
        project_id: Some(project_id.to_string()),
        session_label: session_key.to_string(),
    };

    let transcript = incoming
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let who = m
                .sender
                .as_ref()
                .map(|s| format!("{} (id {})", s.nickname.as_deref().unwrap_or("?"), s.user_id))
                .unwrap_or_else(|| "system".into());
            format!("[msg{i}] {who}: {}", m.text)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let existing = {
        let pool = state.pool.clone();
        let facts_ref = extract::TurnFacts {
            messages: messages.clone(),
            is_group,
            project_id: Some(project_id.to_string()),
            session_label: session_key.to_string(),
        };
        let subs = subjects.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().ok()?;
            Some(extract::existing_for_extraction(&mut conn, &facts_ref, &subs))
        })
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
    };

    let user_prompt = format!(
        "Conversation:\n{transcript}\n\nAlready remembered:\n{}\n\nWhat, if anything, is worth remembering?",
        if existing.is_empty() { "(nothing yet)" } else { &existing },
    );

    let raw = match super::agent::oneshot_completion(
        state,
        conversation_id,
        extract::EXTRACTION_PROMPT,
        &user_prompt,
    )
    .await
    {
        Ok(text) => text,
        Err(e) => {
            tracing::debug!("memory extraction skipped: {e}");
            return vec![];
        }
    };

    let proposals = match extract::run_extraction(&state.pool, &raw, facts).await {
        Ok(p) => p,
        Err(e) => {
            tracing::debug!("memory extraction produced nothing usable: {e}");
            return vec![];
        }
    };

    if proposals.is_empty() || state.config.admin_users.is_empty() {
        return vec![];
    }

    // Bot-wide memory changes how the bot behaves everywhere, so it waits for a
    // person. The notice goes to the operator privately, wherever it came from.
    let pool = state.pool.clone();
    let ids = proposals.clone();
    let summaries = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        Some(
            ids.iter()
                .filter_map(|id| crate::db::ops::memory::get_proposal(&mut conn, *id).ok().flatten())
.map(|p| format!("M{} {}: {}", p.id, p.key, p.content))
                .collect::<Vec<_>>(),
        )
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    if summaries.is_empty() {
        return vec![];
    }

    let text = format!(
        "助手想记住以下全局记忆(将在所有会话生效):\n{}\n\n回复「同意 MN」或「拒绝 MN」处理(如 同意 M3),24 小时内有效。",
        summaries.join("\n"),
    );
    state
        .config
        .admin_users
        .iter()
        .map(|admin| OneBotAction::send_private_msg(*admin, format::text_to_rich_segments(&text)))
        .collect()
}

/// Route a numbered decision to whichever queue owns that id.
///
/// One dispatcher rather than two independent lookups: the previous code
/// returned "no such request" as soon as the friend-request map was non-empty,
/// so a memory proposal could never be reached while any friend request was
/// outstanding.
///
/// `None` means no queue recognised the id, and the message is ordinary chat.
async fn dispatch_decision(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    decision: command::RequestDecision,
    decider: i64,
) -> Option<Vec<OneBotAction>> {
    // The prefix picks the queue, so the two id spaces can never be confused
    // for one another.
    let id = match decision.target {
        command::DecisionTarget::Request(id) => {
            // Remove under the lock so two concurrent decisions on the same id
            // cannot both fire the API.
            let removed = {
                let mut map = state.pending_requests.lock().await;
                map.remove(&id)
            };
            return match removed {
                Some(req) => Some(handle_request_decision(event, state, decision, req).await),
                // Report the miss rather than letting it fall through to the
                // model, which would answer conversationally and read as
                // confirmation while the request stays pending.
                None => Some(build_reply(
                    event,
                    &format!("没有找到编号 {id} 的待处理请求。"),
                    None,
                )),
            };
        }
        command::DecisionTarget::MemoryProposal(id) => id,
    };

    let pool = state.pool.clone();
    let approve = decision.approve;
    let outcome = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        let Some(proposal) = super::extract::is_known_proposal(&mut conn, id) else {
            return Some(format!("没有找到编号 M{id} 的提议。"));
        };
        let now = crate::util::now_ms();
        if approve {
            match super::extract::approve_proposal(&mut conn, id, decider, now) {
                Ok(Some(key)) => Some(format!("已记住全局记忆「{key}」。")),
                Ok(None) => Some(format!("提议 M{id} 已处理或已过期。")),
                Err(e) => Some(format!("写入失败: {e}\n可稍后重试「同意 M{id}」。")),
            }
        } else {
            match super::extract::reject_proposal(&mut conn, id, decider, now) {
                Ok(true) => Some(format!("已拒绝提议 M{id}(「{}」)。", proposal)),
                Ok(false) => Some(format!("提议 M{id} 已处理或已过期。")),
                Err(e) => Some(format!("操作失败: {e}")),
            }
        }
    })
    .await
    .ok()
    .flatten()?;

    Some(build_reply(event, &outcome, None))
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
        RequestKind::Friend => format!("好友申请 #{}(QQ {})", decision.target.label(), req.user_id),
        RequestKind::GroupAdd => format!(
            "入群申请 #{}(QQ {} → 群 {})",
            decision.target.label(), req.user_id, req.group_id.unwrap_or(0),
        ),
        RequestKind::GroupInvite => format!("群邀请 #{}(群 {})", decision.target.label(), req.group_id.unwrap_or(0)),
    };

    match call_api(state, action).await {
        // The request was already removed at intercept time; nothing to do here.
        Ok(_) => build_reply(event, &format!("已{verb}{what}"), None),
        Err(e) => {
            // Put it back so the admin can retry; created_at is preserved, so the
            // 24h expiry sweep still applies.
            if let command::DecisionTarget::Request(id) = decision.target {
                state.pending_requests.lock().await.insert(id, req);
            }
            build_reply(
                event,
                &format!("操作失败: {e}\n可稍后重试「{verb} {}」", decision.target.label()),
                None,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// /memory
// ---------------------------------------------------------------------------

/// Render a numbered list and remember the mapping, so a later `forget N`
/// resolves to the row the person actually saw.
#[allow(clippy::too_many_arguments)]
async fn present_listing(
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    user_id: i64,
    kind: super::MemoryListingKind,
    rows: &[crate::db::models::memory::Memory],
    header: &str,
    footer: &str,
) -> String {
    if rows.is_empty() {
        return header.to_string();
    }
    const MAX_SHOWN: usize = 20;
    const MAX_CHARS: usize = 60;

    let shown = rows.len().min(MAX_SHOWN);
    let mut out = format!("{header}\n");
    for (i, m) in rows.iter().take(shown).enumerate() {
        let mut preview: String = m.content.chars().take(MAX_CHARS).collect();
        if m.content.chars().count() > MAX_CHARS {
            preview.push('…');
        }
        out.push_str(&format!("{}. [{}] {preview}\n", i + 1, m.memory_type));
    }
    if rows.len() > shown {
        out.push_str(&format!("还有 {} 条,私聊我查看完整列表\n", rows.len() - shown));
    }
    if !footer.is_empty() {
        out.push_str(footer);
    }

    let now = crate::util::now_ms();
    let mut listings = state.memory_listings.lock().await;
    listings.retain(|_, l| now - l.created_at < super::MEMORY_LISTING_TTL_MS);
    listings.insert(
        (session_key.to_string(), user_id),
        super::MemoryListing {
            kind,
            ids: rows.iter().take(shown).map(|m| m.id.clone()).collect(),
            created_at: now,
        },
    );
    out
}

/// Resolve numbers against the caller's last listing. Expiry is a hard failure:
/// falling back to whatever the current order happens to be is how people end up
/// deleting a memory they never chose.
async fn resolve_listing(
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    user_id: i64,
    expected: super::MemoryListingKind,
    indices: &[usize],
) -> Result<Vec<String>, String> {
    let now = crate::util::now_ms();
    let listings = state.memory_listings.lock().await;
    let listing = listings
        .get(&(session_key.to_string(), user_id))
        .filter(|l| now - l.created_at < super::MEMORY_LISTING_TTL_MS)
        .ok_or("列表已过期,请重新执行一次查看指令。")?;
    // The numbers must come from the matching command. Resolving /memory me's
    // numbers against a /memory group listing (or the reverse) deletes rows the
    // caller never saw under those numbers.
    if listing.kind != expected {
        return Err("编号与上次查看的列表不符,请先重新执行对应的查看指令。".to_string());
    }

    let mut ids = Vec::new();
    for n in indices {
        match listing.ids.get(n - 1) {
            Some(id) => ids.push(id.clone()),
            None => return Err(format!("列表中没有第 {n} 条。")),
        }
    }
    Ok(ids)
}

async fn dispatch_memory(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    is_admin: bool,
    args: &str,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    use crate::db::models::memory::{DeletedBy, MemoryScope, Origin, Visibility};
    use crate::db::ops::memory as mem_ops;

    let is_group = session_key.kind == SessionKind::Group;
    let user_id = event.user_id.unwrap_or(0);
    let scope_id = crate::db::models::memory::onebot_user_scope_id(user_id);

    let Some(sub) = command::parse_memory_sub(args) else {
        return build_reply(event, "用法: /memory [me|forget N|undo|optout|group]", reply_to);
    };

    // Operator views mix what was learned in other rooms, in private chats, and
    // the operator's own notes. Refuse before touching the database.
    if sub.is_operator_only() {
        if !is_admin {
            return build_reply(event, "该指令仅管理员可用。", reply_to);
        }
        if is_group {
            return build_reply(event, "该指令仅限私聊使用。", reply_to);
        }
    }

    let pool = state.pool.clone();
    let now = crate::util::now_ms();

    match sub {
        command::MemorySub::Help => build_reply(
            event,
            "/memory — 概览\n\
             /memory me — 查看关于你的记忆\n\
             /memory forget N — 删除第 N 条(支持 2 3 5 或 2-5)\n\
             /memory forget all yes — 删除全部\n\
             /memory undo — 撤销 5 分钟内的删除\n\
             /memory optout — 不再记住我 · /memory optin — 恢复\n\
             /memory group — 查看本群记忆(任何成员可删)",
            reply_to,
        ),

        command::MemorySub::Overview => {
            let sid = scope_id.clone();
            let counts = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                let ctx = mem_ops::VisibilityCtx::self_view(is_group);
                let mine = mem_ops::visible_user_memories(&mut conn, &sid, &ctx).ok()?.len();
                let opted = mem_ops::get_subject(&mut conn, &sid)
                    .ok()
                    .flatten()
                    .is_some_and(|s| s.is_opted_out());
                Some((mine, opted))
            })
            .await
            .ok()
            .flatten();

            let text = match counts {
                Some((_, true)) => "你已选择不被记住。输入 /memory optin 可恢复。".to_string(),
                Some((n, false)) => format!(
                    "关于你的记忆: {n} 条\n输入 /memory me 查看,/memory optout 停止被记住。"
                ),
                None => "读取失败。".to_string(),
            };
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::Me => {
            let sid = scope_id.clone();
            let rows = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                // Exactly what would be injected here, minus the operator's
                // private notes — visibility is a subset of injection, so the
                // two can never disagree.
                let ctx = mem_ops::VisibilityCtx::self_view(is_group);
                mem_ops::visible_user_memories(&mut conn, &sid, &ctx).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_default();

            let header = if rows.is_empty() {
                "我还没有记住关于你的事。".to_string()
            } else {
                format!("关于你的记忆({} 条):", rows.len())
            };
            let text = present_listing(
                state, session_key, user_id, super::MemoryListingKind::Own, &rows, &header,
                "\n/memory forget N 删除 · /memory optout 完全退出",
            )
            .await;
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::Forget(indices) => {
            match resolve_listing(
                state, session_key, user_id, super::MemoryListingKind::Own, &indices,
            ).await {
                Err(e) => build_reply(event, &e, reply_to),
                Ok(ids) => {
                    let n = tokio::task::spawn_blocking(move || {
                        let mut conn = pool.get().ok()?;
                        mem_ops::soft_delete_memories(&mut conn, &ids, DeletedBy::SelfRemoved, now)
                            .ok()
                    })
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or(0);
                    build_reply(
                        event,
                        &format!("已删除 {n} 条。5 分钟内可用 /memory undo 撤销。"),
                        reply_to,
                    )
                }
            }
        }

        command::MemorySub::ForgetAll { confirmed } => {
            if !confirmed {
                return build_reply(
                    event,
                    "这会删除所有关于你的记忆。确认请发送: /memory forget all yes",
                    reply_to,
                );
            }
            let sid = scope_id.clone();
            let n = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                // Operator notes are not the subject's to clear; the reply says so.
                mem_ops::forget_subject(&mut conn, &sid, false, DeletedBy::SelfRemoved, now).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
            build_reply(
                event,
                &format!("已删除 {n} 条。管理员另行记录的备注不受影响。"),
                reply_to,
            )
        }

        command::MemorySub::Undo => {
            let sid = scope_id.clone();
            let n = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                // Only this person's own recent deletions, so one member cannot
                // restore what another chose to remove.
                let cutoff = now - 5 * 60 * 1000;
                let rows = mem_ops::list_trash(&mut conn, 200).ok()?;
                let ids: Vec<String> = rows
                    .into_iter()
                    .filter(|m| {
                        m.deleted_by.as_deref() == Some(DeletedBy::SelfRemoved.as_str())
                            && m.deleted_at.is_some_and(|t| t >= cutoff)
                            && (m.subject_scope_id.as_deref() == Some(sid.as_str())
                                || m.scope_id == sid)
                    })
                    .map(|m| m.id)
                    .collect();
                mem_ops::restore_memories(&mut conn, &ids).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
            let text = if n == 0 {
                "没有可撤销的删除(仅限 5 分钟内)。".to_string()
            } else {
                format!("已恢复 {n} 条。")
            };
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::OptOut => {
            let sid = scope_id.clone();
            let n = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::touch_subject(&mut conn, &sid, None, false, now).ok()?;
                mem_ops::set_subject_flags(&mut conn, &sid, None, Some(true)).ok()?;
                // Clears memories held about them anywhere, including group
                // entries that name them — otherwise opting out would leave the
                // parts most likely to be repeated in front of others.
                mem_ops::forget_subject(&mut conn, &sid, false, DeletedBy::SelfRemoved, now).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
            build_reply(
                event,
                &format!(
                    "已删除 {n} 条并停止记住你。管理员另行记录的备注不受影响。\n随时可用 /memory optin 恢复。"
                ),
                reply_to,
            )
        }

        command::MemorySub::OptIn => {
            let sid = scope_id.clone();
            let ok = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::touch_subject(&mut conn, &sid, None, false, now).ok()?;
                mem_ops::set_subject_flags(&mut conn, &sid, None, Some(false)).ok()
            })
            .await
            .is_ok();
            build_reply(
                event,
                if ok { "好的,我会重新开始记住你说的事。" } else { "操作失败。" },
                reply_to,
            )
        }

        command::MemorySub::Group | command::MemorySub::GroupForget(_) => {
            if !is_group {
                return build_reply(event, "该指令仅限群聊使用。", reply_to);
            }
            let project_id = {
                let mut sessions = state.sessions.lock().await;
                sessions
                    .get_or_create(session_key, "", state.config.assistant_id.as_deref())
                    .ok()
                    .map(|(pid, _)| pid)
            };
            let Some(project_id) = project_id else {
                return build_reply(event, "读取失败。", reply_to);
            };

            if let command::MemorySub::GroupForget(indices) = sub {
                return match resolve_listing(state, session_key, user_id, super::MemoryListingKind::Group, &indices).await {
                    Err(e) => build_reply(event, &e, reply_to),
                    Ok(ids) => {
                        let n = tokio::task::spawn_blocking(move || {
                            let mut conn = pool.get().ok()?;
                            mem_ops::soft_delete_memories(
                                &mut conn, &ids, DeletedBy::SelfRemoved, now,
                            )
                            .ok()
                        })
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or(0);
                        build_reply(event, &format!("已删除 {n} 条群记忆。"), reply_to)
                    }
                };
            }

            let rows = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::list_by_scope(&mut conn, MemoryScope::Project, &project_id).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
            // Any member may delete these. A group memory can just as easily be
            // an embarrassing story about one person as a piece of shared slang,
            // and leaving removal to the operator only would reopen the hole
            // that per-person deletion exists to close.
            let rows: Vec<_> = rows.into_iter().filter(|m| !m.is_owner_only()).collect();
            let header = if rows.is_empty() {
                "本群还没有记忆。".to_string()
            } else {
                format!("本群记忆({} 条):", rows.len())
            };
            let text = present_listing(
                state, session_key, user_id, super::MemoryListingKind::Group, &rows, &header,
                "\n/memory group forget N 删除",
            )
            .await;
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::User(target) => {
            let target_scope = crate::db::models::memory::onebot_user_scope_id(target);
            let rows = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::list_by_subject(&mut conn, &target_scope).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
            let header = if rows.is_empty() {
                format!("没有关于 {target} 的记忆。")
            } else {
                format!("关于 {target} 的全部记忆({} 条):", rows.len())
            };
            let text = present_listing(state, session_key, user_id, super::MemoryListingKind::Operator, &rows, &header, "").await;
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::UserAdd { user_id: target, content } => {
            let target_scope = crate::db::models::memory::onebot_user_scope_id(target);
            let key = format!("note_{}", now % 100_000);
            let result = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().map_err(|e| e.to_string())?;
                mem_ops::validate_memory(
                    &mut conn, MemoryScope::OnebotUser, &target_scope, &key, &content,
                )?;
                let id = uuid::Uuid::new_v4().to_string();
                mem_ops::upsert_memory(
                    &mut conn,
                    &crate::db::models::memory::NewMemory {
                        id: &id,
                        scope_type: MemoryScope::OnebotUser.as_str(),
                        scope_id: &target_scope,
                        key: &key,
                        content: &content,
                        memory_type: "fact",
                        subject_scope_id: Some(&target_scope),
                        origin: Origin::Admin.as_str(),
                        // The operator's own annotation: the subject can neither
                        // see nor remove it.
                        visibility: Visibility::OwnerOnly.as_str(),
                        source_session_id: None,
                        created_at: now,
                        updated_at: now,
                    },
                )
                .map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
            let text = match result {
                Ok(()) => format!("已记录关于 {target} 的备注(仅你可见)。"),
                Err(e) => format!("写入失败: {e}"),
            };
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::Global => {
            let rows = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::list_by_scope(
                    &mut conn,
                    MemoryScope::OnebotGlobal,
                    crate::db::models::memory::GLOBAL_SCOPE_ID,
                )
                .ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
            let header = if rows.is_empty() {
                "还没有全局记忆。".to_string()
            } else {
                format!("全局记忆({} 条):", rows.len())
            };
            let text = present_listing(state, session_key, user_id, super::MemoryListingKind::Operator, &rows, &header, "").await;
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::GlobalAdd { key, content } => {
            let result = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().map_err(|e| e.to_string())?;
                let gid = crate::db::models::memory::GLOBAL_SCOPE_ID;
                mem_ops::validate_memory(&mut conn, MemoryScope::OnebotGlobal, gid, &key, &content)?;
                let id = uuid::Uuid::new_v4().to_string();
                mem_ops::upsert_memory(
                    &mut conn,
                    &crate::db::models::memory::NewMemory {
                        id: &id,
                        scope_type: MemoryScope::OnebotGlobal.as_str(),
                        scope_id: gid,
                        key: &key,
                        content: &content,
                        memory_type: "instruction",
                        subject_scope_id: None,
                        origin: Origin::Admin.as_str(),
                        // Taught deliberately, and meant to be acted on.
                        visibility: Visibility::Normal.as_str(),
                        source_session_id: None,
                        created_at: now,
                        updated_at: now,
                    },
                )
                .map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
            let text = match result {
                Ok(()) => "已加入全局记忆。".to_string(),
                Err(e) => format!("写入失败: {e}"),
            };
            build_reply(event, &text, reply_to)
        }

        command::MemorySub::Pending => {
            let rows = tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().ok()?;
                mem_ops::expire_proposals(&mut conn, now).ok()?;
                mem_ops::list_proposals(&mut conn, true).ok()
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
            let text = if rows.is_empty() {
                "没有待处理的全局记忆提议。".to_string()
            } else {
                let mut s = format!("待处理提议({} 条):\n", rows.len());
                for p in &rows {
                    s.push_str(&format!("#{} {}: {}\n", p.id, p.key, p.content));
                }
                s.push_str("回复「同意 MN」或「拒绝 MN」处理(如 同意 M3)。");
                s
            };
            build_reply(event, &text, reply_to)
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
    let is_group = session_key.kind == SessionKind::Group;

    // Single gate, ahead of everything else: a new command cannot forget to
    // check its own permissions.
    if !cmd.available(is_admin, is_group) {
        let why = match cmd.scope() {
            command::CommandScope::PrivateOnly if is_group => "该指令仅限私聊使用。",
            command::CommandScope::GroupOnly if !is_group => "该指令仅限群聊使用。",
            _ => "该指令仅管理员可用。",
        };
        return build_reply(event, why, reply_to);
    }

    // Resetting or compacting the conversation while a turn is writing to it
    // would corrupt the running loop's view of history.
    if matches!(cmd, SlashCommand::New | SlashCommand::Compact) {
        let busy = state.session_states.lock()
            .get(&session_key.to_string())
            .is_some_and(|s| s.turn_active);
        if busy {
            return build_reply(event, "当前有任务正在处理,请稍后再试。", reply_to);
        }
    }

    match cmd {
        SlashCommand::Help => {
            build_reply(event, &SlashCommand::help_text(is_admin, is_group), reply_to)
        }
        SlashCommand::Memory => {
            dispatch_memory(event, state, session_key, is_admin, args, reply_to).await
        }
        SlashCommand::New => dispatch_new(event, state, session_key, title, reply_to).await,
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

/// Archive what the session was on and start it somewhere fresh.
///
/// The check in `dispatch_command` only knows about this session's own turns;
/// the desktop can have the same conversation open and be answering in it, and
/// archiving it mid-answer takes it out of the sidebar while the reply is still
/// arriving. So it is leased first, like every other write — and the id that
/// was leased is the id handed to `reset_conversation`, which archives that one
/// and nothing else.
async fn dispatch_new(
    event: &OneBotEvent,
    state: &Arc<SharedState>,
    session_key: &SessionKey,
    title: &str,
    reply_to: Option<i64>,
) -> Vec<OneBotAction> {
    let conversation_id = {
        let mut sessions = state.sessions.lock().await;
        match sessions.get_or_create(session_key, title, state.config.assistant_id.as_deref()) {
            Ok((_, cid)) => cid,
            Err(e) => return build_reply(event, &format!("内部错误: {e}"), reply_to),
        }
    };

    let _lease = match state.coordinator.try_acquire_mutation(&conversation_id, "a reset") {
        Ok(lease) => lease,
        Err(busy) => {
            tracing::info!(
                conversation_id = %conversation_id,
                reason = %busy,
                "OneBot /new refused: the conversation is held elsewhere"
            );
            return build_reply(event, "这个对话正在电脑端处理,请稍后再试。", reply_to);
        }
    };

    let mut sessions = state.sessions.lock().await;
    let reset = sessions.reset_conversation(
        session_key, title, state.config.assistant_id.as_deref(), &conversation_id,
    );
    match reset {
        Ok(_) => build_reply(event, "已重置对话。新的对话已创建。", reply_to),
        Err(e) => build_reply(event, &format!("重置失败: {e}"), reply_to),
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

    // The check above only knows about this session's own turns. The desktop
    // can have the same conversation open and be compacting or answering in it.
    let _lease = match state.coordinator.try_acquire_mutation(&conversation_id, "compaction") {
        Ok(lease) => lease,
        Err(busy) => {
            tracing::info!(
                conversation_id = %conversation_id,
                reason = %busy,
                "OneBot /compact refused: the conversation is held elsewhere"
            );
            return build_reply(event, "这个对话正在电脑端处理,请稍后再试。", reply_to);
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

    match crate::agent::do_compact(pool, secrets, &conversation_id, assistant.as_ref(), keep_recent, custom_instructions.as_deref()).await {
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
        // The active path, not every row: counting branches the user has
        // switched away from would not describe the conversation /status is
        // reporting on.
        let msg_count = crate::db::ops::message::list_messages(&mut conn, &conv_id)
            .map(|history| {
                crate::db::ops::message::active_context(&history, conv.head_message_id.as_deref())
                    .path
                    .len() as i64
            })
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
