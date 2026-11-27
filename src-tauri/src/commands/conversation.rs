use std::collections::HashMap;

use crate::ServicesExt;
use crate::commands::entity_response::{ConversationAgentKind, ConversationInfoResponse, ConversationListResponse};
use crate::commands::model_config::RequiredNullable;

use meridian_core::agent::{
    TokenBudget, TurnParamsResolveRequest, build_file_access, build_messages_with_context_items, do_compact,
    file_access_prompt, instruction_budget, load_project_instructions, resolve_provider_config, resolve_turn_params,
};
use meridian_core::db;
use meridian_core::db::entity::assistant;
use meridian_core::db::entity::message_context_item;
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::{Db, WriteTx};
use meridian_core::db::sea::ops::conversation as conversation_ops;
use meridian_core::events::{CompactDoneEvent, CompactOutcome, CompactStartEvent, CompactTrigger};
use meridian_core::provider::ChatMessage;
use meridian_core::util::{double_option, now_ms};

/// Summarise the conversation's history down to a summary row.
///
/// Refused while a turn is running: the turn does its own compaction from a
/// path it read at the top, so the two would delete each other's summaries and
/// anchor the survivor to ids that are no longer on the path. The OneBot side
/// has refused this since it was written; the desktop side never did.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationCompactionRequest {
    pub conversation_id: String,
    pub custom_instructions: RequiredNullable<String>,
}

#[tauri::command]
pub async fn invoke_conversation_compaction(
    app: tauri::AppHandle,
    request: ConversationCompactionRequest,
) -> Result<(), String> {
    let conversation_id = request.conversation_id;
    let custom_instructions = request.custom_instructions.0;
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "compaction")
        .map_err(|busy| busy.to_string())?;
    services.cache_lifecycle.cancel(&conversation_id);
    let secrets = services.secrets.clone();

    let (assistant, keep_recent) = services
        .db
        .read(async |tx| {
            let Some(conv) = conversation_ops::get(tx, &conversation_id).await? else {
                return Ok(Err(format!("conversation {conversation_id} not found")));
            };
            // An assistant that cannot be read is no assistant, as before.
            let assistant = match conv.assistant_id.as_deref() {
                Some(aid) => db::sea::ops::assistant::get(tx, aid).await.ok().flatten(),
                None => None,
            };
            let keep_recent = assistant
                .as_ref()
                .map(|a| a.compact_keep_recent_tokens.max(0) as usize)
                // domain-default: migration m0007 gives the column this default; a row without one is absent configuration, not an unknown limit.
                .unwrap_or(20_000);
            // Summarised by the model that wrote the transcript, and against
            // that model's window.
            Ok::<_, db::sea::DbErr>(Ok((conv.pin_model(assistant), keep_recent)))
        })
        .await
        .map_err(|e| e.to_string())??;

    services.events.emit_compact_start(&CompactStartEvent {
        conversation_id: conversation_id.clone(),
        mid_turn: false,
        trigger: CompactTrigger::Manual,
    })?;

    let result = Box::pin(do_compact(
        &services.db,
        &secrets,
        &conversation_id,
        assistant.as_ref(),
        keep_recent,
        custom_instructions.as_deref(),
    ))
    .await;

    if let Err(ref e) = result {
        // The automatic path logs its failures; this one used to hand the error
        // straight to the frontend and leave nothing behind.
        tracing::error!(
            conversation_id = %conversation_id,
            keep_recent,
            error = %e,
            "manual compaction failed"
        );
    }

    let (outcome, error) = match &result {
        Ok(_) => (CompactOutcome::Completed, None),
        Err(error) => (CompactOutcome::Failed, Some(error.clone())),
    };
    services.events.emit_compact_done(&CompactDoneEvent {
        conversation_id: conversation_id.clone(),
        mid_turn: false,
        trigger: CompactTrigger::Manual,
        outcome,
        tokens_reclaimed: None,
        error,
    })?;

    result?;
    Ok(())
}

// `get_conversation` was here, and `load_message_tree` and
// `list_pending_approvals` in their own files. All three answered one third of
// the same question, and the caller had to ask all three and hope nothing moved
// in between. `conversation_snapshot` answers it once.

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationListRequest {
    pub archived: bool,
    pub project_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn list_conversations(
    app: tauri::AppHandle,
    request: ConversationListRequest,
) -> Result<ConversationListResponse, String> {
    let rows = match request.project_id.0.as_deref() {
        Some(project_id) => conversation_ops::list_by_project(&app.services().db, project_id, request.archived).await,
        None => conversation_ops::list(&app.services().db, request.archived).await,
    }
    .map_err(|e| e.to_string())?;
    rows.into_iter().map(TryInto::try_into).collect()
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationCreateRequest {
    title: RequiredNullable<String>,
    project_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn create_conversation(
    app: tauri::AppHandle,
    request: ConversationCreateRequest,
) -> Result<ConversationInfoResponse, String> {
    let id = uuid::Uuid::new_v4().to_string();
    // The default assistant read under the same lock the row is written under.
    let row = app
        .services()
        .db
        .write(async |tx| {
            let default_assistant = db::sea::ops::assistant::get_default(tx).await?;
            conversation_ops::create(
                tx,
                &id,
                request.title.0.as_deref(),
                default_assistant.as_ref().map(|a| a.id.as_str()),
                request.project_id.0.as_deref(),
                now_ms(),
            )
            .await
        })
        .await
        .map_err(|e| e.to_string())?;
    row.try_into()
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationUpdateRequest {
    pub id: String,
    pub title: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub mode: Option<Option<meridian_core::agent::modes::ChatMode>>,
    #[serde(default, deserialize_with = "double_option")]
    pub assistant_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub thinking_level: Option<Option<meridian_core::provider::capabilities::StoredThinkingLevel>>,
    pub fast_mode: Option<bool>,
    pub accept_edits: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
}

impl ConversationUpdateRequest {
    fn needs_turn_guard(&self) -> bool {
        self.assistant_id.is_some()
            || self.thinking_level.is_some()
            || self.fast_mode.is_some()
            || self.accept_edits.is_some()
            || self.project_id.is_some()
    }
}

/// Applies every requested conversation field in one write transaction.
async fn update_conversation_fields(
    tx: &WriteTx,
    patch: &ConversationUpdateRequest,
    now: i64,
) -> Result<db::entity::conversation::Model, DbErr> {
    let id = &patch.id;
    let current = conversation_ops::get(tx, id)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("conversation `{id}`")))?;
    if let Some(ref title) = patch.title {
        conversation_ops::update_title(tx, id, title, now).await?;
    }
    if let Some(ref mode) = patch.mode {
        let canonical = mode.and_then(meridian_core::agent::modes::ChatMode::canonical_storage);
        conversation_ops::update_mode(tx, id, canonical, now).await?;
    }
    if let Some(is_pinned) = patch.is_pinned {
        conversation_ops::set_pinned(tx, id, is_pinned, now).await?;
    }
    if let Some(is_archived) = patch.is_archived {
        conversation_ops::set_archived(tx, id, is_archived, now).await?;
    }
    if let Some(ref assistant_id) = patch.assistant_id {
        conversation_ops::update_assistant(tx, id, assistant_id.clone(), now).await?;
    }
    if patch.thinking_level.is_some() || patch.fast_mode.is_some() {
        let thinking_level = match &patch.thinking_level {
            Some(level) => level.map(|l| l.as_str().to_string()),
            None => current.thinking_level.clone(),
        };
        let fast_mode = patch.fast_mode.unwrap_or_else(|| current.fast_mode.get());
        conversation_ops::update_reasoning_prefs(tx, id, thinking_level, fast_mode, now).await?;
    }
    if let Some(accept_edits) = patch.accept_edits {
        conversation_ops::update_accept_edits(tx, id, accept_edits, now).await?;
    }
    if let Some(ref project_id) = patch.project_id {
        conversation_ops::update_project(tx, id, project_id.clone(), now).await?;
    }
    conversation_ops::get(tx, id)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("conversation `{id}`")))
}

/// The caller holds the conversation's turn lease whenever `patch.needs_turn_guard()`.
async fn apply_conversation_update(
    db: &Db,
    patch: &ConversationUpdateRequest,
) -> Result<db::entity::conversation::Model, String> {
    db.write(async |tx| update_conversation_fields(tx, patch, now_ms()).await)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_conversation(
    app: tauri::AppHandle,
    request: ConversationUpdateRequest,
) -> Result<ConversationInfoResponse, String> {
    let services = app.services();
    let _lease = if request.needs_turn_guard() {
        Some(
            services
                .turns
                .clone()
                .try_acquire_mutation(&request.id, "a conversation update")
                .map_err(|busy| busy.to_string())?,
        )
    } else {
        None
    };
    let row = apply_conversation_update(&services.db, &request).await?;
    row.try_into()
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationSearchRequest {
    query: String,
    limit: RequiredNullable<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptRole {
    User,
    Assistant,
}

impl TranscriptRole {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            _ => Err(format!("unknown transcript role `{value}`")),
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct ConversationSearchHitInfoResponse {
    pub conversation_id: String,
    pub title: Option<String>,
    pub role: TranscriptRole,
    pub snippet: String,
    pub created_at: i64,
}

impl TryFrom<conversation_ops::TranscriptHit> for ConversationSearchHitInfoResponse {
    type Error = String;

    fn try_from(hit: conversation_ops::TranscriptHit) -> Result<Self, Self::Error> {
        Ok(Self {
            conversation_id: hit.conversation_id,
            title: hit.title,
            role: TranscriptRole::parse(&hit.role)?,
            snippet: hit.snippet,
            created_at: hit.created_at,
        })
    }
}

pub type ConversationSearchHitListResponse = Vec<ConversationSearchHitInfoResponse>;

/// Conversations whose transcript says the query, newest mention first.
#[tauri::command]
pub async fn search_conversations(
    app: tauri::AppHandle,
    request: ConversationSearchRequest,
) -> Result<ConversationSearchHitListResponse, String> {
    // domain-default: a page size the caller did not ask about, not a fact about a model
    let limit = request.limit.0.unwrap_or(20).min(100) as usize;
    let hits = app
        .services()
        .db
        .read(async |tx| conversation_ops::search_transcripts(tx, &request.query, limit).await)
        .await
        .map_err(|e| e.to_string())?;
    hits.into_iter().map(TryInto::try_into).collect()
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationDeleteRequest {
    pub id: String,
}

/// Delete a conversation and everything in it.
///
/// Refused while a turn is running. The front end sends a stop first, but a
/// stop is only a signal — the turn goes on appending messages, moving the head
/// and writing todos and plans for as long as it takes to notice, all of it
/// against a conversation that is no longer there. Waiting for the turn to
/// actually exit needs a turn that can be waited on, which is phase 1's job;
/// until then this refuses rather than races.
#[tauri::command]
pub async fn delete_conversation(app: tauri::AppHandle, request: ConversationDeleteRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    // A board card's conversation goes with its card, from the board: deleted
    // on its own it would leave a card pointing at nothing, and the card is
    // what says the worktree is gone.
    #[cfg(not(target_os = "android"))]
    if let Some(card) = meridian_core::db::sea::ops::board_task::for_conversation(&services.db, &id)
        .await
        .map_err(|e| e.to_string())?
    {
        return Err(format!(
            "this conversation works board card \"{}\"; delete the card on the board instead",
            card.title
        ));
    }
    Box::pin(delete_conversation_tree(&services, &id)).await
}

/// Delete a conversation with its delegated runs, their processes and their
/// files. `delete_conversation` after its board check; the board's own delete
/// calls it for a card's conversation.
pub(crate) async fn delete_conversation_tree(
    services: &meridian_core::services::Services,
    id: &str,
) -> Result<(), String> {
    let id = id.to_owned();
    services.cache_lifecycle.cancel(&id);
    let coordinator = services.turns.clone();
    let sea = services.db.clone();

    // This one first, and on its own. A delegated run is started from inside a
    // turn on this conversation, and a turn cannot exist while a mutation holds
    // it — so from here the set of children is fixed, and reading it next cannot
    // miss one that appears in between.
    let _parent = coordinator
        .try_acquire_mutations(std::slice::from_ref(&id), "a delete")
        .map_err(|busy| busy.to_string())?;

    let doomed = sea
        .read(async |tx| conversation_ops::descendants(tx, &id).await)
        .await
        .map_err(|e| e.to_string())?;
    // All of them or none. Any one can have a sub-agent running on it, and
    // taking them one at a time would mean holding part of a tree while being
    // refused the rest.
    let _children = coordinator
        .try_acquire_mutations(&doomed, "a delete")
        .map_err(|busy| busy.to_string())?;

    #[allow(unused_mut)]
    let mut attachment_dirs: Vec<std::path::PathBuf> = std::iter::once(&id)
        .chain(doomed.iter())
        .map(|c| meridian_core::files::conversation_files_dir(&services.paths.data_dir, c))
        .collect();
    #[cfg(not(target_os = "android"))]
    attachment_dirs.extend(
        std::iter::once(&id)
            .chain(doomed.iter())
            .map(|c| meridian_core::background::log_dir(&services.paths.data_dir, c)),
    );

    // Before the rows go, and after the leases above make the set final. A
    // hosted session is a child process keyed by conversation id: delete the
    // conversation without this and the adapter keeps running, serving a
    // transcript that no longer exists, unreachable because the id nobody can
    // look up any more is the only handle on it.
    #[cfg(not(target_os = "android"))]
    {
        let mut all = doomed.clone();
        all.push(id.clone());
        services.acp.close_each(&all).await;
        // The command container is keyed by conversation id the same way, and
        // deleting the row is the last moment anything can still name it —
        // after this, the only thing that ever finds it again is the startup
        // reconcile noticing its conversation is gone.
        for c in &all {
            services.containers.close(c).await;
        }
        // Background commands too: a task keeps running into a project whose
        // conversation — the only place anybody could see or stop it — is
        // about to be gone. Its log directory goes with the rest below.
        for c in &all {
            services.background_tasks.stop_conversation(c);
        }
    }

    sea.write(async |tx| conversation_ops::delete(tx, &id).await)
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        // Best-effort, and every run's directory as well as the parent's: the
        // rows are the source of truth, so a failed cleanup must not fail the
        // delete — but a directory nobody deletes is one nothing will ever come
        // back for either.
        for dir in attachment_dirs {
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ContextInfoResponse {
    pub estimated_tokens: usize,
    pub context_limit: usize,
    pub compact_threshold: usize,
    pub auto_compact_enabled: bool,
    pub circuit_breaker_state: meridian_core::agent::CompactCircuitBreakerState,
    pub message_count: usize,
    /// Whose window this is. A number on its own cannot say, and a delegated run
    /// routinely has a different one from the conversation that started it.
    pub model: String,
    /// `explore` | `agent` when this conversation is a delegated run, `None`
    /// when it is somebody's own. Read off the row rather than inferred from the
    /// sidebar, which cannot see these at all.
    pub agent_kind: Option<ConversationAgentKind>,
}

/// Test scaffolding only. Production assembly lives in
/// `agent::turn_config::resolve`, which every loop now shares; keeping a second
/// implementation reachable from production is exactly how the three callers
/// drifted apart in the first place.
///
/// The memory block is not part of this — it is sent as a user-role message —
/// but it still has to be counted, so callers add it to the total separately.
#[cfg(test)]
fn compose_system_prompt(base_block: Option<&str>, persona: &str, instructions: &str, file_access: &str) -> String {
    let base = base_block.map(|b| format!("{b}\n\n")).unwrap_or_default();
    format!("{base}{persona}{instructions}{file_access}")
}

/// The persona and the checklist block — the parts of a request that come
/// straight out of the database. Split out from `assemble_system_prompt`
/// so it can be exercised without an app handle. `live` is what a turn starting
/// now would actually carry, which is what makes the checklist figure honest:
/// with it frozen into the history, most turns inject nothing at all, and
/// counting a full block every time would report a cost no turn pays. Reads
/// only — an estimate is not a turn, so it must not write a row or move a
/// cursor.
///
/// The persona is the assistant's prompt exactly as written: there are no
/// template variables to resolve.
async fn load_persona_and_todo(
    db: &meridian_core::db::sea::cap::Db,
    conversation_id: &str,
    assistant: Option<&assistant::Model>,
    live: &[db::entity::message::Model],
) -> Result<(String, String), String> {
    let persona = assistant.map(|a| a.system_prompt.clone()).unwrap_or_default();
    let todo = meridian_core::agent::plan_todo_injection(db, conversation_id, live)
        .await?
        .map(|t| t.text)
        .unwrap_or_default();
    Ok((persona, todo))
}

/// The memory block a turn starting now would send, through the same planner
/// the chat loop runs and against the same `live` path, so it is as honest as
/// the checklist figure beside it. Reads only, like the rest of the estimate.
async fn load_memory_estimate(
    db: &meridian_core::db::sea::cap::Db,
    project_id: Option<&str>,
    live: &[db::entity::message::Model],
) -> Result<String, String> {
    let req = meridian_core::agent::MemoryRequest::desktop(
        project_id.map(|s| s.to_string()),
        // Counting uses the largest bracket: an under-reported figure is worse
        // than a slightly generous one.
        meridian_core::agent::memory_budget(usize::MAX),
    );
    Ok(
        meridian_core::agent::plan_injection_async(db, req, live.to_vec(), meridian_core::util::now_ms())
            .await?
            .and_then(|injection| injection.text)
            .unwrap_or_default(),
    )
}

/// Rebuild the system prompt the way `commands::chat::chat` does, so the token
/// figure the UI reports covers what a turn actually sends. Counting the
/// history alone understated it by the whole baseline + persona + project
/// instructions + memory, which on a project session is the larger share.
///
/// Deliberately still outside the count (the chat loop's own budget does not
/// count them either): the JSON tool schemas sent alongside the messages, and
/// anything the loop injects mid-turn — skill bodies pulled in by `load_skill`,
/// and tool results that are not persisted yet.
/// Returns `(system_prompt, memory_block)`. They are counted together but sent
/// separately: the memory block travels as a user-role message.
#[expect(
    clippy::too_many_arguments,
    reason = "mirrors the chat command's own inputs one for one; bundling them would be a struct with a single caller"
)]
async fn assemble_system_prompt(
    app: &tauri::AppHandle,
    conversation_id: &str,
    mode: Option<&str>,
    assistant: Option<&assistant::Model>,
    project_path: Option<&str>,
    project_id: Option<&str>,
    context_limit: usize,
    active_path: &[db::entity::message::Model],
    // `server_tools` is the turn's own, resolved by the caller. Counting the
    // local `web_search` that a provider-side one displaces would make the
    // estimate disagree with the prompt actually sent — the drift this function
    // exists to avoid, not to introduce.
    server_tools: Vec<meridian_core::provider::ServerToolKind>,
) -> Result<(String, String, String), String> {
    // Off the published snapshot, so the context estimator cannot be blocked by
    // a server that is busy answering something else.
    let mcp_defs = app.services().mcp.tool_definitions().as_ref().clone();
    let registry = app.services().tools.clone();
    let instruction_block = {
        let budget = instruction_budget(context_limit);
        if budget > 0 {
            load_project_instructions(project_path, budget).await
        } else {
            None
        }
    };
    let file_access = build_file_access(&app.services().db).await?;

    // The very same resolver the chat loop runs. Counting anything else here is
    // how the estimate ended up short of what actually gets sent — the checklist
    // block used to be missing from this side entirely.
    let sea = &app.services().db;
    let mode = meridian_core::agent::modes::resolve(mode)?;
    let context_blocks = vec![
        instruction_block.unwrap_or_default(),
        file_access_prompt(&file_access),
        // Same function the chat loop calls, so the estimate covers the block.
        meridian_core::voice::prompt::voice_context_block(active_path, false).unwrap_or_default(),
    ];
    let memory_block = load_memory_estimate(sea, project_id, active_path).await?;
    let (persona, todo_block) = load_persona_and_todo(sea, conversation_id, assistant, active_path).await?;
    let turn = sea
        .read(async |tx| {
            let sub_agents = match meridian_core::agent::sub_agents::catalog(tx).await {
                Ok(catalog) => catalog,
                Err(error) => return Ok::<_, db::sea::DbErr>(Err(error)),
            };
            // The shell line the chat loop puts in the base prompt, decided from
            // the settings alone — `CommandSettings::command_shell` says why that
            // is the same answer the loop's resolved policy gives. Not on
            // Android, where there is no `run_command` for the line to describe.
            #[cfg(not(target_os = "android"))]
            let command_shell = match meridian_core::sandbox::CommandSettings::read_in(tx).await {
                Ok(settings) => settings.command_shell(),
                Err(error) => return Ok(Err(error)),
            };
            #[cfg(target_os = "android")]
            let command_shell = None;
            Ok(meridian_core::agent::turn_config::resolve(
                tx,
                &registry,
                meridian_core::agent::turn_config::TurnConfigResolveRequest {
                    assistant: assistant.cloned(),
                    conversation_id: conversation_id.to_string(),
                    // The estimate has to count the prompt the chat loop will
                    // send, and a provider-side tool takes the local one out of it.
                    server_tools,
                    project_id: project_id.map(str::to_string),
                    // The estimate has to count the prompt the chat loop will
                    // actually send, transitions included.
                    mode: meridian_core::agent::modes::Modes::Switchable(mode),
                    // And for the same reason it has to answer this the way the
                    // chat loop does. `run_agent` carries a roster of models in
                    // its description, which is not a small number of tokens to
                    // be wrong about.
                    sub_agents: Some(sub_agents),
                    mcp_defs,
                    exposure: meridian_core::agent::turn_config::ToolExposure::All,
                    persona,
                    context_blocks,
                    session_tools: None,
                    command_shell,
                    forbidden_effects: &[],
                },
            )
            .await)
        })
        .await
        .map_err(|error| error.to_string())??;
    Ok((turn.system_prompt, memory_block, todo_block))
}

/// Build the exact message list whose tokens `get_context_info` reports. Kept
/// separate so a regression test can pin the frozen context that ordinary chat
/// replays after each stored user row.
fn context_info_messages(
    system_prompt: &str,
    context: &db::sea::ops::message::ActiveContext,
    trailing: Vec<ChatMessage>,
    context_items: &HashMap<String, Vec<message_context_item::Model>>,
) -> Result<Vec<ChatMessage>, String> {
    build_messages_with_context_items(system_prompt, context, trailing, &Default::default(), context_items)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationContextReadRequest {
    pub conversation_id: String,
}

#[tauri::command]
pub async fn get_conversation_context(
    app: tauri::AppHandle,
    request: ConversationContextReadRequest,
) -> Result<ContextInfoResponse, String> {
    let conversation_id = request.conversation_id;
    let services = app.services();

    let (assistant, ctx, context_items, project_path, project_id, conv_mode, agent_kind) = services
        .db
        .read(async |tx| {
            let Some(conv) = conversation_ops::get(tx, &conversation_id).await? else {
                return Ok(Err(format!("conversation {conversation_id} not found")));
            };
            // An assistant or project that cannot be read is none, as before.
            let assistant = match conv.assistant_id.as_deref() {
                Some(aid) => db::sea::ops::assistant::get(tx, aid).await.ok().flatten(),
                None => None,
            };
            let history = db::sea::ops::message::list(tx, &conversation_id).await?;
            let project = match conv.project_id.as_deref() {
                Some(pid) => db::sea::ops::project::get(tx, pid).await.ok().flatten(),
                None => None,
            };
            let project_path = project.as_ref().and_then(|p| p.path.clone());
            let project_id = project.as_ref().map(|p| p.id.clone());
            let ctx = db::sea::ops::message::active_context(&history, conv.head_message_id.as_deref());
            let path_ids = ctx.path.iter().map(|message| message.id.clone()).collect::<Vec<_>>();
            let context_items = db::sea::ops::message_context_item::list_for_messages(tx, &path_ids).await?;
            // The indicator has to describe the window a request from *this*
            // conversation would go into, which for a delegated run is its own
            // model's rather than the parent assistant's.
            Ok::<_, db::sea::DbErr>(Ok((
                conv.pin_model(assistant),
                ctx,
                context_items,
                project_path,
                project_id,
                conv.mode.clone(),
                conv.agent_kind.clone(),
            )))
        })
        .await
        .map_err(|e| e.to_string())??;

    let auto_compact_enabled = assistant
        .as_ref()
        .map(|a| a.auto_compact_enabled.get())
        .unwrap_or(false);

    // Resolved exactly as the chat path does, so the threshold the UI reports is
    // the one the compaction check actually compares against.
    let (provider_type, model, turn) = {
        let meridian_core::agent::ResolvedProvider {
            provider_type,
            model,
            api_format,
            transport_profile,
            codex_request_shape,
            ..
        } = resolve_provider_config(&services.secrets, &services.db, assistant.as_ref()).await?;
        let turn = resolve_turn_params(
            &services.db,
            TurnParamsResolveRequest {
                assistant: assistant.as_ref(),
                provider_id: assistant.as_ref().and_then(|a| a.provider_id.as_deref()),
                provider_type: &provider_type,
                api_format: &api_format,

                transport_profile: &transport_profile,
                codex_request_shape,
                codex_request_kind: meridian_core::provider::codex_metadata::CodexRequestKind::Background,
                codex_thread_source: meridian_core::provider::codex_metadata::CodexThreadSource::User,
                model: &model,
                thinking_level: None,
                fast: false,
            },
        )
        .await?;
        (provider_type, model, turn)
    };
    let context_limit = turn.context_limit;
    let budget = TokenBudget::new(
        &provider_type,
        &model,
        context_limit,
        turn.max_output,
        turn.compact_threshold,
    );

    let (system_prompt, memory_block, todo_block) = assemble_system_prompt(
        &app,
        &conversation_id,
        conv_mode.as_deref(),
        assistant.as_ref(),
        project_path.as_deref(),
        project_id.as_deref(),
        context_limit,
        &ctx.path,
        turn.params.server_tools.clone(),
    )
    .await?;

    // What the next turn would carry, if it started now: no turn is running, so
    // nothing is excluded, and an interrupted turn before this one would be
    // reported to it. Reading costs nothing — only a request that reaches a
    // provider marks anything as told, and an estimate sends none.
    let interrupted_block =
        meridian_core::agent::interrupted::load_block(&services.db, &services.turns, &conversation_id, "").await?;

    // Mirrors the chat path exactly, background blocks included, so the figure
    // the UI shows covers what a turn actually sends.
    let msgs = context_info_messages(
        system_prompt.trim(),
        &ctx,
        meridian_core::agent::trailing_with_memory(
            Some(&memory_block),
            Some(&todo_block),
            interrupted_block.as_ref().map(|r| r.text()),
            // No message: an estimate is what the next turn would carry before
            // anything is typed.
            None,
            // A desktop conversation has one implicit speaker, so there is no
            // roster to draw and nothing to count for it.
            None,
        ),
        &context_items,
    )?;
    // What the next turn would carry: the tail past the summary, plus the
    // summary itself when one applies.
    // Injected background is not a message anybody sent, and this figure sits
    // next to the conversation in the UI.
    let message_count = ctx.live().iter().filter(|m| m.role != "context").count() + usize::from(ctx.summary.is_some());
    let estimated_tokens = budget.counter.count_messages(&msgs);

    let cb_state = {
        let map = services.compact_breakers.lock().await;
        match map.get(&conversation_id) {
            Some(cb) => cb.state()?,
            None => meridian_core::agent::CompactCircuitBreakerState::Closed,
        }
    };

    Ok(ContextInfoResponse {
        estimated_tokens,
        context_limit,
        compact_threshold: budget.compact_threshold,
        auto_compact_enabled,
        circuit_breaker_state: cb_state,
        message_count,
        model,
        agent_kind: agent_kind.as_deref().map(ConversationAgentKind::parse).transpose()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::agent::{base_prompt, build_messages};
    use meridian_core::db::entity::project::{self as project_entity, ProjectSource};

    #[tokio::test]
    async fn conversation_settings_update_cleanly() {
        let sea = db::sea::sea_test_db().await;
        sea.write(async |tx| {
            for (id, path) in [("project-a", "A"), ("project-b", "B")] {
                db::sea::ops::project::create(
                    tx,
                    project_entity::Model {
                        id: id.into(),
                        name: id.into(),
                        path: Some(path.into()),
                        source_type: ProjectSource::Local,
                        source_id: None,
                        assistant_id: None,
                        description: None,
                        created_at: 1,
                        updated_at: 1,
                    },
                )
                .await?;
            }
            conversation_ops::create(tx, "conversation-1", None, None, Some("project-a"), 1).await?;
            Ok::<_, db::sea::DbErr>(())
        })
        .await
        .unwrap();
        let patches = [
            ConversationUpdateRequest {
                id: "conversation-1".into(),
                assistant_id: Some(None),
                ..Default::default()
            },
            ConversationUpdateRequest {
                id: "conversation-1".into(),
                thinking_level: Some(Some(meridian_core::provider::capabilities::StoredThinkingLevel::High)),
                fast_mode: Some(true),
                ..Default::default()
            },
            ConversationUpdateRequest {
                id: "conversation-1".into(),
                accept_edits: Some(true),
                ..Default::default()
            },
            ConversationUpdateRequest {
                id: "conversation-1".into(),
                project_id: Some(Some("project-b".into())),
                ..Default::default()
            },
        ];
        for patch in patches {
            apply_conversation_update(&sea, &patch).await.unwrap();
        }
        let updated = conversation_ops::get(&sea, "conversation-1").await.unwrap().unwrap();
        assert_eq!(
            (
                updated.project_id.as_deref(),
                updated.accept_edits.get(),
                updated.thinking_level.as_deref()
            ),
            (Some("project-b"), true, Some("high"))
        );
    }

    #[test]
    fn conversation_requests_reject_unknown_fields() {
        let create = serde_json::json!({
            "title": null,
            "project_id": null,
            "future_field": true,
        });
        assert!(serde_json::from_value::<ConversationCreateRequest>(create).is_err());

        let update = serde_json::json!({
            "id": "conversation-1",
            "title": "renamed",
            "legacy_title": "old",
        });
        assert!(serde_json::from_value::<ConversationUpdateRequest>(update).is_err());

        let search = serde_json::json!({
            "query": "needle",
            "limit": 20,
            "cursor": "unsupported",
        });
        assert!(serde_json::from_value::<ConversationSearchRequest>(search).is_err());
    }

    #[test]
    fn context_response_serializes_null_agent_kind() {
        let payload = serde_json::to_value(ContextInfoResponse {
            estimated_tokens: 1,
            context_limit: 2,
            compact_threshold: 1,
            auto_compact_enabled: false,
            circuit_breaker_state: meridian_core::agent::CompactCircuitBreakerState::Closed,
            message_count: 0,
            model: "model".into(),
            agent_kind: None,
        })
        .unwrap();

        assert_eq!(payload["agent_kind"], serde_json::Value::Null);
    }

    #[test]
    fn conversation_actions_require_explicit_nullable_fields() {
        let mut create = serde_json::json!({ "title": null, "project_id": null });
        assert!(serde_json::from_value::<ConversationCreateRequest>(create.clone()).is_ok());
        create.as_object_mut().unwrap().remove("project_id");
        assert!(serde_json::from_value::<ConversationCreateRequest>(create).is_err());

        let mut list = serde_json::json!({ "archived": false, "project_id": null });
        assert!(serde_json::from_value::<ConversationListRequest>(list.clone()).is_ok());
        list.as_object_mut().unwrap().remove("project_id");
        assert!(serde_json::from_value::<ConversationListRequest>(list).is_err());

        let mut compaction = serde_json::json!({
            "conversation_id": "conversation-1",
            "custom_instructions": null
        });
        assert!(serde_json::from_value::<ConversationCompactionRequest>(compaction.clone()).is_ok());
        compaction.as_object_mut().unwrap().remove("custom_instructions");
        assert!(serde_json::from_value::<ConversationCompactionRequest>(compaction).is_err());

        let update: ConversationUpdateRequest = serde_json::from_value(serde_json::json!({
            "id": "conversation-1",
            "assistant_id": null,
            "thinking_level": null,
            "mode": null,
            "project_id": null,
            "fast_mode": false,
            "accept_edits": true,
            "is_pinned": true,
            "is_archived": false
        }))
        .unwrap();
        assert_eq!(update.assistant_id, Some(None));
        assert_eq!(update.thinking_level, Some(None));
        assert_eq!(update.mode, Some(None));
        assert_eq!(update.project_id, Some(None));
        assert!(update.needs_turn_guard());

        let title_only: ConversationUpdateRequest = serde_json::from_value(serde_json::json!({
            "id": "conversation-1",
            "title": "hello"
        }))
        .unwrap();
        assert!(!title_only.needs_turn_guard());

        let mut search = serde_json::json!({ "query": "needle", "limit": null });
        assert!(serde_json::from_value::<ConversationSearchRequest>(search.clone()).is_ok());
        search.as_object_mut().unwrap().remove("limit");
        assert!(serde_json::from_value::<ConversationSearchRequest>(search).is_err());
    }

    #[test]
    fn remaining_conversation_request_objects_reject_unknown_fields() {
        assert!(
            serde_json::from_value::<ConversationUpdateRequest>(serde_json::json!({
                "id": "conversation-1",
                "accept_edits": true,
                "future_field": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ConversationListRequest>(serde_json::json!({
                "project_id": "project-1",
                "archived": false,
                "cursor": null
            }))
            .is_err()
        );
    }

    #[test]
    fn transcript_search_role_is_closed_at_the_response_boundary() {
        let hit = conversation_ops::TranscriptHit {
            conversation_id: "conversation-1".into(),
            title: None,
            role: "future_role".into(),
            snippet: "needle".into(),
            created_at: 1,
        };

        assert!(ConversationSearchHitInfoResponse::try_from(hit).is_err());
    }

    fn make_assistant(id: &str, name: &str, prompt: &str) -> assistant::Model {
        assistant::Model {
            id: id.into(),
            name: name.into(),
            description: None,
            avatar: None,
            system_prompt: prompt.into(),
            provider_id: None,
            model_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            is_default: db::types::SqlBool::FALSE,
            sort_order: 0,
            created_at: 1000,
            updated_at: 1000,
            context_limit: 128_000,
            compact_keep_recent_tokens: 10,
            enabled_tools: None,
            thinking_enabled: db::types::SqlBool::FALSE,
            thinking_budget: None,
            tool_preset_id: None,
            auto_compact_enabled: db::types::SqlBool::FALSE,
            cache_ttl: None,
            cache_expiry_policy: meridian_core::agent::cache_warmer::CacheExpiryPolicy::Compact,
            cache_max_warm_count: meridian_core::agent::cache_warmer::DEFAULT_CACHE_MAX_WARM_COUNT,
            cache_compact_min_tokens: meridian_core::agent::cache_warmer::DEFAULT_CACHE_COMPACT_MIN_TOKENS,
            logical_model_id: None,
            deployment_id: None,
        }
    }

    fn make_message(id: &str, role: &str, content: &str) -> db::entity::message::Model {
        db::entity::message::Model {
            id: id.into(),
            conversation_id: "c1".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            response_model_id: None,
            ttft_ms: None,
            generation_ms: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 1,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: meridian_core::db::types::SqlBool::FALSE,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            cache_write_1h_tokens: None,
            server_tool_calls: None,
            provider_name: None,
            provider_state: None,
            auto_review: None,
            tool_diffs: None,
        }
    }

    #[test]
    fn compose_keeps_the_chat_path_section_order() {
        let out = compose_system_prompt(Some("BASE"), "PERSONA", "\n\nINSTRUCTIONS", "\n\nFILEACCESS");
        // Memory is absent by design: it ships as a user-role message now.
        assert_eq!(out, "BASE\n\nPERSONA\n\nINSTRUCTIONS\n\nFILEACCESS");
        // No baseline (no file-editing tools enabled) must not leave padding.
        assert_eq!(compose_system_prompt(None, "PERSONA", "", ""), "PERSONA");
    }

    /// There are no template variables any more. A prompt written for them is
    /// sent as those characters — re-adding resolution here is what this guards
    /// against, since a clock in the prompt is what they were mostly used for.
    /// One project memory, in a database of its own: the memory block reads
    /// through SeaORM, and nothing else in these tests reads it.
    async fn memory_db(content: &str) -> meridian_core::db::sea::cap::Db {
        use meridian_core::db::entity::memory::{MemoryScope, MemoryType, Origin, Visibility};

        let db = meridian_core::db::sea::sea_test_db().await;
        meridian_core::db::sea::execute_for_tests(
            &db,
            "INSERT INTO projects (id, name, source_type, created_at, updated_at) VALUES ('p1', 'P', 'local', 1, 1)",
        )
        .await
        .unwrap();
        let row = meridian_core::db::entity::memory::Model {
            id: "m1".into(),
            scope_type: MemoryScope::Project,
            scope_id: "p1".into(),
            key: "stack".into(),
            content: content.into(),
            memory_type: MemoryType::General,
            subject_scope_id: None,
            origin: Origin::Desktop,
            visibility: Visibility::Normal,
            source_session_id: None,
            deleted_at: None,
            deleted_by: None,
            created_at: 1000,
            updated_at: 1000,
        };
        db.write(async |tx| meridian_core::db::sea::ops::memory::upsert(tx, row).await)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn persona_is_sent_verbatim_and_memory_is_appended() {
        let assistant = make_assistant("a1", "Nova", "You are {{assistant_name}} helping {{user_name}}.");
        let memory_db = memory_db("Rust + Tauri").await;

        let (persona, todo) = load_persona_and_todo(&memory_db, "c1", Some(&assistant), &[])
            .await
            .unwrap();
        let memory = load_memory_estimate(&memory_db, Some("p1"), &[]).await.unwrap();
        assert_eq!(persona, "You are {{assistant_name}} helping {{user_name}}.");
        assert!(memory.contains("<project_memories>"), "got: {memory}");
        assert!(memory.contains("stack: Rust + Tauri"), "got: {memory}");
        assert!(todo.is_empty(), "no checklist, no block");

        // Without a project there is no memory block at all.
        assert!(load_memory_estimate(&memory_db, None, &[]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn estimated_tokens_account_for_the_system_prompt() {
        let assistant = make_assistant(
            "a1",
            "Nova",
            "You are {{assistant_name}}, a meticulous engineering assistant. \
             Answer precisely and cite the files you touched.",
        );
        let memory_db = memory_db("Rust backend, React frontend, SQLite storage").await;

        let (persona, _) = load_persona_and_todo(&memory_db, "c1", Some(&assistant), &[])
            .await
            .unwrap();
        let memory = load_memory_estimate(&memory_db, Some("p1"), &[]).await.unwrap();
        let system_prompt = compose_system_prompt(base_prompt(&[], None).as_deref(), &persona, "", "");

        let budget = TokenBudget::new("openai", "gpt-4o", 128_000, 16_384, None);
        // Counted the way the chat path sends it: prompt plus the memory block
        // that now rides along as a user-role message.
        let empty = meridian_core::db::sea::ops::message::ActiveContext {
            path: Vec::new(),
            summary: None,
            anchor_index: None,
            head_id: None,
        };
        let with_prompt = budget.counter.count_messages(
            &meridian_core::agent::build_messages_with_senders(
                system_prompt.trim(),
                &empty,
                meridian_core::agent::trailing_with_memory(Some(&memory), None, None, None, None),
                &Default::default(),
            )
            .unwrap(),
        );
        let history_only = budget.counter.count_messages(&build_messages("", &empty, "").unwrap());

        // The regression this guards: get_context_info used to pass an empty
        // system prompt, so the UI reported a number that excluded it entirely.
        assert!(
            with_prompt > history_only + 20,
            "system prompt must be counted: {with_prompt} vs {history_only}"
        );
    }

    #[test]
    fn context_info_messages_include_frozen_user_context() {
        let user = make_message("m1", "user", "inspect @src/lib.rs");
        let context = db::sea::ops::message::ActiveContext {
            path: vec![user.clone()],
            summary: None,
            anchor_index: None,
            head_id: Some(user.id.clone()),
        };
        let frozen = message_context_item::Model {
            id: "ctx1".into(),
            message_id: user.id.clone(),
            position: 0,
            kind: meridian_core::workspace::reference::MessageContextKind::ProjectFile,
            content: "pub fn counted_snapshot() { /* frozen bytes */ }".into(),
            display_path: Some("src/lib.rs".into()),
            line_start: None,
            line_end: None,
            content_hash: "hash".into(),
            byte_count: 48,
            line_count: 1,
            token_count: 10,
            truncated: meridian_core::db::types::SqlBool::FALSE,
            metadata: None,
            created_at: 1,
        };
        let items = HashMap::from([(user.id.clone(), vec![frozen])]);

        let with_context = context_info_messages("system", &context, Vec::new(), &items).unwrap();
        let without_context = context_info_messages("system", &context, Vec::new(), &HashMap::new()).unwrap();

        assert!(
            with_context
                .iter()
                .any(|message| message.content.contains("counted_snapshot")),
            "the estimate payload must replay the frozen snapshot"
        );
        let budget = TokenBudget::new("openai", "gpt-4o", 128_000, 16_384, None);
        assert!(
            budget.counter.count_messages(&with_context) > budget.counter.count_messages(&without_context),
            "frozen context must contribute to the displayed token estimate"
        );
    }
}
