use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::db::models::message::NewMessage;
use crate::db::models::turn::TurnPhase;
use crate::mcp::McpRegistry;
use crate::provider::{self, ChatMessage, ToolCall};
use crate::secrets::SecretsManager;
use crate::tools::{self, ToolRegistry};
use crate::util::{get_conn, now_ms};
use crate::agent::engine::{self};
use crate::agent::{
    build_messages_with_senders, microcompact, resolve_provider_config, trim_to_context_limit,
    TokenBudget,
};

/// `(tool_call, sandbox_block_reason)` → approved. The reason is `Some` only
/// for the retry-without-sandbox escalation ask, so the prompt can say why a
/// second approval for the same call is being requested.
pub type ApprovalFn = Box<dyn Fn(ToolCall, Option<String>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// Called with each tool-calling iteration's assistant text before the tools
/// execute, so headless frontends can deliver mid-turn commentary in order
/// (the final iteration's text is the return value instead).
pub type TextNotifyFn = Box<dyn Fn(String) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// What one round of a headless turn left behind, for the caller to report.
///
/// The engine's, under this side's names. There were two of these — identical
/// field for field, because the engine's was transcribed from this one — and one
/// copy is exactly as much as a value that only travels between the loop and its
/// caller needs.
///
/// The terminal `stop` event is deliberately *not* emitted from inside the loop.
/// A QQ conversation can be open in the desktop UI, where a stop is read as
/// permission to send again — so it has to go out after the conversation has
/// actually been handed back, and only once the turn is really over. Whether it
/// is over is the caller's question: a `TurnEnd::Continue` round is the same
/// turn going round again, and announcing a stop between rounds would invite a
/// desktop message the coordinator would then refuse.
pub type TurnProgress = engine::TurnProgress;

/// A headless round's reply, plus what the caller needs to close it out.
pub type HeadlessOutcome = engine::TurnOutcome;

/// The terminal `chat-stream` event for a turn that has ended.
///
/// Built even when the round never got as far as writing an assistant row — a
/// provider that refuses the very first request produces exactly that. The
/// front end is sitting on the `streaming` flag its optimistic send set, and
/// with no stop to clear it, it sits there until the window is reloaded. So
/// `message_id` may be null; the event still goes out.
pub fn turn_stop_payload(
    conversation_id: &str,
    turn_id: &str,
    message_id: Option<&str>,
    reason: &str,
    input_tokens: i32,
    output_tokens: i32,
) -> serde_json::Value {
    serde_json::json!({
        "type": "stop", "reason": reason, "done": true,
        "message_id": message_id,
        "turn_id": turn_id,
        "conversation_id": conversation_id,
        "input_tokens": input_tokens, "output_tokens": output_tokens,
    })
}

/// A QQ turn answer travels over the chat transport; these events are a
/// courtesy to a desktop window that may not even be open. So a send that
/// fails is not the turn failing -- see the Emit trait for the desktop
/// opposite reading.
struct BestEffortEmit(tauri::AppHandle);

impl crate::agent::engine::Emit for BestEffortEmit {
    fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
        let _ = self.0.emit(channel, payload);
        Ok(())
    }
}

/// Asking in a chat, where the only answer the transport can carry is yes or no.
///
/// The mapping to a decision is per tool and cannot be otherwise. `ask_user`
/// asks a *question*, and the loop reads its answer as the thing to hand back to
/// the model — so a bare `Approved` there would be read as "nobody answered" and
/// the model would be told so. Everything else is a permission, where a yes is
/// `Approved` and nothing else will do: sending a `Response` would turn somebody
/// typing into authorisation to run a command.
///
/// What is lost is the words. A person who replies with a sentence has it
/// flattened to `"User approved."`, and a refusal arrives with no reason at all.
/// That is this transport's shape today rather than a decision made here, and it
/// is on the drift list.
struct ChatApprovals<'a> {
    approval_fn: &'a ApprovalFn,
    pool: DbPool,
    turn_id: String,
}

#[async_trait::async_trait]
impl crate::agent::engine::Approvals for ChatApprovals<'_> {
    async fn ask(
        &self,
        _assistant_message_id: &str,
        call: &ToolCall,
        retry_reason: Option<&str>,
    ) -> Result<Option<crate::agent::engine::ApprovalDecision>, String> {
        use crate::agent::engine::ApprovalDecision;
        // A QQ approval is a message in a chat and can sit there for the full
        // minute, so this is a window the process can easily be killed in — and
        // dying here means nothing ran, which is worth being able to say.
        let yes = engine::in_phase(
            &self.pool,
            &self.turn_id,
            TurnPhase::AwaitingApproval,
            Some(&call.name),
            (self.approval_fn)(call.clone(), retry_reason.map(str::to_string)),
        )
        .await;
        // Never `Err`: this side's answer goes out over the chat transport, so
        // there is no send here that can fail the way drawing a card can.
        Ok(match (yes, call.name.as_str()) {
            (true, "ask_user") => Some(ApprovalDecision::Response("User approved.".to_string())),
            (true, _) => Some(ApprovalDecision::Approved),
            // Timed out, refused, or answered by somebody who was not asked —
            // the transport cannot tell them apart, and none of them is a yes.
            (false, _) => Some(ApprovalDecision::Denied(None)),
        })
    }
}

/// Mid-turn commentary, sent as its own chat message.
///
/// Only the final iteration's text is returned to the caller, so without this
/// everything the model says on the way to a tool call would exist solely in
/// the database. The desktop needs no equivalent: it has already streamed every
/// one of those characters to the window.
struct ChatCommentary<'a>(&'a TextNotifyFn);

#[async_trait::async_trait]
impl crate::agent::engine::Commentary for ChatCommentary<'_> {
    async fn say(&self, text: String) {
        (self.0)(text).await;
    }
}

/// The tools that belong to the chat rather than to the machine.
struct QqSurface<'a>(&'a super::qq_tools::QqToolExecutor);

#[async_trait::async_trait]
impl crate::agent::engine::SurfaceTools for QqSurface<'_> {
    fn owns(&self, name: &str) -> bool {
        self.0.owns(name)
    }
    fn requires_approval(&self, name: &str) -> bool {
        self.0.requires_approval(name)
    }
    async fn execute(&self, name: &str, arguments: &str) -> Result<String, String> {
        self.0.execute(name, arguments).await
    }
}

/// What arrived while the turn was running.
struct InboxSteering<'a>(&'a super::InboxHandle);

impl crate::agent::engine::Steering for InboxSteering<'_> {
    fn drain(&self) -> Vec<crate::agent::engine::Steered> {
        self.0
            .drain()
            .into_iter()
            .map(|item| crate::agent::engine::Steered {
                text: item.text,
                // A notice is something the system generated rather than
                // something a person said, and it travels as context instead of
                // as a user message.
                speaker: item.sender.as_ref().map(|s| s.into()),
            })
            .collect()
    }
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

    // Both resolutions take a pooled connection, and the first also reads the OS
    // credential store, so they run off the async thread.
    //
    // The turn parameters are resolved like any other turn: an extraction
    // request that invents its own temperature is rejected by models the chat
    // path already talks to.
    let (provider_type, base_url, api_key, api_format, turn) = {
        let pool2 = state.pool.clone();
        let secrets2 = state.secrets.clone();
        let assistant2 = assistant.clone();
        tokio::task::spawn_blocking(move || {
            let (provider_type, base_url, api_key, model, api_format) =
                resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())?;
            let effective_model = assistant2
                .as_ref()
                .and_then(|a| a.model_id.clone())
                .unwrap_or(model);
            let turn = crate::agent::resolve_turn_params(&pool2, crate::agent::TurnParamsInput {
                assistant: assistant2.as_ref(),
                provider_id: assistant2.as_ref().and_then(|a| a.provider_id.as_deref()),
                provider_type: &provider_type,
                api_format: &api_format,
                model: &effective_model,
                thinking_level: None,
                fast: false,
            })?;
            Ok::<_, String>((provider_type, base_url, api_key, api_format, turn))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let provider =
        provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

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
///
/// Every event except the terminal `stop` goes out from in here. That one is
/// handed back in `TurnProgress` instead — see it for why.
#[allow(clippy::too_many_arguments)]
pub async fn headless_chat(
    pool: &DbPool,
    secrets: &Arc<SecretsManager>,
    tool_registry: &Arc<ToolRegistry>,
    mcp_registry: &Arc<McpRegistry>,
    conversation_id: &str,
    turn_id: &str,
    project_id: Option<&str>,
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
    // Needed to tell a turn that really is running from one whose row still
    // says so because it was killed. `None` in tests that do not care.
    coordinator: Option<&Arc<crate::turn::TurnCoordinator>>,
) -> HeadlessOutcome {
    // Written into as the round goes, so the `?`-heavy body below can bail out
    // anywhere and still leave the caller enough to close the turn out.
    let mut progress = TurnProgress::default();
    let reply = headless_chat_inner(
        pool, secrets, tool_registry, mcp_registry, conversation_id, turn_id, project_id,
        incoming, assistant_id, model_override, is_admin, approval_fn, interim_text_fn,
        cancel, app, qq_tools, session_inbox, coordinator, &mut progress,
    )
    .await;
    HeadlessOutcome { reply, progress }
}

#[allow(clippy::too_many_arguments)]
async fn headless_chat_inner(
    pool: &DbPool,
    // The `Arc` rather than a plain reference: provider resolution is handed to
    // `spawn_blocking`, which needs an owned handle.
    secrets: &Arc<SecretsManager>,
    tool_registry: &Arc<ToolRegistry>,
    mcp_registry: &Arc<McpRegistry>,
    conversation_id: &str,
    // Which run of the turn this is. A QQ conversation can be opened in the
    // desktop UI, and these events go down the same `chat-stream` channel, so
    // without the id the front end cannot tell this turn's stop from anyone
    // else's — and a QQ session left in the UI would stream forever.
    // Unchanged across `TurnEnd::Continue` rounds: they are one turn.
    turn_id: &str,
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
    coordinator: Option<&Arc<crate::turn::TurnCoordinator>>,
    progress: &mut TurnProgress,
) -> Result<String, String> {
    // Every stream event this round sends goes through here. `None` when no
    // window is attached, which for a QQ turn is the ordinary case.
    let emitter = app.map(|a| BestEffortEmit(a.clone()));
    let emit = emitter.as_ref().map(|e| e as &dyn crate::agent::engine::Emit);

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

    // Resolve provider off the async thread: it takes a pooled connection and
    // reads the OS credential store, either of which can block for as long as
    // the pool's acquire timeout.
    let (provider_type, base_url, api_key, model, api_format) = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        let assistant2 = assistant.clone();
        tokio::task::spawn_blocking(move || {
            resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())
        }).await.map_err(|e| e.to_string())??
    };
    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    // The same resolver the desktop loop uses. Sharing it is what keeps a QQ
    // assistant's tool set honest: this path used to read `enabled_tools` only,
    // so an assistant configured with a tool preset quietly got a different set
    // here than in the app.
    //
    // Collaboration modes stay off: a headless turn has no way to switch them,
    // and a QQ session already cannot touch the filesystem (its file access is
    // an empty root set), so plan mode would guard nothing.
    // Read off the published snapshot rather than through the connection lock,
    // so a server that is mid-call cannot hold up this turn from starting.
    let mcp_defs = if is_admin {
        mcp_registry.tool_definitions().as_ref().clone()
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
        .unwrap_or(&model)
        .to_string();
    // Same resolution as the desktop chat command, so a per-model config the
    // user wrote applies here too. No per-request tier: OneBot turns run off
    // the assistant's stored defaults. Off the async thread because it takes a
    // pooled connection.
    let turn_params = {
        let pool2 = pool.clone();
        let assistant2 = assistant.clone();
        let pt = provider_type.clone();
        let af = api_format.clone();
        let em = effective_model.clone();
        tokio::task::spawn_blocking(move || {
            crate::agent::resolve_turn_params(&pool2, crate::agent::TurnParamsInput {
                assistant: assistant2.as_ref(),
                provider_id: assistant2.as_ref().and_then(|a| a.provider_id.as_deref()),
                provider_type: &pt,
                api_format: &af,
                model: &em,
                thinking_level: None,
                fast: false,
            })
        }).await.map_err(|e| e.to_string())??
    };
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

    let budget = TokenBudget::new(
        &provider_type,
        &effective_model,
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

    // How the previous turns stopped, for any that did not stop cleanly. Same
    // block the desktop gets: a QQ turn is just as capable of dying with a tool
    // half run, and the model is the one that has to decide what to do about it.
    // Emptied by the first reply read to the end, not by reading the record and
    // not by getting a request away.
    let interrupted = match coordinator {
        Some(c) => crate::agent::interrupted::load_block(pool, c, conversation_id, turn_id).await,
        None => None,
    };

    // Background first, then what was just said: these are context for reading
    // the message, not a reply to it.
    let mut trailing: Vec<provider::ChatMessage> = Vec::new();
    for block in [memory_block.as_deref(), interrupted.as_ref().map(|r| r.text())]
        .into_iter()
        .flatten()
    {
        if !block.trim().is_empty() {
            trailing.push(provider::ChatMessage::system_context(block.trim_start()));
        }
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

    let params = turn_params.params;

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
        let turn = turn_id.to_string();
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
                    turn_id: Some(&turn), tool_outcome: None,
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

    // The loop is the desktop's too now. What stays here is what the two do not
    // share: this session's own setup above, and the round's accounting below —
    // the lease, the turn record and the terminal event all belong to the
    // caller, because `TurnEnd::Continue` makes a round and a turn two different
    // things and only the caller knows which one is ending.
    let approvals = ChatApprovals {
        approval_fn,
        pool: pool.clone(),
        turn_id: turn_id.to_string(),
    };
    let commentary = interim_text_fn.map(ChatCommentary);
    let surface = qq_tools.map(QqSurface);
    let steering = session_inbox.map(InboxSteering);

    let outcome = engine::run_turn(
        &engine::TurnServices { pool, tools: tool_registry, mcp: mcp_registry },
        engine::TurnSetup {
            provider: &*provider,
            params,
            chat_messages,
            tool_defs,
            offered,
            // Modes stay off. A headless turn has no way to switch them, and a
            // QQ session already cannot touch the filesystem — its file access
            // is an empty root set — so plan mode would guard nothing.
            mode: crate::agent::modes::resolve(None),
            tool_context,
            budget,
            turn_id: turn_id.to_string(),
            conversation_id: conversation_id.to_string(),
            parent_cursor,
            cancel: cancel.clone(),
            keep_recent,
            context_limit,
            // The declared permission and nothing else: no reach check, and no
            // standing yes to project edits — there is no project. The desktop
            // consults both. On the drift list.
            approval_rule: engine::ApprovalRule::ByPermission,
            withheld: engine::WithheldWording::Terse,
            // Steering resolves image URIs against this, which is why it is here
            // rather than only in the setup above.
            files_root,
            interrupted,
            compaction: engine::CompactionPolicy::OneBot,
        },
        engine::TurnPorts {
            emit,
            approvals: &approvals,
            interim: commentary.as_ref().map(|c| c as &dyn engine::Commentary),
            surface_tools: surface.as_ref().map(|s| s as &dyn engine::SurfaceTools),
            steering: steering.as_ref().map(|s| s as &dyn engine::Steering),
            // No modes, so no way between them. Which is also why `enter_plan`
            // still reaches the registry and answers with a sentence — see the
            // drift list; this batch preserves it rather than deciding it.
            transitions: None,
        },
    )
    .await;

    // Handed over whole, and before the reply is unwrapped: this is what the
    // caller closes the turn out with whatever became of the round, and a round
    // that failed still has to name the row it was writing. Adding up across
    // rounds is the caller's job — one of these is made per round, not per turn.
    *progress = outcome.progress;

    // No stop event here. The caller emits it, after handing the conversation
    // back and only once the turn is genuinely over.
    outcome.reply
}

#[cfg(test)]
mod tests {
    use super::*;

    // The stream-reading tests moved with the reader itself, to
    // `agent::engine::stream`. They were never about OneBot.

    fn outcome(reply: Result<String, String>, aborted: bool) -> HeadlessOutcome {
        HeadlessOutcome {
            reply,
            progress: TurnProgress { aborted, ..Default::default() },
        }
    }

    #[test]
    fn a_round_that_failed_ends_as_an_error() {
        assert_eq!(outcome(Err("no api key".into()), false).stop_reason(), "error");
    }

    #[test]
    fn a_round_the_loop_guard_cut_short_says_so() {
        assert_eq!(outcome(Ok(String::new()), true).stop_reason(), "loop_detected");
        assert_eq!(outcome(Ok("hi".into()), false).stop_reason(), "end_turn");
    }

    /// The path that strands the front end if it is missed: a provider that
    /// refuses the very first request means no assistant row was ever created,
    /// so there is no message to hang the event off — but the composer is
    /// already disabled by the optimistic send, and only a stop re-enables it.
    #[test]
    fn a_turn_that_never_wrote_a_message_still_gets_a_terminal_event() {
        let failed = outcome(Err("no api key".into()), false);
        assert!(failed.progress.message_id.is_none());

        let payload = turn_stop_payload(
            "conv-1", "turn-1", failed.progress.message_id.as_deref(),
            failed.stop_reason(), 0, 0,
        );

        assert_eq!(payload["type"], "stop");
        assert_eq!(payload["done"], true);
        assert_eq!(payload["reason"], "error");
        assert_eq!(payload["turn_id"], "turn-1");
        assert_eq!(payload["conversation_id"], "conv-1");
        // Null, not absent: the front end reads a stop it cannot place as
        // "whatever is running here", which is exactly right for this one.
        assert!(payload["message_id"].is_null());
    }

    /// A QQ conversation open in the desktop has to be able to tell this turn's
    /// end from anyone else's, or it streams for good.
    #[test]
    fn a_terminal_event_names_its_turn_and_its_message() {
        let payload = turn_stop_payload("conv-1", "turn-1", Some("msg-9"), "end_turn", 12, 34);
        assert_eq!(payload["message_id"], "msg-9");
        assert_eq!(payload["turn_id"], "turn-1");
        assert_eq!(payload["input_tokens"], 12);
        assert_eq!(payload["output_tokens"], 34);
    }

    /// Turning a chat's yes or no into a decision, which is the one place this
    /// side has to make a choice the desktop never faces.
    mod approvals {
        use super::*;
        use crate::agent::engine::{ApprovalDecision, Approvals};
        use crate::db::test_db;
        use crate::turn::TurnOrigin;

        fn asked(answer: bool, tool: &str) -> Option<ApprovalDecision> {
            let pool = test_db();
            {
                let mut conn = pool.get().unwrap();
                crate::db::ops::conversation::create_conversation(
                    &mut conn, "c1", Some("t"), None, None, 1,
                )
                .unwrap();
                crate::db::ops::turn::begin(&mut conn, "t1", "c1", TurnOrigin::OneBot, 1000)
                    .unwrap();
            }
            let approval_fn: ApprovalFn =
                Box::new(move |_, _| Box::pin(async move { answer }));
            let adapter = ChatApprovals {
                approval_fn: &approval_fn,
                pool: pool.clone(),
                turn_id: "t1".into(),
            };
            let call = ToolCall {
                id: "call-1".into(),
                name: tool.into(),
                arguments: "{}".into(),
            };
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(adapter.ask("m1", &call, None))
                .unwrap()
        }

        /// The distinction the whole mapping exists for. `ask_user` asked a
        /// question, so a yes is an *answer* and the loop hands it to the model;
        /// an `Approved` there would be read as nobody having replied.
        #[test]
        fn a_yes_to_a_question_is_an_answer() {
            assert!(matches!(
                asked(true, "ask_user"),
                Some(ApprovalDecision::Response(ref s)) if s == "User approved.",
            ));
        }

        /// And a yes to anything else is permission, which is the only thing
        /// that authorises a call. Sending a `Response` here would turn somebody
        /// typing into authorisation to run a command.
        #[test]
        fn a_yes_to_a_tool_is_permission() {
            for tool in ["run_command", "mcp__server__do", "qq_recall"] {
                assert!(
                    matches!(asked(true, tool), Some(ApprovalDecision::Approved)),
                    "{tool}",
                );
            }
        }

        /// Timed out, refused, or answered by somebody who was not asked. The
        /// transport cannot tell them apart and none of them is a yes — and a
        /// refusal with no reason is not the same as nobody answering, which is
        /// why it is `Denied` rather than `None`.
        #[test]
        fn anything_short_of_a_yes_is_a_refusal() {
            for tool in ["ask_user", "run_command"] {
                assert!(
                    matches!(asked(false, tool), Some(ApprovalDecision::Denied(None))),
                    "{tool}",
                );
            }
        }
    }
}
