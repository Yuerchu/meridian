//! Plan-review commands.
//!
//! SQLite owns the plan document, revisions, review sessions, drafts, and
//! inline comments (`PlanReviewPage`). Live approval waits happen synchronously
//! inside the running Native or ACP turn — mirroring Claude Code's
//! `ExitPlanMode` — with no outbox delivery table and no conversation-wide
//! barrier.

use std::collections::HashSet;

use meridian_core::db;
use meridian_core::db::entity::plan_comment::{PlanCommentAnchorKind, PlanCommentState};
use meridian_core::db::entity::plan_materialization::PlanMaterializationState;
use meridian_core::db::entity::plan_review_draft::PlanReviewDraftMode;
use meridian_core::db::entity::plan_review_session::{PlanReviewProviderKind, PlanReviewState};
use meridian_core::db::entity::{plan_comment, plan_document, plan_review_draft, plan_review_session, plan_revision};
use meridian_core::db::sea::cap::{Read, Snapshot};
use meridian_core::db::sea::ops::plan_review as ops;
use meridian_core::events::PlanReviewEvent;
use meridian_core::state::PlanReviewResolution;
use meridian_core::util::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;

const PLAN_EDITOR_SCHEMA_VERSION: i32 = 1;
const PLAN_EDITOR_SCHEMA_HASH: &str = "meridian-plan-markdown-v1";

fn emit_review_update_best_effort(events: &meridian_core::events::EventBus, event: &PlanReviewEvent) {
    if let Err(error) = events.emit_plan_review_updated(event) {
        tracing::warn!(%error, review_id = %event.review_id, "could not publish plan-review update");
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
/// tagged variants.
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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanApprovalModeRequest {
    /// Exit plan mode into normal work mode (ask before workspace edits).
    Default,
    /// Exit plan mode into work mode with auto-accept edits enabled.
    AcceptEdits,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReviewDecisionRequest {
    pub review_id: String,
    pub decision_id: String,
    pub expected_generation: i64,
    pub expected_draft_hash: String,
    pub action: PlanReviewDecisionActionRequest,
    /// Required (`default` or `accept_edits`) for `approve`; must be `null` for `request_changes`.
    pub approval_mode: RequiredNullable<PlanApprovalModeRequest>,
    /// When `true` on `approve`, clears conversation context and launches a fresh
    /// implementation turn carrying the approved plan and any feedback.
    pub clear_context: bool,
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
pub struct PlanReviewInfoResponse {
    pub document: PlanDocumentInfoResponse,
    pub review: PlanReviewSessionInfoResponse,
    pub submitted_revision: PlanRevisionInfoResponse,
    pub parent_revision: Option<PlanRevisionInfoResponse>,
    pub draft: PlanReviewDraftInfoResponse,
    pub comments: PlanCommentListResponse,
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

async fn bundle_response(db: &impl Snapshot, bundle: ops::PlanReviewBundle) -> Result<PlanReviewInfoResponse, String> {
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
    })
}

fn event_for(conversation_id: String, review: &plan_review_session::Model) -> PlanReviewEvent {
    PlanReviewEvent {
        review_id: review.id.clone(),
        conversation_id,
        document_id: review.document_id.clone(),
        revision_id: review.submitted_revision_id.clone(),
        turn_id: review.turn_id.clone().unwrap_or_default(),
        status: review.state.as_str().to_string(),
        lock_version: review.lock_version,
    }
}

/// Build review/card links for reviews whose submitting assistant message is
/// on the snapshot's active branch (or currently pending).
pub async fn summaries_for_conversation(
    db: &impl Snapshot,
    conversation_id: &str,
    visible_message_ids: &HashSet<&str>,
) -> Result<PlanReviewSummaryListResponse, String> {
    let mut summaries = Vec::new();
    for row in ops::list_reviews_for_conversation(db, conversation_id)
        .await
        .map_err(|error| error.to_string())?
    {
        let (Some(assistant_message_id), Some(provider_call_id), Some(turn_id)) = (
            row.assistant_message_id.clone(),
            row.provider_call_id.clone(),
            row.turn_id.clone(),
        ) else {
            continue;
        };
        if row.state != PlanReviewState::Pending && !visible_message_ids.contains(assistant_message_id.as_str()) {
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
            status: row.state.as_str().to_string(),
            lock_version: row.lock_version,
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
        .db
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
    ops::list_revisions(&app.services().db, &request.document_id)
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
    let (response, event) = services
        .db
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
            let event = event_for(bundle.document.conversation_id, &bundle.review);
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
        .db
        .write(async |tx| {
            let bundle = ops::discard_review_draft(tx, &request.review_id, request.expected_generation, now_ms())
                .await
                .map_err(|error| error.to_string())?;
            let event = event_for(bundle.document.conversation_id.clone(), &bundle.review);
            let response = bundle_response(tx, bundle).await?;
            Ok::<_, ops::PlanReviewStoreError>((response, event))
        })
        .await
        .map_err(|error| error.to_string())?;
    emit_review_update_best_effort(&services.events, &event);
    Ok(response)
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
        .db
        .write(async |tx| ops::retry_materialization_from_database(tx, &request.document_id, now).await)
        .await
        .map_err(|error| error.to_string())?;
    let report = services
        .plan_files
        .reconcile_document(&services.db, &request.document_id, now)
        .await
        .map_err(|error| error.to_string())?;
    if report.conflict.is_some() {
        return Err("plan.md is still in conflict after restoring the database revision".into());
    }
    services
        .db
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
    conversation_id: String,
    document_id: String,
    provider_kind: PlanReviewProviderKind,
    plan_markdown: String,
    edited_by_user: bool,
    feedback: Option<String>,
    replayed: bool,
}

#[tauri::command]
pub async fn decide_plan_review(
    app: tauri::AppHandle,
    request: PlanReviewDecisionRequest,
) -> Result<PlanReviewDecisionResponse, String> {
    let accept_edits = match (request.action, request.approval_mode.0) {
        (PlanReviewDecisionActionRequest::Approve, Some(PlanApprovalModeRequest::Default)) => Some(false),
        (PlanReviewDecisionActionRequest::Approve, Some(PlanApprovalModeRequest::AcceptEdits)) => Some(true),
        (PlanReviewDecisionActionRequest::Approve, None) => {
            return Err("approve requires approvalMode (`default` or `accept_edits`)".into());
        }
        (PlanReviewDecisionActionRequest::RequestChanges, Some(_)) => {
            return Err("request_changes requires approvalMode to be null".into());
        }
        (PlanReviewDecisionActionRequest::RequestChanges, None) => {
            if request.clear_context {
                return Err("request_changes cannot set clearContext".into());
            }
            None
        }
    };

    let services = app.services();

    // Check that a live turn is still parked on this review before committing.
    // If the turn already died (or the app restarted), orphan the stale review
    // instead of leaving an unreachable decision behind.
    let precheck = services
        .db
        .read(async |tx| ops::get_review_bundle(tx, &request.review_id).await)
        .await
        .map_err(|error| error.to_string())?;
    if precheck.review.state == PlanReviewState::Pending {
        let waiter_live = match precheck.review.provider_kind {
            PlanReviewProviderKind::Native => services.plan_reviews.has(&request.review_id),
            PlanReviewProviderKind::Acp => {
                #[cfg(not(target_os = "android"))]
                {
                    services
                        .acp
                        .get(&precheck.document.conversation_id)
                        .is_some_and(|session| session.has_pending_plan_review(&request.review_id))
                }
                #[cfg(target_os = "android")]
                {
                    false
                }
            }
            PlanReviewProviderKind::Legacy => false,
        };
        if !waiter_live {
            let orphaned = services
                .db
                .write(async |tx| {
                    ops::orphan_review(
                        tx,
                        &request.review_id,
                        "The planning turn ended before this review was decided",
                        now_ms(),
                    )
                    .await
                })
                .await
                .map_err(|error| error.to_string())?;
            if let Some((doc, rev)) = orphaned {
                emit_review_update_best_effort(&services.events, &event_for(doc.conversation_id, &rev));
            }
            return Err("This plan review is no longer active because its turn has already ended.".into());
        }
    }

    let commit = services
        .db
        .write(async |tx| {
            let before = ops::get_review_bundle(tx, &request.review_id).await?;
            let provider_kind = before.review.provider_kind;
            let conversation_id = before.document.conversation_id.clone();
            let action = match request.action {
                PlanReviewDecisionActionRequest::Approve => ops::PlanReviewDecisionAction::Approve,
                PlanReviewDecisionActionRequest::RequestChanges => ops::PlanReviewDecisionAction::RequestChanges,
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
                    accept_edits,
                    decision_summary: None,
                    now: now_ms(),
                },
            )
            .await?;

            let plan_markdown = result
                .approved_revision
                .as_ref()
                .map(|rev| rev.content_markdown.clone())
                .unwrap_or_else(|| before.submitted_revision.content_markdown.clone());
            let event = event_for(conversation_id.clone(), &result.review);
            Ok::<_, ops::PlanReviewStoreError>(DecisionCommit {
                response: PlanReviewDecisionResponse {
                    review_id: result.review.id,
                    state: result.review.state.as_str().to_string(),
                },
                event,
                conversation_id,
                document_id: result.document.id,
                provider_kind,
                plan_markdown,
                edited_by_user: result.edited_by_user,
                feedback: result.feedback,
                replayed: result.replayed,
            })
        })
        .await
        .map_err(|error| error.to_string())?;

    if !commit.replayed
        && request.action == PlanReviewDecisionActionRequest::Approve
        && commit.edited_by_user
        && let Err(error) = services
            .plan_files
            .reconcile_document(&services.db, &commit.document_id, now_ms())
            .await
    {
        tracing::warn!(%error, document_id = %commit.document_id, "could not sync edited approved plan.md");
    }

    emit_review_update_best_effort(&services.events, &commit.event);
    if request.action == PlanReviewDecisionActionRequest::Approve {
        let _ = services.events.emit_conversation_updated(&commit.conversation_id);
    }

    if !commit.replayed {
        match commit.provider_kind {
            PlanReviewProviderKind::Native => {
                if let Some(waiter) = services.plan_reviews.claim(&request.review_id) {
                    let resolution = match request.action {
                        PlanReviewDecisionActionRequest::Approve => PlanReviewResolution::Approved {
                            accept_edits: accept_edits.unwrap_or(false),
                            clear_context: request.clear_context,
                            plan_markdown: commit.plan_markdown,
                            edited_by_user: commit.edited_by_user,
                            feedback: commit.feedback,
                        },
                        PlanReviewDecisionActionRequest::RequestChanges => PlanReviewResolution::ChangesRequested {
                            feedback: commit.feedback.unwrap_or_default(),
                        },
                    };
                    let _ = waiter.sender.send(resolution);
                }
            }
            PlanReviewProviderKind::Acp => {
                #[cfg(not(target_os = "android"))]
                {
                    let session = services
                        .acp
                        .get(&commit.conversation_id)
                        .ok_or_else(|| "the Claude Code session is no longer running".to_string())?;
                    let accept_edits_flag = accept_edits.unwrap_or(false);
                    let resolution = match request.action {
                        PlanReviewDecisionActionRequest::Approve => {
                            meridian_core::acp::AcpPlanReviewResolution::Approve {
                                review_id: request.review_id.clone(),
                                accept_edits: accept_edits_flag,
                                clear_context: request.clear_context,
                                plan_markdown: commit.plan_markdown.clone(),
                                edited_by_user: commit.edited_by_user,
                                feedback: commit.feedback.clone(),
                            }
                        }
                        PlanReviewDecisionActionRequest::RequestChanges => {
                            meridian_core::acp::AcpPlanReviewResolution::RequestChanges {
                                review_id: request.review_id.clone(),
                                feedback: commit.feedback.clone().unwrap_or_default(),
                            }
                        }
                    };
                    session.resolve_plan_review(&services, resolution).await?;
                    if request.action == PlanReviewDecisionActionRequest::Approve && request.clear_context {
                        spawn_acp_clear_context_implementation(
                            services.clone(),
                            commit.conversation_id,
                            accept_edits_flag,
                            commit.plan_markdown,
                            commit.feedback,
                        );
                    }
                }
                #[cfg(target_os = "android")]
                {
                    return Err("ACP plan review is unavailable on Android".into());
                }
            }
            PlanReviewProviderKind::Legacy => {}
        }
    }

    Ok(commit.response)
}

#[cfg(not(target_os = "android"))]
fn spawn_acp_clear_context_implementation(
    services: meridian_core::services::Services,
    conversation_id: String,
    accept_edits: bool,
    plan_markdown: String,
    feedback: Option<String>,
) {
    tokio::spawn(async move {
        // Close the old ACP session (which also ends the cancelled ExitPlanMode turn).
        services.acp.close(&conversation_id).await;
        // Clear the persisted acp_session_id so reopening starts a fresh
        // `session/new` with empty context in the same working directory.
        let cleared = services
            .db
            .write(async |tx| {
                if let Some(row) = db::sea::ops::acp_session::get(tx, &conversation_id).await? {
                    db::sea::ops::acp_session::upsert(tx, &conversation_id, None, &row.cwd, now_ms()).await?;
                }
                Ok::<_, db::sea::DbErr>(())
            })
            .await;
        if let Err(error) = cleared {
            tracing::error!(%error, %conversation_id, "could not reset ACP session for clear-context plan");
            return;
        }
        let session = match meridian_core::acp::reopen_session(&services, &conversation_id).await {
            Ok(session) => session,
            Err(error) => {
                tracing::error!(%error, %conversation_id, "could not open fresh ACP session for clear-context plan");
                return;
            }
        };
        session
            .set_mode_if_available(if accept_edits { "acceptEdits" } else { "default" })
            .await;
        let mut prompt = format!("Implement the following plan:\n\n{}", plan_markdown.trim());
        if let Some(fb) = feedback.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            prompt.push_str("\n\n## User notes / feedback\n");
            prompt.push_str(fb);
        }
        if let Err(error) = session.prompt(&services, &prompt, None).await {
            tracing::error!(%error, %conversation_id, "clear-context ACP plan implementation turn failed");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rich_draft_request_carries_an_immutable_baseline_separately_from_the_edit() {
        let request: PlanReviewDraftSaveRequest = serde_json::from_value(serde_json::json!({
            "reviewId": "review-1",
            "expectedGeneration": 0,
            "mode": "rich",
            "baseEditorJson": {"type":"doc","content":[{"type":"paragraph"}]},
            "editorJson": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"edited"}]}]},
            "sourceText": null,
            "normalizedMarkdown": "edited\n",
            "baseNormalizedMarkdown": "\n",
            "comments": [],
            "globalNote": null,
            "selection": null,
            "editorSchemaVersion": 1,
            "editorSchemaHash": "meridian-plan-markdown-v1",
            "editorSchemaFallback": null
        }))
        .unwrap();
        assert_eq!(request.review_id, "review-1");
        assert!(request.base_editor_json.0.is_some());
        assert!(request.editor_json.0.is_some());
    }

    #[test]
    fn decision_request_requires_approval_mode_and_clear_context_explicitly() {
        let approve: PlanReviewDecisionRequest = serde_json::from_value(serde_json::json!({
            "reviewId": "r1",
            "decisionId": "d1",
            "expectedGeneration": 0,
            "expectedDraftHash": "abc",
            "action": "approve",
            "approvalMode": "accept_edits",
            "clearContext": true
        }))
        .unwrap();
        assert_eq!(approve.approval_mode.0, Some(PlanApprovalModeRequest::AcceptEdits));
        assert!(approve.clear_context);

        let missing_mode = serde_json::from_value::<PlanReviewDecisionRequest>(serde_json::json!({
            "reviewId": "r1",
            "decisionId": "d1",
            "expectedGeneration": 0,
            "expectedDraftHash": "abc",
            "action": "approve",
            "clearContext": false
        }));
        assert!(missing_mode.is_err());
    }
}
