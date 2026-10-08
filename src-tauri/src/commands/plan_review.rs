//! Durable plan-review commands.
//!
//! SQLite owns the review state.  The command layer is deliberately an exact
//! projection rather than a serialization of persistence rows: stored JSON is
//! decoded here, nullable transcript identities are rejected for interactive
//! reviews, and every mutation uses the generation/hash CAS supplied by the
//! editor.

use std::collections::HashSet;

use meridian_core::db;
use meridian_core::db::entity::plan_comment::{PlanCommentAnchorKind, PlanCommentState};
use meridian_core::db::entity::plan_materialization::PlanMaterializationState;
use meridian_core::db::entity::plan_review_delivery::{PlanDeliveryState, PlanDeliveryTarget};
use meridian_core::db::entity::plan_review_draft::PlanReviewDraftMode;
use meridian_core::db::entity::plan_review_session::{
    NativePlanReviewRuntimeConfig, PlanReviewProviderKind, PlanReviewState,
};
use meridian_core::db::entity::turn::TurnStatus;
use meridian_core::db::entity::{
    plan_comment, plan_document, plan_review_delivery, plan_review_draft, plan_review_session, plan_revision,
};
use meridian_core::db::ops::plan_review as diesel_ops;
use meridian_core::db::sea::cap::{Db, Read, Snapshot, WriteTx};
use meridian_core::db::sea::ops::plan_review as ops;
use meridian_core::events::PlanReviewEvent;
use meridian_core::util::now_ms;
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

pub async fn ensure_conversation_not_waiting_review(db: &Db, conversation_id: &str) -> Result<(), String> {
    let blocked = db
        .read(async |tx| ops::has_conversation_barrier(tx, conversation_id).await)
        .await
        .map_err(|error| error.to_string())?;
    if blocked {
        Err("This conversation is waiting for plan review. Approve it or request changes before sending another message.".into())
    } else {
        Ok(())
    }
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

fn revision_response(row: plan_revision::Model) -> Result<PlanRevisionInfoResponse, String> {
    let editor_json = decode_json(row.editor_json, "plan revision editor_json")?;
    Ok(PlanRevisionInfoResponse {
        id: row.id,
        document_id: row.document_id,
        revision_no: row.revision_no,
        parent_revision_id: row.parent_revision_id,
        author_kind: row.author_kind.as_str().to_string(),
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

async fn document_response(db: &impl Read, row: plan_document::Model) -> Result<PlanDocumentInfoResponse, String> {
    let sync = ops::latest_materialization(db, &row.id)
        .await
        .map_err(|error| error.to_string())?
        .map_or(PlanMaterializationState::Applied, |row| row.state)
        .as_str()
        .to_string();
    Ok(PlanDocumentInfoResponse {
        id: row.id,
        conversation_id: row.conversation_id,
        state: row.state.as_str().to_string(),
        head_revision_id: row.head_revision_id,
        approved_revision_id: row.approved_revision_id,
        working_generation: row.working_generation,
        file_rel_path: row.file_rel_path,
        file_sync_state: sync,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn review_session_response(row: plan_review_session::Model) -> Result<PlanReviewSessionInfoResponse, String> {
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
        state: row.state.as_str().to_string(),
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

fn draft_response(row: plan_review_draft::Model) -> Result<PlanReviewDraftInfoResponse, String> {
    let base_editor_json = decode_json(row.base_editor_json, "plan draft base_editor_json")?;
    let draft_editor_json = decode_json(row.draft_editor_json, "plan draft draft_editor_json")?;
    let selection = decode_anchor(row.selection_json, "plan draft selection")?;
    Ok(PlanReviewDraftInfoResponse {
        review_id: row.review_id,
        base_revision_id: row.base_revision_id,
        generation: row.generation,
        mode: row.mode.as_str().to_string(),
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

fn comment_response(row: plan_comment::Model) -> Result<PlanCommentInfoResponse, String> {
    let anchor: PlanCommentAnchor = serde_json::from_str(&row.anchor_json)
        .map_err(|error| format!("stored plan comment anchor is invalid: {error}"))?;
    if anchor.stored_kind() != row.anchor_kind {
        return Err(format!(
            "plan comment {} anchor kind disagrees with its payload",
            row.id
        ));
    }
    Ok(PlanCommentInfoResponse {
        id: row.id,
        review_id: row.review_id,
        position: row.position,
        state: row.state.as_str().to_string(),
        anchor,
        body: row.body,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn delivery_response(row: plan_review_delivery::Model) -> Result<PlanReviewDeliveryInfoResponse, String> {
    let payload = serde_json::from_str(&row.payload_json)
        .map_err(|error| format!("stored plan review delivery payload is invalid: {error}"))?;
    Ok(PlanReviewDeliveryInfoResponse {
        id: row.id,
        review_id: row.review_id,
        target: row.target.as_str().to_string(),
        state: row.state.as_str().to_string(),
        payload,
        error: row.error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

async fn bundle_response(db: &impl Snapshot, bundle: ops::PlanReviewBundle) -> Result<PlanReviewInfoResponse, String> {
    // A review may contain several update_plan patches.  Its useful baseline
    // is therefore the preceding submitted review, not the immediate parent
    // revision (which would expose only the last patch in the batch).
    let previous_review = ops::list_reviews(db, &bundle.document.id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .take_while(|review| review.id != bundle.review.id)
        .last();
    let parent_revision = match previous_review.as_ref() {
        Some(review) => Some(
            ops::get_revision(db, &review.submitted_revision_id)
                .await
                .map_err(|error| error.to_string())?,
        ),
        None => None,
    };
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
        document: document_response(db, bundle.document).await?,
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
    review: &plan_review_session::Model,
    delivery: Option<&plan_review_delivery::Model>,
) -> PlanReviewEvent {
    PlanReviewEvent {
        review_id: review.id.clone(),
        conversation_id,
        document_id: review.document_id.clone(),
        revision_id: review.submitted_revision_id.clone(),
        turn_id: review.turn_id.clone().unwrap_or_default(),
        status: review.state.as_str().to_string(),
        lock_version: review.lock_version,
        delivery_state: delivery.map(|row| row.state.as_str().to_string()),
    }
}

/// The event for a review as it stands after `delivery` moved.
async fn event_after(db: &impl Snapshot, delivery: &plan_review_delivery::Model) -> Result<PlanReviewEvent, String> {
    let bundle = ops::get_review_bundle(db, &delivery.review_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(event_for(
        bundle.document.conversation_id,
        &bundle.review,
        Some(delivery),
    ))
}

/// Build review/card links only for reviews whose submitting assistant message
/// is on the snapshot's active branch. Legacy artifacts have no transcript
/// identity and remain available through the migration tables, but cannot be
/// attached to a particular tool card without inventing one.
///
/// Still on Diesel: the message snapshot that calls it is one Diesel read.
pub fn summaries_for_conversation(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
    visible_message_ids: &HashSet<&str>,
) -> Result<PlanReviewSummaryListResponse, String> {
    let mut summaries = Vec::new();
    for row in diesel_ops::list_reviews_for_conversation(conn, conversation_id).map_err(|error| error.to_string())? {
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
        let delivery_state = diesel_ops::get_review_bundle(conn, &row.id)
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
    app.services()
        .sea
        .read(async |tx| {
            let bundle = ops::get_review_bundle(tx, &request.review_id)
                .await
                .map_err(|error| error.to_string())?;
            Ok::<_, ops::PlanReviewStoreError>(bundle_response(tx, bundle).await?)
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_plan_revisions(
    app: tauri::AppHandle,
    request: PlanRevisionListRequest,
) -> Result<PlanRevisionListResponse, String> {
    ops::list_revisions(&app.services().sea, &request.document_id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(revision_response)
        .collect()
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
    let requested_mode: PlanReviewDraftMode = request.mode.into();
    let schema_fallback = request.editor_schema_fallback.0;
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
    // The checks against the stored draft and the save are one write: read
    // outside it, a save in between could change the schema being fallen
    // back from.
    let (response, event) = services
        .sea
        .write(async |tx| {
            let current = ops::get_review_bundle(tx, &request.review_id)
                .await
                .map_err(|error| error.to_string())?;
            if let Some(fallback) = schema_fallback.as_ref() {
                if requested_mode != PlanReviewDraftMode::Source {
                    return Err("editorSchemaFallback requires source mode".into());
                }
                if current.draft.mode != PlanReviewDraftMode::Rich
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
            let bundle = ops::save_review_draft(
                tx,
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
            .await
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
            );
            Ok::<_, ops::PlanReviewStoreError>((response, event))
        })
        .await
        .map_err(|error| error.to_string())?;
    emit_review_update_best_effort(&services.events, &event);
    Ok(response)
}

#[tauri::command]
pub async fn discard_plan_review_draft(
    app: tauri::AppHandle,
    request: PlanReviewDraftDiscardRequest,
) -> Result<PlanReviewInfoResponse, String> {
    let services = app.services();
    let (response, event) = services
        .sea
        .write(async |tx| {
            let bundle = ops::discard_review_draft(tx, &request.review_id, request.expected_generation, now_ms())
                .await
                .map_err(|error| error.to_string())?;
            let event = event_for(
                bundle.document.conversation_id.clone(),
                &bundle.review,
                bundle.deliveries.last(),
            );
            let response = bundle_response(tx, bundle).await?;
            Ok::<_, ops::PlanReviewStoreError>((response, event))
        })
        .await
        .map_err(|error| error.to_string())?;
    emit_review_update_best_effort(&services.events, &event);
    Ok(response)
}

#[tauri::command]
pub async fn get_plan_review_delivery(
    app: tauri::AppHandle,
    request: PlanReviewDeliveryReadRequest,
) -> Result<Option<PlanReviewDeliveryInfoResponse>, String> {
    let bundle = app
        .services()
        .sea
        .read(async |tx| ops::get_review_bundle(tx, &request.review_id).await)
        .await
        .map_err(|error| error.to_string())?;
    bundle.deliveries.into_iter().last().map(delivery_response).transpose()
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
    let now = now_ms();
    services
        .sea
        .write(async |tx| ops::retry_materialization_from_database(tx, &request.document_id, now).await)
        .await
        .map_err(|error| error.to_string())?;
    let report = services
        .plan_files
        .reconcile_document(&services.sea, &request.document_id, now)
        .await
        .map_err(|error| error.to_string())?;
    if report.conflict.is_some() {
        return Err("plan.md is still in conflict after restoring the database revision".into());
    }
    services
        .sea
        .read(async |tx| {
            let document = ops::get_document(tx, &request.document_id)
                .await
                .map_err(|error| error.to_string())?;
            Ok::<_, ops::PlanReviewStoreError>(document_response(tx, document).await?)
        })
        .await
        .map_err(|error| error.to_string())
}

struct DecisionCommit {
    response: PlanReviewDecisionResponse,
    event: PlanReviewEvent,
    delivery_id: Option<String>,
    delivery_target: Option<PlanDeliveryTarget>,
}

async fn append_native_review_result(
    tx: &WriteTx,
    conversation_id: &str,
    review: &plan_review_session::Model,
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
    let row = db::entity::message::Model {
        tool_call_id: Some(call_id.to_owned()),
        turn_id: Some(turn_id.to_owned()),
        tool_outcome: Some(outcome.to_owned()),
        ..db::sea::ops::message::new_row(&message_id, conversation_id, "tool", payload, now)
    };
    db::sea::ops::message::append_message(tx, row, Some(assistant_message_id)).await?;
    let changed = db::sea::ops::turn::finish_waiting_review(tx, turn_id, TurnStatus::Done, None, now).await?;
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
    let continuation_turn_id = uuid::Uuid::new_v4().to_string();
    let commit = services
        .sea
        .write(async |tx| {
            let before = ops::get_review_bundle(tx, &request.review_id).await?;
            let was_pending = before.review.state == PlanReviewState::Pending;
            let provider_kind = before.review.provider_kind;
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
                db::sea::ops::acp_session::get(tx, &conversation_id)
                    .await?
                    .and_then(|row| row.acp_session_id)
            } else {
                None
            };
            let target_turn_id = match provider_kind {
                PlanReviewProviderKind::Native => Some(continuation_turn_id.as_str()),
                PlanReviewProviderKind::Acp | PlanReviewProviderKind::Legacy => before.review.turn_id.as_deref(),
            };
            let result = ops::decide_review(
                tx,
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
            )
            .await?;

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
                    tx,
                    &conversation_id,
                    &result.review,
                    &delivery.payload_json,
                    outcome,
                    now_ms(),
                )
                .await?;
                let mode = if action == ops::PlanReviewDecisionAction::Approve {
                    None
                } else {
                    Some(meridian_core::agent::modes::PLAN_MODE)
                };
                db::sea::ops::conversation::update_mode(tx, &conversation_id, mode, now_ms()).await?;
            }

            let event = event_for(conversation_id, &result.review, result.delivery.as_ref());
            let delivery_state = result
                .delivery
                .as_ref()
                .map(|delivery| delivery.state.as_str().to_string());
            let persisted_continuation = result
                .delivery
                .as_ref()
                .and_then(|delivery| delivery.target_turn_id.clone())
                .filter(|_| provider_kind == PlanReviewProviderKind::Native);
            Ok::<_, ops::PlanReviewStoreError>(DecisionCommit {
                response: PlanReviewDecisionResponse {
                    review_id: result.review.id,
                    state: result.review.state.as_str().to_string(),
                    delivery_state,
                    continuation_turn_id: persisted_continuation,
                },
                event,
                delivery_id: result.delivery.map(|delivery| delivery.id),
                delivery_target,
            })
        })
        .await
        .map_err(|error| error.to_string())?;

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
    row: plan_review_delivery::Model,
    event: PlanReviewEvent,
    conversation_id: String,
    mode: &'static str,
    continuation_turn_id: String,
    attempt_token: String,
    native_runtime: Option<NativePlanReviewRuntimeConfig>,
}

/// The mode a continuation runs in, from how the review was settled.
fn continuation_mode(review: &plan_review_session::Model) -> &'static str {
    if review.state == PlanReviewState::Approved {
        meridian_core::agent::modes::WORK_MODE
    } else {
        meridian_core::agent::modes::PLAN_MODE
    }
}

/// Record how a delivery attempt ended, and the event that says so.
async fn settle_delivery(
    services: &meridian_core::services::Services,
    settle: impl AsyncFnOnce(&WriteTx) -> Result<plan_review_delivery::Model, ops::PlanReviewStoreError>,
) -> Result<(plan_review_delivery::Model, PlanReviewEvent), String> {
    services
        .sea
        .write(async |tx| {
            let row = settle(tx).await.map_err(|error| error.to_string())?;
            let event = event_after(tx, &row).await?;
            Ok::<_, ops::PlanReviewStoreError>((row, event))
        })
        .await
        .map_err(|error| error.to_string())
}

async fn dispatch_native_delivery(
    services: &meridian_core::services::Services,
    delivery_id: &str,
    retry_in_doubt: bool,
) -> Result<PlanReviewDeliveryInfoResponse, String> {
    // Read, decide and claim in one IMMEDIATE write: two dispatchers reading
    // the same queued row would otherwise both go on to the claim.
    let dispatch = services
        .sea
        .write(async |tx| {
            let row = ops::get_delivery(tx, delivery_id)
                .await
                .map_err(|error| error.to_string())?;
            if row.target != PlanDeliveryTarget::Native {
                return Err("the delivery does not target the native runtime".into());
            }
            let initial_bundle = ops::get_review_bundle(tx, &row.review_id)
                .await
                .map_err(|error| error.to_string())?;
            let native_runtime = initial_bundle
                .review
                .native_runtime_config_json
                .clone()
                .map(|json| json.0);
            if row.state == PlanDeliveryState::Acknowledged {
                let event = event_for(
                    initial_bundle.document.conversation_id.clone(),
                    &initial_bundle.review,
                    Some(&row),
                );
                return Ok::<_, ops::PlanReviewStoreError>(DeliveryDispatch {
                    continuation_turn_id: row.target_turn_id.clone().unwrap_or_default(),
                    attempt_token: row.attempt_token.clone().unwrap_or_default(),
                    mode: continuation_mode(&initial_bundle.review),
                    conversation_id: initial_bundle.document.conversation_id,
                    row,
                    event,
                    native_runtime,
                });
            }
            if row.state == PlanDeliveryState::Dispatched {
                return Err("the native continuation is already dispatched".into());
            }
            if native_runtime.is_none() {
                if row.state != PlanDeliveryState::Queued {
                    return Err("native plan review has no persisted runtime config".into());
                }
                let row = ops::mark_delivery_held(
                    tx,
                    delivery_id,
                    Some("native plan review has no persisted runtime config"),
                    now_ms(),
                )
                .await
                .map_err(|error| error.to_string())?;
                let event = event_after(tx, &row).await?;
                return Ok(DeliveryDispatch {
                    row,
                    conversation_id: event.conversation_id.clone(),
                    event,
                    mode: meridian_core::agent::modes::PLAN_MODE,
                    continuation_turn_id: String::new(),
                    attempt_token: String::new(),
                    native_runtime: None,
                });
            }
            let attempt_token = uuid::Uuid::new_v4().to_string();
            let continuation_turn_id = if matches!(row.state, PlanDeliveryState::InDoubt | PlanDeliveryState::Held) {
                if !retry_in_doubt {
                    return Err("the native continuation requires an explicit retry".into());
                }
                uuid::Uuid::new_v4().to_string()
            } else {
                row.target_turn_id
                    .clone()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
            };
            let row = if row.state == PlanDeliveryState::InDoubt {
                ops::retry_delivery_dispatched_for_turn(
                    tx,
                    delivery_id,
                    &attempt_token,
                    &continuation_turn_id,
                    now_ms(),
                )
                .await
            } else {
                ops::mark_delivery_dispatched_for_turn(tx, delivery_id, &attempt_token, &continuation_turn_id, now_ms())
                    .await
            }
            .map_err(|error| error.to_string())?;
            let bundle = ops::get_review_bundle(tx, &row.review_id)
                .await
                .map_err(|error| error.to_string())?;
            let event = event_for(bundle.document.conversation_id.clone(), &bundle.review, Some(&row));
            Ok(DeliveryDispatch {
                row,
                event,
                conversation_id: bundle.document.conversation_id,
                mode: continuation_mode(&bundle.review),
                continuation_turn_id,
                attempt_token,
                native_runtime: bundle.review.native_runtime_config_json.map(|json| json.0),
            })
        })
        .await
        .map_err(|error| error.to_string())?;

    if dispatch.row.state == PlanDeliveryState::Acknowledged {
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
    let attempt = dispatch.attempt_token;
    let (row, event) = settle_delivery(services, async |tx| match outcome {
        Ok(()) => ops::mark_delivery_acknowledged(tx, delivery_id, &attempt, now_ms()).await,
        Err(ref error) => ops::mark_delivery_held(tx, delivery_id, Some(error), now_ms()).await,
    })
    .await?;
    emit_review_update_best_effort(&services.events, &event);
    let acknowledged = row.state == PlanDeliveryState::Acknowledged;
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
        row: plan_review_delivery::Model,
        event: PlanReviewEvent,
        conversation_id: String,
        attempt_token: String,
        delivery: meridian_core::acp::AcpPlanReviewDelivery,
    }

    fn handoff(
        row: &plan_review_delivery::Model,
        provider_call_id: String,
        submitting_turn_id: String,
    ) -> meridian_core::acp::AcpPlanReviewDelivery {
        meridian_core::acp::AcpPlanReviewDelivery {
            delivery_id: row.id.clone(),
            review_id: row.review_id.clone(),
            provider_call_id,
            target_session_id: row.target_session_id.clone(),
            submitting_turn_id,
            payload_json: row.payload_json.clone(),
        }
    }

    let dispatch = services
        .sea
        .write(async |tx| {
            let row = ops::get_delivery(tx, delivery_id)
                .await
                .map_err(|error| error.to_string())?;
            if row.target != PlanDeliveryTarget::Acp {
                return Err("the delivery does not target the ACP runtime".into());
            }
            let bundle = ops::get_review_bundle(tx, &row.review_id)
                .await
                .map_err(|error| error.to_string())?;
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
            if row.state == PlanDeliveryState::Acknowledged {
                let event = event_for(bundle.document.conversation_id.clone(), &bundle.review, Some(&row));
                return Ok::<_, ops::PlanReviewStoreError>(AcpDispatch {
                    attempt_token: row.attempt_token.clone().unwrap_or_default(),
                    delivery: handoff(&row, provider_call_id, submitting_turn_id),
                    conversation_id: bundle.document.conversation_id,
                    row,
                    event,
                });
            }
            if row.state == PlanDeliveryState::Dispatched {
                return Err("the ACP plan delivery is already dispatched".into());
            }
            let attempt_token = uuid::Uuid::new_v4().to_string();
            let row = if row.state == PlanDeliveryState::InDoubt {
                if !retry_in_doubt {
                    return Err("the ACP plan delivery is in doubt and requires explicit retry".into());
                }
                ops::retry_delivery_dispatched(tx, delivery_id, &attempt_token, now_ms()).await
            } else {
                ops::mark_delivery_dispatched(tx, delivery_id, &attempt_token, now_ms()).await
            }
            .map_err(|error| error.to_string())?;
            // The delivery transition bumps the review version in the same
            // transaction. Reload it before publishing or the dispatched event is
            // stale the instant it is emitted.
            let event = event_after(tx, &row).await?;
            Ok(AcpDispatch {
                delivery: handoff(&row, provider_call_id, submitting_turn_id),
                row,
                conversation_id: event.conversation_id.clone(),
                event,
                attempt_token,
            })
        })
        .await
        .map_err(|error| error.to_string())?;

    if dispatch.row.state == PlanDeliveryState::Acknowledged {
        return delivery_response(dispatch.row);
    }
    emit_review_update_best_effort(&services.events, &dispatch.event);
    let outcome = match meridian_core::acp::reopen_session(services, &dispatch.conversation_id).await {
        Ok(session) => session.deliver_plan_review(services, dispatch.delivery).await,
        Err(error) => meridian_core::acp::AcpPlanReviewDeliveryOutcome::Held(error),
    };
    let attempt = dispatch.attempt_token;
    let (row, event) = settle_delivery(services, async |tx| match outcome {
        meridian_core::acp::AcpPlanReviewDeliveryOutcome::Acknowledged => {
            ops::mark_delivery_acknowledged(tx, delivery_id, &attempt, now_ms()).await
        }
        meridian_core::acp::AcpPlanReviewDeliveryOutcome::Held(ref error) => {
            ops::mark_delivery_held(tx, delivery_id, Some(error), now_ms()).await
        }
        meridian_core::acp::AcpPlanReviewDeliveryOutcome::InDoubt(ref error) => {
            ops::mark_delivery_in_doubt(tx, delivery_id, &attempt, error, now_ms()).await
        }
    })
    .await?;
    emit_review_update_best_effort(&services.events, &event);
    let acknowledged = row.state == PlanDeliveryState::Acknowledged;
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
    let target = ops::get_delivery(&services.sea, &request.delivery_id)
        .await
        .map_err(|error| error.to_string())?
        .target;
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

    /// The first revision of `c1`'s plan, written and on disk.
    async fn first_revision(tx: &WriteTx, conversation_id: &str) -> ops::PlanRevisionAppendResult {
        let document = ops::create_or_resume_document(tx, conversation_id, 2).await.unwrap();
        let appended = ops::append_assistant_revision(
            tx,
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
        .await
        .unwrap();
        ops::mark_materialization_applied(tx, &appended.materialization.id, 4)
            .await
            .unwrap();
        appended
    }

    /// Submit the head of `appended`'s document for native review.
    async fn submit_native(
        tx: &WriteTx,
        appended: &ops::PlanRevisionAppendResult,
        turn_id: Option<&str>,
        message_id: &str,
        call_id: &str,
        now: i64,
    ) -> ops::PlanReviewBundle {
        ops::submit_native_head_for_review(
            tx,
            &ops::PlanReviewSubmit {
                document_id: &appended.document.id,
                expected_generation: appended.document.working_generation,
                expected_head_sha256: &appended.revision.content_sha256,
                turn_id,
                assistant_message_id: Some(message_id),
                provider_call_id: Some(call_id),
                provider_kind: PlanReviewProviderKind::Native,
                now,
            },
            &native_plan_runtime(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn direct_native_send_is_refused_by_a_durable_pending_review() {
        let db = db::sea::sea_test_db().await;
        db.write(async |tx| {
            db::sea::ops::conversation::create_conversation(tx, "c1", None, None, None, 1).await?;
            let appended = first_revision(tx, "c1").await;
            submit_native(tx, &appended, None, "m1", "exit-1", 5).await;
            Ok::<_, db::sea::DbErr>(())
        })
        .await
        .unwrap();

        let error = ensure_conversation_not_waiting_review(&db, "c1").await.unwrap_err();
        assert!(error.contains("waiting for plan review"));
    }

    #[tokio::test]
    async fn native_continuation_is_refused_before_start_when_the_review_workspace_drifted() {
        let pool = db::diesel_test_db();
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
            let document = diesel_ops::create_or_resume_document(&mut conn, "c1", 2).unwrap();
            let appended = diesel_ops::append_assistant_revision(
                &mut conn,
                &diesel_ops::PlanRevisionAppend {
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
            diesel_ops::mark_materialization_applied(&mut conn, &appended.materialization.id, 4).unwrap();
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

    /// The summaries are still read by the Diesel snapshot, so the review is
    /// built through SeaORM on a file both pools open.
    #[tokio::test]
    async fn snapshot_delivery_state_and_review_diff_span_the_whole_review_episode() {
        let dir = tempfile::tempdir().unwrap();
        let (pool, sea) = db::sea::shared_test_db(dir.path()).await;
        let (first, delivery) = sea
            .write(async |tx| {
                db::sea::ops::conversation::create_conversation(tx, "c1", None, None, None, 1).await?;
                let first = first_revision(tx, "c1").await;
                db::sea::ops::turn::begin(tx, "t1", "c1", meridian_core::turn::TurnOrigin::Desktop, None, 4).await?;
                let first_review = submit_native(tx, &first, Some("t1"), "m1", "exit-1", 5).await;
                let approved = ops::decide_review(
                    tx,
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
                .await
                .unwrap();
                Ok::<_, db::sea::DbErr>((first, approved.delivery.unwrap()))
            })
            .await
            .unwrap();
        let visible = HashSet::from(["m1"]);
        let queued = summaries_for_conversation(&mut pool.get().unwrap(), "c1", &visible).unwrap();
        assert_eq!(queued[0].delivery_state.as_deref(), Some("queued"));
        sea.write(async |tx| {
            ops::mark_delivery_dispatched(tx, &delivery.id, "attempt-1", 7).await?;
            ops::mark_delivery_acknowledged(tx, &delivery.id, "attempt-1", 8).await
        })
        .await
        .unwrap();
        let acknowledged = summaries_for_conversation(&mut pool.get().unwrap(), "c1", &visible).unwrap();
        assert_eq!(acknowledged[0].delivery_state.as_deref(), Some("acknowledged"));

        let response = sea
            .write(async |tx| {
                let append =
                    async |after: &ops::PlanRevisionAppendResult, markdown: &str, patch: &str, call: &str, now| {
                        let appended = ops::append_assistant_revision(
                            tx,
                            &ops::PlanRevisionAppend {
                                document_id: &after.document.id,
                                expected_generation: after.document.working_generation,
                                expected_head_sha256: Some(&after.revision.content_sha256),
                                content_markdown: markdown,
                                patch,
                                source_message_id: Some("m2"),
                                source_call_id: Some(call),
                                responding_to_suggestion_revision_id: None,
                                now,
                            },
                        )
                        .await
                        .unwrap();
                        ops::mark_materialization_applied(tx, &appended.materialization.id, now + 1)
                            .await
                            .unwrap();
                        appended
                    };
                let second = append(&first, "# Plan\n\nAlpha\n", "patch-2", "update-2", 9).await;
                let third = append(&second, "# Plan\n\nAlpha\n\nBeta\n", "patch-3", "update-3", 11).await;
                db::sea::ops::turn::begin(tx, "t2", "c1", meridian_core::turn::TurnOrigin::Desktop, None, 12).await?;
                let second_review = submit_native(tx, &third, Some("t2"), "m2", "exit-2", 13).await;
                Ok::<_, ops::PlanReviewStoreError>(bundle_response(tx, second_review).await?)
            })
            .await
            .unwrap();
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
