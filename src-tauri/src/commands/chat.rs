use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::agent::engine;
use meridian_core::agent::turn_record;
use meridian_core::agent::{
    CompactCircuitBreaker, TokenBudget, build_file_access, build_messages_with_context_items, do_compact,
    file_access_prompt, instruction_budget, load_project_instructions, microcompact, resolve_file_uris_in_messages,
    resolve_sticker_parts_in_messages, trailing_with_memory, trim_to_context_limit,
};
use meridian_core::db;
use meridian_core::db::DbPool;
use meridian_core::db::models::assistant::AssistantRow;
use meridian_core::db::models::message::MessageInsert;
use meridian_core::db::models::turn::{ERROR_LOOP_DETECTED, TurnPhase, TurnStatus};
use meridian_core::events::{
    ChatStopReason, ChatStreamEvent, CompactDoneEvent, CompactOutcome, CompactStartEvent, CompactTrigger,
};
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
    assistant: Option<AssistantRow>,
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
    /// And once more. This rebuilds the tool set, so a suppression applied only
    /// where the turn was set up is undone by the first mode switch — handing
    /// back a local `web_search` to sit beside the provider-side one.
    server_tools: Vec<provider::ServerToolKind>,
    /// Frozen effective destination/preferences for the durable continuation.
    /// The review can outlive this process and conversation defaults may change
    /// before it is decided, so none of these may be re-resolved at approval.
    native_runtime: db::models::plan_review::NativePlanReviewRuntimeConfig,
}

fn select_turn_setting<T>(origin: TurnOrigin, explicit: Option<T>, conversation_default: Option<T>) -> Option<T> {
    if origin == TurnOrigin::PlanReview {
        explicit
    } else {
        explicit.or(conversation_default)
    }
}

async fn load_message_context_items(
    pool: &DbPool,
    context: &db::ops::message::ActiveContext,
) -> Result<std::collections::HashMap<String, Vec<db::models::message_context_item::MessageContextItemRow>>, String> {
    let ids = context
        .path
        .iter()
        .map(|message| message.id.clone())
        .collect::<Vec<_>>();
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::message_context_item::list_for_messages(&mut conn, &ids).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn trailing_with_user_context(
    memory: Option<&str>,
    interrupted: Option<&str>,
    user_message: &str,
    roster: Option<&str>,
    context: &[meridian_core::workspace::reference::PreparedContextItem],
) -> Vec<ChatMessage> {
    let mut trailing = trailing_with_memory(memory, interrupted, user_message, roster);
    let user = trailing
        .iter()
        .rposition(|message| matches!(message.origin, provider::MessageOrigin::LegacyUser))
        .unwrap_or(trailing.len().saturating_sub(1));
    let injected = context.iter().map(|item| {
        ChatMessage::user_provided_context(&meridian_core::workspace::reference::render_context_item(
            item.kind,
            item.display_path.as_deref(),
            item.line_start,
            item.line_end,
            &item.content,
            item.truncated != 0,
        ))
    });
    trailing.splice(user + 1..user + 1, injected);
    trailing
}

fn reference_tool_context(
    working_directory: Option<String>,
    file_access: tools::FileAccess,
    cancel: tokio_util::sync::CancellationToken,
) -> tools::ToolContext {
    tools::ToolContext {
        working_directory,
        shell: tools::ShellType::default_for_platform(),
        file_access,
        project_id: None,
        conversation_id: None,
        turn_id: None,
        assistant_id: None,
        db_pool: None,
        #[cfg(not(target_os = "android"))]
        sandbox_policy: None,
        tool_secrets: Default::default(),
        cancel,
        journal: None,
    }
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
        let input = meridian_core::agent::turn_config::TurnConfigResolveRequest {
            assistant: self.assistant.clone(),
            server_tools: self.server_tools.clone(),
            conversation_id: self.conversation_id.clone(),
            project_id: self.project_id.clone(),
            // This type exists to answer the question, so the answer is yes.
            mode: meridian_core::agent::modes::Modes::Switchable(mode),
            // The turn's own, carried rather than resolved again.
            sub_agents: Some(self.sub_agents.clone()),
            mcp_defs,
            exposure: meridian_core::agent::turn_config::ToolExposure::when(self.supports_tools),
            persona: self.persona.clone(),
            context_blocks: self.context_blocks.clone(),
        };
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            meridian_core::agent::turn_config::resolve(&mut conn, &registry, input)
        })
        .await
        .map_err(|e| e.to_string())
    }

    async fn read_plan(&self) -> Result<meridian_core::agent::engine::PlanReadResult, String> {
        use meridian_core::db::models::plan_review::PlanMaterializationState;

        let pool = self.pool.clone();
        let conversation_id = self.conversation_id.clone();
        let files = self.services.plan_files.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            let document = db::ops::plan_review::create_or_resume_document(&mut conn, &conversation_id, now)
                .map_err(|error| error.to_string())?;
            let report = files
                .reconcile_document(&mut conn, &document.id, now)
                .map_err(|error| error.to_string())?;
            let head =
                db::ops::plan_review::get_head_revision(&mut conn, &document.id).map_err(|error| error.to_string())?;
            let state = match report.conflict {
                Some(_) => PlanMaterializationState::Conflict,
                None => db::ops::plan_review::latest_materialization(&mut conn, &document.id)
                    .map_err(|error| error.to_string())?
                    .map(|row| row.state())
                    .transpose()?
                    .unwrap_or(PlanMaterializationState::Applied),
            };
            let (content, sha256) = match head {
                Some(revision) => (revision.content_markdown, revision.content_sha256),
                None => {
                    let content = String::new();
                    let sha256 = db::ops::plan_review::markdown_sha256(&content);
                    (content, sha256)
                }
            };
            Ok(meridian_core::agent::engine::PlanReadResult {
                content,
                generation: document.working_generation,
                sha256,
                file_sync_state: state,
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }

    async fn update_plan(
        &self,
        request: meridian_core::agent::engine::UpdatePlanRequest,
    ) -> Result<meridian_core::agent::engine::PlanUpdateResult, String> {
        let pool = self.pool.clone();
        let conversation_id = self.conversation_id.clone();
        let files = self.services.plan_files.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            let document = db::ops::plan_review::create_or_resume_document(&mut conn, &conversation_id, now)
                .map_err(|error| error.to_string())?;
            let report = files
                .reconcile_document(&mut conn, &document.id, now)
                .map_err(|error| error.to_string())?;
            if report.conflict.is_some() {
                return Err("plan.md is in conflict; restore the database copy before updating it".into());
            }
            let head = db::ops::plan_review::get_head_revision(&mut conn, &document.id)
                .map_err(|error| error.to_string())?;
            let current_sha = head
                .as_ref()
                .map(|revision| revision.content_sha256.clone())
                .unwrap_or_else(|| db::ops::plan_review::markdown_sha256(""));
            if document.working_generation != request.base_generation || current_sha != request.base_sha256 {
                return Err(format!(
                    "stale plan base: current generation is {} and current SHA-256 is {}; call read_plan and regenerate the patch",
                    document.working_generation, current_sha
                ));
            }
            let content = meridian_core::tools::apply_patch::apply_plan_patch(
                head.as_ref().map(|revision| revision.content_markdown.as_str()),
                &request.patch,
            )?;
            let responding_to_suggestion_revision_id = db::ops::plan_review::list_reviews(&mut conn, &document.id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .rev()
                .find_map(|review| {
                    (review.state
                        == meridian_core::db::models::plan_review::PlanReviewState::ChangesRequested.as_str()
                        && head
                            .as_ref()
                            .is_some_and(|current| current.id == review.submitted_revision_id))
                        .then_some(review.suggestion_revision_id)
                        .flatten()
                });
            let appended = db::ops::plan_review::append_assistant_revision(
                &mut conn,
                &db::ops::plan_review::PlanRevisionAppend {
                    document_id: &document.id,
                    expected_generation: request.base_generation,
                    expected_head_sha256: head.as_ref().map(|revision| revision.content_sha256.as_str()),
                    content_markdown: &content,
                    patch: &request.patch,
                    source_message_id: Some(&request.source_message_id),
                    source_call_id: Some(&request.source_call_id),
                    responding_to_suggestion_revision_id: responding_to_suggestion_revision_id.as_deref(),
                    now,
                },
            )
            .map_err(|error| error.to_string())?;
            let materialized = files
                .reconcile_document(&mut conn, &document.id, now_ms())
                .map_err(|error| error.to_string())?;
            if let Some(conflict) = materialized.conflict {
                return Err(conflict.error.unwrap_or_else(|| "plan.md materialization conflicted".into()));
            }
            Ok(meridian_core::agent::engine::PlanUpdateResult {
                generation: appended.document.working_generation,
                sha256: appended.revision.content_sha256,
                applied_diff: request.patch,
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }

    async fn submit_plan(
        &self,
        request: meridian_core::agent::engine::SubmitPlanRequest,
    ) -> Result<meridian_core::events::PlanReviewEvent, String> {
        let pool = self.pool.clone();
        let conversation_id = self.conversation_id.clone();
        let files = self.services.plan_files.clone();
        let native_runtime = self.native_runtime.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            let document = db::ops::plan_review::create_or_resume_document(&mut conn, &conversation_id, now)
                .map_err(|error| error.to_string())?;
            let report = files
                .reconcile_document(&mut conn, &document.id, now)
                .map_err(|error| error.to_string())?;
            if report.conflict.is_some() {
                return Err("plan.md is in conflict and cannot be submitted".into());
            }
            let head = db::ops::plan_review::get_head_revision(&mut conn, &document.id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "plan.md has no saved revision; create it with update_plan first".to_string())?;
            let bundle = db::ops::plan_review::submit_native_head_for_review(
                &mut conn,
                &db::ops::plan_review::PlanReviewSubmit {
                    document_id: &document.id,
                    expected_generation: document.working_generation,
                    expected_head_sha256: &head.content_sha256,
                    turn_id: Some(&request.turn_id),
                    assistant_message_id: Some(&request.assistant_message_id),
                    provider_call_id: Some(&request.provider_call_id),
                    provider_kind: meridian_core::db::models::plan_review::PlanReviewProviderKind::Native,
                    now,
                },
                &native_runtime,
            )
            .map_err(|error| error.to_string())?;
            Ok(meridian_core::events::PlanReviewEvent {
                review_id: bundle.review.id,
                conversation_id,
                document_id: bundle.document.id,
                revision_id: bundle.submitted_revision.id,
                turn_id: request.turn_id,
                status: bundle.review.state,
                lock_version: bundle.review.lock_version,
                delivery_state: None,
            })
        })
        .await
        .map_err(|error| error.to_string())?
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
    origin: TurnOrigin,
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
        turn_record::begin(pool, &self.turn_id, self.conversation_id, self.origin, None).await
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
        //
        // Through `approval::retire_turn` rather than a bare `retain`: a card
        // expiring as its turn dies is claimed by whichever of the two gets
        // there first, and the loser does nothing.
        meridian_core::approval::retire_turn(
            self.services,
            &self.turn_id,
            meridian_core::approval::RetireCause::TurnGone,
        );
        // Before the event, not after: a user who sends again the instant the
        // stream ends must not be told the conversation is busy.
        self.lease.take();
        if self.armed {
            let _ = self.services.events.emit_chat(ChatStreamEvent::Stop {
                reason: ChatStopReason::Error,
                message_id: self.message_id.clone(),
                turn_id: self.turn_id.clone(),
                conversation_id: self.conversation_id.to_string(),
                input_tokens: None,
                output_tokens: None,
            });
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
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatStopRequest {
    pub conversation_id: String,
    pub turn_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn stop_chat(app: tauri::AppHandle, request: ChatStopRequest) -> Result<(), String> {
    let ChatStopRequest {
        conversation_id,
        turn_id: RequiredNullable(turn_id),
    } = request;
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

#[cfg(test)]
mod command_contract_tests {
    use super::{ChatRequest, ChatStopRequest, select_turn_setting};
    use meridian_core::turn::TurnOrigin;
    use serde_json::json;

    fn chat_request() -> serde_json::Value {
        json!({
            "conversationId": "conversation-1",
            "message": "hello",
            "turnId": null,
            "replaces": null,
            "modelOverride": null,
            "providerOverride": null,
            "thinkingLevel": null,
            "assistantId": null,
            "fast": null,
            "mode": null,
            "voice": null,
            "contextRefs": null,
            "conversationRefs": null
        })
    }

    #[test]
    fn chat_request_requires_every_nullable_key_and_rejects_unknown_fields() {
        serde_json::from_value::<ChatRequest>(chat_request()).unwrap();

        let mut missing = chat_request();
        missing.as_object_mut().unwrap().remove("mode");
        assert!(serde_json::from_value::<ChatRequest>(missing).is_err());

        let mut unknown = chat_request();
        unknown["futureField"] = json!(true);
        assert!(serde_json::from_value::<ChatRequest>(unknown).is_err());

        let mut invalid_mode = chat_request();
        invalid_mode["mode"] = json!("future_mode");
        assert!(serde_json::from_value::<ChatRequest>(invalid_mode).is_err());

        let mut incomplete_reference = chat_request();
        incomplete_reference["contextRefs"] = json!([{
            "path": "src/main.rs",
            "lineStart": null
        }]);
        assert!(serde_json::from_value::<ChatRequest>(incomplete_reference).is_err());
    }

    #[test]
    fn chat_stop_request_requires_explicit_nullable_turn_id() {
        serde_json::from_value::<ChatStopRequest>(json!({
            "conversationId": "conversation-1",
            "turnId": null
        }))
        .unwrap();
        assert!(
            serde_json::from_value::<ChatStopRequest>(json!({
                "conversationId": "conversation-1"
            }))
            .is_err()
        );
    }

    #[test]
    fn plan_review_continuation_preserves_explicit_null_instead_of_reinheriting() {
        assert_eq!(
            select_turn_setting(TurnOrigin::PlanReview, None::<String>, Some("new-default".into())),
            None
        );
        assert_eq!(
            select_turn_setting(TurnOrigin::Desktop, None, Some("new-default".to_string())),
            Some("new-default".to_string())
        );
    }
}

/// The queue's way into an ordinary turn.
///
/// Registered once at startup, because `meridian_core` cannot reach a Tauri
/// command and this is the one thing it needs from up here. Holds `Services`
/// rather than an `AppHandle`: the handle is only ever used as a locator for
/// exactly this, and taking it would put the framework back below the line for
/// no gain.
pub struct DesktopTurns(pub Services);

#[async_trait::async_trait]
impl meridian_core::services::StartTurn for DesktopTurns {
    async fn start(
        &self,
        conversation_id: &str,
        queued: &meridian_core::db::models::queue::QueuedPromptRow,
    ) -> Result<(), String> {
        let pool = self.0.db.clone();
        let queue_id = queued.id.clone();
        let queued_context = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::queued_prompt_context_item::list_prepared(&mut conn, &queue_id).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        run_turn(
            self.0.clone(),
            conversation_id.to_string(),
            Some(queued.content.clone()),
            uuid::Uuid::new_v4().to_string(),
            None,
            // Every override left to the conversation's own configuration. A
            // queued message was typed without a model picker in front of it,
            // so inventing answers here would run it under settings nobody
            // chose — and the composer's are about the turn a person is
            // starting now, which this is not.
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            // The queue froze both kinds of reference at enqueue time, so the
            // ids that produced them are not resupplied here.
            None,
            Some(queued_context),
            Some(queued.id.clone()),
            None,
            TurnOrigin::Desktop,
        )
        .await
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRequest {
    pub conversation_id: String,
    pub message: RequiredNullable<String>,
    pub turn_id: RequiredNullable<String>,
    pub replaces: RequiredNullable<String>,
    pub model_override: RequiredNullable<String>,
    pub provider_override: RequiredNullable<String>,
    pub thinking_level: RequiredNullable<meridian_core::provider::capabilities::StoredThinkingLevel>,
    pub assistant_id: RequiredNullable<String>,
    pub fast: RequiredNullable<bool>,
    pub mode: RequiredNullable<meridian_core::agent::modes::ChatMode>,
    pub voice: RequiredNullable<bool>,
    pub context_refs: RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>,
    /// Conversations the user dragged into the composer, as bare ids. Not part
    /// of `context_refs`: a dragged thread has no `@` marker in the visible
    /// text, so the reconcile-against-the-message contract cannot apply — the
    /// backend validates these on their own terms instead.
    pub conversation_refs: RequiredNullable<Vec<String>>,
}

#[tauri::command]
// Everything this turn logs is tagged with the conversation, so "why did that
// one fail" is a single query rather than a scan. skip_all because the message
// body must never reach the log.
#[tracing::instrument(
    skip_all,
    fields(
        conversation_id = %request.conversation_id,
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
///
/// `turn_id` is the front end's, minted before it sent. See
/// `TurnCoordinator::try_acquire_turn_as` for why it is not minted here.
pub async fn chat(app: tauri::AppHandle, request: ChatRequest) -> Result<(), String> {
    let ChatRequest {
        conversation_id,
        message: RequiredNullable(message),
        turn_id: RequiredNullable(turn_id),
        replaces: RequiredNullable(replaces),
        model_override: RequiredNullable(model_override),
        provider_override: RequiredNullable(provider_override),
        thinking_level: RequiredNullable(thinking_level),
        assistant_id: RequiredNullable(assistant_id),
        fast: RequiredNullable(fast),
        mode: RequiredNullable(mode),
        voice: RequiredNullable(voice),
        context_refs: RequiredNullable(context_refs),
        conversation_refs: RequiredNullable(conversation_refs),
    } = request;
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
    crate::commands::plan_review::ensure_conversation_not_waiting_review(&app.services().db, &conversation_id).await?;
    run_turn(
        app.services(),
        conversation_id,
        message,
        turn_id,
        replaces,
        model_override,
        provider_override,
        thinking_level.map(|level| level.as_str().to_string()),
        assistant_id,
        fast,
        mode.map(|mode| mode.as_str().to_string()),
        voice,
        context_refs,
        conversation_refs,
        None,
        None,
        None,
        TurnOrigin::Desktop,
    )
    .await
}

/// One desktop turn, from anything that has `Services`.
///
/// Split out of [`chat`] for the queue, which starts a turn without a window in
/// front of it. Everything here was already framework-free; what it did not
/// have was a name.
///
/// `queued` names the queue item this turn is delivering, and travels all the
/// way down to the transaction that writes the user's row so the two are spent
/// together. See `db::ops::queue::take_next` for why that has to be one write.
#[allow(clippy::too_many_arguments)]
pub async fn run_turn(
    services: Services,
    conversation_id: String,
    message: Option<String>,
    turn_id: String,
    replaces: Option<String>,
    model_override: Option<String>,
    provider_override: Option<String>,
    thinking_level: Option<String>,
    assistant_id: Option<String>,
    fast: Option<bool>,
    mode: Option<String>,
    voice: Option<bool>,
    context_refs: Option<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>,
    conversation_refs: Option<Vec<String>>,
    queued_context: Option<Vec<meridian_core::workspace::reference::PreparedContextItem>>,
    queued: Option<String>,
    accept_edits_override: Option<bool>,
    origin: TurnOrigin,
) -> Result<(), String> {
    let pool = services.db.clone();

    if origin != TurnOrigin::PlanReview {
        crate::commands::plan_review::ensure_conversation_not_waiting_review(&pool, &conversation_id).await?;
    }

    // Nothing is awaited between taking this and handing it to the guard that
    // gives it back, so there is no point at which the task can be dropped
    // holding it.
    let lease = services
        .turns
        .clone()
        .try_acquire_turn_as(&conversation_id, origin, turn_id.clone())
        .map_err(|busy| busy.to_string())?;

    // The fast check above can race a planning turn that commits its review
    // and releases the lease between our read and acquisition. Once this lease
    // is held no other ordinary turn can create a new review, so this second
    // durable read closes that gap. Plan-review continuations are the one
    // authorised path across their own barrier.
    if origin != TurnOrigin::PlanReview {
        crate::commands::plan_review::ensure_conversation_not_waiting_review(&pool, &conversation_id).await?;
    }

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
        services.clone(),
        conversation_id.clone(),
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
        context_refs,
        conversation_refs,
        queued_context,
        queued,
        accept_edits_override,
        origin,
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

    // After the record is closed, and reading it back rather than being told:
    // this function has a dozen ways out and the queue's answer depends on
    // which of them a turn took. The row is the one place that already knows.
    meridian_core::agent::queue::after_recorded_turn(&services, &conversation_id, &turn_id).await?;
    result
}

/// Resume a native conversation from the durable `exit_plan` tool result.
/// The result row is committed by the review command before this is called, so
/// no synthetic user message is added and the provider sees the same tool-call
/// continuation it would have seen had the review happened in-process.
pub async fn run_plan_review_continuation(
    services: Services,
    conversation_id: String,
    turn_id: String,
    mode: &'static str,
    runtime: db::models::plan_review::NativePlanReviewRuntimeConfig,
) -> Result<(), String> {
    verify_plan_review_workspace(&services.db, &conversation_id, &runtime).await?;
    let thinking_level = runtime.thinking_level.map(|level| level.as_str().to_string());
    run_turn(
        services,
        conversation_id,
        None,
        turn_id,
        None,
        Some(runtime.model),
        Some(runtime.provider_id),
        thinking_level,
        runtime.assistant_id,
        Some(runtime.fast),
        Some(mode.to_string()),
        None,
        None,
        None,
        None,
        None,
        Some(runtime.accept_edits),
        TurnOrigin::PlanReview,
    )
    .await
}

pub(crate) async fn verify_plan_review_workspace(
    pool: &DbPool,
    conversation_id: &str,
    runtime: &db::models::plan_review::NativePlanReviewRuntimeConfig,
) -> Result<(), String> {
    let pool = pool.clone();
    let conversation_id = conversation_id.to_string();
    let expected_project_id = runtime.project_id.clone();
    let expected_project_path = runtime.project_path.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let conversation =
            db::ops::conversation::get_conversation(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        let current_project_id = conversation.project_id.clone();
        let current_project_path = current_project_id
            .as_deref()
            .map(|project_id| db::ops::project::get_project(&mut conn, project_id))
            .transpose()
            .map_err(|e| e.to_string())?
            .and_then(|project| project.path);
        if current_project_id != expected_project_id || current_project_path != expected_project_path {
            return Err(
                "The conversation workspace changed after this plan was submitted. Restore the original project/path or request a new plan before continuing."
                    .into(),
            );
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
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
    context_refs: Option<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>,
    conversation_refs: Option<Vec<String>>,
    queued_context: Option<Vec<meridian_core::workspace::reference::PreparedContextItem>>,
    queued: Option<String>,
    accept_edits_override: Option<bool>,
    origin: TurnOrigin,
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
        origin,
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
            let effective_aid = select_turn_setting(origin, aid_override.as_deref(), conv.assistant_id.as_deref());
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
    let mut stored_context_items = load_message_context_items(&pool, &ctx).await?;

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
    // Filled in now rather than declared at entry: which model a turn actually
    // used is the first thing a provider error needs explaining.
    tracing::Span::current().record("model", resolved.model.as_str());
    tracing::Span::current().record("provider_type", resolved.provider_type.as_str());
    tracing::Span::current().record("api_format", resolved.api_format.as_str());

    // Before the field is taken out of `resolved`: the wire borrows the whole
    // row, so moving anything out of it first makes this a borrow of a
    // partially moved value.
    let provider = provider::registry::create_provider(resolved.wire())?;
    let model = resolved.model.clone();

    // Needed before the tool set is assembled, unlike the other two prefs which
    // only matter once the request parameters are built.
    let conv_mode = conv_prefs.2.clone();

    // Build messages with history (resolve template variables in system prompt)
    let file_access = build_file_access(&pool).await?;
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
        meridian_core::agent::interrupted::load_block(&pool, &services.turns, &conversation_id, &turn_id).await?;
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
    let mode = meridian_core::agent::modes::resolve(mode.as_deref().or(conv_mode.as_deref()))?;
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
    let accept_edits = accept_edits_override.unwrap_or(conv_prefs.3);
    let (conv_thinking_level, conv_fast_mode, _, _) = conv_prefs;
    let effective_level = select_turn_setting(origin, thinking_level, conv_thinking_level);
    let effective_stored_level = effective_level
        .as_deref()
        .map(meridian_core::provider::capabilities::StoredThinkingLevel::parse)
        .transpose()?;
    let effective_fast = fast.unwrap_or(conv_fast_mode);
    // Ahead of the tool set, and ahead of the compaction check: the summariser
    // and the turn it summarises have to send parameters filtered against the
    // same model, and what the model can be sent at all — whether it takes a
    // tools field — decides the tool set below.
    //
    // `context_limit` stays where it was, deliberately. The one bound above is
    // the assistant's and it sizes the memory block and the project
    // instructions; this one is the model's and shadows it for the loop. Moving
    // the shadow up with the resolution would silently resize both.
    let mut turn_params = {
        let pool2 = pool.clone();
        let assistant2 = assistant.clone();
        let pid = effective_provider_id.clone();
        let pt = resolved.provider_type.clone();
        let af = resolved.api_format.clone();
        let tp = resolved.transport_profile.clone();
        let crs = resolved.codex_request_shape;
        let mid = model.clone();
        let level = effective_level.clone();
        let fast = effective_fast;
        tokio::task::spawn_blocking(move || {
            meridian_core::agent::resolve_turn_params(
                &pool2,
                meridian_core::agent::TurnParamsResolveRequest {
                    assistant: assistant2.as_ref(),
                    provider_id: pid.as_deref(),
                    provider_type: &pt,
                    api_format: &af,

                    transport_profile: &tp,
                    codex_request_shape: crs,
                    codex_request_kind: meridian_core::provider::codex_metadata::CodexRequestKind::Turn,
                    codex_thread_source: meridian_core::provider::codex_metadata::CodexThreadSource::User,
                    model: &mid,
                    thinking_level: level.as_deref(),
                    fast,
                },
            )
        })
        .await
        .map_err(|e| e.to_string())??
    };
    // What the provider caches is a prefix, and the conversation is what keeps
    // one stable across turns. Set here rather than inside the resolver, which
    // is also what the summariser and the token estimator go through: neither
    // sends the transcript's prefix, so pinning them to it buys nothing.
    turn_params.params.cache_key = Some(conversation_id.clone());
    // The three things only this layer knows, for a row that asked for the
    // Codex shape. `take`n and put back rather than mutated in place because
    // `in_turn` consumes; `None` here is the ordinary row and stays `None`.
    if let Some(metadata) = turn_params.params.codex_turn.take() {
        turn_params.params.codex_turn = Some(metadata.in_turn(&turn_id, now_ms(), project_id.is_some()));
    }
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
    // Copied for the same reason as the two above: `turn_params.params` is moved
    // later in the turn, and a mid-turn mode switch rebuilds the tool set — so
    // the list that suppresses the local `web_search` has to survive that.
    let turn_server_tools = turn_params.params.server_tools.clone();
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
        let server_tools = turn_server_tools.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let catalog = meridian_core::agent::sub_agents::catalog(&mut conn)?;
            let input = meridian_core::agent::turn_config::TurnConfigResolveRequest {
                assistant: assistant2,
                server_tools,
                conversation_id: conv_id,
                project_id: pid,
                mode: meridian_core::agent::modes::Modes::Switchable(mode),
                sub_agents: Some(catalog.clone()),
                mcp_defs,
                exposure: meridian_core::agent::turn_config::ToolExposure::when(supports_tools),
                persona: persona2,
                context_blocks: blocks,
            };
            let turn = meridian_core::agent::turn_config::resolve(&mut conn, &registry, input)?;
            Ok::<_, String>((turn, catalog))
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

    // The backend resolves the token again to validate the structured copy.
    // This ensures a stale or forged DTO cannot attach a path the message did
    // not name. A required explicit null means no selected references; it does
    // not activate a parser fallback.
    let prepared_context = match queued_context {
        Some(frozen) => frozen,
        None => {
            let parsed_refs = message
                .as_deref()
                .map(meridian_core::workspace::reference::parse_message_references)
                .unwrap_or_default();
            let effective_refs = meridian_core::workspace::reference::reconcile_references(
                context_refs.unwrap_or_default(),
                parsed_refs,
            )?;
            if message.is_none() && !effective_refs.is_empty() {
                return Err("regeneration cannot introduce new workspace references".into());
            }
            let mut items = if effective_refs.is_empty() {
                Vec::new()
            } else {
                let reference_context =
                    reference_tool_context(project_path.clone(), file_access.clone(), cancel.clone());
                meridian_core::workspace::reference::prepare_references(
                    &reference_context,
                    &effective_refs,
                    &budget.counter,
                    context_limit,
                )
                .await?
            };
            // Dragged-in conversations freeze through the same carrier, spending
            // what the workspace references left of the same per-turn budget.
            let conv_refs = conversation_refs.unwrap_or_default();
            if !conv_refs.is_empty() {
                // The symmetric twin of the workspace check above: a regenerate
                // has no new user message for a new reference to belong to.
                if message.is_none() {
                    return Err("regeneration cannot introduce new conversation references".into());
                }
                let spent: usize = items.iter().map(|item| item.token_count.max(0) as usize).sum();
                let budget_left =
                    meridian_core::workspace::reference::turn_context_token_limit(context_limit).saturating_sub(spent);
                let pool2 = pool.clone();
                let current = conversation_id.clone();
                let frozen = tokio::task::spawn_blocking(move || {
                    let mut conn = get_conn(&pool2)?;
                    meridian_core::agent::conversation_excerpt::freeze_conversation_refs(
                        &mut conn,
                        &current,
                        &conv_refs,
                        budget_left,
                    )
                })
                .await
                .map_err(|e| e.to_string())??;
                items.extend(frozen);
            } else if message.is_some()
                && let Some(replaced) = replaces.as_deref()
            {
                // An edit re-extracts `@` from the new text, but a dragged-in
                // conversation left no marker there to re-extract — without
                // this, editing a message would silently drop its references.
                // The frozen bytes are copied from the message being replaced,
                // so the replay stays word-for-word; a re-freeze would show the
                // thread as it is now, which is not what the edited question
                // was asked about.
                let pool2 = pool.clone();
                let replaced = replaced.to_string();
                let copied = tokio::task::spawn_blocking(move || {
                    let mut conn = get_conn(&pool2)?;
                    let rows = db::ops::message_context_item::list_for_message(&mut conn, &replaced)
                        .map_err(|e| e.to_string())?;
                    Ok::<_, String>(
                        rows.into_iter()
                            .filter(|row| {
                                row.kind
                                    == meridian_core::workspace::reference::MessageContextKind::Conversation.as_str()
                            })
                            .map(|row| meridian_core::workspace::reference::PreparedContextItem {
                                id: uuid::Uuid::new_v4().to_string(),
                                kind: meridian_core::workspace::reference::MessageContextKind::Conversation,
                                content: row.content,
                                display_path: row.display_path,
                                line_start: row.line_start,
                                line_end: row.line_end,
                                content_hash: row.content_hash,
                                byte_count: row.byte_count,
                                line_count: row.line_count,
                                token_count: row.token_count,
                                truncated: row.truncated,
                                metadata: row.metadata,
                            })
                            .collect::<Vec<_>>(),
                    )
                })
                .await
                .map_err(|e| e.to_string())??;
                items.extend(copied);
            }
            items
        }
    };

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
                .await?;
        let pre_msgs = build_messages_with_context_items(
            system_prompt.trim(),
            &ctx,
            trailing_with_user_context(
                probe.as_ref().and_then(|i| i.text.as_deref()),
                interrupted.as_ref().map(|r| r.text()),
                payload_message.as_deref().unwrap_or(""),
                None,
                &prepared_context,
            ),
            &Default::default(),
            &stored_context_items,
        )?;
        budget.update_estimate(&pre_msgs);
        if budget.needs_compact() && ctx.path.len() > keep_recent * 2 + 2 {
            services
                .events
                .emit_compact_start(&CompactStartEvent {
                    conversation_id: conversation_id.clone(),
                    mid_turn: false,
                    trigger: CompactTrigger::Threshold,
                })
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
                        .emit_compact_done(&CompactDoneEvent {
                            conversation_id: conversation_id.clone(),
                            mid_turn: false,
                            trigger: CompactTrigger::Threshold,
                            outcome: CompactOutcome::Completed,
                            tokens_reclaimed: None,
                            error: None,
                        })
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
                        .emit_compact_done(&CompactDoneEvent {
                            conversation_id: conversation_id.clone(),
                            mid_turn: false,
                            trigger: CompactTrigger::Threshold,
                            outcome: CompactOutcome::Failed,
                            tokens_reclaimed: None,
                            error: Some(e),
                        })
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
    if compacted {
        stored_context_items = load_message_context_items(&pool, &ctx).await?;
    }

    // After compaction, never before it: compaction moves the summary anchor, and
    // with it what `live()` returns. A plan made against the old path would be
    // reasoning about rows the model can no longer see — and since a cut history
    // is exactly the signal that everything has to be re-sent, getting this
    // ordering wrong is silent rather than loud.
    let t0 = now_ms();
    let injection = meridian_core::agent::plan_injection_async(&pool, memory_request, ctx.live().to_vec(), t0).await?;
    let injected = injection.as_ref().and_then(|i| i.text.clone());

    let mut chat_messages = build_messages_with_context_items(
        system_prompt.trim(),
        &ctx,
        trailing_with_user_context(
            injected.as_deref(),
            interrupted.as_ref().map(|r| r.text()),
            payload_message.as_deref().unwrap_or(""),
            None,
            &prepared_context,
        ),
        &Default::default(),
        &stored_context_items,
    )?;
    resolve_sticker_parts_in_messages(
        &mut chat_messages,
        &pool,
        Some(services.paths.data_dir.as_path()),
        supports_images,
    )?;
    let files_root = Some(meridian_core::files::files_dir(&services.paths.data_dir));
    resolve_file_uris_in_messages(&mut chat_messages, files_root.as_deref())?;
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
        // Read before the shadowing clone below carries it into the closure.
        let delivered_from_queue = queued.is_some();
        let queued = queued.clone();
        let context_items = prepared_context.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            use diesel::Connection;
            let mut conn = get_conn(&pool)?;
            // One transaction, because a queued message and the row it becomes
            // must not come apart: killed in between, either the item is still
            // queued and no row exists — deliver it again, safely — or the row
            // is in the transcript and the item is spent.
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                db::ops::message::append_message(
                    conn,
                    &MessageInsert {
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
                        server_tool_calls: None,
                        provider_name: None,
                        response_model_id: None,
                    },
                    parent.as_deref(),
                )?;
                db::ops::emoji::link_stickers_in_content(conn, &msg_id, &msg)?;
                let rows = context_items
                    .iter()
                    .enumerate()
                    .map(
                        |(position, item)| db::models::message_context_item::MessageContextItemInsert {
                            id: &item.id,
                            message_id: &msg_id,
                            position: position as i32,
                            kind: item.kind.as_str(),
                            content: &item.content,
                            display_path: item.display_path.as_deref(),
                            line_start: item.line_start,
                            line_end: item.line_end,
                            content_hash: &item.content_hash,
                            byte_count: item.byte_count,
                            line_count: item.line_count,
                            token_count: item.token_count,
                            truncated: item.truncated,
                            metadata: item.metadata.as_deref(),
                            created_at: now,
                        },
                    )
                    .collect::<Vec<_>>();
                db::ops::message_context_item::insert_many(conn, &rows)?;
                if let Some(queued) = &queued {
                    // Refuses an item somebody else already took, or that has
                    // been held or dragged out of first place since it was
                    // read, and rolls the row back with it. The turn lease
                    // makes the first all but impossible; "all but" is the
                    // wrong guarantee for a message that might say "delete the
                    // old migration", and the lease says nothing at all about
                    // the other two.
                    //
                    // `None`: a turn of its own takes whatever mode is at the
                    // front, because with nothing running there is nothing for
                    // an `interject` to wait for.
                    if db::ops::queue::mark_dispatched(conn, &conv_id, queued, None, &turn, now)? == 0 {
                        return Err(diesel::result::Error::RollbackTransaction);
                    }
                    db::ops::queue::mark_settled(conn, queued, Some(&msg_id), now)?;
                    db::ops::queued_prompt_context_item::delete_for_queue(conn, queued)?;
                }
                Ok(())
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        // The row exists and the item has been spent, both in the transaction
        // above. Nothing else will say so until the turn ends, which for a
        // queued message is the whole of the wait: without this the front end
        // holds the item at `queued` for the length of the turn — stacked above
        // the composer, offering a delete that answers "the message has already
        // been sent" — while the message it became is on no screen at all.
        if delivered_from_queue {
            meridian_core::agent::queue::announce_delivered(&services, &conversation_id);
        }
        parent_cursor = Some(user_msg_id.clone());
    }

    // Shell preference
    let (shell_type, sandbox_pref) =
        {
            let pool2 = pool.clone();
            tokio::task::spawn_blocking(move || {
            let mut conn = match pool2.get() {
                Ok(c) => c,
                Err(e) => {
                    // The sandbox fallback is fail-safe — absent means enabled.
                    // The shell is not: the turn would run commands through the
                    // platform default instead of the one the user picked, with
                    // nothing on screen to say so.
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
            Some((shell, sandbox))
        })
        .await
        .ok()
        .flatten()
        .unwrap_or((None, None))
        };
    let sleep_enabled = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let stored = db::ops::preference::get_preference(&mut conn, "sleep_inhibitor.enabled")
                .map_err(|error| error.to_string())?;
            db::ops::preference::parse_bool_preference("sleep_inhibitor.enabled", stored.as_deref(), true)
        })
        .await
        .map_err(|error| error.to_string())??
    };
    // The same preference key, with more values in it. A second key would be
    // one that could disagree with the first, and there is no reading of
    // "enabled = false, mode = container" that is not a bug.
    // Missing still means enabled: sandbox-by-default on Windows.
    // Keep the machine awake for the rest of the turn (RAII; missing pref = enabled).
    let _sleep_guard = sleep_enabled.then(|| services.sleep.begin_turn());
    let tool_secrets = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        tokio::task::spawn_blocking(move || meridian_core::agent::build_tool_secrets(&secrets2, &pool2))
            .await
            .map_err(|e| e.to_string())?
    };
    // **The error is returned rather than swallowed into `None`.** A
    // conversation set to run commands in a container and handed no policy
    // would run them on the host, silently — which is the failure the setting
    // exists to prevent, and the user would never learn of it. Failing the turn
    // costs them a message and tells them what is wrong.
    #[cfg(not(target_os = "android"))]
    let sandbox_policy = meridian_core::sandbox::resolve_sandbox_policy(
        meridian_core::sandbox::ExecutionMode::parse(sandbox_pref.as_deref())?,
        project_path.as_deref(),
        &conversation_id,
        Some(services.containers.clone()),
    )
    .map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    let _ = sandbox_pref;
    // The shadow file journal for this turn: what the file primitives append
    // their observed transitions to. Desktop-only wiring for now — SAF paths
    // have no canonical key, so Android runs without one and its writes
    // surface as `external` on the next desktop observation.
    #[cfg(not(target_os = "android"))]
    let journal = Some(meridian_core::journal::capture::JournalCtx::new(
        pool.clone(),
        meridian_core::journal::journal_root(&services.paths.data_dir),
        conversation_id.clone(),
        turn_id.clone(),
        meridian_core::turn::TurnOrigin::Desktop.as_str().to_string(),
        Some(model.clone()),
        project_id.clone(),
        project_path.as_deref().map(std::path::PathBuf::from),
        services.journal_shared.clone(),
    ));
    #[cfg(target_os = "android")]
    let journal = None;
    let tool_context = tools::ToolContext {
        working_directory: project_path.clone(),
        shell: shell_type
            .map(|value| tools::ShellType::parse(&value))
            .transpose()?
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
        journal,
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
        server_tools: turn_server_tools.clone(),
        native_runtime: db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: resolved.provider_id.clone(),
            model: model.clone(),
            assistant_id: assistant.as_ref().map(|assistant| assistant.id.clone()),
            thinking_level: effective_stored_level,
            fast: effective_fast,
            project_id: project_id.clone(),
            project_path: project_path.clone(),
            accept_edits,
        },
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
    let asker = super::approval_adapter::DesktopApprovals {
        services: services.clone(),
        cancel: cancel.clone(),
        turn_id: turn_id.clone(),
        conversation_id: conversation_id.clone(),
        // The user started this turn themselves; its cards belong here.
        bubble: None,
    };
    // Inert unless the user turned automatic review on and named a model.
    // `unattended` is false: there is a window, so a review that cannot answer
    // falls back to drawing the card rather than refusing.
    let approvals = meridian_core::agent::auto_review::AutoReviewed::wrap(
        &asker,
        meridian_core::agent::auto_review::Context {
            services: services.clone(),
            conversation_id: conversation_id.clone(),
            turn_id: turn_id.clone(),
            working_directory: tool_context.working_directory.clone(),
            // The turn's own boundary, so the escalating pass can read exactly
            // what the turn could and nothing more. On Android that is the SAF
            // whitelist rather than the whole disk.
            file_access: tool_context.file_access.clone(),
            // One person, and they own the machine.
            multi_party: false,
            unattended: false,
        },
    )?;
    // Outermost, so it sees the reviewer's own refusals as well as the ones the
    // user gave. Underneath it, the denials cheapest to repeat — the ones
    // nothing stopped to ask about — would be exactly the ones it missed.
    let approvals = meridian_core::agent::denied::DeniedMemory::wrap(&approvals);
    // Per turn, because a row it writes belongs to the turn it interrupted —
    // which is where the model reads it.
    // Wrapped, so that taking one off the queue mid-turn reaches the window.
    // The row and the item are spent in one transaction inside the port; what
    // the wrapper adds is the only thing that says so.
    let interjections = meridian_core::agent::queue::Announcing::wrap(
        services.events.clone(),
        meridian_core::agent::queue::Interjections::new(pool.clone(), conversation_id.clone(), turn_id.clone()),
    );
    let outcome = engine::run_turn(
        &engine::TurnServices {
            pool: &pool,
            tools: tool_registry,
            mcp: &mcp,
            redaction: &services.redaction,
            redaction_mappings: &services.redaction_mappings,
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
            files_root,
            interrupted,
            compaction: engine::CompactionPolicy::Desktop {
                enabled: auto_compact,
                breaker: circuit_breaker.clone(),
            },
            // The turn prices itself as it goes. It has to: a model with tiered
            // rates cannot be billed from the totals this loop leaves behind,
            // because the totals are a sum over requests that were each priced
            // on their own size.
            pricing: model_config
                .as_ref()
                .map(meridian_core::agent::pricing::TurnPricing::of)
                .transpose()
                .map_err(|error| error.to_string())?
                .flatten(),
        },
        engine::TurnPorts {
            emit: Some(&emitter),
            approvals: &approvals,
            // The desktop streams every chunk to the window as it arrives and
            // runs no tools outside the registry and MCP. Each `None` is the
            // absence of the thing, not a feature turned off.
            interim: None,
            surface_tools: None,
            // Not an inbox: the desktop's is a table, so a message queued for
            // this turn survives the app being killed and is still there when
            // it comes back. Draining is what spends it.
            steering: Some(&interjections),
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
    let turn_aborted = outcome.progress.aborted;
    let waiting_review = outcome.progress.waiting_review.clone();
    let last_assistant_text = outcome.reply?;

    // This is the only place that knows how the loop was left, and the three
    // ways out are genuinely different: the loop guard cutting a repeating
    // model short is a turn that did not finish, cancellation is a decision,
    // and neither is a clean ending. Recording the first as `done` would have
    // the row claim a completed turn while its own stop event says it was
    // aborted.
    let (status, error) = if waiting_review.is_some() {
        (TurnStatus::WaitingReview, None)
    } else if turn_aborted {
        (TurnStatus::Failed, Some(ERROR_LOOP_DETECTED))
    } else if cancel.is_cancelled() {
        (TurnStatus::Cancelled, None)
    } else {
        (TurnStatus::Done, None)
    };
    if waiting_review.is_none() {
        turn_record::finish(&pool, &turn_id, status, error).await;
    }

    let stop_reason = if turn_aborted {
        ChatStopReason::LoopDetected
    } else if cancel.is_cancelled() {
        ChatStopReason::Cancelled
    } else {
        ChatStopReason::EndTurn
    };
    // Released ahead of the event it announces, not after it.
    stop_guard.release();
    services.events.emit_chat(ChatStreamEvent::Stop {
        reason: stop_reason,
        message_id: Some(assistant_msg_id.clone()),
        turn_id: turn_id.clone(),
        conversation_id: conversation_id.clone(),
        input_tokens: Some(total_input_tokens),
        output_tokens: Some(total_output_tokens),
    })?;
    stop_guard.disarm();

    // Auto-generate title if first message
    if conv_title.is_none() && waiting_review.is_none() {
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
        // `chat_with_tools` with an empty list, for the usage `chat` throws
        // away. Naming a conversation is small and constant, but it happens on
        // every first exchange and used to appear on no bill at all.
        if let Ok(answer) = provider.chat_with_tools(title_messages, Vec::new(), title_params).await {
            let title = answer.text.trim().trim_matches('"').trim_matches('\'').to_string();
            let title_usage = answer.usage;
            if !title.is_empty() {
                let pool = pool.clone();
                let conv_id = conversation_id.clone();
                let assistant_row = assistant_msg_id.clone();
                let (pid, pname, mid) = (
                    resolved.provider_id.clone(),
                    resolved.provider_name.clone(),
                    model.clone(),
                );
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::conversation::update_title(&mut conn, &conv_id, &title, now_ms());
                        // Filed against the reply the title was taken from —
                        // there is no row of its own, and this is the one it
                        // describes.
                        if let Some(usage) = title_usage {
                            let cost = db::ops::audit::SideRequestCost {
                                role: db::ops::audit::TITLE_ROLE,
                                message_id: &assistant_row,
                                conversation_id: &conv_id,
                                turn_id: None,
                                provider_id: Some(&pid),
                                provider_name: Some(&pname),
                                model_id: Some(&mid),
                                usage: db::models::message::MessageUsage {
                                    input_tokens: usage.prompt_tokens,
                                    output_tokens: usage.completion_tokens,
                                    cache_read_tokens: usage.cache_read_tokens,
                                    cache_write_tokens: usage.cache_write_tokens,
                                    server_tool_calls: usage.billable_tool_calls,
                                },
                                peak_prompt_tokens: usage.prompt_tokens,
                                summary: "title",
                            };
                            if let Err(e) = db::ops::audit::record_side_request(&mut conn, cost) {
                                tracing::warn!(error = %e, "could not record what the title cost");
                            }
                        }
                    }
                })
                .await;
                services.events.emit_conversation_updated(&conversation_id).ok();
            }
        }
    }

    Ok(())
}
