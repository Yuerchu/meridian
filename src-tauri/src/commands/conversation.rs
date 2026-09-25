use std::collections::HashMap;

use crate::ServicesExt;
use crate::commands::entity_response::{ConversationAgentKind, ConversationInfoResponse, ConversationListResponse};
use crate::commands::model_config::RequiredNullable;
use diesel::sqlite::SqliteConnection;

use meridian_core::agent::{
    TokenBudget, TurnParamsResolveRequest, build_file_access, build_messages_with_context_items, do_compact,
    file_access_prompt, instruction_budget, load_project_instructions, resolve_provider_config, resolve_turn_params,
};
use meridian_core::db;
use meridian_core::db::DbPool;
use meridian_core::db::models::assistant::AssistantRow;
use meridian_core::db::models::message_context_item::MessageContextItemRow;
use meridian_core::events::{CompactDoneEvent, CompactOutcome, CompactStartEvent, CompactTrigger};
use meridian_core::provider::ChatMessage;
use meridian_core::template;
use meridian_core::util::now_ms;

/// Summarise the conversation's history down to a summary row.
///
/// Refused while a turn is running: the turn does its own compaction from a
/// path it read at the top, so the two would delete each other's summaries and
/// anchor the survivor to ids that are no longer on the path. The OneBot side
/// has refused this since it was written; the desktop side never did.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationCompactionRequest {
    pub conversation_id: String,
    pub custom_instructions: RequiredNullable<String>,
}

#[tauri::command]
pub async fn compact(app: tauri::AppHandle, request: ConversationCompactionRequest) -> Result<(), String> {
    let conversation_id = request.conversation_id;
    let custom_instructions = request.custom_instructions.0;
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "compaction")
        .map_err(|busy| busy.to_string())?;
    if meridian_core::agent::queue::has_plan_review_barrier(&services, &conversation_id).await? {
        return Err(PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER.into());
    }
    let pool = services.db.clone();
    let secrets = services.secrets.clone();

    let (assistant, keep_recent) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = meridian_core::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let assistant = conv
                .assistant_id
                .as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
            // Summarised by the model that wrote the transcript, and against
            // that model's window.
            Ok::<_, String>((conv.pin_model(assistant), keep_recent))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    services.events.emit_compact_start(&CompactStartEvent {
        conversation_id: conversation_id.clone(),
        mid_turn: false,
        trigger: CompactTrigger::Manual,
    })?;

    let result = do_compact(
        &pool,
        &secrets,
        &conversation_id,
        assistant.as_ref(),
        keep_recent,
        custom_instructions.as_deref(),
    )
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

#[tauri::command]
pub async fn list_conversations(app: tauri::AppHandle, archived: bool) -> Result<ConversationListResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::conversation::list_conversations(&mut conn, archived).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationCreateRequest {
    title: RequiredNullable<String>,
    project_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn create_conversation(
    app: tauri::AppHandle,
    request: ConversationCreateRequest,
) -> Result<ConversationInfoResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let default_assistant = db::ops::assistant::get_default_assistant(&mut conn).map_err(|e| e.to_string())?;
        let assistant_id = default_assistant.as_ref().map(|a| a.id.as_str());
        let row = db::ops::conversation::create_conversation(
            &mut conn,
            &id,
            request.title.0.as_deref(),
            assistant_id,
            request.project_id.0.as_deref(),
            now_ms(),
        )
        .map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationAssistantUpdateRequest {
    pub id: String,
    pub assistant_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn set_conversation_assistant(
    app: tauri::AppHandle,
    request: ConversationAssistantUpdateRequest,
) -> Result<(), String> {
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&request.id, "an assistant change")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        mutate_conversation_unless_plan_barrier(&mut conn, &request.id, |conn| {
            db::ops::conversation::update_assistant(conn, &request.id, request.assistant_id.0.as_deref(), now_ms())
        })
        .map_err(|e| e.to_string())?
        .then_some(())
        .ok_or_else(|| PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationReasoningPreferencesUpdateRequest {
    pub id: String,
    pub thinking_level: RequiredNullable<meridian_core::provider::capabilities::StoredThinkingLevel>,
    pub fast_mode: bool,
}

#[tauri::command]
pub async fn set_conversation_reasoning_prefs(
    app: tauri::AppHandle,
    request: ConversationReasoningPreferencesUpdateRequest,
) -> Result<(), String> {
    let thinking_level = request.thinking_level.0.map(|level| level.as_str().to_string());
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&request.id, "a reasoning preference change")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        mutate_conversation_unless_plan_barrier(&mut conn, &request.id, |conn| {
            db::ops::conversation::update_reasoning_prefs(
                conn,
                &request.id,
                thinking_level.as_deref(),
                request.fast_mode,
                now_ms(),
            )
        })
        .map_err(|e| e.to_string())?
        .then_some(())
        .ok_or_else(|| PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Switch the conversation's collaboration mode. `None` is the canonical
/// default (work) mode; a present id must name a declared mode exactly.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationModeUpdateRequest {
    pub id: String,
    pub mode: RequiredNullable<meridian_core::agent::modes::ChatMode>,
}

#[tauri::command]
pub async fn set_conversation_mode(
    app: tauri::AppHandle,
    request: ConversationModeUpdateRequest,
) -> Result<(), String> {
    let mode = request
        .mode
        .0
        .and_then(meridian_core::agent::modes::ChatMode::canonical_storage)
        .map(str::to_string);
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_mode(&mut conn, &request.id, mode.as_deref(), now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Turn the standing approval for ordinary edits on or off.
///
/// What this widens is bounded by `tools::reach`, not by this call: edits
/// outside the project, anything irreversible, and paths that make code run
/// later keep asking however this is set. Per-conversation, like the mode and
/// the todo list, because it describes this stretch of work rather than a
/// general preference.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationAcceptEditsUpdateRequest {
    pub id: String,
    pub accept_edits: bool,
}

#[tauri::command]
pub async fn set_conversation_accept_edits(
    app: tauri::AppHandle,
    request: ConversationAcceptEditsUpdateRequest,
) -> Result<(), String> {
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&request.id, "an edit-approval change")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        mutate_conversation_unless_plan_barrier(&mut conn, &request.id, |conn| {
            db::ops::conversation::update_accept_edits(conn, &request.id, request.accept_edits, now_ms())
        })
        .map_err(|e| e.to_string())?
        .then_some(())
        .ok_or_else(|| PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationTitleUpdateRequest {
    id: String,
    title: String,
}

#[tauri::command]
pub async fn update_conversation_title(
    app: tauri::AppHandle,
    request: ConversationTitleUpdateRequest,
) -> Result<(), String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_title(&mut conn, &request.id, &request.title, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Refile a conversation under another project, or under none (`None`).
///
/// For a native conversation this also moves what the next turn resolves its
/// working directory and file access against — see `update_project`.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationProjectUpdateRequest {
    pub id: String,
    pub project_id: RequiredNullable<String>,
}

const PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER: &str = "This conversation is waiting for plan review or its continuation. Finish it before changing its transcript or project.";

fn mutate_conversation_unless_plan_barrier<F>(
    conn: &mut SqliteConnection,
    conversation_id: &str,
    mutation: F,
) -> diesel::QueryResult<bool>
where
    F: FnOnce(&mut SqliteConnection) -> diesel::QueryResult<()>,
{
    conn.immediate_transaction(|conn| {
        if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
        {
            return Ok(false);
        }
        mutation(conn).map(|_| true)
    })
}

fn update_conversation_project_unless_plan_barrier(
    conn: &mut SqliteConnection,
    conversation_id: &str,
    project_id: Option<&str>,
    now: i64,
) -> diesel::QueryResult<bool> {
    conn.immediate_transaction(|conn| {
        if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
        {
            return Ok(false);
        }
        db::ops::conversation::update_project(conn, conversation_id, project_id, now).map(|_| true)
    })
}

#[tauri::command]
pub async fn set_conversation_project(
    app: tauri::AppHandle,
    request: ConversationProjectUpdateRequest,
) -> Result<(), String> {
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&request.id, "a project move")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        update_conversation_project_unless_plan_barrier(
            &mut conn,
            &request.id,
            request.project_id.0.as_deref(),
            now_ms(),
        )
        .map_err(|e| e.to_string())?
        .then_some(())
        .ok_or_else(|| PLAN_REVIEW_CONVERSATION_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

impl TryFrom<db::ops::conversation::TranscriptHit> for ConversationSearchHitInfoResponse {
    type Error = String;

    fn try_from(hit: db::ops::conversation::TranscriptHit) -> Result<Self, Self::Error> {
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
    let pool = app.services().db.clone();
    // domain-default: a page size the caller did not ask about, not a fact about a model
    let limit = request.limit.0.unwrap_or(20).min(100) as usize;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let hits =
            db::ops::conversation::search_transcripts(&mut conn, &request.query, limit).map_err(|e| e.to_string())?;
        hits.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_pin_conversation(app: tauri::AppHandle, id: String) -> Result<ConversationInfoResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let row = db::ops::conversation::toggle_pin(&mut conn, &id, now_ms()).map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_archive_conversation(
    app: tauri::AppHandle,
    id: String,
) -> Result<ConversationInfoResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let row = db::ops::conversation::toggle_archive(&mut conn, &id, now_ms()).map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn delete_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let coordinator = app.services().turns.clone();
    let pool = app.services().db.clone();

    // This one first, and on its own. A delegated run is started from inside a
    // turn on this conversation, and a turn cannot exist while a mutation holds
    // it — so from here the set of children is fixed, and reading it next cannot
    // miss one that appears in between.
    let _parent = coordinator
        .try_acquire_mutations(std::slice::from_ref(&id), "a delete")
        .map_err(|busy| busy.to_string())?;

    let doomed = {
        let (pool, id) = (pool.clone(), id.clone());
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            db::ops::conversation::descendants(&mut conn, &id).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    };
    // All of them or none. Any one can have a sub-agent running on it, and
    // taking them one at a time would mean holding part of a tree while being
    // refused the rest.
    let _children = coordinator
        .try_acquire_mutations(&doomed, "a delete")
        .map_err(|busy| busy.to_string())?;

    let services = app.services();
    let attachment_dirs: Vec<std::path::PathBuf> = std::iter::once(&id)
        .chain(doomed.iter())
        .map(|c| meridian_core::files::conversation_files_dir(&services.paths.data_dir, c))
        .collect();

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
    }

    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::delete_conversation(&mut conn, &id).map_err(|e| e.to_string())?;
        // Best-effort, and every run's directory as well as the parent's: the
        // rows are the source of truth, so a failed cleanup must not fail the
        // delete — but a directory nobody deletes is one nothing will ever come
        // back for either.
        for dir in attachment_dirs {
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())?
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

/// The persona (template variables resolved) and the project memory block — the
/// system-prompt parts that come straight out of the database. Split out from
/// `assemble_system_prompt` so it can be exercised without an app handle.
/// `live` is what a turn starting now would actually carry, which is what makes
/// the memory figure honest: with the block frozen into the history, most turns
/// inject nothing at all, and counting a full block every time would report a
/// cost no turn pays. Reads only — an estimate is not a turn, so it must not
/// write a row or move a cursor.
fn load_persona_and_memory(
    conn: &mut SqliteConnection,
    assistant: Option<&AssistantRow>,
    project_id: Option<&str>,
    live: &[db::models::message::MessageRow],
) -> Result<(String, String), String> {
    let raw_prompt = assistant.map(|a| a.system_prompt.as_str()).unwrap_or("");
    let user_name = db::ops::preference::get_preference(conn, "user_name").ok().flatten();
    let mut ctx = template::build_context(assistant.map(|a| a.name.as_str()), user_name.as_deref());
    if let Some(a) = assistant
        && let Some(block) = db::ops::emoji::format_emoji_list_block(conn, &a.id)
    {
        ctx.set("emoji_list", &block);
    }
    let persona = template::resolve(raw_prompt, &ctx);
    let req = meridian_core::agent::MemoryRequest::desktop(
        project_id.map(|s| s.to_string()),
        // Counting uses the largest bracket: an under-reported figure is worse
        // than a slightly generous one.
        meridian_core::agent::memory_budget(usize::MAX),
    );
    let memory = meridian_core::agent::plan_injection(conn, &req, live, meridian_core::util::now_ms())?
        .text
        .unwrap_or_default();
    Ok((persona, memory))
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
    pool: &DbPool,
    conversation_id: &str,
    mode: Option<&str>,
    assistant: Option<&AssistantRow>,
    project_path: Option<&str>,
    project_id: Option<&str>,
    context_limit: usize,
    active_path: &[db::models::message::MessageRow],
    // `server_tools` is the turn's own, resolved by the caller. Counting the
    // local `web_search` that a provider-side one displaces would make the
    // estimate disagree with the prompt actually sent — the drift this function
    // exists to avoid, not to introduce.
    server_tools: Vec<meridian_core::provider::ServerToolKind>,
) -> Result<(String, String), String> {
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
    let file_access = build_file_access(pool).await?;

    // The very same resolver the chat loop runs. Counting anything else here is
    // how the estimate ended up short of what actually gets sent — the checklist
    // block used to be missing from this side entirely.
    let pool2 = pool.clone();
    let assistant = assistant.cloned();
    let conv_id = conversation_id.to_string();
    let pid = project_id.map(str::to_string);
    let mode = meridian_core::agent::modes::resolve(mode)?;
    let context_blocks = vec![
        instruction_block.unwrap_or_default(),
        file_access_prompt(&file_access),
        // Same function the chat loop calls, so the estimate covers the block.
        meridian_core::voice::prompt::voice_context_block(active_path, false).unwrap_or_default(),
    ];
    let live: Vec<db::models::message::MessageRow> = active_path.to_vec();
    tokio::task::spawn_blocking(move || -> Result<(String, String), String> {
        let mut conn = meridian_core::util::get_conn(&pool2)?;
        let (persona, memory_block) = load_persona_and_memory(&mut conn, assistant.as_ref(), pid.as_deref(), &live)?;
        let sub_agents = meridian_core::agent::sub_agents::catalog(&mut conn)?;
        let turn = meridian_core::agent::turn_config::resolve(
            &mut conn,
            &registry,
            meridian_core::agent::turn_config::TurnConfigResolveRequest {
                assistant,
                conversation_id: conv_id,
                // The estimate has to count the prompt the chat loop will send,
                // and a provider-side tool takes the local one out of it.
                server_tools,
                project_id: pid,
                // The estimate has to count the prompt the chat loop will
                // actually send, transitions included.
                mode: meridian_core::agent::modes::Modes::Switchable(mode),
                // And for the same reason it has to answer this the way the
                // chat loop does. `run_agent` carries a roster of models in its
                // description, which is not a small number of tokens to be
                // wrong about.
                sub_agents: Some(sub_agents),
                mcp_defs,
                exposure: meridian_core::agent::turn_config::ToolExposure::All,
                persona,
                context_blocks,
            },
        )?;
        Ok((turn.system_prompt, memory_block))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Build the exact message list whose tokens `get_context_info` reports. Kept
/// separate so a regression test can pin the frozen context that ordinary chat
/// replays after each stored user row.
fn context_info_messages(
    system_prompt: &str,
    context: &db::ops::message::ActiveContext,
    trailing: Vec<ChatMessage>,
    context_items: &HashMap<String, Vec<MessageContextItemRow>>,
) -> Result<Vec<ChatMessage>, String> {
    build_messages_with_context_items(system_prompt, context, trailing, &Default::default(), context_items)
}

#[tauri::command]
pub async fn get_context_info(app: tauri::AppHandle, conversation_id: String) -> Result<ContextInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();

    let (assistant, ctx, context_items, project_path, project_id, conv_mode, agent_kind) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = meridian_core::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let assistant = conv
                .assistant_id
                .as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let project = conv
                .project_id
                .as_deref()
                .and_then(|pid| db::ops::project::get_project(&mut conn, pid).ok());
            let project_path = project.as_ref().and_then(|p| p.path.clone());
            let project_id = project.as_ref().map(|p| p.id.clone());
            let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
            let path_ids = ctx.path.iter().map(|message| message.id.clone()).collect::<Vec<_>>();
            let context_items =
                db::ops::message_context_item::list_for_messages(&mut conn, &path_ids).map_err(|e| e.to_string())?;
            // The indicator has to describe the window a request from *this*
            // conversation would go into, which for a delegated run is its own
            // model's rather than the parent assistant's.
            Ok::<_, String>((
                conv.pin_model(assistant),
                ctx,
                context_items,
                project_path,
                project_id,
                conv.mode.clone(),
                conv.agent_kind.clone(),
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    let auto_compact_enabled = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    // Both take a pooled connection, and the first also reads the OS credential
    // store. Run off the async thread: the UI polls this command every time the
    // transcript grows, so a blocking call here occupies a worker repeatedly
    // rather than once.
    //
    // Resolved exactly as the chat path does, so the threshold the UI reports is
    // the one the compaction check actually compares against.
    let (provider_type, model, turn) = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        let assistant2 = assistant.clone();
        tokio::task::spawn_blocking(move || {
            let meridian_core::agent::ResolvedProvider {
                provider_type,
                model,
                api_format,
                transport_profile,
                codex_request_shape,
                ..
            } = resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())?;
            let turn = resolve_turn_params(
                &pool2,
                TurnParamsResolveRequest {
                    assistant: assistant2.as_ref(),
                    provider_id: assistant2.as_ref().and_then(|a| a.provider_id.as_deref()),
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
            )?;
            Ok::<_, String>((provider_type, model, turn))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let context_limit = turn.context_limit;
    let budget = TokenBudget::new(
        &provider_type,
        &model,
        context_limit,
        turn.max_output,
        turn.compact_threshold,
    );

    let (system_prompt, memory_block) = assemble_system_prompt(
        &app,
        &pool,
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
        meridian_core::agent::interrupted::load_block(&pool, &services.turns, &conversation_id, "").await?;

    // Mirrors the chat path exactly, background blocks included, so the figure
    // the UI shows covers what a turn actually sends.
    let msgs = context_info_messages(
        system_prompt.trim(),
        &ctx,
        meridian_core::agent::trailing_with_memory(
            Some(&memory_block),
            interrupted_block.as_ref().map(|r| r.text()),
            "",
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationListByProjectRequest {
    pub project_id: String,
    pub archived: bool,
}

#[tauri::command]
pub async fn list_conversations_by_project(
    app: tauri::AppHandle,
    request: ConversationListByProjectRequest,
) -> Result<ConversationListResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows =
            db::ops::conversation::list_conversations_by_project(&mut conn, &request.project_id, request.archived)
                .map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::agent::{base_prompt, build_messages};
    use meridian_core::db::models::assistant::AssistantInsert;
    use meridian_core::db::models::emoji::EmojiInsert;
    use meridian_core::db::models::emoji_pack::EmojiPackInsert;
    use meridian_core::db::models::memory::MemoryInsert;
    use meridian_core::db::models::project::ProjectInsert;
    use meridian_core::db::test_db;

    fn seed_pending_review(conn: &mut SqliteConnection, conversation_id: &str) {
        let document = db::ops::plan_review::create_or_resume_document(conn, conversation_id, 2).unwrap();
        let appended = db::ops::plan_review::append_assistant_revision(
            conn,
            &db::ops::plan_review::PlanRevisionAppend {
                document_id: &document.id,
                expected_generation: 0,
                expected_head_sha256: None,
                content_markdown: "# Plan\n",
                patch: "first patch",
                source_message_id: Some("m1"),
                source_call_id: Some("update-1"),
                responding_to_suggestion_revision_id: None,
                now: 3,
            },
        )
        .unwrap();
        db::ops::plan_review::mark_materialization_applied(conn, &appended.materialization.id, 4).unwrap();
        db::ops::plan_review::submit_native_head_for_review(
            conn,
            &db::ops::plan_review::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: appended.document.working_generation,
                expected_head_sha256: &appended.revision.content_sha256,
                turn_id: None,
                assistant_message_id: Some("m1"),
                provider_call_id: Some("exit-1"),
                provider_kind: db::models::plan_review::PlanReviewProviderKind::Native,
                now: 5,
            },
            &db::models::plan_review::NativePlanReviewRuntimeConfig {
                provider_id: "provider-test".into(),
                model: "model-test".into(),
                assistant_id: None,
                thinking_level: None,
                fast: false,
                project_id: Some("project-a".into()),
                project_path: Some("A".into()),
                accept_edits: false,
            },
        )
        .unwrap();
    }

    fn create_project(conn: &mut SqliteConnection, id: &str, path: &str) {
        db::ops::project::create_project(
            conn,
            &ProjectInsert {
                id,
                name: id,
                path: Some(path),
                source_type: "local",
                source_id: None,
                assistant_id: None,
                description: None,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
    }

    #[test]
    fn a_pending_plan_review_prevents_moving_the_conversation_to_another_project() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_project(&mut conn, "project-a", "A");
        create_project(&mut conn, "project-b", "B");
        db::ops::conversation::create_conversation(&mut conn, "conversation-1", None, None, Some("project-a"), 1)
            .unwrap();
        seed_pending_review(&mut conn, "conversation-1");

        assert!(
            !update_conversation_project_unless_plan_barrier(&mut conn, "conversation-1", Some("project-b"), 6,)
                .unwrap()
        );
        assert_eq!(
            db::ops::conversation::get_conversation(&mut conn, "conversation-1")
                .unwrap()
                .project_id
                .as_deref(),
            Some("project-a")
        );
    }

    #[test]
    fn conversation_requests_reject_unknown_fields() {
        let create = serde_json::json!({
            "title": null,
            "projectId": null,
            "futureField": true,
        });
        assert!(serde_json::from_value::<ConversationCreateRequest>(create).is_err());

        let update = serde_json::json!({
            "id": "conversation-1",
            "title": "renamed",
            "legacyTitle": "old",
        });
        assert!(serde_json::from_value::<ConversationTitleUpdateRequest>(update).is_err());

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
        let mut create = serde_json::json!({ "title": null, "projectId": null });
        assert!(serde_json::from_value::<ConversationCreateRequest>(create.clone()).is_ok());
        create.as_object_mut().unwrap().remove("projectId");
        assert!(serde_json::from_value::<ConversationCreateRequest>(create).is_err());

        let mut compaction = serde_json::json!({
            "conversationId": "conversation-1",
            "customInstructions": null
        });
        assert!(serde_json::from_value::<ConversationCompactionRequest>(compaction.clone()).is_ok());
        compaction.as_object_mut().unwrap().remove("customInstructions");
        assert!(serde_json::from_value::<ConversationCompactionRequest>(compaction).is_err());

        let mut assistant = serde_json::json!({ "id": "conversation-1", "assistantId": null });
        assert!(serde_json::from_value::<ConversationAssistantUpdateRequest>(assistant.clone()).is_ok());
        assistant.as_object_mut().unwrap().remove("assistantId");
        assert!(serde_json::from_value::<ConversationAssistantUpdateRequest>(assistant).is_err());

        let mut reasoning = serde_json::json!({
            "id": "conversation-1",
            "thinkingLevel": null,
            "fastMode": false
        });
        assert!(serde_json::from_value::<ConversationReasoningPreferencesUpdateRequest>(reasoning.clone()).is_ok());
        reasoning.as_object_mut().unwrap().remove("thinkingLevel");
        assert!(serde_json::from_value::<ConversationReasoningPreferencesUpdateRequest>(reasoning).is_err());

        let mut mode = serde_json::json!({ "id": "conversation-1", "mode": null });
        assert!(serde_json::from_value::<ConversationModeUpdateRequest>(mode.clone()).is_ok());
        mode.as_object_mut().unwrap().remove("mode");
        assert!(serde_json::from_value::<ConversationModeUpdateRequest>(mode).is_err());

        let mut project = serde_json::json!({ "id": "conversation-1", "projectId": null });
        assert!(serde_json::from_value::<ConversationProjectUpdateRequest>(project.clone()).is_ok());
        project.as_object_mut().unwrap().remove("projectId");
        assert!(serde_json::from_value::<ConversationProjectUpdateRequest>(project).is_err());

        let mut search = serde_json::json!({ "query": "needle", "limit": null });
        assert!(serde_json::from_value::<ConversationSearchRequest>(search.clone()).is_ok());
        search.as_object_mut().unwrap().remove("limit");
        assert!(serde_json::from_value::<ConversationSearchRequest>(search).is_err());
    }

    #[test]
    fn remaining_conversation_request_objects_reject_unknown_fields() {
        assert!(
            serde_json::from_value::<ConversationAcceptEditsUpdateRequest>(serde_json::json!({
                "id": "conversation-1",
                "acceptEdits": true,
                "futureField": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ConversationListByProjectRequest>(serde_json::json!({
                "projectId": "project-1",
                "archived": false,
                "cursor": null
            }))
            .is_err()
        );
    }

    #[test]
    fn transcript_search_role_is_closed_at_the_response_boundary() {
        let hit = db::ops::conversation::TranscriptHit {
            conversation_id: "conversation-1".into(),
            title: None,
            role: "future_role".into(),
            snippet: "needle".into(),
            created_at: 1,
        };

        assert!(ConversationSearchHitInfoResponse::try_from(hit).is_err());
    }

    fn make_assistant(conn: &mut SqliteConnection, id: &str, name: &str, prompt: &str) -> AssistantRow {
        db::ops::assistant::create_assistant(
            conn,
            &AssistantInsert {
                id,
                name,
                description: None,
                avatar: None,
                system_prompt: prompt,
                provider_id: None,
                model_id: None,
                temperature: None,
                top_p: None,
                max_tokens: None,
                is_default: 0,
                sort_order: 0,
                created_at: 1000,
                updated_at: 1000,
                context_limit: 128_000,
                compact_keep_recent: 10,
                enabled_tools: None,
                thinking_enabled: 0,
                thinking_budget: None,
                tool_preset_id: None,
                auto_compact_enabled: 0,
            },
        )
        .unwrap()
    }

    fn make_project(conn: &mut SqliteConnection, id: &str) {
        db::ops::project::create_project(
            conn,
            &ProjectInsert {
                id,
                name: "Proj",
                path: None,
                source_type: "local",
                source_id: None,
                assistant_id: None,
                description: None,
                created_at: 1000,
                updated_at: 1000,
            },
        )
        .unwrap();
    }

    fn make_message(id: &str, role: &str, content: &str) -> db::models::message::MessageRow {
        db::models::message::MessageRow {
            id: id.into(),
            conversation_id: "c1".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            response_model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 1,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
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

    #[test]
    fn persona_resolves_template_variables_and_memory_is_appended() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        db::ops::preference::set_preference(&mut conn, "user_name", "Yuerchu", 1000).unwrap();
        let assistant = make_assistant(
            &mut conn,
            "a1",
            "Nova",
            "You are {{assistant_name}} helping {{user_name}}.",
        );
        make_project(&mut conn, "p1");
        db::ops::memory::upsert_memory(
            &mut conn,
            &MemoryInsert {
                id: "m1",
                scope_type: "project",
                scope_id: "p1",
                key: "stack",
                content: "Rust + Tauri",
                memory_type: "general",
                subject_scope_id: None,
                origin: "desktop",
                visibility: "normal",
                source_session_id: None,
                created_at: 1000,
                updated_at: 1000,
            },
        )
        .unwrap();

        let (persona, memory) = load_persona_and_memory(&mut conn, Some(&assistant), Some("p1"), &[]).unwrap();
        assert_eq!(persona, "You are Nova helping Yuerchu.");
        assert!(memory.contains("<project_memories>"), "got: {memory}");
        assert!(memory.contains("stack: Rust + Tauri"), "got: {memory}");

        // Without a project there is no memory block at all.
        let (_, none) = load_persona_and_memory(&mut conn, Some(&assistant), None, &[]).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn persona_expands_sticker_tool_guidance() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let assistant = make_assistant(&mut conn, "a1", "Nova", "{{emoji_list}}");

        // Nothing assigned: the variable stays literal rather than expanding to
        // an instruction about an empty set.
        let (persona, _) = load_persona_and_memory(&mut conn, Some(&assistant), None, &[]).unwrap();
        assert_eq!(persona, "{{emoji_list}}");

        db::ops::emoji_pack::create_pack(
            &mut conn,
            &EmojiPackInsert {
                id: "pack1",
                name: "Pack",
                description: None,
                cover_image: None,
                is_builtin: 0,
                sort_order: 0,
                created_at: 1000,
                updated_at: 1000,
                kind: "manual",
                source_account_id: None,
            },
        )
        .unwrap();
        db::ops::emoji::create_emoji(
            &mut conn,
            &EmojiInsert {
                id: "e1",
                pack_id: "pack1",
                name: "shocked",
                tags: None,
                file_name: "shocked.png",
                file_format: "png",
                sort_order: 0,
                created_at: 1000,
                source: "local",
                source_key: None,
                native_payload: None,
                semantic_status: "confirmed",
                suggested_name: None,
                suggested_tags: None,
                file_size: 0,
                seen_count: 1,
                last_seen_at: Some(1000),
            },
        )
        .unwrap();
        db::ops::emoji_pack::assign_pack(&mut conn, "a1", "pack1", 1000).unwrap();

        let (persona, _) = load_persona_and_memory(&mut conn, Some(&assistant), None, &[]).unwrap();
        assert!(persona.contains("list_stickers"), "got: {persona}");
        assert!(!persona.contains("[emoji:shocked]"), "got: {persona}");
    }

    #[test]
    fn estimated_tokens_account_for_the_system_prompt() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let assistant = make_assistant(
            &mut conn,
            "a1",
            "Nova",
            "You are {{assistant_name}}, a meticulous engineering assistant. \
             Answer precisely and cite the files you touched.",
        );
        make_project(&mut conn, "p1");
        db::ops::memory::upsert_memory(
            &mut conn,
            &MemoryInsert {
                id: "m1",
                scope_type: "project",
                scope_id: "p1",
                key: "stack",
                content: "Rust backend, React frontend, SQLite storage",
                memory_type: "general",
                subject_scope_id: None,
                origin: "desktop",
                visibility: "normal",
                source_session_id: None,
                created_at: 1000,
                updated_at: 1000,
            },
        )
        .unwrap();

        let (persona, memory) = load_persona_and_memory(&mut conn, Some(&assistant), Some("p1"), &[]).unwrap();
        let system_prompt = compose_system_prompt(base_prompt(&[]).as_deref(), &persona, "", "");

        let budget = TokenBudget::new("openai", "gpt-4o", 128_000, 16_384, None);
        // Counted the way the chat path sends it: prompt plus the memory block
        // that now rides along as a user-role message.
        let empty = meridian_core::db::ops::message::ActiveContext {
            path: Vec::new(),
            summary: None,
            anchor_index: None,
            head_id: None,
        };
        let with_prompt = budget.counter.count_messages(
            &meridian_core::agent::build_messages_with_senders(
                system_prompt.trim(),
                &empty,
                meridian_core::agent::trailing_with_memory(Some(&memory), None, "", None),
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
        let context = db::ops::message::ActiveContext {
            path: vec![user.clone()],
            summary: None,
            anchor_index: None,
            head_id: Some(user.id.clone()),
        };
        let frozen = MessageContextItemRow {
            id: "ctx1".into(),
            message_id: user.id.clone(),
            position: 0,
            kind: "project_file".into(),
            content: "pub fn counted_snapshot() { /* frozen bytes */ }".into(),
            display_path: Some("src/lib.rs".into()),
            line_start: None,
            line_end: None,
            content_hash: "hash".into(),
            byte_count: 48,
            line_count: 1,
            token_count: 10,
            truncated: 0,
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
