//! Durable plan-review commands.
//!
//! SQLite owns the review state.  The command layer is deliberately an exact
//! projection rather than a serialization of persistence rows: stored JSON is
//! decoded here, nullable transcript identities are rejected for interactive
//! reviews, and every mutation uses the generation/hash CAS supplied by the
//! editor.

use std::collections::HashSet;

use diesel::Connection;
use meridian_core::db;
use meridian_core::db::models::message::MessageInsert;
use meridian_core::db::models::plan_review::{
    PlanCommentAnchorKind, PlanCommentState, PlanDeliveryState, PlanDeliveryTarget, PlanMaterializationState,
    PlanReviewDraftMode, PlanReviewProviderKind, PlanReviewState,
};
use meridian_core::db::ops::plan_review as ops;
use meridian_core::events::PlanReviewEvent;
use meridian_core::util::{get_conn, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;

const PLAN_EDITOR_SCHEMA_VERSION: i32 = 1;
const PLAN_EDITOR_SCHEMA_HASH: &str = "meridian-plan-markdown-v1";

fn emit_review_update_best_effort(events: &meridian_core::events::EventBus, event: &PlanReviewEvent) {
    if let Err(error) = events.emit_plan_review_updated(event) {
        tracing::warn!(%error, review_id = %event.review_id, "could not publish durable plan-review update");
    }
}

pub async fn ensure_conversation_not_waiting_review(pool: &db::DbPool, conversation_id: &str) -> Result<(), String> {
    let pool = pool.clone();
    let conversation_id = conversation_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        if ops::has_conversation_barrier(&mut conn, &conversation_id).map_err(|error| error.to_string())? {
            Err("This conversation is waiting for plan review. Approve it or request changes before sending another message.".into())
        } else {
            Ok(())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewReadRequest {
    pub review_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanRevisionListRequest {
    pub document_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanReviewDraftModeRequest {
    Rich,
    Source,
}

impl From<PlanReviewDraftModeRequest> for PlanReviewDraftMode {
    fn from(value: PlanReviewDraftModeRequest) -> Self {
        match value {
            PlanReviewDraftModeRequest::Rich => Self::Rich,
            PlanReviewDraftModeRequest::Source => Self::Source,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanCommentStateRequest {
    Draft,
    Active,
    Orphaned,
    Submitted,
    Deleted,
}

impl From<PlanCommentStateRequest> for PlanCommentState {
    fn from(value: PlanCommentStateRequest) -> Self {
        match value {
            PlanCommentStateRequest::Draft => Self::Draft,
            PlanCommentStateRequest::Active => Self::Active,
            PlanCommentStateRequest::Orphaned => Self::Orphaned,
            PlanCommentStateRequest::Submitted => Self::Submitted,
            PlanCommentStateRequest::Deleted => Self::Deleted,
        }
    }
}

/// The editor's two anchor coordinate spaces are intentionally different
/// tagged variants.  A future anchor shape must be added on both sides of the
/// IPC boundary rather than disappearing into an opaque JSON column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlanCommentAnchor {
    ProsemirrorRange {
        from: i64,
        to: i64,
        quote: String,
        prefix: String,
        suffix: String,
    },
    SourceRange {
        from: i64,
        to: i64,
        quote: String,
        prefix: String,
        suffix: String,
    },
}

impl PlanCommentAnchor {
    fn stored_kind(&self) -> PlanCommentAnchorKind {
        match self {
            Self::ProsemirrorRange { .. } => PlanCommentAnchorKind::Rich,
            Self::SourceRange { .. } => PlanCommentAnchorKind::Source,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanCommentDraftRequest {
    pub id: String,
    pub state: PlanCommentStateRequest,
    pub anchor: PlanCommentAnchor,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanEditorSchemaFallbackRequest {
    pub from_version: i32,
    pub from_hash: RequiredNullable<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDraftSaveRequest {
    pub review_id: String,
    pub expected_generation: i64,
    pub mode: PlanReviewDraftModeRequest,
    pub base_editor_json: RequiredNullable<Value>,
    pub editor_json: RequiredNullable<Value>,
    pub source_text: RequiredNullable<String>,
    pub normalized_markdown: String,
    pub base_normalized_markdown: String,
    pub comments: Vec<PlanCommentDraftRequest>,
    pub global_note: RequiredNullable<String>,
    pub selection: RequiredNullable<PlanCommentAnchor>,
    pub editor_schema_version: RequiredNullable<i32>,
    pub editor_schema_hash: RequiredNullable<String>,
    pub editor_schema_fallback: RequiredNullable<PlanEditorSchemaFallbackRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDraftDiscardRequest {
    pub review_id: String,
    pub expected_generation: i64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanReviewDecisionActionRequest {
    Approve,
    RequestChanges,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDecisionRequest {
    pub review_id: String,
    pub decision_id: String,
    /// This is the draft generation, not the review row's lock version.  The
    /// handler reads the latter in the same transaction and passes both CAS
    /// values to storage.
    pub expected_generation: i64,
    pub expected_draft_hash: String,
    pub action: PlanReviewDecisionActionRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDeliveryReadRequest {
    pub review_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDeliveryContinueRequest {
    pub delivery_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanFileConflictActionRequest {
    RestoreDb,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanFileConflictResolveRequest {
    pub document_id: String,
    pub action: PlanFileConflictActionRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanDocumentInfoResponse {
    pub id: String,
    pub conversation_id: String,
    pub state: String,
    pub head_revision_id: Option<String>,
    pub approved_revision_id: Option<String>,
    pub working_generation: i64,
    pub file_rel_path: String,
    pub file_sync_state: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanRevisionInfoResponse {
    pub id: String,
    pub document_id: String,
    pub revision_no: i64,
    pub parent_revision_id: Option<String>,
    pub author_kind: String,
    pub content_markdown: String,
    pub content_sha256: String,
    pub patch: Option<String>,
    pub responding_to_suggestion_revision_id: Option<String>,
    pub assistant_message_id: Option<String>,
    pub provider_call_id: Option<String>,
    pub editor_json: Option<Value>,
    pub created_at: i64,
}

pub type PlanRevisionListResponse = Vec<PlanRevisionInfoResponse>;

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewSessionInfoResponse {
    pub id: String,
    pub document_id: String,
    pub submitted_revision_id: String,
    pub state: String,
    pub decision_id: Option<String>,
    pub suggestion_revision_id: Option<String>,
    pub assistant_message_id: String,
    pub provider_call_id: String,
    pub turn_id: String,
    pub lock_version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewSummaryInfoResponse {
    pub review_id: String,
    pub conversation_id: String,
    pub document_id: String,
    pub revision_id: String,
    pub assistant_message_id: String,
    pub provider_call_id: String,
    pub turn_id: String,
    pub status: String,
    pub lock_version: i64,
    pub delivery_state: Option<String>,
}

pub type PlanReviewSummaryListResponse = Vec<PlanReviewSummaryInfoResponse>;

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewDraftInfoResponse {
    pub review_id: String,
    pub base_revision_id: String,
    pub generation: i64,
    pub mode: String,
    pub base_editor_json: Option<Value>,
    pub draft_editor_json: Option<Value>,
    pub source_text: Option<String>,
    pub base_normalized_markdown: String,
    pub draft_normalized_markdown: String,
    pub draft_sha256: String,
    pub global_note: Option<String>,
    pub selection: Option<PlanCommentAnchor>,
    pub editor_schema_version: Option<i32>,
    pub editor_schema_hash: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanCommentInfoResponse {
    pub id: String,
    pub review_id: String,
    pub position: i32,
    pub state: String,
    pub anchor: PlanCommentAnchor,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub type PlanCommentListResponse = Vec<PlanCommentInfoResponse>;

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewDeliveryInfoResponse {
    pub id: String,
    pub review_id: String,
    pub target: String,
    pub state: String,
    pub payload: Value,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewInfoResponse {
    pub document: PlanDocumentInfoResponse,
    pub review: PlanReviewSessionInfoResponse,
    pub submitted_revision: PlanRevisionInfoResponse,
    pub parent_revision: Option<PlanRevisionInfoResponse>,
    pub draft: PlanReviewDraftInfoResponse,
    pub comments: PlanCommentListResponse,
    pub delivery: Option<PlanReviewDeliveryInfoResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewDraftSaveResponse {
    pub review_id: String,
    pub generation: i64,
    pub draft_sha256: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanReviewDecisionResponse {
    pub review_id: String,
    pub state: String,
    pub delivery_state: Option<String>,
    pub continuation_turn_id: Option<String>,
}

fn decode_json(value: Option<String>, field: &str) -> Result<Option<Value>, String> {
    value
        .map(|raw| serde_json::from_str(&raw).map_err(|error| format!("stored {field} is invalid JSON: {error}")))
        .transpose()
}

fn decode_anchor(value: Option<String>, field: &str) -> Result<Option<PlanCommentAnchor>, String> {
    value
        .map(|raw| serde_json::from_str(&raw).map_err(|error| format!("stored {field} is invalid: {error}")))
        .transpose()
}

fn revision_response(row: db::models::plan_review::PlanRevisionRow) -> Result<PlanRevisionInfoResponse, String> {
    let author_kind = row.author_kind()?.as_str().to_string();
    let editor_json = decode_json(row.editor_json, "plan revision editor_json")?;
    Ok(PlanRevisionInfoResponse {
        id: row.id,
        document_id: row.document_id,
        revision_no: row.revision_no,
        parent_revision_id: row.parent_revision_id,
        author_kind,
        content_markdown: row.content_markdown,
        content_sha256: row.content_sha256,
        patch: row.patch,
        responding_to_suggestion_revision_id: row.responding_to_suggestion_revision_id,
        assistant_message_id: row.source_message_id,
        provider_call_id: row.source_call_id,
        editor_json,
        created_at: row.created_at,
    })
}

fn document_response(
    conn: &mut diesel::sqlite::SqliteConnection,
    row: db::models::plan_review::PlanDocumentRow,
) -> Result<PlanDocumentInfoResponse, String> {
    let state = row.state()?.as_str().to_string();
    let sync = ops::latest_materialization(conn, &row.id)
        .map_err(|error| error.to_string())?
        .map(|row| row.state())
        .transpose()?
        .unwrap_or(PlanMaterializationState::Applied)
        .as_str()
        .to_string();
    Ok(PlanDocumentInfoResponse {
        id: row.id,
        conversation_id: row.conversation_id,
        state,
        head_revision_id: row.head_revision_id,
        approved_revision_id: row.approved_revision_id,
        working_generation: row.working_generation,
        file_rel_path: row.file_rel_path,
        file_sync_state: sync,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn review_session_response(
    row: db::models::plan_review::PlanReviewSessionRow,
) -> Result<PlanReviewSessionInfoResponse, String> {
    let state = row.state()?.as_str().to_string();
    let assistant_message_id = row
        .assistant_message_id
        .ok_or_else(|| format!("plan review {} has no transcript assistant message", row.id))?;
    let provider_call_id = row
        .provider_call_id
        .ok_or_else(|| format!("plan review {} has no provider call id", row.id))?;
    let turn_id = row
        .turn_id
        .ok_or_else(|| format!("plan review {} has no submitting turn", row.id))?;
    Ok(PlanReviewSessionInfoResponse {
        id: row.id,
        document_id: row.document_id,
        submitted_revision_id: row.submitted_revision_id,
        state,
        decision_id: row.decision_id,
        suggestion_revision_id: row.suggestion_revision_id,
        assistant_message_id,
        provider_call_id,
        turn_id,
        lock_version: row.lock_version,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn draft_response(row: db::models::plan_review::PlanReviewDraftRow) -> Result<PlanReviewDraftInfoResponse, String> {
    let mode = row.mode()?.as_str().to_string();
    let base_editor_json = decode_json(row.base_editor_json, "plan draft base_editor_json")?;
    let draft_editor_json = decode_json(row.draft_editor_json, "plan draft draft_editor_json")?;
    let selection = decode_anchor(row.selection_json, "plan draft selection")?;
    Ok(PlanReviewDraftInfoResponse {
        review_id: row.review_id,
        base_revision_id: row.base_revision_id,
        generation: row.generation,
        mode,
        base_editor_json,
        draft_editor_json,
        source_text: row.source_text,
        base_normalized_markdown: row.base_normalized_markdown,
        draft_normalized_markdown: row.draft_normalized_markdown,
        draft_sha256: row.draft_sha256,
        global_note: row.global_note,
        selection,
        editor_schema_version: row.editor_schema_version,
        editor_schema_hash: row.editor_schema_hash,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn comment_response(row: db::models::plan_review::PlanCommentRow) -> Result<PlanCommentInfoResponse, String> {
    let state = row.state()?.as_str().to_string();
    let stored_kind = row.anchor_kind()?;
    let anchor: PlanCommentAnchor = serde_json::from_str(&row.anchor_json)
        .map_err(|error| format!("stored plan comment anchor is invalid: {error}"))?;
    if anchor.stored_kind() != stored_kind {
        return Err(format!(
            "plan comment {} anchor kind disagrees with its payload",
            row.id
        ));
    }
    Ok(PlanCommentInfoResponse {
        id: row.id,
        review_id: row.review_id,
        position: row.position,
        state,
        anchor,
        body: row.body,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn delivery_response(
    row: db::models::plan_review::PlanReviewDeliveryRow,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    let target = row.target()?.as_str().to_string();
    let state = row.state()?.as_str().to_string();
    let payload = serde_json::from_str(&row.payload_json)
        .map_err(|error| format!("stored plan review delivery payload is invalid: {error}"))?;
    Ok(PlanReviewDeliveryInfoResponse {
        id: row.id,
        review_id: row.review_id,
        target,
        state,
        payload,
        error: row.error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn bundle_response(
    conn: &mut diesel::sqlite::SqliteConnection,
    bundle: ops::PlanReviewBundle,
) -> Result<PlanReviewInfoResponse, String> {
    // A review may contain several update_plan patches.  Its useful baseline
    // is therefore the preceding submitted review, not the immediate parent
    // revision (which would expose only the last patch in the batch).
    let previous_review = ops::list_reviews(conn, &bundle.document.id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .take_while(|review| review.id != bundle.review.id)
        .last();
    let parent_revision = previous_review
        .as_ref()
        .map(|review| ops::get_revision(conn, &review.submitted_revision_id))
        .transpose()
        .map_err(|error| error.to_string())?;
    let full_review_patch = parent_revision
        .as_ref()
        .and_then(|parent| ops::markdown_diff(&parent.content_markdown, &bundle.submitted_revision.content_markdown));
    let mut submitted_revision = revision_response(bundle.submitted_revision)?;
    if previous_review.is_some() {
        submitted_revision.patch = full_review_patch;
    }
    let parent_revision = parent_revision.map(revision_response).transpose()?;
    let delivery = bundle
        .deliveries
        .into_iter()
        .last()
        .map(delivery_response)
        .transpose()?;
    Ok(PlanReviewInfoResponse {
        document: document_response(conn, bundle.document)?,
        review: review_session_response(bundle.review)?,
        submitted_revision,
        parent_revision,
        draft: draft_response(bundle.draft)?,
        comments: bundle
            .comments
            .into_iter()
            .map(comment_response)
            .collect::<Result<Vec<_>, _>>()?,
        delivery,
    })
}

fn event_for(
    conversation_id: String,
    review: &db::models::plan_review::PlanReviewSessionRow,
    delivery: Option<&db::models::plan_review::PlanReviewDeliveryRow>,
) -> Result<PlanReviewEvent, String> {
    Ok(PlanReviewEvent {
        review_id: review.id.clone(),
        conversation_id,
        document_id: review.document_id.clone(),
        revision_id: review.submitted_revision_id.clone(),
        turn_id: review.turn_id.clone().unwrap_or_default(),
        status: review.state()?.as_str().to_string(),
        lock_version: review.lock_version,
        delivery_state: delivery
            .map(|row| row.state())
            .transpose()?
            .map(|state| state.as_str().to_string()),
    })
}

/// Build review/card links only for reviews whose submitting assistant message
/// is on the snapshot's active branch. Legacy artifacts have no transcript
/// identity and remain available through the migration tables, but cannot be
/// attached to a particular tool card without inventing one.
pub fn summaries_for_conversation(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
    visible_message_ids: &HashSet<&str>,
) -> Result<PlanReviewSummaryListResponse, String> {
    let mut summaries = Vec::new();
    for row in ops::list_reviews_for_conversation(conn, conversation_id).map_err(|error| error.to_string())? {
        let (Some(assistant_message_id), Some(provider_call_id), Some(turn_id)) = (
            row.assistant_message_id.clone(),
            row.provider_call_id.clone(),
            row.turn_id.clone(),
        ) else {
            // Legacy imports deliberately have no transcript identity and are
            // orphaned, so there is neither a card nor an active barrier to
            // recover through this projection.
            continue;
        };
        let status = row.state()?;
        let delivery_state = ops::get_review_bundle(conn, &row.id)
            .map_err(|error| error.to_string())?
            .deliveries
            .into_iter()
            .last()
            .map(|delivery| delivery.state())
            .transpose()?;
        let active_barrier = status == PlanReviewState::Pending
            || delivery_state.is_some_and(|state| {
                matches!(
                    state,
                    PlanDeliveryState::Queued
                        | PlanDeliveryState::Dispatched
                        | PlanDeliveryState::Held
                        | PlanDeliveryState::InDoubt
                )
            });
        if !active_barrier && !visible_message_ids.contains(assistant_message_id.as_str()) {
            continue;
        }
        summaries.push(PlanReviewSummaryInfoResponse {
            review_id: row.id,
            conversation_id: conversation_id.to_string(),
            document_id: row.document_id,
            revision_id: row.submitted_revision_id,
            assistant_message_id,
            provider_call_id,
            turn_id,
            status: status.as_str().to_string(),
            lock_version: row.lock_version,
            delivery_state: delivery_state.map(|state| state.as_str().to_string()),
        });
    }
    Ok(summaries)
}

#[tauri::command]
pub async fn get_plan_review(
    app: tauri::AppHandle,
    request: PlanReviewReadRequest,
) -> Result<PlanReviewInfoResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let bundle = ops::get_review_bundle(&mut conn, &request.review_id).map_err(|error| error.to_string())?;
        bundle_response(&mut conn, bundle)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_plan_revisions(
    app: tauri::AppHandle,
    request: PlanRevisionListRequest,
) -> Result<PlanRevisionListResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::list_revisions(&mut conn, &request.document_id)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(revision_response)
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

struct OwnedCommentSave {
    id: String,
    position: i32,
    state: PlanCommentState,
    anchor_kind: PlanCommentAnchorKind,
    anchor_json: String,
    body: String,
}

#[tauri::command]
pub async fn save_plan_review_draft(
    app: tauri::AppHandle,
    request: PlanReviewDraftSaveRequest,
) -> Result<PlanReviewDraftSaveResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let events = services.events.clone();
    let (response, event) = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let current = ops::get_review_bundle(&mut conn, &request.review_id).map_err(|error| error.to_string())?;
        let requested_mode: PlanReviewDraftMode = request.mode.into();
        let schema_fallback = request.editor_schema_fallback.0;
        if let Some(fallback) = schema_fallback.as_ref() {
            if requested_mode != PlanReviewDraftMode::Source {
                return Err("editorSchemaFallback requires source mode".into());
            }
            if current.draft.mode().map_err(|error| error.to_string())? != PlanReviewDraftMode::Rich
                || current.draft.editor_schema_version != Some(fallback.from_version)
                || current.draft.editor_schema_hash.as_deref() != fallback.from_hash.0.as_deref()
            {
                return Err("editorSchemaFallback does not match the persisted rich schema".into());
            }
            if fallback.from_version == PLAN_EDITOR_SCHEMA_VERSION
                && fallback.from_hash.0.as_deref() == Some(PLAN_EDITOR_SCHEMA_HASH)
            {
                return Err("the persisted editor schema is compatible; source fallback is not allowed".into());
            }
        }
        let base_editor_json = request
            .base_editor_json
            .0
            .map(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
            .transpose()?;
        let editor_json = request
            .editor_json
            .0
            .map(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
            .transpose()?;
        let selection_json = request
            .selection
            .0
            .map(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
            .transpose()?;
        if requested_mode == PlanReviewDraftMode::Rich && request.source_text.0.is_some() {
            return Err("rich plan drafts require sourceText to be null".into());
        }
        if requested_mode == PlanReviewDraftMode::Source && request.source_text.0.is_none() {
            return Err("source plan drafts require exact sourceText".into());
        }

        if requested_mode == PlanReviewDraftMode::Rich && base_editor_json.is_none() {
            return Err("rich plan drafts require baseEditorJson".into());
        }
        if requested_mode == PlanReviewDraftMode::Rich
            && (editor_json.is_none()
                || request.editor_schema_version.0.is_none()
                || request.editor_schema_hash.0.is_none())
        {
            return Err("rich plan drafts require editorJson and editor schema identity".into());
        }
        if requested_mode == PlanReviewDraftMode::Source
            && (base_editor_json.is_some()
                || editor_json.is_some()
                || request.editor_schema_version.0.is_some()
                || request.editor_schema_hash.0.is_some())
        {
            return Err("source plan drafts cannot carry editor JSON or editor schema identity".into());
        }
        if requested_mode == PlanReviewDraftMode::Source
            && request.base_normalized_markdown != current.submitted_revision.content_markdown
        {
            return Err("source plan drafts must use the submitted raw markdown as their baseline".into());
        }
        let owned_comments = request
            .comments
            .into_iter()
            .enumerate()
            .map(|(position, comment)| {
                let position = i32::try_from(position).map_err(|_| "too many plan comments".to_string())?;
                let anchor_kind = comment.anchor.stored_kind();
                let anchor_json = serde_json::to_string(&comment.anchor).map_err(|error| error.to_string())?;
                Ok(OwnedCommentSave {
                    id: comment.id,
                    position,
                    state: comment.state.into(),
                    anchor_kind,
                    anchor_json,
                    body: comment.body,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let comments = owned_comments
            .iter()
            .map(|comment| ops::PlanCommentSave {
                id: &comment.id,
                position: comment.position,
                state: comment.state,
                anchor_kind: comment.anchor_kind,
                anchor_json: &comment.anchor_json,
                body: &comment.body,
            })
            .collect::<Vec<_>>();
        let bundle = ops::save_review_draft(
            &mut conn,
            &ops::PlanReviewDraftSave {
                review_id: &request.review_id,
                expected_generation: request.expected_generation,
                mode: requested_mode,
                base_editor_json: base_editor_json.as_deref(),
                draft_editor_json: editor_json.as_deref(),
                base_normalized_markdown: &request.base_normalized_markdown,
                draft_normalized_markdown: &request.normalized_markdown,
                source_text: request.source_text.0.as_deref(),
                editor_schema_version: request.editor_schema_version.0,
                editor_schema_hash: request.editor_schema_hash.0.as_deref(),
                schema_fallback_from_version: schema_fallback.as_ref().map(|fallback| fallback.from_version),
                schema_fallback_from_hash: schema_fallback
                    .as_ref()
                    .and_then(|fallback| fallback.from_hash.0.as_deref()),
                global_note: request.global_note.0.as_deref(),
                selection_json: selection_json.as_deref(),
                comments: &comments,
                now: now_ms(),
            },
        )
        .map_err(|error| error.to_string())?;
        let response = PlanReviewDraftSaveResponse {
            review_id: bundle.draft.review_id.clone(),
            generation: bundle.draft.generation,
            draft_sha256: bundle.draft.draft_sha256.clone(),
            updated_at: bundle.draft.updated_at,
        };
        let event = event_for(
            bundle.document.conversation_id,
            &bundle.review,
            bundle.deliveries.last(),
        )?;
        Ok::<_, String>((response, event))
    })
    .await
    .map_err(|error| error.to_string())??;
    emit_review_update_best_effort(&events, &event);
    Ok(response)
}

#[tauri::command]
pub async fn discard_plan_review_draft(
    app: tauri::AppHandle,
    request: PlanReviewDraftDiscardRequest,
) -> Result<PlanReviewInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let events = services.events.clone();
    let (response, event) = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let bundle = ops::discard_review_draft(&mut conn, &request.review_id, request.expected_generation, now_ms())
            .map_err(|error| error.to_string())?;
        let event = event_for(
            bundle.document.conversation_id.clone(),
            &bundle.review,
            bundle.deliveries.last(),
        )?;
        let response = bundle_response(&mut conn, bundle)?;
        Ok::<_, String>((response, event))
    })
    .await
    .map_err(|error| error.to_string())??;
    emit_review_update_best_effort(&events, &event);
    Ok(response)
}

#[tauri::command]
pub async fn get_plan_review_delivery(
    app: tauri::AppHandle,
    request: PlanReviewDeliveryReadRequest,
) -> Result<Option<PlanReviewDeliveryInfoResponse>, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let bundle = ops::get_review_bundle(&mut conn, &request.review_id).map_err(|error| error.to_string())?;
        bundle.deliveries.into_iter().last().map(delivery_response).transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn resolve_plan_file_conflict(
    app: tauri::AppHandle,
    request: PlanFileConflictResolveRequest,
) -> Result<PlanDocumentInfoResponse, String> {
    if request.action != PlanFileConflictActionRequest::RestoreDb {
        return Err("unsupported plan file conflict action".into());
    }
    let services = app.services();
    let pool = services.db.clone();
    let files = services.plan_files.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let now = now_ms();
        ops::retry_materialization_from_database(&mut conn, &request.document_id, now)
            .map_err(|error| error.to_string())?;
        let report = files
            .reconcile_document(&mut conn, &request.document_id, now)
            .map_err(|error| error.to_string())?;
        if report.conflict.is_some() {
            return Err("plan.md is still in conflict after restoring the database revision".into());
        }
        let document = ops::get_document(&mut conn, &request.document_id).map_err(|error| error.to_string())?;
        document_response(&mut conn, document)
    })
    .await
    .map_err(|error| error.to_string())?
}

struct DecisionCommit {
    response: PlanReviewDecisionResponse,
    event: PlanReviewEvent,
    delivery_id: Option<String>,
    delivery_target: Option<PlanDeliveryTarget>,
}

fn append_native_review_result(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
    review: &db::models::plan_review::PlanReviewSessionRow,
    payload: &str,
    outcome: &'static str,
    now: i64,
) -> Result<(), ops::PlanReviewStoreError> {
    let assistant_message_id = review
        .assistant_message_id
        .as_deref()
        .ok_or_else(|| ops::PlanReviewStoreError::Contract("native review has no assistant message id".into()))?;
    let call_id = review
        .provider_call_id
        .as_deref()
        .ok_or_else(|| ops::PlanReviewStoreError::Contract("native review has no provider call id".into()))?;
    let turn_id = review
        .turn_id
        .as_deref()
        .ok_or_else(|| ops::PlanReviewStoreError::Contract("native review has no submitting turn id".into()))?;
    let message_id = uuid::Uuid::new_v4().to_string();
    db::ops::message::append_message(
        conn,
        &MessageInsert {
            id: &message_id,
            conversation_id,
            role: "tool",
            content: payload,
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: Some(call_id),
            sort_order: 0,
            created_at: now,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: Some(turn_id),
            tool_outcome: Some(outcome),
            cache_read_tokens: None,
            cache_write_tokens: None,
            server_tool_calls: None,
            provider_name: None,
            response_model_id: None,
        },
        Some(assistant_message_id),
    )?;
    let changed = db::ops::turn::finish_waiting_review(conn, turn_id, db::models::turn::TurnStatus::Done, None, now)?;
    if changed != 1 {
        return Err(ops::PlanReviewStoreError::InvalidState(
            "the native submitting turn is not waiting for review".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn decide_plan_review(
    app: tauri::AppHandle,
    request: PlanReviewDecisionRequest,
) -> Result<PlanReviewDecisionResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let continuation_turn_id = uuid::Uuid::new_v4().to_string();
    let commit = tokio::task::spawn_blocking({
        let continuation_turn_id = continuation_turn_id.clone();
        move || {
            let mut conn = get_conn(&pool)?;
            conn.transaction::<DecisionCommit, ops::PlanReviewStoreError, _>(|conn| {
                let before = ops::get_review_bundle(conn, &request.review_id)?;
                let was_pending = before.review.state()? == PlanReviewState::Pending;
                let provider_kind = before.review.provider_kind()?;
                let conversation_id = before.document.conversation_id.clone();
                let action = match request.action {
                    PlanReviewDecisionActionRequest::Approve => ops::PlanReviewDecisionAction::Approve,
                    PlanReviewDecisionActionRequest::RequestChanges => ops::PlanReviewDecisionAction::RequestChanges,
                };
                let delivery_target = match provider_kind {
                    PlanReviewProviderKind::Native => Some(PlanDeliveryTarget::Native),
                    PlanReviewProviderKind::Acp => Some(PlanDeliveryTarget::Acp),
                    PlanReviewProviderKind::Legacy if action == ops::PlanReviewDecisionAction::RequestChanges => {
                        Some(PlanDeliveryTarget::Native)
                    }
                    PlanReviewProviderKind::Legacy => None,
                };
                let acp_session_id = if provider_kind == PlanReviewProviderKind::Acp {
                    db::ops::acp_session::get(conn, &conversation_id)?.and_then(|row| row.acp_session_id)
                } else {
                    None
                };
                let target_turn_id = match provider_kind {
                    PlanReviewProviderKind::Native => Some(continuation_turn_id.as_str()),
                    PlanReviewProviderKind::Acp | PlanReviewProviderKind::Legacy => before.review.turn_id.as_deref(),
                };
                let result = ops::decide_review(
                    conn,
                    &ops::PlanReviewDecision {
                        review_id: &request.review_id,
                        decision_id: &request.decision_id,
                        expected_lock_version: before.review.lock_version,
                        expected_draft_generation: request.expected_generation,
                        expected_draft_sha256: &request.expected_draft_hash,
                        action,
                        decision_summary: None,
                        delivery_target,
                        target_session_id: acp_session_id.as_deref(),
                        target_turn_id,
                        now: now_ms(),
                    },
                )?;

                // A retry of the same decision is storage-idempotent.  The
                // transcript result and terminal turn transition must be just
                // as idempotent, so only the pending->settled edge writes them.
                if provider_kind == PlanReviewProviderKind::Native && was_pending {
                    let delivery = result.delivery.as_ref().ok_or_else(|| {
                        ops::PlanReviewStoreError::InvalidState(
                            "native plan decisions require a durable continuation delivery".into(),
                        )
                    })?;
                    let outcome = if action == ops::PlanReviewDecisionAction::Approve {
                        "success"
                    } else {
                        "denied"
                    };
                    append_native_review_result(
                        conn,
                        &conversation_id,
                        &result.review,
                        &delivery.payload_json,
                        outcome,
                        now_ms(),
                    )?;
                    let mode = if action == ops::PlanReviewDecisionAction::Approve {
                        None
                    } else {
                        Some(meridian_core::agent::modes::PLAN_MODE)
                    };
                    db::ops::conversation::update_mode(conn, &conversation_id, mode, now_ms())?;
                }

                let event = event_for(conversation_id, &result.review, result.delivery.as_ref())?;
                let delivery_state = result
                    .delivery
                    .as_ref()
                    .map(|delivery| delivery.state())
                    .transpose()?
                    .map(|state| state.as_str().to_string());
                let persisted_continuation = result
                    .delivery
                    .as_ref()
                    .and_then(|delivery| delivery.target_turn_id.clone())
                    .filter(|_| provider_kind == PlanReviewProviderKind::Native);
                let state = result.review.state()?.as_str().to_string();
                Ok(DecisionCommit {
                    response: PlanReviewDecisionResponse {
                        review_id: result.review.id,
                        state,
                        delivery_state,
                        continuation_turn_id: persisted_continuation,
                    },
                    event,
                    delivery_id: result.delivery.map(|delivery| delivery.id),
                    delivery_target,
                })
            })
            .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())??;

    emit_review_update_best_effort(&services.events, &commit.event);
    if let (Some(delivery_id), Some(target)) = (commit.delivery_id.clone(), commit.delivery_target) {
        dispatch_delivery_later(services.clone(), delivery_id, target, false);
    }
    Ok(commit.response)
}

fn dispatch_delivery_later(
    services: meridian_core::services::Services,
    delivery_id: String,
    target: PlanDeliveryTarget,
    retry_in_doubt: bool,
) {
    tokio::spawn(async move {
        let result = match target {
            PlanDeliveryTarget::Native => dispatch_native_delivery(&services, &delivery_id, retry_in_doubt).await,
            PlanDeliveryTarget::Acp => dispatch_acp_delivery(&services, &delivery_id, retry_in_doubt).await,
        };
        if let Err(error) = result {
            tracing::warn!(%error, %delivery_id, "plan review delivery did not continue");
        }
    });
}

struct DeliveryDispatch {
    row: db::models::plan_review::PlanReviewDeliveryRow,
    event: PlanReviewEvent,
    conversation_id: String,
    mode: &'static str,
    continuation_turn_id: String,
    attempt_token: String,
    native_runtime: Option<db::models::plan_review::NativePlanReviewRuntimeConfig>,
}

async fn dispatch_native_delivery(
    services: &meridian_core::services::Services,
    delivery_id: &str,
    retry_in_doubt: bool,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    let pool = services.db.clone();
    let id = delivery_id.to_string();
    let dispatch = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let row = ops::get_delivery(&mut conn, &id).map_err(|error| error.to_string())?;
        if row.target()? != PlanDeliveryTarget::Native {
            return Err("the delivery does not target the native runtime".into());
        }
        let initial_bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        if row.state()? == PlanDeliveryState::Acknowledged {
            let native_runtime = initial_bundle.review.native_runtime_config()?;
            let event = event_for(
                initial_bundle.document.conversation_id.clone(),
                &initial_bundle.review,
                Some(&row),
            )?;
            return Ok::<_, String>(DeliveryDispatch {
                continuation_turn_id: row.target_turn_id.clone().unwrap_or_default(),
                attempt_token: row.attempt_token.clone().unwrap_or_default(),
                mode: if initial_bundle.review.state()? == PlanReviewState::Approved {
                    meridian_core::agent::modes::WORK_MODE
                } else {
                    meridian_core::agent::modes::PLAN_MODE
                },
                conversation_id: initial_bundle.document.conversation_id,
                row,
                event,
                native_runtime,
            });
        }
        if row.state()? == PlanDeliveryState::Dispatched {
            return Err("the native continuation is already dispatched".into());
        }
        if initial_bundle.review.native_runtime_config()?.is_none() {
            if row.state()? != PlanDeliveryState::Queued {
                return Err("native plan review has no persisted runtime config".into());
            }
            let row = ops::mark_delivery_held(
                &mut conn,
                &id,
                Some("native plan review has no persisted runtime config"),
                now_ms(),
            )
            .map_err(|error| error.to_string())?;
            let bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
            let event = event_for(bundle.document.conversation_id.clone(), &bundle.review, Some(&row))?;
            return Ok(DeliveryDispatch {
                row,
                event,
                conversation_id: bundle.document.conversation_id,
                mode: meridian_core::agent::modes::PLAN_MODE,
                continuation_turn_id: String::new(),
                attempt_token: String::new(),
                native_runtime: None,
            });
        }
        let attempt_token = uuid::Uuid::new_v4().to_string();
        let continuation_turn_id = if matches!(row.state()?, PlanDeliveryState::InDoubt | PlanDeliveryState::Held) {
            if !retry_in_doubt {
                return Err("the native continuation requires an explicit retry".into());
            }
            uuid::Uuid::new_v4().to_string()
        } else {
            row.target_turn_id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
        };
        let row = if row.state()? == PlanDeliveryState::InDoubt {
            ops::retry_delivery_dispatched_for_turn(&mut conn, &id, &attempt_token, &continuation_turn_id, now_ms())
        } else {
            ops::mark_delivery_dispatched_for_turn(&mut conn, &id, &attempt_token, &continuation_turn_id, now_ms())
        }
        .map_err(|error| error.to_string())?;
        let bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        let native_runtime = bundle.review.native_runtime_config()?;
        let mode = if bundle.review.state()? == PlanReviewState::Approved {
            meridian_core::agent::modes::WORK_MODE
        } else {
            meridian_core::agent::modes::PLAN_MODE
        };
        let event = event_for(bundle.document.conversation_id.clone(), &bundle.review, Some(&row))?;
        Ok(DeliveryDispatch {
            row,
            event,
            conversation_id: bundle.document.conversation_id,
            mode,
            continuation_turn_id,
            attempt_token,
            native_runtime,
        })
    })
    .await
    .map_err(|error| error.to_string())??;

    if dispatch.row.state()? == PlanDeliveryState::Acknowledged {
        return delivery_response(dispatch.row);
    }
    emit_review_update_best_effort(&services.events, &dispatch.event);
    let native_runtime = dispatch
        .native_runtime
        .clone()
        .ok_or_else(|| "native plan review has no persisted runtime config".to_string())?;
    let outcome = crate::commands::chat::run_plan_review_continuation(
        services.clone(),
        dispatch.conversation_id.clone(),
        dispatch.continuation_turn_id,
        dispatch.mode,
        native_runtime,
    )
    .await;
    let pool = services.db.clone();
    let id = delivery_id.to_string();
    let attempt = dispatch.attempt_token;
    let (row, event) = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let row = match outcome {
            Ok(()) => ops::mark_delivery_acknowledged(&mut conn, &id, &attempt, now_ms()),
            Err(ref error) => ops::mark_delivery_held(&mut conn, &id, Some(error), now_ms()),
        }
        .map_err(|error| error.to_string())?;
        let bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        let event = event_for(bundle.document.conversation_id, &bundle.review, Some(&row))?;
        Ok::<_, String>((row, event))
    })
    .await
    .map_err(|error| error.to_string())??;
    emit_review_update_best_effort(&services.events, &event);
    let acknowledged = row.state()? == PlanDeliveryState::Acknowledged;
    let response = delivery_response(row)?;
    if acknowledged {
        meridian_core::agent::queue::pump_later(services, &dispatch.conversation_id);
    }
    Ok(response)
}

#[cfg(not(target_os = "android"))]
async fn dispatch_acp_delivery(
    services: &meridian_core::services::Services,
    delivery_id: &str,
    retry_in_doubt: bool,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    struct AcpDispatch {
        row: db::models::plan_review::PlanReviewDeliveryRow,
        event: PlanReviewEvent,
        conversation_id: String,
        attempt_token: String,
        delivery: meridian_core::acp::AcpPlanReviewDelivery,
    }

    let pool = services.db.clone();
    let id = delivery_id.to_string();
    let dispatch = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let row = ops::get_delivery(&mut conn, &id).map_err(|error| error.to_string())?;
        if row.target()? != PlanDeliveryTarget::Acp {
            return Err("the delivery does not target the ACP runtime".into());
        }
        let bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        let provider_call_id = bundle
            .review
            .provider_call_id
            .clone()
            .ok_or("ACP plan review has no provider call id")?;
        let submitting_turn_id = bundle
            .review
            .turn_id
            .clone()
            .ok_or("ACP plan review has no submitting turn id")?;
        if row.state()? == PlanDeliveryState::Acknowledged {
            let event = event_for(bundle.document.conversation_id.clone(), &bundle.review, Some(&row))?;
            return Ok::<_, String>(AcpDispatch {
                attempt_token: row.attempt_token.clone().unwrap_or_default(),
                delivery: meridian_core::acp::AcpPlanReviewDelivery {
                    delivery_id: row.id.clone(),
                    review_id: row.review_id.clone(),
                    provider_call_id,
                    target_session_id: row.target_session_id.clone(),
                    submitting_turn_id,
                    payload_json: row.payload_json.clone(),
                },
                conversation_id: bundle.document.conversation_id,
                row,
                event,
            });
        }
        if row.state()? == PlanDeliveryState::Dispatched {
            return Err("the ACP plan delivery is already dispatched".into());
        }
        let attempt_token = uuid::Uuid::new_v4().to_string();
        let row = if row.state()? == PlanDeliveryState::InDoubt {
            if !retry_in_doubt {
                return Err("the ACP plan delivery is in doubt and requires explicit retry".into());
            }
            ops::retry_delivery_dispatched(&mut conn, &id, &attempt_token, now_ms())
        } else {
            ops::mark_delivery_dispatched(&mut conn, &id, &attempt_token, now_ms())
        }
        .map_err(|error| error.to_string())?;
        // The delivery transition bumps the review version in the same
        // transaction. Reload it before publishing or the dispatched event is
        // stale the instant it is emitted.
        let transitioned = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        let event = event_for(
            transitioned.document.conversation_id.clone(),
            &transitioned.review,
            Some(&row),
        )?;
        Ok(AcpDispatch {
            delivery: meridian_core::acp::AcpPlanReviewDelivery {
                delivery_id: row.id.clone(),
                review_id: row.review_id.clone(),
                provider_call_id,
                target_session_id: row.target_session_id.clone(),
                submitting_turn_id,
                payload_json: row.payload_json.clone(),
            },
            row,
            event,
            conversation_id: transitioned.document.conversation_id,
            attempt_token,
        })
    })
    .await
    .map_err(|error| error.to_string())??;

    if dispatch.row.state()? == PlanDeliveryState::Acknowledged {
        return delivery_response(dispatch.row);
    }
    emit_review_update_best_effort(&services.events, &dispatch.event);
    let outcome = match meridian_core::acp::reopen_session(services, &dispatch.conversation_id).await {
        Ok(session) => session.deliver_plan_review(services, dispatch.delivery).await,
        Err(error) => meridian_core::acp::AcpPlanReviewDeliveryOutcome::Held(error),
    };
    let pool = services.db.clone();
    let id = delivery_id.to_string();
    let attempt = dispatch.attempt_token;
    let (row, event) = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let row = match outcome {
            meridian_core::acp::AcpPlanReviewDeliveryOutcome::Acknowledged => {
                ops::mark_delivery_acknowledged(&mut conn, &id, &attempt, now_ms())
            }
            meridian_core::acp::AcpPlanReviewDeliveryOutcome::Held(error) => {
                ops::mark_delivery_held(&mut conn, &id, Some(&error), now_ms())
            }
            meridian_core::acp::AcpPlanReviewDeliveryOutcome::InDoubt(error) => {
                ops::mark_delivery_in_doubt(&mut conn, &id, &attempt, &error, now_ms())
            }
        }
        .map_err(|error| error.to_string())?;
        let bundle = ops::get_review_bundle(&mut conn, &row.review_id).map_err(|error| error.to_string())?;
        let event = event_for(bundle.document.conversation_id, &bundle.review, Some(&row))?;
        Ok::<_, String>((row, event))
    })
    .await
    .map_err(|error| error.to_string())??;
    emit_review_update_best_effort(&services.events, &event);
    let acknowledged = row.state()? == PlanDeliveryState::Acknowledged;
    let response = delivery_response(row)?;
    if acknowledged {
        meridian_core::agent::queue::pump_later(services, &dispatch.conversation_id);
    }
    Ok(response)
}

#[cfg(target_os = "android")]
async fn dispatch_acp_delivery(
    _services: &meridian_core::services::Services,
    _delivery_id: &str,
    _retry_in_doubt: bool,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    Err("ACP plan review delivery is unavailable on Android".into())
}

#[tauri::command]
pub async fn continue_plan_review_delivery(
    app: tauri::AppHandle,
    request: PlanReviewDeliveryContinueRequest,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let delivery_id = request.delivery_id.clone();
    let target = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::get_delivery(&mut conn, &delivery_id)
            .map_err(|error| error.to_string())?
            .target()
    })
    .await
    .map_err(|error| error.to_string())??;
    match target {
        PlanDeliveryTarget::Native => dispatch_native_delivery(&services, &request.delivery_id, true).await,
        PlanDeliveryTarget::Acp => dispatch_acp_delivery(&services, &request.delivery_id, true).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_plan_runtime() -> db::models::plan_review::NativePlanReviewRuntimeConfig {
        db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: "provider-test".into(),
            model: "model-test".into(),
            assistant_id: Some("assistant-test".into()),
            thinking_level: Some(meridian_core::provider::capabilities::StoredThinkingLevel::High),
            fast: true,
            project_id: None,
            project_path: None,
            accept_edits: false,
        }
    }

    #[test]
    fn rich_draft_request_carries_an_immutable_baseline_separately_from_the_edit() {
        let request: PlanReviewDraftSaveRequest = serde_json::from_value(serde_json::json!({
            "reviewId": "review-1",
            "expectedGeneration": 0,
            "mode": "rich",
            "baseEditorJson": {"type":"doc","content":[{"type":"paragraph"}]},
            "editorJson": {"type":"doc","content":[{"type":"heading","attrs":{"level":1}}]},
            "sourceText": null,
            "baseNormalizedMarkdown": "plain\n",
            "normalizedMarkdown": "# edited\n",
            "comments": [],
            "globalNote": null,
            "selection": null,
            "editorSchemaVersion": 1,
            "editorSchemaHash": "schema-1",
            "editorSchemaFallback": null
        }))
        .unwrap();
        assert_ne!(request.base_editor_json.0, request.editor_json.0);
        assert_ne!(request.base_normalized_markdown, request.normalized_markdown);

        let missing_baseline = serde_json::json!({
            "reviewId": "review-1",
            "expectedGeneration": 0,
            "mode": "rich",
            "editorJson": {"type":"doc"},
            "sourceText": null,
            "baseNormalizedMarkdown": "plain\n",
            "normalizedMarkdown": "plain\n",
            "comments": [],
            "globalNote": null,
            "selection": null,
            "editorSchemaVersion": 1,
            "editorSchemaHash": "schema-1",
            "editorSchemaFallback": null
        });
        assert!(serde_json::from_value::<PlanReviewDraftSaveRequest>(missing_baseline).is_err());
    }

    #[tokio::test]
    async fn direct_native_send_is_refused_by_a_durable_pending_review() {
        let pool = db::test_db();
        {
            let mut conn = pool.get().unwrap();
            db::ops::conversation::create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
            let document = ops::create_or_resume_document(&mut conn, "c1", 2).unwrap();
            let appended = ops::append_assistant_revision(
                &mut conn,
                &ops::PlanRevisionAppend {
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
            ops::mark_materialization_applied(&mut conn, &appended.materialization.id, 4).unwrap();
            ops::submit_native_head_for_review(
                &mut conn,
                &ops::PlanReviewSubmit {
                    document_id: &document.id,
                    expected_generation: appended.document.working_generation,
                    expected_head_sha256: &appended.revision.content_sha256,
                    turn_id: None,
                    assistant_message_id: Some("m1"),
                    provider_call_id: Some("exit-1"),
                    provider_kind: PlanReviewProviderKind::Native,
                    now: 5,
                },
                &native_plan_runtime(),
            )
            .unwrap();
        }

        let error = ensure_conversation_not_waiting_review(&pool, "c1").await.unwrap_err();
        assert!(error.contains("waiting for plan review"));
    }

    #[tokio::test]
    async fn native_continuation_is_refused_before_start_when_the_review_workspace_drifted() {
        let pool = db::test_db();
        let runtime = {
            let mut conn = pool.get().unwrap();
            for (id, path) in [("project-a", "A"), ("project-b", "B")] {
                db::ops::project::create_project(
                    &mut conn,
                    &db::models::project::ProjectInsert {
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
            db::ops::conversation::create_conversation(&mut conn, "c1", None, None, Some("project-a"), 1).unwrap();
            let document = ops::create_or_resume_document(&mut conn, "c1", 2).unwrap();
            let appended = ops::append_assistant_revision(
                &mut conn,
                &ops::PlanRevisionAppend {
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
            ops::mark_materialization_applied(&mut conn, &appended.materialization.id, 4).unwrap();
            let runtime = db::models::plan_review::NativePlanReviewRuntimeConfig {
                project_id: Some("project-a".into()),
                project_path: Some("A".into()),
                ..native_plan_runtime()
            };
            // Bypass command guards to simulate external/old-code corruption;
            // the continuation endpoint is the final defensive check.
            db::ops::conversation::update_project(&mut conn, "c1", Some("project-b"), 7).unwrap();
            runtime
        };

        let error = crate::commands::chat::verify_plan_review_workspace(&pool, "c1", &runtime)
            .await
            .unwrap_err();
        assert!(error.contains("workspace changed"));
        let mut conn = pool.get().unwrap();
        assert!(
            db::ops::turn::list_for_conversation(&mut conn, "c1")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn snapshot_delivery_state_and_review_diff_span_the_whole_review_episode() {
        let pool = db::test_db();
        let mut conn = pool.get().unwrap();
        db::ops::conversation::create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        let document = ops::create_or_resume_document(&mut conn, "c1", 2).unwrap();
        let first = ops::append_assistant_revision(
            &mut conn,
            &ops::PlanRevisionAppend {
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
        ops::mark_materialization_applied(&mut conn, &first.materialization.id, 4).unwrap();
        db::ops::turn::begin(&mut conn, "t1", "c1", meridian_core::turn::TurnOrigin::Desktop, None, 4).unwrap();
        let first_review = ops::submit_native_head_for_review(
            &mut conn,
            &ops::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: first.document.working_generation,
                expected_head_sha256: &first.revision.content_sha256,
                turn_id: Some("t1"),
                assistant_message_id: Some("m1"),
                provider_call_id: Some("exit-1"),
                provider_kind: PlanReviewProviderKind::Native,
                now: 5,
            },
            &native_plan_runtime(),
        )
        .unwrap();
        let approved = ops::decide_review(
            &mut conn,
            &ops::PlanReviewDecision {
                review_id: &first_review.review.id,
                decision_id: "approve-1",
                expected_lock_version: 0,
                expected_draft_generation: 0,
                expected_draft_sha256: &first_review.draft.draft_sha256,
                action: ops::PlanReviewDecisionAction::Approve,
                decision_summary: None,
                delivery_target: Some(PlanDeliveryTarget::Native),
                target_session_id: None,
                target_turn_id: Some("continuation-1"),
                now: 6,
            },
        )
        .unwrap();
        let delivery = approved.delivery.unwrap();
        let visible = HashSet::from(["m1"]);
        let queued = summaries_for_conversation(&mut conn, "c1", &visible).unwrap();
        assert_eq!(queued[0].delivery_state.as_deref(), Some("queued"));
        ops::mark_delivery_dispatched(&mut conn, &delivery.id, "attempt-1", 7).unwrap();
        ops::mark_delivery_acknowledged(&mut conn, &delivery.id, "attempt-1", 8).unwrap();
        let acknowledged = summaries_for_conversation(&mut conn, "c1", &visible).unwrap();
        assert_eq!(acknowledged[0].delivery_state.as_deref(), Some("acknowledged"));

        let second = ops::append_assistant_revision(
            &mut conn,
            &ops::PlanRevisionAppend {
                document_id: &document.id,
                expected_generation: first.document.working_generation,
                expected_head_sha256: Some(&first.revision.content_sha256),
                content_markdown: "# Plan\n\nAlpha\n",
                patch: "patch-2",
                source_message_id: Some("m2"),
                source_call_id: Some("update-2"),
                responding_to_suggestion_revision_id: None,
                now: 9,
            },
        )
        .unwrap();
        ops::mark_materialization_applied(&mut conn, &second.materialization.id, 10).unwrap();
        let third = ops::append_assistant_revision(
            &mut conn,
            &ops::PlanRevisionAppend {
                document_id: &document.id,
                expected_generation: second.document.working_generation,
                expected_head_sha256: Some(&second.revision.content_sha256),
                content_markdown: "# Plan\n\nAlpha\n\nBeta\n",
                patch: "patch-3",
                source_message_id: Some("m2"),
                source_call_id: Some("update-3"),
                responding_to_suggestion_revision_id: None,
                now: 11,
            },
        )
        .unwrap();
        ops::mark_materialization_applied(&mut conn, &third.materialization.id, 12).unwrap();
        db::ops::turn::begin(
            &mut conn,
            "t2",
            "c1",
            meridian_core::turn::TurnOrigin::Desktop,
            None,
            12,
        )
        .unwrap();
        let second_review = ops::submit_native_head_for_review(
            &mut conn,
            &ops::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: third.document.working_generation,
                expected_head_sha256: &third.revision.content_sha256,
                turn_id: Some("t2"),
                assistant_message_id: Some("m2"),
                provider_call_id: Some("exit-2"),
                provider_kind: PlanReviewProviderKind::Native,
                now: 13,
            },
            &native_plan_runtime(),
        )
        .unwrap();
        let response = bundle_response(&mut conn, second_review).unwrap();
        assert_eq!(response.parent_revision.unwrap().id, first.revision.id);
        let patch = response.submitted_revision.patch.unwrap();
        assert_ne!(patch, "patch-3");
        assert!(patch.contains("Alpha"));
        assert!(patch.contains("Beta"));
    }

    #[test]
    fn decision_generation_is_not_deserialized_as_a_review_lock_version() {
        let request: PlanReviewDecisionRequest = serde_json::from_value(serde_json::json!({
            "reviewId": "review-1",
            "decisionId": "decision-1",
            "expectedGeneration": 7,
            "expectedDraftHash": "abc",
            "action": "request_changes"
        }))
        .unwrap();
        assert_eq!(request.expected_generation, 7);
        assert!(
            serde_json::from_value::<PlanReviewDecisionRequest>(serde_json::json!({
                "reviewId": "review-1",
                "decisionId": "decision-1",
                "expectedGeneration": 7,
                "expectedDraftHash": "abc",
                "expectedLockVersion": 7,
                "action": "request_changes"
            }))
            .is_err(),
            "the review lock version is read transactionally, not conflated with draft generation"
        );
    }
}
