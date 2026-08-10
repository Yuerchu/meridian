use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
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
use crate::agent::turn_record;
use crate::db::models::turn::{TurnPhase, TurnStatus, ERROR_LOOP_DETECTED};
use crate::db::DbPool;
use crate::state::{AppDb, AppSecrets, AppTools, AppMcp, ApprovalDecision, ApprovalWaiters, AppTurns, EditSessions, CompactBreakers};
use crate::turn::{TurnLease, TurnOrigin};
use crate::agent::{build_messages_with_senders, trailing_with_memory, build_file_access, file_access_prompt, estimate_tokens, microcompact, resolve_file_uris_in_messages, trim_to_context_limit, extract_tool_calls_from_blocks, parse_openai_tool_calls, serialize_tool_calls_openai, provider_secret_name, get_provider_api_key, resolve_provider_config, do_compact, mid_turn_compact, CompactCircuitBreaker, COMPACT_PROMPT, MAX_STREAM_RETRIES, STREAM_RETRY_BASE, is_context_window_error, is_retryable_stream_error, instruction_budget, load_project_instructions, TokenBudget};
use crate::util::{get_conn, now_ms, take_bytes_at_char_boundary};
use crate::agent::engine::{self, consume_stream};

/// The desktop events are the answer. A window that missed one is showing a
/// transcript that never catches up, so a send that fails ends the turn and the
/// user is told -- see the Emit trait for the other runner opposite reading.
struct WindowEmit(tauri::AppHandle);

impl crate::agent::engine::Emit for WindowEmit {
    fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
        self.0.emit(channel, payload).map_err(|e| e.to_string())
    }
}

/// Everything a turn owes back, whichever way it leaves.
///
/// A turn has around thirty exits: seven early returns before the loop, twenty
/// or so inside it, cancellation, and panics. `Drop` is the only one of those
/// that every path takes, so all three obligations hang off it — release the
/// conversation, retire the approvals nobody is waiting on any more, and tell
/// the front end the turn is over.
///
/// The lease is held in an `Option` so it can be dropped by hand, in order. A
/// struct field is destroyed only once `Drop::drop` has returned, so leaving it
/// to that order would send the stop event while the conversation still read as
/// occupied — and the front end treats a stop as permission to send again.
struct TurnGuard<'a> {
    app: &'a tauri::AppHandle,
    conversation_id: &'a str,
    turn_id: String,
    /// The row being written. Absent until the first iteration creates one —
    /// the early returns before that still owe a terminal stop, they just have
    /// no message to attach it to, and the front end would otherwise sit on the
    /// `streaming` flag its optimistic send set.
    message_id: Option<String>,
    /// Cleared once the turn's own stop event has gone out.
    armed: bool,
    lease: Option<TurnLease>,
}

impl TurnGuard<'_> {
    /// Open this turn's durable record.
    ///
    /// A method on the guard rather than a free call, so it cannot be made
    /// before the guard exists. Recording first would leave a window — one
    /// `await` on a pooled connection — in which a dropped task released the
    /// conversation and told the front end nothing, which is the state this
    /// guard was written to make unreachable.
    ///
    /// `Err` means the id is already on record, and the caller must not go on
    /// to close that turn out.
    async fn open_record(&self, pool: &DbPool) -> Result<(), String> {
        turn_record::begin(pool, &self.turn_id, self.conversation_id, TurnOrigin::Desktop).await
    }

    /// Hand the conversation back. Called just before the turn's own stop event
    /// goes out, so "the stream ended" and "you may send again" become true at
    /// the same moment. What still runs after it — generating a title — is a
    /// whole model call, and holding the conversation across that would refuse
    /// every follow-up message for as long as it took.
    ///
    /// The title write itself is safe to race: it touches `title` and nothing
    /// the transcript is read through.
    fn release(&mut self) {
        self.lease.take();
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TurnGuard<'_> {
    fn drop(&mut self) {
        // Nobody is left to answer these. Left behind, they would show the user
        // a card whose buttons reach a receiver that has already gone, and the
        // registry would grow one entry per abandoned turn.
        self.app
            .state::<ApprovalWaiters>()
            .lock()
            .retain(|_, pending| pending.turn_id != self.turn_id);
        // Before the event, not after: a user who sends again the instant the
        // stream ends must not be told the conversation is busy.
        self.lease.take();
        if self.armed {
            let _ = self.app.emit("chat-stream", serde_json::json!({
                "type": "stop", "reason": "error", "done": true,
                "message_id": self.message_id,
                "turn_id": self.turn_id,
                "conversation_id": self.conversation_id,
            }));
        }
    }
}

/// Put a tool call in front of the user and wait for their answer. Returns
/// `None` when the chat is cancelled (stop button) before a decision arrives,
/// so approval waits cannot outlive the conversation.
///
/// Brackets the wait with the turn's phase, so a process killed while the card
/// is on screen is diagnosed as "stopped waiting for you" rather than as
/// something that might have run.
///
/// `retry_reason` is set when a sandbox-blocked command is asking to be run
/// again without the sandbox. It retries the same call under the same id — the
/// approval is what is new, and that gets its own `approval_id`.
async fn wait_for_approval(
    app: &tauri::AppHandle,
    cancel: &CancellationToken,
    tc: &provider::ToolCall,
    turn_id: &str,
    message_id: &str,
    conversation_id: &str,
    retry_reason: Option<&str>,
) -> Result<Option<ApprovalDecision>, String> {
    // Ours, not the provider's. See `PendingApproval` for what reusing the tool
    // call id used to cost.
    let approval_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    // Registered before the event goes out, so a decision can never arrive
    // before there is somewhere to put it.
    {
        let waiters = app.state::<ApprovalWaiters>();
        waiters.lock().insert(approval_id.clone(), crate::state::PendingApproval {
            conversation_id: conversation_id.to_string(),
            turn_id: turn_id.to_string(),
            assistant_message_id: message_id.to_string(),
            provider_call_id: tc.id.clone(),
            // A retry is an attempt at the same call, under the same id.
            origin_call_id: retry_reason.map(|_| tc.id.clone()),
            tool_name: tc.name.clone(),
            retry_reason: retry_reason.map(str::to_string),
            sender: tx,
        });
    }
    let mut payload = serde_json::json!({
        "type": "tool_approval_req",
        "approval_id": approval_id,
        "call_id": tc.id,
        "tool_name": tc.name,
        "arguments": tc.arguments,
        "message_id": message_id,
        "conversation_id": conversation_id,
    });
    // The reason's presence is the flag; a separate boolean beside it could
    // only ever disagree with it.
    if let Some(reason) = retry_reason {
        payload["retry_reason"] = serde_json::json!(reason);
        payload["origin_call_id"] = serde_json::json!(tc.id);
    }
    if let Err(e) = app.emit("chat-stream", payload) {
        // Nobody will ever answer a card that was never drawn; don't leave the
        // entry behind for the turn guard to find.
        app.state::<ApprovalWaiters>().lock().remove(&approval_id);
        return Err(e.to_string());
    }
    // After the card is on screen, so the recorded phase is never ahead of what
    // the user can actually see.
    let pool = app.state::<AppDb>().0.clone();
    // The bracket restores `Streaming` however the wait ends — leaving the
    // phase behind would have a crash a minute later report a card that is no
    // longer on screen.
    let decision = engine::in_phase(
        &pool, turn_id, TurnPhase::AwaitingApproval, Some(&tc.name),
        async {
            let decision = tokio::select! {
                _ = cancel.cancelled() => None,
                r = rx => r.ok(),
            };
            if decision.is_none() {
                // Cancelled, or the sender was dropped. Take the entry out so a
                // late answer cannot land on a turn that has already moved on.
                app.state::<ApprovalWaiters>().lock().remove(&approval_id);
            }
            decision
        },
    ).await;
    Ok(decision)
}

/// Ask the turn running for this conversation to stop.
///
/// `turn_id` names which run the caller meant to stop. Without it "stop, then
/// send again" could cancel the new turn instead of the old one: the two are
/// only told apart by id, and a stop takes effect asynchronously. `None` still
/// means "whatever is running here" — a reload loses the id, and the button has
/// to keep working.
///
/// Succeeds either way. A stop aimed at a turn that already ended is not a
/// failure the user needs to see; the front end clears its own state regardless.
#[tauri::command]
pub async fn stop_chat(
    app: tauri::AppHandle,
    conversation_id: String,
    turn_id: Option<String>,
) -> Result<(), String> {
    let cancelled = app.state::<AppTurns>().0.cancel(&conversation_id, turn_id.as_deref());
    if !cancelled {
        tracing::debug!(
            conversation_id = %conversation_id,
            turn_id = ?turn_id,
            "stop asked for a turn that is no longer running"
        );
    }
    Ok(())
}

#[tauri::command]
// Everything this turn logs is tagged with the conversation, so "why did that
// one fail" is a single query rather than a scan. skip_all because the message
// body must never reach the log.
#[tracing::instrument(
    skip_all,
    fields(conversation_id = %conversation_id, model = tracing::field::Empty)
)]
/// Run a turn.
///
/// `message` and `replaces` together pick which of three things this is:
///
/// | message | replaces | |
/// |---|---|---|
/// | set   | unset | continue the conversation from its head |
/// | unset | set   | regenerate: another answer alongside that one |
/// | set   | set   | edit: another version of that question, answered afresh |
///
/// `replaces` names the message being offered an alternative, not the parent of
/// the new one — the parent is looked up from it. That way editing the opening
/// message works like editing any other: it has no parent, and the new version
/// becomes a second root rather than being appended to the end.
///
/// The named message is never modified or removed; it stays reachable as a
/// sibling of what this turn writes.
#[allow(clippy::too_many_arguments)]
///
/// `turn_id` is the front end's, minted before it sent. See
/// `TurnCoordinator::try_acquire_turn_as` for why it is not minted here.
pub async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: Option<String>,
    turn_id: Option<String>,
    replaces: Option<String>,
    model_override: Option<String>,
    provider_override: Option<String>,
    thinking_level: Option<String>,
    assistant_id: Option<String>,
    fast: Option<bool>,
    mode: Option<String>,
    voice: Option<bool>,
) -> Result<(), String> {
    // Decided here rather than inside, so the failure path below can name the
    // turn it is closing without depending on how far the run got.
    //
    // Parsed rather than taken as given: this ends up as a primary key, and the
    // canonical form is what stops the same id in two spellings from opening
    // two records. A value that is not a uuid at all is a bug on the other side
    // and is refused outright.
    let turn_id = match turn_id {
        Some(raw) => uuid::Uuid::parse_str(&raw)
            .map_err(|_| "turn id must be a uuid".to_string())?
            .to_string(),
        None => uuid::Uuid::new_v4().to_string(),
    };
    let pool = app.state::<AppDb>().0.clone();

    // Nothing is awaited between taking this and handing it to the guard that
    // gives it back, so there is no point at which the task can be dropped
    // holding it.
    let lease = app.state::<AppTurns>().0.clone()
        .try_acquire_turn_as(&conversation_id, TurnOrigin::Desktop, turn_id.clone())
        .map_err(|busy| busy.to_string())?;

    // Set once the turn's row exists, and read below to decide whether closing
    // it out is this call's business. A duplicate id is refused *after* the
    // guard is up — closing it out anyway would rewrite the ending of whichever
    // turn that id really belongs to, which is the corruption the refusal is
    // for.
    let recorded = Arc::new(AtomicBool::new(false));

    // Every way a turn can end early funnels through here, so the red bubble the
    // user sees always has a matching record in the log. Doing it at one point
    // rather than at each `?` also keeps a single failure from being reported
    // twice.
    let result = chat_inner(
        app, conversation_id, message, lease, Arc::clone(&recorded), replaces,
        model_override, provider_override, thinking_level, assistant_id, fast, mode, voice,
    )
    .await
    .inspect_err(|e| tracing::error!(error = %e, "turn failed"));

    // A turn that stopped because something went wrong is not a turn that was
    // killed, and the record has to say which. Without this the row would be
    // left at `running` and the next launch would report a bad API key as a
    // crash.
    if let Err(ref e) = result {
        if recorded.load(Ordering::Relaxed) {
            turn_record::finish(&pool, &turn_id, TurnStatus::Failed, Some(e)).await;
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn chat_inner(
    app: tauri::AppHandle,
    conversation_id: String,
    message: Option<String>,
    // Already taken by the caller, but not yet recorded: the guard that gives
    // it back has to exist before anything is awaited, or a task dropped in
    // that gap would release the conversation and leave the front end
    // streaming forever with nothing to tell it otherwise.
    lease: TurnLease,
    // Set once the turn's row exists. The caller reads it to decide whether the
    // record is its to close.
    recorded: Arc<AtomicBool>,
    replaces: Option<String>,
    model_override: Option<String>,
    provider_override: Option<String>,
    thinking_level: Option<String>,
    assistant_id: Option<String>,
    fast: Option<bool>,
    mode: Option<String>,
    voice: Option<bool>,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let pool = app.state::<AppDb>().0.clone();
    // Every stream event this turn sends goes through here. The handle is an
    // `Arc` inside, so the clone is a refcount bump.
    let emitter = WindowEmit(app.clone());

    // Names this run of the turn, as opposed to the conversation it belongs to
    // or the assistant row it is currently writing (which changes every
    // iteration).
    let turn_id = lease.turn_id().to_string();
    let cancel = lease.cancel_token().clone();
    // From here on every exit goes through this: the lease, the approvals and
    // the terminal stop event are all released by its `Drop`.
    let mut stop_guard = TurnGuard {
        app: &app,
        conversation_id: &conversation_id,
        turn_id: turn_id.clone(),
        message_id: None,
        armed: true,
        lease: Some(lease),
    };

    // Only now, with the guard up. From here the row says `running`; every exit
    // that reaches an ending overwrites that, and every exit that does not — a
    // kill, a power cut — leaves it as the record that this turn never
    // finished. Deliberately never written from the guard's `Drop`: destructors
    // do not run for the case this is all for.
    //
    // Refused, not logged, if the id is already on record: these are minted by
    // the front end, and a replayed one would rewrite the finished turn it
    // names and file this turn's messages under it.
    stop_guard.open_record(&pool).await?;
    recorded.store(true, Ordering::Relaxed);

    // Load conversation + assistant + active path + project path
    let (assistant, ctx, conv_title, project_path, project_id, conv_prefs, branch_parent) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let aid_override = assistant_id.clone();
        let replaces = replaces.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
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
            let conv_prefs = (
                conv.thinking_level.clone(),
                conv.fast_mode != 0,
                conv.mode.clone(),
                conv.accept_edits != 0,
            );
            // Where the new messages hang. Looked up from the message being
            // replaced rather than passed in, so replacing a root works without
            // a special case: its parent is None, and the new version becomes a
            // second root.
            let replaced = replaces.as_deref().and_then(|id| history.iter().find(|m| m.id == id));
            if replaces.is_some() && replaced.is_none() {
                return Err("the message being replaced is not in this conversation".into());
            }
            let branch_parent = replaced.and_then(|m| m.parent_id.clone());

            // Resolved once and threaded through the turn. Re-reading the head
            // per row would let a concurrent turn's writes splice into this one.
            //
            // Branching reads up to the fork point rather than the conversation
            // head, so the model sees the history as it stood when the message
            // being replaced was written — not whatever came after it.
            //
            // Replacing a root means there is no history at all; the usual
            // "no head, use the newest row" fallback would wrongly hand back the
            // whole conversation, so that case is built empty.
            let ctx = match (replaced.is_some(), branch_parent.as_deref()) {
                (true, None) => db::ops::message::ActiveContext {
                    path: Vec::new(),
                    summary: None,
                    anchor_index: None,
                    head_id: None,
                },
                (true, parent) => db::ops::message::active_context(&history, parent),
                (false, _) => db::ops::message::active_context(&history, conv.head_message_id.as_deref()),
            };
            Ok::<_, String>((assistant, ctx, conv.title, project_path, project_id, conv_prefs, branch_parent))
        }).await.map_err(|e| e.to_string())??
    };

    // Resolve provider config (with optional overrides). Off the async thread:
    // it takes a pooled connection and reads the OS credential store, either of
    // which can block for as long as the pool's acquire timeout.
    let (mut provider_type, mut base_url, mut api_key, model, mut api_format) = {
        let pool2 = pool.clone();
        let secrets2 = secrets.0.clone();
        let assistant2 = assistant.clone();
        tokio::task::spawn_blocking(move || {
            resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())
        }).await.map_err(|e| e.to_string())??
    };

    let model = model_override.unwrap_or(model);
    // Filled in now rather than declared at entry: which model a turn actually
    // used is the first thing a provider error needs explaining.
    tracing::Span::current().record("model", model.as_str());

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

    // Needed before the tool set is assembled, unlike the other two prefs which
    // only matter once the request parameters are built.
    let conv_mode = conv_prefs.2.clone();

    // Build messages with history (resolve template variables in system prompt)
    let file_access = build_file_access(&pool).await;
    let raw_prompt = assistant.as_ref().map(|a| a.system_prompt.as_str()).unwrap_or("");
    // Decorative: an unreadable preference costs the assistant the user's name,
    // nothing more. Logged rather than swallowed so a pool timeout is still
    // traceable.
    let user_name = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = match get_conn(&pool2) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "could not read user_name; the assistant will not know it");
                    return None;
                }
            };
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
        // Decorative, same as the name above: without it the assistant simply
        // has no emoji to reach for.
        let emoji_names: Option<String> = tokio::task::spawn_blocking(move || {
            let mut conn = match get_conn(&pool2) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "could not read the emoji list; it is omitted from this turn");
                    return None;
                }
            };
            db::ops::emoji::format_emoji_list_block(&mut conn, &aid)
        }).await.ok().flatten();
        if let Some(names) = emoji_names {
            tmpl_ctx.set("emoji_list", &names);
        }
    }
    let system_prompt_resolved = template::resolve(raw_prompt, &tmpl_ctx);
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let memory_block = crate::agent::load_memory_block(
        &pool,
        crate::agent::MemoryRequest::desktop(
            project_id.clone(),
            crate::agent::memory_budget(context_limit),
        ),
    )
    .await;
    // How the previous turns stopped, for any that did not stop cleanly. Read
    // here rather than at the top because it is background about the
    // conversation, like the memory block, and travels the same way.
    //
    // Held in an Option that is emptied by the first reply this turn reads to
    // the end: reading the record settles nothing, and neither does sending a
    // request, since this turn may die on the way out or be refused over SSE
    // by a provider that already answered 200.
    let mut interrupted = crate::agent::interrupted::load_block(
        &pool,
        &app.state::<AppTurns>().0,
        &conversation_id,
        &turn_id,
    )
    .await;
    let instruction_block = {
        let budget = instruction_budget(context_limit);
        if budget > 0 {
            load_project_instructions(project_path.as_deref(), budget).await
        } else {
            None
        }
    };
    // Everything the assistant may do this turn, and everything it is told.
    // Shared with the OneBot loop and the token estimator so the three cannot
    // drift apart again. The memory block is deliberately not part of it: that
    // one travels as a user-role message, because it is partly learned from
    // what other people said and the system prompt is for our own rules.
    let tool_registry = app.state::<AppTools>();
    // Off the published snapshot. Reading it never waits on a server that is
    // mid-call — which is exactly what used to stop every other conversation
    // from starting a turn.
    let mcp_defs = app.state::<AppMcp>().0.tool_definitions().as_ref().clone();
    let mut mode = crate::agent::modes::resolve(
        mode.as_deref().or(conv_mode.as_deref()),
    );
    // Kept so the turn can be re-resolved in place if the user approves a plan
    // mid-flight; everything else the resolver needs is still in scope.
    let persona = system_prompt_resolved;
    let context_blocks = vec![
        instruction_block.unwrap_or_default(),
        file_access_prompt(&file_access),
        // Mirrored in conversation.rs's estimator via the same function; the
        // OR with this turn's flag only matters before the message lands.
        crate::voice::prompt::voice_context_block(&ctx.path, voice == Some(true))
            .unwrap_or_default(),
    ];
    let turn = {
        let pool2 = pool.clone();
        let registry = tool_registry.0.clone();
        let input = crate::agent::turn_config::TurnConfigInput {
            assistant: assistant.clone(),
            conversation_id: conversation_id.clone(),
            project_id: project_id.clone(),
            mode,
            mcp_defs,
            include_tools: true,
            persona: persona.clone(),
            context_blocks: context_blocks.clone(),
        };
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            Ok::<_, String>(crate::agent::turn_config::resolve(&mut conn, &registry, input))
        }).await.map_err(|e| e.to_string())??
    };
    let mut tool_defs = turn.tool_defs;
    let mut offered = turn.offered;
    let system_prompt = turn.system_prompt;
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
    let auto_compact = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    let effective_provider_id = provider_override.clone()
        .or_else(|| assistant.as_ref().and_then(|a| a.provider_id.clone()));

    // Precedence: per-request override > conversation preference > assistant default.
    // Read once at the top of the turn: a mid-turn flip should not retroactively
    // widen calls the user is already looking at an approval card for.
    let accept_edits = conv_prefs.3;
    let (conv_thinking_level, conv_fast_mode, _, _) = conv_prefs;
    let effective_level = thinking_level.as_deref().or(conv_thinking_level.as_deref());
    // Resolved before the compaction check so the summariser and the turn it
    // summarises send parameters filtered against the same model.
    let turn_params = {
        let pool2 = pool.clone();
        let assistant2 = assistant.clone();
        let pid = effective_provider_id.clone();
        let pt = provider_type.clone();
        let af = api_format.clone();
        let mid = model.clone();
        let level = effective_level.map(|s| s.to_string());
        let fast = fast.unwrap_or(conv_fast_mode);
        tokio::task::spawn_blocking(move || {
            crate::agent::resolve_turn_params(&pool2, crate::agent::TurnParamsInput {
                assistant: assistant2.as_ref(),
                provider_id: pid.as_deref(),
                provider_type: &pt,
                api_format: &af,
                model: &mid,
                thinking_level: level.as_deref(),
                fast,
            })
        }).await.map_err(|e| e.to_string())??
    };
    let context_limit = turn_params.context_limit;
    let max_output = turn_params.max_output;
    let model_config = turn_params.model_config;
    let mut budget = TokenBudget::new(&provider_type, &model, context_limit, max_output, turn_params.compact_threshold);

    let circuit_breaker = {
        let breakers = app.state::<CompactBreakers>();
        let mut map = breakers.0.lock().await;
        map.entry(conversation_id.clone())
            .or_insert_with(|| Arc::new(CompactCircuitBreaker::new()))
            .clone()
    };

    // What the provider sees; the stored row keeps the clean transcript. The
    // [voice] marker matches what push_history_message adds to older rows.
    let payload_message = match (message.as_deref(), voice == Some(true)) {
        (Some(m), true) => Some(format!("[voice] {m}")),
        (m, _) => m.map(String::from),
    };

    // Auto-compact: if enabled and tokens exceed threshold, compact before sending
    let mut compacted = false;
    if auto_compact && circuit_breaker.can_compact() {
        let pre_msgs = build_messages_with_senders(
            system_prompt.trim(),
            &ctx,
            trailing_with_memory(memory_block.as_deref(), interrupted.as_ref().map(|r| r.text()), payload_message.as_deref().unwrap_or("")),
            &Default::default(),
        );
        budget.update_estimate(&pre_msgs);
        if budget.needs_compact() && ctx.path.len() > keep_recent * 2 + 2 {
            app.emit("compact-start", serde_json::json!({
                "conversation_id": &conversation_id,
                "mid_turn": false,
                "trigger": "threshold",
            })).ok();
            // Compaction deletes the old summary before writing the new one and
            // the two are not one transaction, so dying in here is its own kind
            // of half-finished. The bracket also restores `Streaming` however it
            // goes — leaving this phase set would have a crash in the answer
            // that follows reported as a compaction that never finished, and
            // tell the model its history might be half-rewritten when it is not.
            let compaction = engine::in_phase(
                &pool, &turn_id, TurnPhase::Compacting, None,
                do_compact(&pool, &secrets.0, &conversation_id, assistant.as_ref(), keep_recent, None),
            ).await;
            match compaction {
                Ok(_anchor) => {
                    compacted = true;
                    circuit_breaker.record_success();
                    app.emit("compact-done", serde_json::json!({
                        "conversation_id": &conversation_id,
                        "mid_turn": false,
                    })).ok();
                }
                Err(e) => {
                    tracing::warn!("Auto-compact failed: {e}");
                    circuit_breaker.record_failure();
                    // Surfaced rather than swallowed: a silent failure looks
                    // exactly like compaction never having been attempted, while
                    // the context indicator sits pinned at its limit.
                    app.emit("compact-done", serde_json::json!({
                        "conversation_id": &conversation_id,
                        "mid_turn": false,
                        "error": e,
                    })).ok();
                }
            }
        }
    }

    // Compaction wrote a summary row, so the context has to be read again for it
    // to take effect.
    let ctx = if compacted {
        let pool2 = pool.clone();
        let conv_id = conversation_id.clone();
        // Not a fallback to the pre-compaction context. Compaction has already
        // written the summary and moved the head, so carrying on with the old
        // path would send the very history that just overflowed — and do it
        // while reporting the turn as compacted.
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(db::ops::message::active_context(&history, conv.head_message_id.as_deref()))
        }).await.map_err(|e| e.to_string())?
            .map_err(|e| format!("compaction finished but its result could not be read back: {e}"))?
    } else {
        ctx
    };

    let mut chat_messages = build_messages_with_senders(
        system_prompt.trim(),
        &ctx,
        trailing_with_memory(memory_block.as_deref(), interrupted.as_ref().map(|r| r.text()), payload_message.as_deref().unwrap_or("")),
        &Default::default(),
    );
    let files_root = app.path().app_data_dir().ok().map(|d| crate::files::files_dir(&d));
    resolve_file_uris_in_messages(&mut chat_messages, files_root.as_deref());
    microcompact(&mut chat_messages, &budget, keep_recent);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let mut params = turn_params.params;

    // Persist user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let mut assistant_msg_id = String::new();
    // Only the user row uses this: it marks where the turn began. Every later row
    // stamps its own now_ms(), so relative times differ per message and the turn's
    // elapsed time is derivable. Reusing one timestamp across the turn made every
    // message read as sent at the same instant.
    let now = now_ms();

    // Walks down the branch as the turn writes: every row hangs off the one
    // before it, so the whole turn is a single chain and any node with more than
    // one child is a real fork.
    //
    // Branching starts at the replaced message's parent, so what this turn
    // writes becomes its sibling rather than a continuation past it.
    let mut parent_cursor: Option<String> = if replaces.is_some() {
        branch_parent
    } else {
        ctx.head_id.clone()
    };

    // Absent only when regenerating, which re-answers a question that is already
    // on record.
    if let Some(ref text) = message {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg = text.clone();
        let msg_id = user_msg_id.clone();
        let parent = parent_cursor.clone();
        let turn = turn_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::append_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user", content: &msg,
                provider_id: None, model_id: None, input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None, sort_order: 0, created_at: now,
                reasoning_content: None, rating: None, schema_version: 2, is_compact_summary: 0,
                // Desktop chats have a single implicit speaker.
                sender_id: None,
                parent_id: None, compact_anchor_id: None,
                source: if voice == Some(true) { Some("voice") } else { None },
                turn_id: Some(&turn), tool_outcome: None,
            }, parent.as_deref()).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
        parent_cursor = Some(user_msg_id.clone());
    }

    // Shell preference
    let (shell_type, sandbox_pref, sleep_pref) = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = match pool2.get() {
                Ok(c) => c,
                Err(e) => {
                    // The sandbox and sleep fallbacks are fail-safe — absent
                    // means enabled. The shell is not: the turn would run
                    // commands through the platform default instead of the one
                    // the user picked, with nothing on screen to say so.
                    tracing::warn!(
                        error = %e,
                        shell = ?tools::ShellType::default_for_platform(),
                        "could not read shell/sandbox preferences; using the platform default shell with the sandbox on"
                    );
                    return None;
                }
            };
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
        // Cloned rather than moved: approving a plan mid-turn re-resolves the
        // turn config, which needs the project again.
        project_id: project_id.clone(),
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

    // Unified streaming agent loop: each iteration creates a new assistant message
    loop {
        if cancel.is_cancelled() { break; }

        // Create a new assistant message for this iteration
        assistant_msg_id = engine::begin_assistant(
            &pool, &conversation_id, &turn_id, &model, parent_cursor.as_deref(),
        ).await?;
        parent_cursor = Some(assistant_msg_id.clone());

        app.emit("chat-stream", serde_json::json!({
            "type": "message_start", "message_id": &assistant_msg_id,
            "turn_id": &turn_id, "conversation_id": &conversation_id,
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
                    Ok(stream) => consume_stream(stream, &cancel, Some(&emitter), &assistant_msg_id, &conversation_id).await,
                    Err(e) => Err(e.to_string()),
                };
                match try_result {
                    Ok(r) => {
                        // A reply the model finished producing is the only
                        // proof it received what this request carried, and `Ok`
                        // alone does not say that twice over: the branches
                        // below exist because a provider will answer 200 and
                        // then refuse over SSE, and `Ok` also covers a stream
                        // the user cancelled two hundred milliseconds in. Both
                        // would retire the warning that a tool may be half-run
                        // in favour of a request nothing ever read. Repeating
                        // it costs a paragraph; losing it costs the safety of
                        // whatever the model does next.
                        //
                        // Taken rather than read so it is recorded once, on the
                        // attempt that got through — the block itself is baked
                        // into `chat_messages` and rides along with every later
                        // iteration of the tool loop.
                        if r.ran_to_completion {
                            if let Some(report) = interrupted.take() {
                                crate::agent::interrupted::confirm_delivered(&pool, report).await;
                            }
                        }
                        break r;
                    }
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
                        let recovered = consume_stream(stream, &cancel, Some(&emitter), &assistant_msg_id, &conversation_id)
                            .await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        // Same rule, and reachable without the branch above ever
                        // succeeding: a provider that refuses an oversized
                        // request outright makes this the first stream anyone
                        // reads to the end.
                        if recovered.ran_to_completion {
                            if let Some(report) = interrupted.take() {
                                crate::agent::interrupted::confirm_delivered(&pool, report).await;
                            }
                        }
                        break recovered;
                    }
                    Err(e) if is_retryable_stream_error(&e) && attempt < MAX_STREAM_RETRIES => {
                        tracing::warn!(error = %e, attempt, "request failed, retrying");
                        retry_delay = crate::agent::parse_retry_after(&e);
                        _last_err = e;
                        attempt += 1;
                        continue;
                    }
                    // Logged once by the wrapper, together with every other way
                    // a turn can end early.
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
        engine::complete_assistant(
            &pool,
            &assistant_msg_id,
            &result.text,
            if result.reasoning.is_empty() { None } else { Some(result.reasoning.as_str()) },
            tool_calls_json.as_deref(),
            result.usage.as_ref().and_then(|u| u.prompt_tokens),
            result.usage.as_ref().and_then(|u| u.completion_tokens),
        ).await?;

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

            // Authorised against what was actually offered this turn, not
            // against the assistant's configuration. A tool the mode removed is
            // still sitting in the registry, and a model that names one anyway
            // would otherwise be obeyed — which would make the pruning
            // decorative.
            let tool_allowed = offered.contains(&tc.name);
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
                // Deliberately says "withheld", not "unknown": a model told a
                // writing tool does not exist will reach for one that does —
                // `run_command` can write files just as well — and route around
                // the very restriction the mode exists to impose.
                (
                    format!(
                        "The tool '{}' is not available in this conversation right now. Do not try \
                         to achieve the same effect through another tool.",
                        tc.name
                    ),
                    "error",
                )
            } else if tc.name == "ask_user" {
                match wait_for_approval(&app, &cancel, tc, &turn_id, &assistant_msg_id, &conversation_id, None).await? {
                    Some(ApprovalDecision::Response(text)) => (text, "success"),
                    _ => ("User did not respond.".to_string(), "denied"),
                }
            } else if let Some(target) = crate::agent::modes::by_enter_tool(&tc.name) {
                // The mirror of the exit path, minus the artifact: entering a
                // mode produces nothing to record, it only narrows what the rest
                // of the turn may do.
                match wait_for_approval(&app, &cancel, tc, &turn_id, &assistant_msg_id, &conversation_id, None).await? {
                    Some(ApprovalDecision::Approved) => {
                        let switched = {
                            let pool2 = pool.clone();
                            let conv_id = conversation_id.clone();
                            let target_id = target.id;
                            tokio::task::spawn_blocking(move || {
                                let mut conn = get_conn(&pool2)?;
                                db::ops::conversation::update_mode(&mut conn, &conv_id, Some(target_id), now_ms())
                                    .map_err(|e| e.to_string())
                            }).await.map_err(|e| e.to_string())?
                        };
                        let rebuilt = match switched {
                            Err(e) => Err(e),
                            Ok(()) => {
                                let mcp_defs = app.state::<AppMcp>().0
                                    .tool_definitions().as_ref().clone();
                                let pool2 = pool.clone();
                                let registry = tool_registry.0.clone();
                                let input = crate::agent::turn_config::TurnConfigInput {
                                    assistant: assistant.clone(),
                                    conversation_id: conversation_id.clone(),
                                    project_id: project_id.clone(),
                                    mode: target,
                                    mcp_defs,
                                    include_tools: true,
                                    persona: persona.clone(),
                                    context_blocks: context_blocks.clone(),
                                };
                                tokio::task::spawn_blocking(move || {
                                    let mut conn = get_conn(&pool2)?;
                                    Ok::<_, String>(crate::agent::turn_config::resolve(&mut conn, &registry, input))
                                }).await.map_err(|e| e.to_string())?
                            }
                        };
                        match rebuilt {
                            Ok(next) => {
                                mode = target;
                                tool_defs = next.tool_defs;
                                offered = next.offered;
                                if let Some(first) = chat_messages.first_mut() {
                                    if first.role == "system" {
                                        first.content = next.system_prompt.trim().to_string();
                                    }
                                }
                                let _ = app.emit("conversation-updated", serde_json::json!({
                                    "id": &conversation_id,
                                }));
                                (
                                    "The user agreed. You are in plan mode from here: the tools that \
                                     change anything are gone for the rest of this conversation until \
                                     the plan is approved. Explore and design — do not describe edits \
                                     as though you had made them."
                                        .to_string(),
                                    "success",
                                )
                            }
                            Err(e) => (
                                format!(
                                    "The user agreed, but switching into plan mode failed: {e}. You \
                                     are still in the previous mode — tell the user rather than \
                                     pretending to plan."
                                ),
                                "error",
                            ),
                        }
                    }
                    Some(ApprovalDecision::Denied(Some(reason))) => (
                        format!("The user would rather not plan first: {reason}\n\nCarry on as you were."),
                        "denied",
                    ),
                    _ => (
                        "The user declined to switch to plan mode. Carry on as you were."
                            .to_string(),
                        "denied",
                    ),
                }
            } else if mode.exit_tool == Some(tc.name.as_str()) {
                let plan_text = serde_json::from_str::<serde_json::Value>(&tc.arguments)
                    .ok()
                    .and_then(|v| v.get("plan").and_then(|p| p.as_str()).map(str::to_string))
                    .unwrap_or_default();
                if plan_text.trim().is_empty() {
                    ("exit_plan needs a `plan`: pass the whole plan as markdown.".to_string(), "error")
                } else {
                    // Recorded before the user decides, so a plan they reject is
                    // still on file and the approved one can be re-injected into
                    // later turns without depending on the transcript surviving.
                    //
                    // Sequenced ahead of the approval rather than matched
                    // alongside it: a tuple match would evaluate both, so a
                    // failed write would still put the card in front of the user
                    // and then throw their answer away.
                    let recorded = {
                        let pool2 = pool.clone();
                        let conv_id = conversation_id.clone();
                        let text = plan_text.clone();
                        tokio::task::spawn_blocking(move || {
                            let mut conn = get_conn(&pool2)?;
                            db::ops::plan::record_plan(&mut conn, &conv_id, &text, now_ms())
                                .map_err(|e| e.to_string())
                        }).await.map_err(|e| e.to_string())?
                    };
                    match recorded {
                        Err(e) => (format!("Could not record the plan: {e}"), "error"),
                        Ok(row) => {
                            let decision = wait_for_approval(
                                &app, &cancel, tc, &turn_id, &assistant_msg_id, &conversation_id, None,
                            ).await?;
                            match decision {
                                Some(ApprovalDecision::Approved) => {
                                    let next_mode = mode.exit_to;
                                    let switched = {
                                        let pool2 = pool.clone();
                                        let conv_id = conversation_id.clone();
                                        let plan_id = row.id.clone();
                                        tokio::task::spawn_blocking(move || {
                                            let mut conn = get_conn(&pool2)?;
                                            let now = now_ms();
                                            db::ops::plan::approve(&mut conn, &plan_id, now)
                                                .map_err(|e| e.to_string())?;
                                            db::ops::conversation::update_mode(&mut conn, &conv_id, next_mode, now)
                                                .map_err(|e| e.to_string())
                                        }).await.map_err(|e| e.to_string())?
                                    };
                                    // Re-resolve the turn so the same reply can
                                    // start implementing. Both this and the write
                                    // above have to succeed before the model is
                                    // told the tools are back — otherwise it acts
                                    // on a promise the tool set does not keep and
                                    // burns the turn on "unknown tool" retries.
                                    let rebuilt = match switched {
                                        Err(e) => Err(e),
                                        Ok(()) => {
                                            let mcp_defs = app.state::<AppMcp>().0
                                                .tool_definitions().as_ref().clone();
                                            let pool2 = pool.clone();
                                            let registry = tool_registry.0.clone();
                                            let input = crate::agent::turn_config::TurnConfigInput {
                                                assistant: assistant.clone(),
                                                conversation_id: conversation_id.clone(),
                                                project_id: project_id.clone(),
                                                mode: crate::agent::modes::resolve(next_mode),
                                                mcp_defs,
                                                include_tools: true,
                                                persona: persona.clone(),
                                                context_blocks: context_blocks.clone(),
                                            };
                                            tokio::task::spawn_blocking(move || {
                                                let mut conn = get_conn(&pool2)?;
                                                Ok::<_, String>(crate::agent::turn_config::resolve(&mut conn, &registry, input))
                                            }).await.map_err(|e| e.to_string())?
                                        }
                                    };
                                    match rebuilt {
                                        Ok(next) => {
                                            mode = crate::agent::modes::resolve(next_mode);
                                            tool_defs = next.tool_defs;
                                            offered = next.offered;
                                            if let Some(first) = chat_messages.first_mut() {
                                                if first.role == "system" {
                                                    first.content = next.system_prompt.trim().to_string();
                                                }
                                            }
                                            // The toolbar reads the mode off the
                                            // conversation row, which just changed.
                                            let _ = app.emit("conversation-updated", serde_json::json!({
                                                "id": &conversation_id,
                                            }));
                                            (
                                                "The user approved the plan. You are out of plan mode and the \
                                                 editing tools are available again — start implementing now, in \
                                                 this reply. The approved plan is in your system prompt."
                                                    .to_string(),
                                                "success",
                                            )
                                        }
                                        Err(e) => (
                                            format!(
                                                "The user approved the plan, but switching out of plan mode \
                                                 failed: {e}. You are still in plan mode and the editing tools \
                                                 are still unavailable. Tell the user, and do not try to \
                                                 implement anything this turn."
                                            ),
                                            "error",
                                        ),
                                    }
                                }
                                decision => {
                                    let pool2 = pool.clone();
                                    let plan_id = row.id.clone();
                                    let _ = tokio::task::spawn_blocking(move || {
                                        let mut conn = get_conn(&pool2)?;
                                        db::ops::plan::reject(&mut conn, &plan_id, now_ms())
                                            .map_err(|e| e.to_string())
                                    }).await.map_err(|e| e.to_string())?;
                                    match decision {
                                        Some(ApprovalDecision::Denied(Some(reason))) => (
                                            format!(
                                                "The user sent the plan back: {reason}\n\nYou are still in \
                                                 plan mode. Revise the plan and call exit_plan again."
                                            ),
                                            "denied",
                                        ),
                                        _ => (
                                            "The user did not approve the plan. You are still in plan mode."
                                                .to_string(),
                                            "denied",
                                        ),
                                    }
                                }
                            }
                        }
                    }
                }
            } else if is_mcp {
                // External MCP tools require explicit user approval, same as
                // built-in Ask tools — they must not bypass the authorizer.
                match wait_for_approval(&app, &cancel, tc, &turn_id, &assistant_msg_id, &conversation_id, None).await? {
                    Some(ApprovalDecision::Approved) => {
                        let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                            .unwrap_or_else(|_| serde_json::json!({}));
                        // Awaited with nothing locked: the registry hands back a
                        // handle and the request itself runs outside it.
                        let mcp = app.state::<AppMcp>().0.clone();
                        let called = engine::in_phase(
                            &pool, &turn_id, TurnPhase::RunningTool, Some(&tc.name),
                            mcp.call_tool(&tc.name, args),
                        ).await;
                        match called {
                            Ok(output) => (output, "success"),
                            Err(e) => (format!("MCP error: {e}"), "error"),
                        }
                    }
                    Some(ApprovalDecision::Denied(Some(reason))) =>
                        (format!("Tool call denied by user. Reason: {reason}"), "denied"),
                    _ => ("Tool call denied by user.".to_string(), "denied"),
                }
            } else if let Some(tool) = tool {
                let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let permission = tool.default_permission();
                // The name alone cannot answer this: `read_file` inside the
                // project and `read_file` pointed at ~/.ssh are the same tool.
                // `reach` is advisory — it decides whether to prompt, not what
                // the tool may touch. `tools::verified` enforces that against
                // the handle when the I/O actually happens.
                let reach = tool.reach(&args, &tool_context);
                let (approved, deny_reason): (bool, Option<String>) = if permission
                    == tools::Permission::Never
                {
                    (false, None)
                } else if !tools::reach::needs_approval(permission, reach, accept_edits) {
                    (true, None)
                } else {
                    match wait_for_approval(&app, &cancel, tc, &turn_id, &assistant_msg_id, &conversation_id, None).await? {
                        Some(ApprovalDecision::Approved) => (true, None),
                        Some(ApprovalDecision::Denied(reason)) => (false, reason),
                        _ => (false, None),
                    }
                };
                if approved {
                    // The one phase that describes something outside the
                    // database. A turn found dead here may have written the
                    // file or run the command already.
                    let executed = engine::in_phase(
                        &pool, &turn_id, TurnPhase::RunningTool, Some(&tc.name),
                        tool.execute(args.clone(), &tool_context),
                    ).await;
                    match executed {
                        Ok(output) => (output, "success"),
                        Err(e) => match tools::decode_sandbox_denied(&e) {
                            Some(blocked) => {
                                // Sandbox blocked the command — offer a
                                // user-approved retry without sandbox
                                // (Codex-style escalation). Same call, same id:
                                // it is the approval that is new, and that has
                                // an id of its own.
                                match wait_for_approval(
                                    &app, &cancel, tc, &turn_id,
                                    &assistant_msg_id, &conversation_id,
                                    Some(blocked),
                                ).await? {
                                    Some(ApprovalDecision::Approved) => {
                                        let escalated_ctx = tool_context.without_sandbox();
                                        let retried = engine::in_phase(
                                            &pool, &turn_id, TurnPhase::RunningTool, Some(&tc.name),
                                            tool.execute(args, &escalated_ctx),
                                        ).await;
                                        match retried {
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

            // `None` leaves the cursor where it is: the tool already ran, so the
            // row is worth less than the turn, and the next write hangs off the
            // last message that did land.
            if let Some(id) = engine::append_tool_result(
                &pool, &conversation_id, &turn_id, &tc.id, &result, outcome,
                parent_cursor.as_deref(),
            ).await {
                parent_cursor = Some(id);
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
                            "error": e.to_string(),
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

    // This is the only place that knows how the loop was left, and the three
    // ways out are genuinely different: the loop guard cutting a repeating
    // model short is a turn that did not finish, cancellation is a decision,
    // and neither is a clean ending. Recording the first as `done` would have
    // the row claim a completed turn while its own stop event says it was
    // aborted.
    let (status, error) = if turn_aborted {
        (TurnStatus::Failed, Some(ERROR_LOOP_DETECTED))
    } else if cancel.is_cancelled() {
        (TurnStatus::Cancelled, None)
    } else {
        (TurnStatus::Done, None)
    };
    turn_record::finish(&pool, &turn_id, status, error).await;

    let stop_reason = if turn_aborted { "loop_detected" } else { "end_turn" };
    let mut stop_payload = serde_json::json!({
        "type": "stop", "reason": stop_reason, "done": true,
        "message_id": &assistant_msg_id,
        "turn_id": &turn_id,
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
    // Released ahead of the event it announces, not after it.
    stop_guard.release();
    app.emit("chat-stream", stop_payload).map_err(|e| e.to_string())?;
    stop_guard.disarm();

    // Auto-generate title if first message
    if conv_title.is_none() {
        // Regenerating carries no new message, so the question comes back off the
        // path this turn answered.
        let titled_question = message.clone().or_else(|| {
            ctx.path.iter().rev().find(|m| m.role == "user").map(|m| m.content.clone())
        }).unwrap_or_default();
        let title_messages = vec![ChatMessage::user(&format!(
            "Generate a short title (max 6 words, no quotes, no punctuation) for this conversation:\nUser: {}\nAssistant: {}",
            titled_question,
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
