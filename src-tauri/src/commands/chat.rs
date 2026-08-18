use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::ServicesExt;
use meridian_core::agent::engine;
use meridian_core::agent::turn_record;
use meridian_core::agent::{
    CompactCircuitBreaker, TokenBudget, build_file_access, build_messages_with_senders, do_compact, file_access_prompt,
    instruction_budget, load_project_instructions, microcompact, resolve_file_uris_in_messages,
    resolve_sticker_parts_in_messages, trailing_with_memory, trim_to_context_limit,
};
use meridian_core::db;
use meridian_core::db::DbPool;
use meridian_core::db::models::assistant::Assistant;
use meridian_core::db::models::message::NewMessage;
use meridian_core::db::models::turn::{ERROR_LOOP_DETECTED, TurnPhase, TurnStatus};
use meridian_core::provider;
use meridian_core::provider::{ChatMessage, ChatParams};
use meridian_core::services::Services;
use meridian_core::template;
use meridian_core::tools;
use meridian_core::turn::{TurnLease, TurnOrigin};
use meridian_core::util::{get_conn, now_ms, take_bytes_at_char_boundary};

/// Everything a mid-turn mode switch needs that the loop does not carry.
///
/// Held for the whole turn rather than assembled at the switch, because by then
/// the ingredients are two hundred lines behind: the assistant row and its
/// resolved persona are read before the first request, and threading four more
/// values through the loop to reach one branch is what the port exists to avoid.
struct PlanTransitions {
    services: Services,
    pool: DbPool,
    registry: Arc<tools::ToolRegistry>,
    assistant: Option<Assistant>,
    conversation_id: String,
    project_id: Option<String>,
    persona: String,
    context_blocks: Vec<String>,
    /// Carried rather than re-read. This rebuilds the tool set mid-turn, so a
    /// check made only where the turn was set up would be undone by the first
    /// mode switch.
    supports_tools: bool,
    /// Same reason again. Re-reading it here would let a mode switch hand out —
    /// or take away — the ability to delegate, and change which models it may
    /// reach, in the middle of a turn.
    sub_agents: meridian_core::agent::sub_agents::SubAgentCatalog,
}

#[async_trait::async_trait]
impl meridian_core::agent::engine::Transitions for PlanTransitions {
    async fn rebuild(
        &self,
        mode: &'static meridian_core::agent::modes::ModeSpec,
    ) -> Result<Result<meridian_core::agent::turn_config::TurnConfig, String>, String> {
        // Read here rather than reused from the top of the turn: a server that
        // finished connecting since then belongs in the tool set the user just
        // agreed to.
        let mcp_defs = self.services.mcp.tool_definitions().as_ref().clone();
        let pool = self.pool.clone();
        let registry = self.registry.clone();
        let input = meridian_core::agent::turn_config::TurnConfigInput {
            assistant: self.assistant.clone(),
            conversation_id: self.conversation_id.clone(),
            project_id: self.project_id.clone(),
            // This type exists to answer the question, so the answer is yes.
            mode: meridian_core::agent::modes::Modes::Switchable(mode),
            // The turn's own, carried rather than resolved again.
            sub_agents: Some(self.sub_agents.clone()),
            mcp_defs,
            include_tools: self.supports_tools,
            persona: self.persona.clone(),
            context_blocks: self.context_blocks.clone(),
        };
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            Ok::<_, String>(meridian_core::agent::turn_config::resolve(&mut conn, &registry, input))
        })
        .await
        .map_err(|e| e.to_string())
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
    services: &'a Services,
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
        turn_record::begin(pool, &self.turn_id, self.conversation_id, TurnOrigin::Desktop, None).await
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
        self.services
            .approvals
            .lock()
            .retain(|_, pending| pending.turn_id != self.turn_id);
        // Before the event, not after: a user who sends again the instant the
        // stream ends must not be told the conversation is busy.
        self.lease.take();
        if self.armed {
            let _ = self.services.events.emit(
                "chat-stream",
                serde_json::json!({
                    "type": "stop", "reason": "error", "done": true,
                    "message_id": self.message_id,
                    "turn_id": self.turn_id,
                    "conversation_id": self.conversation_id,
                }),
            );
        }
    }
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
pub async fn stop_chat(app: tauri::AppHandle, conversation_id: String, turn_id: Option<String>) -> Result<(), String> {
    let services = app.services();
    let cancelled = services.turns.cancel(&conversation_id, turn_id.as_deref());
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
    fields(
        conversation_id = %conversation_id,
        model = tracing::field::Empty,
        provider_type = tracing::field::Empty,
        api_format = tracing::field::Empty
    )
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
    let services = app.services();
    let pool = services.db.clone();

    // Nothing is awaited between taking this and handing it to the guard that
    // gives it back, so there is no point at which the task can be dropped
    // holding it.
    let lease = services
        .turns
        .clone()
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
        services,
        conversation_id,
        message,
        lease,
        Arc::clone(&recorded),
        replaces,
        model_override,
        provider_override,
        thinking_level,
        assistant_id,
        fast,
        mode,
        voice,
    )
    .await
    .inspect_err(|e| tracing::error!(error = %e, "turn failed"));

    // A turn that stopped because something went wrong is not a turn that was
    // killed, and the record has to say which. Without this the row would be
    // left at `running` and the next launch would report a bad API key as a
    // crash.
    if let Err(ref e) = result
        && recorded.load(Ordering::Relaxed)
    {
        turn_record::finish(&pool, &turn_id, TurnStatus::Failed, Some(e)).await;
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn chat_inner(
    services: Services,
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
    let secrets = &services.secrets;
    let pool = services.db.clone();
    // Every stream event this turn sends goes through here. The bus is an `Arc`
    // inside, so the clone is a refcount bump.
    let emitter = meridian_core::events::BusEmit(services.events.clone());

    // Names this run of the turn, as opposed to the conversation it belongs to
    // or the assistant row it is currently writing (which changes every
    // iteration).
    let turn_id = lease.turn_id().to_string();
    let cancel = lease.cancel_token().clone();
    // From here on every exit goes through this: the lease, the approvals and
    // the terminal stop event are all released by its `Drop`.
    let mut stop_guard = TurnGuard {
        services: &services,
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
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let effective_aid = aid_override.as_deref().or(conv.assistant_id.as_deref());
            // Pinned before anything derives from it. A delegated run stays
            // writable after it ends, and a follow-up has to go to the model the
            // transcript was written by — one conversation spanning two models
            // with no record of where it changed is not something anyone can
            // read afterwards. An explicit override from the model picker still
            // wins; this is the fallback, not a lock.
            let assistant =
                conv.pin_model(effective_aid.and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok()));
            let history = db::ops::message::list_messages(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let project = conv
                .project_id
                .as_deref()
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
            Ok::<_, String>((
                assistant,
                ctx,
                conv.title,
                project_path,
                project_id,
                conv_prefs,
                branch_parent,
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // Resolve provider config (with optional overrides). Off the async thread:
    // it takes a pooled connection and reads the OS credential store, either of
    // which can block for as long as the pool's acquire timeout.
    let resolved = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        let assistant2 = assistant.clone();
        let model_override = model_override.clone();
        let provider_override = provider_override.clone();
        tokio::task::spawn_blocking(move || {
            meridian_core::agent::resolve_with_overrides(
                &secrets2,
                &pool2,
                assistant2.as_ref(),
                model_override,
                provider_override.as_deref(),
            )
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let model = resolved.model;

    // Filled in now rather than declared at entry: which model a turn actually
    // used is the first thing a provider error needs explaining.
    tracing::Span::current().record("model", model.as_str());
    tracing::Span::current().record("provider_type", resolved.provider_type.as_str());
    tracing::Span::current().record("api_format", resolved.api_format.as_str());

    let provider = provider::registry::create_provider(
        &resolved.provider_type,
        &resolved.base_url,
        &resolved.api_key,
        Some(&resolved.api_format),
    );

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
            db::ops::preference::get_preference(&mut conn, "user_name")
                .ok()
                .flatten()
        })
        .await
        .ok()
        .flatten()
    };
    let mut tmpl_ctx = template::build_context(assistant.as_ref().map(|a| a.name.as_str()), user_name.as_deref());
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
        })
        .await
        .ok()
        .flatten();
        if let Some(names) = emoji_names {
            tmpl_ctx.set("emoji_list", &names);
        }
    }
    let system_prompt_resolved = template::resolve(raw_prompt, &tmpl_ctx);
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let memory_request = meridian_core::agent::MemoryRequest::desktop(
        project_id.clone(),
        meridian_core::agent::memory_budget(context_limit),
    );
    // How the previous turns stopped, for any that did not stop cleanly. Read
    // here rather than at the top because it is background about the
    // conversation, like the memory block, and travels the same way.
    //
    // Held in an Option that is emptied by the first reply this turn reads to
    // the end: reading the record settles nothing, and neither does sending a
    // request, since this turn may die on the way out or be refused over SSE
    // by a provider that already answered 200.
    let interrupted =
        meridian_core::agent::interrupted::load_block(&pool, &services.turns, &conversation_id, &turn_id).await;
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
    let tool_registry = &services.tools;
    // Off the published snapshot. Reading it never waits on a server that is
    // mid-call — which is exactly what used to stop every other conversation
    // from starting a turn.
    let mcp_defs = services.mcp.tool_definitions().as_ref().clone();
    let mode = meridian_core::agent::modes::resolve(mode.as_deref().or(conv_mode.as_deref()));
    // Kept so the turn can be re-resolved in place if the user approves a plan
    // mid-flight; everything else the resolver needs is still in scope.
    let persona = system_prompt_resolved;
    let context_blocks = vec![
        instruction_block.unwrap_or_default(),
        file_access_prompt(&file_access),
        // Mirrored in conversation.rs's estimator via the same function; the
        // OR with this turn's flag only matters before the message lands.
        meridian_core::voice::prompt::voice_context_block(&ctx.path, voice == Some(true)).unwrap_or_default(),
    ];
    // Taken from the resolution rather than recomputed from the override and the
    // assistant. Those two miss the third case: with neither set, the resolver
    // falls back to the first enabled provider and really does send the request
    // there, which the old expression reported as `None`. That turn then priced
    // itself against no `model_configs` row and wrote a reply belonging to no
    // upstream.
    let effective_provider_id = Some(resolved.provider_id.clone());

    // Precedence: per-request override > conversation preference > assistant default.
    // Read once at the top of the turn: a mid-turn flip should not retroactively
    // widen calls the user is already looking at an approval card for.
    let accept_edits = conv_prefs.3;
    let (conv_thinking_level, conv_fast_mode, _, _) = conv_prefs;
    let effective_level = thinking_level.as_deref().or(conv_thinking_level.as_deref());
    // Ahead of the tool set, and ahead of the compaction check: the summariser
    // and the turn it summarises have to send parameters filtered against the
    // same model, and what the model can be sent at all — whether it takes a
    // tools field — decides the tool set below.
    //
    // `context_limit` stays where it was, deliberately. The one bound above is
    // the assistant's and it sizes the memory block and the project
    // instructions; this one is the model's and shadows it for the loop. Moving
    // the shadow up with the resolution would silently resize both.
    let turn_params = {
        let pool2 = pool.clone();
        let assistant2 = assistant.clone();
        let pid = effective_provider_id.clone();
        let pt = resolved.provider_type.clone();
        let af = resolved.api_format.clone();
        let mid = model.clone();
        let level = effective_level.map(|s| s.to_string());
        let fast = fast.unwrap_or(conv_fast_mode);
        tokio::task::spawn_blocking(move || {
            meridian_core::agent::resolve_turn_params(
                &pool2,
                meridian_core::agent::TurnParamsInput {
                    assistant: assistant2.as_ref(),
                    provider_id: pid.as_deref(),
                    provider_type: &pt,
                    api_format: &af,
                    model: &mid,
                    thinking_level: level.as_deref(),
                    fast,
                },
            )
        })
        .await
        .map_err(|e| e.to_string())??
    };
    // A model that cannot take tools is sent none at all — several providers
    // refuse any request carrying a tools field. Decided here rather than by
    // emptying the list afterwards, because `offered` is what authorises a call
    // and it is derived from the same resolution: the two have to go empty
    // together, and only the resolver can do that.
    //
    // A capability copy rather than a borrow: `turn_params.params` is moved
    // later in the turn.
    let supports_tools = turn_params.caps.supports_tools;
    let supports_images = turn_params.caps.supports_images;
    if !supports_tools {
        tracing::info!(model = %model, "the model cannot take tools; none are offered this turn");
    }

    // Read once and carried, not re-read per use. It goes into the tool
    // description as a roster of models, and a mid-turn mode switch that
    // resolved a different one would quietly change what the model may delegate
    // to — halfway through a turn, with nothing on screen to say so.
    let (turn, sub_agent_catalog) = {
        let pool2 = pool.clone();
        let registry = tool_registry.clone();
        let assistant2 = assistant.clone();
        let (conv_id, pid) = (conversation_id.clone(), project_id.clone());
        let (persona2, blocks) = (persona.clone(), context_blocks.clone());
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let catalog = meridian_core::agent::sub_agents::catalog(&mut conn);
            let input = meridian_core::agent::turn_config::TurnConfigInput {
                assistant: assistant2,
                conversation_id: conv_id,
                project_id: pid,
                mode: meridian_core::agent::modes::Modes::Switchable(mode),
                sub_agents: Some(catalog.clone()),
                mcp_defs,
                include_tools: supports_tools,
                persona: persona2,
                context_blocks: blocks,
            };
            Ok::<_, String>((
                meridian_core::agent::turn_config::resolve(&mut conn, &registry, input),
                catalog,
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let tool_defs = turn.tool_defs;
    let offered = turn.offered;
    let system_prompt = turn.system_prompt;
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
    let auto_compact = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    let context_limit = turn_params.context_limit;
    let max_output = turn_params.max_output;
    let model_config = turn_params.model_config;
    let mut budget = TokenBudget::new(
        &resolved.provider_type,
        &model,
        context_limit,
        max_output,
        turn_params.compact_threshold,
    );

    let circuit_breaker = {
        let mut map = services.compact_breakers.lock().await;
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
        // Only to size the window. The real decision is taken after compaction,
        // against the path compaction leaves behind — see below.
        let probe =
            meridian_core::agent::plan_injection_async(&pool, memory_request.clone(), ctx.live().to_vec(), now_ms())
                .await;
        let pre_msgs = build_messages_with_senders(
            system_prompt.trim(),
            &ctx,
            trailing_with_memory(
                probe.as_ref().and_then(|i| i.text.as_deref()),
                interrupted.as_ref().map(|r| r.text()),
                payload_message.as_deref().unwrap_or(""),
                None,
            ),
            &Default::default(),
        );
        budget.update_estimate(&pre_msgs);
        if budget.needs_compact() && ctx.path.len() > keep_recent * 2 + 2 {
            services
                .events
                .emit(
                    "compact-start",
                    serde_json::json!({
                        "conversation_id": &conversation_id,
                        "mid_turn": false,
                        "trigger": "threshold",
                    }),
                )
                .ok();
            // Compaction deletes the old summary before writing the new one and
            // the two are not one transaction, so dying in here is its own kind
            // of half-finished. The bracket also restores `Streaming` however it
            // goes — leaving this phase set would have a crash in the answer
            // that follows reported as a compaction that never finished, and
            // tell the model its history might be half-rewritten when it is not.
            let compaction = engine::in_phase(
                &pool,
                &turn_id,
                TurnPhase::Compacting,
                None,
                do_compact(&pool, secrets, &conversation_id, assistant.as_ref(), keep_recent, None),
            )
            .await;
            match compaction {
                Ok(_anchor) => {
                    compacted = true;
                    circuit_breaker.record_success();
                    services
                        .events
                        .emit(
                            "compact-done",
                            serde_json::json!({
                                "conversation_id": &conversation_id,
                                "mid_turn": false,
                            }),
                        )
                        .ok();
                }
                Err(e) => {
                    tracing::warn!("Auto-compact failed: {e}");
                    circuit_breaker.record_failure();
                    // Surfaced rather than swallowed: a silent failure looks
                    // exactly like compaction never having been attempted, while
                    // the context indicator sits pinned at its limit.
                    services
                        .events
                        .emit(
                            "compact-done",
                            serde_json::json!({
                                "conversation_id": &conversation_id,
                                "mid_turn": false,
                                "error": e,
                            }),
                        )
                        .ok();
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
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let history = db::ops::message::list_messages(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            Ok::<_, String>(db::ops::message::active_context(
                &history,
                conv.head_message_id.as_deref(),
            ))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("compaction finished but its result could not be read back: {e}"))?
    } else {
        ctx
    };

    // After compaction, never before it: compaction moves the summary anchor, and
    // with it what `live()` returns. A plan made against the old path would be
    // reasoning about rows the model can no longer see — and since a cut history
    // is exactly the signal that everything has to be re-sent, getting this
    // ordering wrong is silent rather than loud.
    let t0 = now_ms();
    let injection = meridian_core::agent::plan_injection_async(&pool, memory_request, ctx.live().to_vec(), t0).await;
    let injected = injection.as_ref().and_then(|i| i.text.clone());

    let mut chat_messages = build_messages_with_senders(
        system_prompt.trim(),
        &ctx,
        trailing_with_memory(
            injected.as_deref(),
            interrupted.as_ref().map(|r| r.text()),
            payload_message.as_deref().unwrap_or(""),
            None,
        ),
        &Default::default(),
    );
    resolve_sticker_parts_in_messages(
        &mut chat_messages,
        &pool,
        Some(services.paths.data_dir.as_path()),
        supports_images,
    );
    let files_root = Some(meridian_core::files::files_dir(&services.paths.data_dir));
    resolve_file_uris_in_messages(&mut chat_messages, files_root.as_deref());
    microcompact(&mut chat_messages, &budget, keep_recent);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let params = turn_params.params;

    // Persist user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
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

    // Ahead of the message, because that is where it was sent and where the next
    // turn has to find it.
    if let Some(ref injection) = injection {
        parent_cursor =
            meridian_core::agent::persist_injection(&pool, injection, &conversation_id, &turn_id, parent_cursor, now)
                .await;
    }

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
            db::ops::message::append_message(
                &mut conn,
                &NewMessage {
                    id: &msg_id,
                    conversation_id: &conv_id,
                    role: "user",
                    content: &msg,
                    provider_id: None,
                    model_id: None,
                    input_tokens: None,
                    output_tokens: None,
                    tool_calls: None,
                    tool_call_id: None,
                    sort_order: 0,
                    created_at: now,
                    reasoning_content: None,
                    rating: None,
                    schema_version: 2,
                    is_compact_summary: 0,
                    // Desktop chats have a single implicit speaker.
                    sender_id: None,
                    parent_id: None,
                    compact_anchor_id: None,
                    source: if voice == Some(true) { Some("voice") } else { None },
                    turn_id: Some(&turn),
                    tool_outcome: None,
                    // What the user typed cost no tokens and came from no upstream.
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    provider_name: None,
                },
                parent.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            db::ops::emoji::link_stickers_in_content(&mut conn, &msg_id, &msg).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
        parent_cursor = Some(user_msg_id.clone());
    }

    // Shell preference
    let (shell_type, sandbox_pref, sleep_pref) =
        {
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
    let _sleep_guard = (sleep_pref.as_deref() != Some("false")).then(|| services.sleep.begin_turn());
    let tool_secrets = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        tokio::task::spawn_blocking(move || meridian_core::agent::build_tool_secrets(&secrets2, &pool2))
            .await
            .map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "android"))]
    let sandbox_policy = meridian_core::sandbox::default_policy_if_enabled(sandbox_enabled, project_path.as_deref());
    #[cfg(target_os = "android")]
    let _ = sandbox_enabled;
    let tool_context = tools::ToolContext {
        working_directory: project_path,
        shell: shell_type
            .map(|s| tools::ShellType::from_str(&s))
            .unwrap_or_else(tools::ShellType::default_for_platform),
        file_access,
        // Cloned rather than moved: approving a plan mid-turn re-resolves the
        // turn config, which needs the project again.
        project_id: project_id.clone(),
        conversation_id: Some(conversation_id.clone()),
        turn_id: Some(turn_id.clone()),
        assistant_id: assistant.as_ref().map(|a| a.id.clone()),
        db_pool: Some(pool.clone()),
        #[cfg(not(target_os = "android"))]
        sandbox_policy,
        tool_secrets,
        cancel: cancel.clone(),
    };

    let transitions = PlanTransitions {
        services: services.clone(),
        pool: pool.clone(),
        registry: tool_registry.clone(),
        assistant: assistant.clone(),
        conversation_id: conversation_id.clone(),
        project_id: project_id.clone(),
        persona,
        context_blocks,
        supports_tools,
        sub_agents: sub_agent_catalog,
    };

    // Assembled here rather than per call: by the time a `run_agent` arrives,
    // the assistant row, the project and the tool context are hundreds of lines
    // behind, and a delegated run needs all three.
    let sub_agents = super::sub_agent::DesktopSubAgents {
        services: services.clone(),
        pool: pool.clone(),
        secrets: secrets.clone(),
        registry: tool_registry.clone(),
        coordinator: services.turns.clone(),
        mcp: services.mcp.clone(),
        parent_conversation_id: conversation_id.clone(),
        parent_cancel: cancel.clone(),
        assistant,
        project_id: project_id.clone(),
        tool_context: tool_context.clone(),
        files_root: files_root.clone(),
        accept_edits,
        keep_recent,
    };

    // The loop itself is shared with the OneBot runner now. What stays here is
    // everything the two do not agree on and everything that brackets a turn
    // rather than being part of one: the lease, the turn record, the terminal
    // event, and this conversation's own setup and epilogue.
    let mcp = services.mcp.clone();
    let approvals = super::approval_adapter::DesktopApprovals {
        services: services.clone(),
        cancel: cancel.clone(),
        turn_id: turn_id.clone(),
        conversation_id: conversation_id.clone(),
        // The user started this turn themselves; its cards belong here.
        bubble: None,
    };
    let outcome = engine::run_turn(
        &engine::TurnServices {
            pool: &pool,
            tools: tool_registry,
            mcp: &mcp,
        },
        engine::TurnSetup {
            provider: &*provider,
            // Cloned because the title request below reuses the model, and it
            // runs after the turn rather than inside it.
            params: params.clone(),
            chat_messages,
            tool_defs,
            offered,
            mode,
            tool_context,
            budget,
            turn_id: turn_id.clone(),
            conversation_id: conversation_id.clone(),
            provider_id: Some(resolved.provider_id.clone()),
            provider_name: Some(resolved.provider_name.clone()),
            parent_cursor,
            cancel: cancel.clone(),
            keep_recent,
            context_limit,
            // Where the call would land decides whether to ask, and a standing
            // yes to project edits can answer it. The other runner asks on the
            // declared permission alone -- see the drift list.
            approval_rule: engine::ApprovalRule::ByReach { accept_edits },
            withheld: engine::WithheldWording::Explained,
            // This turn's, though nothing reads it without a steering port. Its
            // absence is what makes it unread, not a missing value.
            files_root,
            interrupted,
            compaction: engine::CompactionPolicy::Desktop {
                enabled: auto_compact,
                breaker: circuit_breaker.clone(),
            },
        },
        engine::TurnPorts {
            emit: Some(&emitter),
            approvals: &approvals,
            // The desktop streams every chunk to the window as it arrives, has
            // no inbox, and runs no tools outside the registry and MCP. Each
            // `None` is the absence of the thing, not a feature turned off.
            interim: None,
            surface_tools: None,
            steering: None,
            transitions: Some(&transitions),
            sub_agents: Some(&sub_agents),
        },
    )
    .await;

    // Before the error is propagated, which is the whole reason `run_turn` hands
    // progress back rather than using `?`: the guard hangs this turn's terminal
    // event off the row it had reached, and a turn that died halfway still owes
    // the window one.
    stop_guard.message_id = outcome.progress.message_id.clone();
    let assistant_msg_id = outcome.progress.message_id.clone().unwrap_or_default();
    let total_input_tokens = outcome.progress.input_tokens;
    let total_output_tokens = outcome.progress.output_tokens;
    let total_cache_read = outcome.progress.cache_read_tokens;
    let total_cache_write = outcome.progress.cache_write_tokens;
    let turn_aborted = outcome.progress.aborted;
    let last_assistant_text = outcome.reply?;

    let cost_info = model_config
        .as_ref()
        .filter(|mc| meridian_core::agent::pricing::has_pricing(mc))
        .map(|mc| {
            let usage = meridian_core::provider::TokenUsage {
                prompt_tokens: Some(total_input_tokens),
                completion_tokens: Some(total_output_tokens),
                total_tokens: Some(total_input_tokens + total_output_tokens),
                // Zero from a turn where nothing was reported reads the same as
                // zero from one where nothing was cached, and for a price that is
                // the right answer either way: both cost the full input rate.
                cache_read_tokens: Some(total_cache_read),
                cache_write_tokens: Some(total_cache_write),
            };
            meridian_core::agent::pricing::compute_cost(&usage, &meridian_core::agent::pricing::Prices::of(mc))
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
    services.events.emit("chat-stream", stop_payload)?;
    stop_guard.disarm();

    // Auto-generate title if first message
    if conv_title.is_none() {
        // Regenerating carries no new message, so the question comes back off the
        // path this turn answered.
        let titled_question = message
            .clone()
            .or_else(|| {
                ctx.path
                    .iter()
                    .rev()
                    .find(|m| m.role == "user")
                    .map(|m| m.content.clone())
            })
            .unwrap_or_default();
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
                })
                .await;
                services
                    .events
                    .emit(
                        "conversation-updated",
                        serde_json::json!({
                            "id": conversation_id,
                        }),
                    )
                    .ok();
            }
        }
    }

    Ok(())
}
