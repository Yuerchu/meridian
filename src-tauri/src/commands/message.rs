use diesel::Connection;

use crate::ServicesExt;
use crate::commands::entity_response::ConversationInfoResponse;
use meridian_core::agent::{parse_stored_tool_calls, sub_agents::SubAgentKind as CoreSubAgentKind};
use meridian_core::db;
use meridian_core::db::models::message::MessageRow;
use meridian_core::db::models::turn::{TurnPhase as CoreTurnPhase, TurnStatus as CoreTurnStatus};
use meridian_core::events::{
    AutoReviewAuthorization as CoreAutoReviewAuthorization, AutoReviewEvidence as CoreAutoReviewEvidence,
    AutoReviewOutcome as CoreAutoReviewOutcome, AutoReviewRisk as CoreAutoReviewRisk,
    AutoReviewStage as CoreAutoReviewStage, AutoReviewVerdict as CoreAutoReviewVerdict, ToolOutcome as CoreToolOutcome,
};
use meridian_core::workspace::reference::MessageContextKind as CoreMessageContextKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallKind {
    Function,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Assistant,
    Tool,
    Context,
}

impl From<db::models::message::MessageRole> for MessageRole {
    fn from(role: db::models::message::MessageRole) -> Self {
        match role {
            db::models::message::MessageRole::User => Self::User,
            db::models::message::MessageRole::Assistant => Self::Assistant,
            db::models::message::MessageRole::Tool => Self::Tool,
            db::models::message::MessageRole::Context => Self::Context,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolCallFunctionResponse {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolCallInfoResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ToolCallKind,
    pub function: ToolCallFunctionResponse,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadedImageResponse {
    pub url: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadedFileResponse {
    pub url: String,
    pub mime_type: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UploadFileResponse {
    ImageUrl { image_url: UploadedImageResponse },
    File { file: UploadedFileResponse },
}

impl UploadFileResponse {
    pub fn from_stored(uri: String, mime_type: String, name: String) -> Self {
        if mime_type.starts_with("image/") {
            Self::ImageUrl {
                image_url: UploadedImageResponse { url: uri },
            }
        } else {
            Self::File {
                file: UploadedFileResponse {
                    url: uri,
                    mime_type,
                    name,
                },
            }
        }
    }
}

impl From<meridian_core::provider::ToolCall> for ToolCallInfoResponse {
    fn from(call: meridian_core::provider::ToolCall) -> Self {
        Self {
            id: call.id,
            kind: ToolCallKind::Function,
            function: ToolCallFunctionResponse {
                name: call.name,
                arguments: call.arguments,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageSource {
    Voice,
    Shell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageContextKind {
    ProjectFile,
    ProjectDirectory,
    ShellOutput,
    Conversation,
}

impl From<CoreMessageContextKind> for MessageContextKind {
    fn from(kind: CoreMessageContextKind) -> Self {
        match kind {
            CoreMessageContextKind::ProjectFile => Self::ProjectFile,
            CoreMessageContextKind::ProjectDirectory => Self::ProjectDirectory,
            CoreMessageContextKind::ShellOutput => Self::ShellOutput,
            CoreMessageContextKind::Conversation => Self::Conversation,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum MessageRating {
    Negative,
    Positive,
}

impl TryFrom<i32> for MessageRating {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            -1 => Ok(Self::Negative),
            1 => Ok(Self::Positive),
            _ => Err(format!("unknown message rating {value}; expected -1 or 1")),
        }
    }
}

impl From<MessageRating> for i32 {
    fn from(rating: MessageRating) -> Self {
        match rating {
            MessageRating::Negative => -1,
            MessageRating::Positive => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolOutcome {
    Success,
    Denied,
    Error,
}

impl From<CoreToolOutcome> for ToolOutcome {
    fn from(outcome: CoreToolOutcome) -> Self {
        match outcome {
            CoreToolOutcome::Success => Self::Success,
            CoreToolOutcome::Denied => Self::Denied,
            CoreToolOutcome::Error => Self::Error,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MessageContextInfoResponse {
    pub id: String,
    pub position: i32,
    pub kind: MessageContextKind,
    pub display_path: Option<String>,
    pub line_start: Option<i32>,
    pub line_end: Option<i32>,
    pub byte_count: i32,
    pub line_count: i32,
    pub token_count: i32,
    pub truncated: bool,
}

impl TryFrom<db::models::message_context_item::MessageContextItemRow> for MessageContextInfoResponse {
    type Error = String;

    fn try_from(row: db::models::message_context_item::MessageContextItemRow) -> Result<Self, Self::Error> {
        if row.id.is_empty() {
            return Err("message context item id must not be empty".to_string());
        }
        if row.position < 0 || row.byte_count < 0 || row.line_count < 0 || row.token_count < 0 {
            return Err(format!("message context item {} has negative counts", row.id));
        }
        if row.line_start.is_some_and(|value| value <= 0)
            || row.line_end.is_some_and(|value| value <= 0)
            || matches!((row.line_start, row.line_end), (Some(start), Some(end)) if end < start)
        {
            return Err(format!("message context item {} has an invalid line range", row.id));
        }
        let truncated = match row.truncated {
            0 => false,
            1 => true,
            value => {
                return Err(format!(
                    "message context item {} has invalid truncated value {value}; expected 0 or 1",
                    row.id
                ));
            }
        };
        let core_kind = CoreMessageContextKind::parse(&row.kind)?;
        match core_kind {
            CoreMessageContextKind::ProjectFile => {
                if row.display_path.as_deref().is_none_or(str::is_empty) {
                    return Err(format!("project file context item {} has no display_path", row.id));
                }
                if row.line_start.is_some() != row.line_end.is_some() {
                    return Err(format!("project file context item {} has a partial line range", row.id));
                }
            }
            CoreMessageContextKind::ProjectDirectory => {
                if row.display_path.as_deref().is_none_or(str::is_empty) {
                    return Err(format!("project directory context item {} has no display_path", row.id));
                }
                if row.line_start.is_some() || row.line_end.is_some() {
                    return Err(format!("project directory context item {} has a line range", row.id));
                }
            }
            CoreMessageContextKind::ShellOutput => {
                if row.display_path.is_some() || row.line_start.is_some() || row.line_end.is_some() {
                    return Err(format!("shell output context item {} has file metadata", row.id));
                }
            }
            CoreMessageContextKind::Conversation => {
                // `display_path` carries the referenced conversation's title —
                // the hosted prompt path and the transcript chip both read it.
                if row.display_path.as_deref().is_none_or(str::is_empty) {
                    return Err(format!("conversation context item {} has no title", row.id));
                }
                if row.line_start.is_some() || row.line_end.is_some() {
                    return Err(format!("conversation context item {} has a line range", row.id));
                }
            }
        }
        Ok(Self {
            id: row.id,
            position: row.position,
            kind: core_kind.into(),
            display_path: row.display_path,
            line_start: row.line_start,
            line_end: row.line_end,
            byte_count: row.byte_count,
            line_count: row.line_count,
            token_count: row.token_count,
            truncated,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewOutcome {
    Allow,
    Deny,
    Unreadable,
}

impl From<CoreAutoReviewOutcome> for AutoReviewOutcome {
    fn from(outcome: CoreAutoReviewOutcome) -> Self {
        match outcome {
            CoreAutoReviewOutcome::Allow => Self::Allow,
            CoreAutoReviewOutcome::Deny => Self::Deny,
            CoreAutoReviewOutcome::Unreadable => Self::Unreadable,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewRisk {
    Low,
    Medium,
    High,
    Critical,
}

impl From<CoreAutoReviewRisk> for AutoReviewRisk {
    fn from(risk: CoreAutoReviewRisk) -> Self {
        match risk {
            CoreAutoReviewRisk::Low => Self::Low,
            CoreAutoReviewRisk::Medium => Self::Medium,
            CoreAutoReviewRisk::High => Self::High,
            CoreAutoReviewRisk::Critical => Self::Critical,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewAuthorization {
    Unknown,
    Low,
    Medium,
    High,
}

impl From<CoreAutoReviewAuthorization> for AutoReviewAuthorization {
    fn from(authorization: CoreAutoReviewAuthorization) -> Self {
        match authorization {
            CoreAutoReviewAuthorization::Unknown => Self::Unknown,
            CoreAutoReviewAuthorization::Low => Self::Low,
            CoreAutoReviewAuthorization::Medium => Self::Medium,
            CoreAutoReviewAuthorization::High => Self::High,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoReviewStage {
    Quick,
    Investigate,
}

impl From<CoreAutoReviewStage> for AutoReviewStage {
    fn from(stage: CoreAutoReviewStage) -> Self {
        match stage {
            CoreAutoReviewStage::Quick => Self::Quick,
            CoreAutoReviewStage::Investigate => Self::Investigate,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AutoReviewEvidenceInfoResponse {
    pub tool: String,
    pub arguments: String,
}

impl From<CoreAutoReviewEvidence> for AutoReviewEvidenceInfoResponse {
    fn from(evidence: CoreAutoReviewEvidence) -> Self {
        Self {
            tool: evidence.tool,
            arguments: evidence.arguments,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AutoReviewVerdictInfoResponse {
    pub outcome: AutoReviewOutcome,
    pub risk: Option<AutoReviewRisk>,
    pub authorization: Option<AutoReviewAuthorization>,
    pub rationale: Option<String>,
    pub stage: Option<AutoReviewStage>,
    pub model: Option<String>,
    pub evidence: Vec<AutoReviewEvidenceInfoResponse>,
}

impl From<CoreAutoReviewVerdict> for AutoReviewVerdictInfoResponse {
    fn from(verdict: CoreAutoReviewVerdict) -> Self {
        Self {
            outcome: verdict.outcome.into(),
            risk: verdict.risk.map(Into::into),
            authorization: verdict.authorization.map(Into::into),
            rationale: verdict.rationale,
            stage: verdict.stage.map(Into::into),
            model: verdict.model,
            evidence: verdict.evidence.into_iter().map(Into::into).collect(),
        }
    }
}

/// The public transcript shape. Database rows are not serializable: adding an
/// internal column must require an explicit decision here before it can cross
/// the Tauri boundary.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MessageInfoResponse {
    pub id: String,
    pub conversation_id: String,
    pub role: MessageRole,
    pub content: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub tool_calls: Option<Vec<ToolCallInfoResponse>>,
    pub tool_call_id: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub reasoning_content: Option<String>,
    pub rating: Option<MessageRating>,
    pub is_compact_summary: bool,
    pub sender_id: Option<i64>,
    pub parent_id: Option<String>,
    pub compact_anchor_id: Option<String>,
    pub source: Option<MessageSource>,
    pub turn_id: Option<String>,
    pub tool_outcome: Option<ToolOutcome>,
    pub cache_read_tokens: Option<i32>,
    pub cache_write_tokens: Option<i32>,
    pub provider_name: Option<String>,
    /// Automatic-review verdicts for this row's tool calls, keyed by call id.
    /// Crosses the boundary because the card that shows a denied call has to be
    /// able to say who denied it and why — a reload that lost the reason would
    /// leave the model's refusal looking like its own choice.
    pub auto_review: Option<std::collections::BTreeMap<String, AutoReviewVerdictInfoResponse>>,
    /// Descriptors only. Raw file snapshots and command output stay behind the
    /// provider/preview boundary.
    pub context_items: Vec<MessageContextInfoResponse>,
}

impl TryFrom<MessageRow> for MessageInfoResponse {
    type Error = String;

    fn try_from(row: MessageRow) -> Result<Self, Self::Error> {
        let role = db::models::message::MessageRole::parse(&row.role)?;
        match (role, row.tool_call_id.as_deref()) {
            (db::models::message::MessageRole::Tool, Some(call_id)) if !call_id.is_empty() => {}
            (db::models::message::MessageRole::Tool, _) => {
                return Err(format!("tool message {} is missing tool_call_id", row.id));
            }
            (_, Some(_)) => return Err(format!("non-tool message {} has a tool_call_id", row.id)),
            (_, None) => {}
        }
        for (field, value) in [
            ("input_tokens", row.input_tokens),
            ("output_tokens", row.output_tokens),
            ("cache_read_tokens", row.cache_read_tokens),
            ("cache_write_tokens", row.cache_write_tokens),
        ] {
            if value.is_some_and(|value| value < 0) {
                return Err(format!("message {} has negative {field}", row.id));
            }
        }
        if !matches!(row.rating, None | Some(-1 | 1)) {
            return Err(format!("message {} has invalid rating", row.id));
        }
        if row.rating.is_some() && role != db::models::message::MessageRole::Assistant {
            return Err(format!("non-assistant message {} has a rating", row.id));
        }
        let is_compact_summary = match row.is_compact_summary {
            0 => false,
            1 => true,
            value => {
                return Err(format!(
                    "message {} has invalid is_compact_summary {value}; expected 0 or 1",
                    row.id
                ));
            }
        };
        let stored_tool_calls = match role {
            db::models::message::MessageRole::Assistant => {
                parse_stored_tool_calls(row.schema_version, row.tool_calls.as_deref())
                    .map_err(|error| format!("message {} has invalid persisted tool_calls: {error}", row.id))?
            }
            _ if row.tool_calls.is_some() => {
                return Err(format!("non-assistant message {} has persisted tool_calls", row.id));
            }
            _ => Vec::new(),
        };
        let auto_review = row
            .auto_review
            .as_deref()
            .map(|raw| {
                serde_json::from_str::<std::collections::BTreeMap<String, CoreAutoReviewVerdict>>(raw)
                    .map(|verdicts| {
                        verdicts
                            .into_iter()
                            .map(|(call_id, verdict)| (call_id, verdict.into()))
                            .collect::<std::collections::BTreeMap<_, _>>()
                    })
                    .map_err(|error| format!("message {} has invalid persisted auto_review: {error}", row.id))
            })
            .transpose()?;
        if auto_review.is_some() && role != db::models::message::MessageRole::Assistant {
            return Err(format!("non-assistant message {} has auto_review metadata", row.id));
        }
        let auto_review = auto_review.map(|mut verdicts| {
            let call_ids = stored_tool_calls
                .iter()
                .map(|call| call.id.as_str())
                .collect::<std::collections::BTreeSet<_>>();
            verdicts.retain(|call_id, _| !call_id.is_empty() && call_ids.contains(call_id.as_str()));
            verdicts
        });
        let tool_calls = row
            .tool_calls
            .is_some()
            .then(|| stored_tool_calls.into_iter().map(Into::into).collect());
        let tool_outcome = row
            .tool_outcome
            .as_deref()
            .map(CoreToolOutcome::parse)
            .transpose()?
            .map(Into::into);
        if tool_outcome.is_some() && role != db::models::message::MessageRole::Tool {
            return Err(format!("non-tool message {} has a tool_outcome", row.id));
        }
        let source = match (role, row.source.as_deref()) {
            (_, None) | (db::models::message::MessageRole::Context, Some(_)) => None,
            (db::models::message::MessageRole::User, Some("voice")) => Some(MessageSource::Voice),
            (db::models::message::MessageRole::User, Some("shell")) => Some(MessageSource::Shell),
            (_, Some(source)) => return Err(format!("message {} has invalid public source {source:?}", row.id)),
        };
        // Context rows carry frozen memory and other injected background. The
        // transcript needs their ids to preserve the branch shape, not their
        // private prompt body.
        let content = if role == db::models::message::MessageRole::Context {
            String::new()
        } else {
            row.content
        };
        Ok(Self {
            id: row.id,
            conversation_id: row.conversation_id,
            role: role.into(),
            content,
            provider_id: row.provider_id,
            model_id: row.model_id,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            tool_calls,
            tool_call_id: row.tool_call_id,
            sort_order: row.sort_order,
            created_at: row.created_at,
            reasoning_content: row.reasoning_content,
            rating: row.rating.map(MessageRating::try_from).transpose()?,
            is_compact_summary,
            sender_id: row.sender_id,
            parent_id: row.parent_id,
            compact_anchor_id: row.compact_anchor_id,
            source,
            turn_id: row.turn_id,
            tool_outcome,
            cache_read_tokens: row.cache_read_tokens,
            cache_write_tokens: row.cache_write_tokens,
            provider_name: row.provider_name,
            auto_review,
            context_items: Vec::new(),
        })
    }
}

impl MessageInfoResponse {
    fn with_context_items(
        mut self,
        items: Vec<db::models::message_context_item::MessageContextItemRow>,
    ) -> Result<Self, String> {
        if !items.is_empty() && self.role != MessageRole::User {
            return Err(format!("non-user message {} has context items", self.id));
        }
        self.context_items = items
            .into_iter()
            .enumerate()
            .map(|(position, item)| {
                if item.message_id != self.id {
                    return Err(format!(
                        "message context item {} belongs to {}, not {}",
                        item.id, item.message_id, self.id
                    ));
                }
                if item.position != position as i32 {
                    return Err(format!(
                        "message context item {} has non-contiguous position {}",
                        item.id, item.position
                    ));
                }
                item.try_into()
            })
            .collect::<Result<_, _>>()?;
        Ok(self)
    }
}

/// The active path, the summary that applies to it, and where it can be paged.
///
/// Returned as one snapshot so the caller never renders a half-applied state:
/// fetching the messages and the branch points separately would leave a frame
/// where the pagers describe a path that is no longer on screen.
pub type MessageListResponse = Vec<MessageInfoResponse>;
pub type BranchPointListResponse = Vec<BranchPointInfoResponse>;

#[derive(serde::Serialize)]
pub struct MessageTreeResponse {
    /// The summary, when one applies, is appended rather than placed in order —
    /// the front end picks it out by `is_compact_summary` and draws it as a
    /// boundary marker, not as part of the transcript.
    pub messages: MessageListResponse,
    pub head_message_id: Option<String>,
    pub branches: BranchPointListResponse,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchPointInfoResponse {
    pub message_id: String,
    pub index: usize,
    pub total: usize,
    pub sibling_ids: Vec<String>,
}

impl From<db::ops::message::BranchPoint> for BranchPointInfoResponse {
    fn from(point: db::ops::message::BranchPoint) -> Self {
        Self {
            message_id: point.message_id,
            index: point.index,
            total: point.total,
            sibling_ids: point.sibling_ids,
        }
    }
}

#[derive(serde::Serialize)]
pub struct MessageContextContentResponse {
    pub descriptor: MessageContextInfoResponse,
    pub content: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageContextReadRequest {
    pub conversation_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationSnapshotRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageBranchSwitchRequest {
    pub conversation_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageDeleteRequest {
    pub conversation_id: String,
    pub id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageRatingUpdateRequest {
    pub id: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub rating: Option<MessageRating>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationExportRequest {
    pub conversation_id: String,
    pub format: ConversationExportFormat,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ConversationExportResponse {
    pub path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageFileUploadRequest {
    pub conversation_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageFileBytesUploadRequest {
    pub conversation_id: String,
    pub file_name: String,
    /// The file's bytes, base64-encoded — Android has no raw IPC, and one
    /// encoding shared by every platform beats a fast path only some have.
    pub data_base64: String,
}

/// Read raw context only while its owning message is on this conversation's
/// active branch. Knowing an item UUID is not authority to read a sibling's
/// repository snapshot or command output.
#[tauri::command]
pub async fn read_message_context_item(
    app: tauri::AppHandle,
    request: MessageContextReadRequest,
) -> Result<MessageContextContentResponse, String> {
    let MessageContextReadRequest {
        conversation_id,
        item_id,
    } = request;
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            let conv = db::ops::conversation::get_conversation(conn, &conversation_id)?;
            let history = db::ops::message::list_messages(conn, &conversation_id)?;
            let active = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
            let active_ids = active.path.into_iter().map(|row| row.id).collect::<Vec<_>>();
            let mut rows = db::ops::message_context_item::list_for_messages(conn, &active_ids)?
                .into_values()
                .flatten()
                .filter(|item| item.id == item_id);
            let item = rows.next().ok_or(diesel::result::Error::NotFound)?;
            let descriptor = MessageContextInfoResponse::try_from(item.clone())
                .map_err(|error| diesel::result::Error::SerializationError(Box::new(std::io::Error::other(error))))?;
            Ok(MessageContextContentResponse {
                descriptor,
                content: item.content,
            })
        })
        .map_err(|e| {
            if matches!(e, diesel::result::Error::NotFound) {
                "context item is not on the active conversation branch".to_string()
            } else {
                e.to_string()
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_tree_with_conversation(
    conn: &mut db::PooledConn,
    conversation_id: &str,
) -> Result<(db::models::conversation::ConversationRow, MessageTreeResponse), String> {
    let conv = db::ops::conversation::get_conversation(conn, conversation_id).map_err(|e| e.to_string())?;
    let history = db::ops::message::list_messages(conn, conversation_id).map_err(|e| e.to_string())?;
    let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
    let branches = db::ops::message::branch_points(&history, &ctx.path)
        .into_iter()
        .map(Into::into)
        .collect();
    let head_message_id = ctx.head_id.clone();
    let ids = ctx.path.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let mut context_items = db::ops::message_context_item::list_for_messages(conn, &ids).map_err(|e| e.to_string())?;
    let mut messages = ctx
        .path
        .into_iter()
        .map(|row| {
            let items = context_items.remove(&row.id).unwrap_or_default();
            MessageInfoResponse::try_from(row).and_then(|message| message.with_context_items(items))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(summary) = ctx.summary {
        messages.push(summary.try_into()?);
    }
    Ok((
        conv,
        MessageTreeResponse {
            messages,
            head_message_id,
            branches,
        },
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Running,
    WaitingReview,
    Done,
    Cancelled,
    Failed,
    Interrupted,
}

impl From<CoreTurnStatus> for TurnStatus {
    fn from(status: CoreTurnStatus) -> Self {
        match status {
            CoreTurnStatus::Running => Self::Running,
            CoreTurnStatus::WaitingReview => Self::WaitingReview,
            CoreTurnStatus::Done => Self::Done,
            CoreTurnStatus::Cancelled => Self::Cancelled,
            CoreTurnStatus::Failed => Self::Failed,
            CoreTurnStatus::Interrupted => Self::Interrupted,
        }
    }
}

#[cfg(test)]
impl TurnStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::WaitingReview => "waiting_review",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnPhase {
    Streaming,
    AwaitingApproval,
    RunningTool,
    Compacting,
}

impl From<CoreTurnPhase> for TurnPhase {
    fn from(phase: CoreTurnPhase) -> Self {
        match phase {
            CoreTurnPhase::Streaming => Self::Streaming,
            CoreTurnPhase::AwaitingApproval => Self::AwaitingApproval,
            CoreTurnPhase::RunningTool => Self::RunningTool,
            CoreTurnPhase::Compacting => Self::Compacting,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnPricingStatus {
    Exact,
    Estimated,
    LowerBound,
    Subscription,
    External,
    Unavailable,
}

impl From<db::ops::usage::TurnPricingStatus> for TurnPricingStatus {
    fn from(status: db::ops::usage::TurnPricingStatus) -> Self {
        match status {
            db::ops::usage::TurnPricingStatus::Exact => Self::Exact,
            db::ops::usage::TurnPricingStatus::Estimated => Self::Estimated,
            db::ops::usage::TurnPricingStatus::LowerBound => Self::LowerBound,
            db::ops::usage::TurnPricingStatus::Subscription => Self::Subscription,
            db::ops::usage::TurnPricingStatus::External => Self::External,
            db::ops::usage::TurnPricingStatus::Unavailable => Self::Unavailable,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TurnUsageInfoResponse {
    pub messages: i64,
    pub missing_token_usage_messages: i64,
    pub incomplete_token_usage_messages: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub server_tool_calls: i64,
    pub input_cost: Option<meridian_core::decimal::Decimal>,
    pub output_cost: Option<meridian_core::decimal::Decimal>,
    pub cache_cost: Option<meridian_core::decimal::Decimal>,
    pub tool_cost: Option<meridian_core::decimal::Decimal>,
    pub total_cost: Option<meridian_core::decimal::Decimal>,
    pub unpriced_token_messages: i64,
    pub unpriced_input_messages: i64,
    pub unpriced_output_messages: i64,
    pub unpriced_cache_messages: i64,
    pub unpriced_tool_messages: i64,
    pub estimated_token_messages: i64,
    pub estimated_tool_messages: i64,
    pub estimated_messages: i64,
    pub unpriced_messages: i64,
    pub metered_messages: i64,
    pub subscription_messages: i64,
    pub external_messages: i64,
    pub pricing_status: TurnPricingStatus,
}

impl From<db::ops::usage::TurnUsageSummary> for TurnUsageInfoResponse {
    fn from(usage: db::ops::usage::TurnUsageSummary) -> Self {
        Self {
            messages: usage.messages,
            missing_token_usage_messages: usage.missing_token_usage_messages,
            incomplete_token_usage_messages: usage.incomplete_token_usage_messages,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_tokens: usage.cache_read_tokens,
            cache_write_tokens: usage.cache_write_tokens,
            server_tool_calls: usage.server_tool_calls,
            input_cost: usage.input_cost,
            output_cost: usage.output_cost,
            cache_cost: usage.cache_cost,
            tool_cost: usage.tool_cost,
            total_cost: usage.total_cost,
            unpriced_token_messages: usage.unpriced_token_messages,
            unpriced_input_messages: usage.unpriced_input_messages,
            unpriced_output_messages: usage.unpriced_output_messages,
            unpriced_cache_messages: usage.unpriced_cache_messages,
            unpriced_tool_messages: usage.unpriced_tool_messages,
            estimated_token_messages: usage.estimated_token_messages,
            estimated_tool_messages: usage.estimated_tool_messages,
            estimated_messages: usage.estimated_messages,
            unpriced_messages: usage.unpriced_messages,
            metered_messages: usage.metered_messages,
            subscription_messages: usage.subscription_messages,
            external_messages: usage.external_messages,
            pricing_status: usage.pricing_status.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubAgentKind {
    Explore,
    Agent,
}

impl From<CoreSubAgentKind> for SubAgentKind {
    fn from(kind: CoreSubAgentKind) -> Self {
        match kind {
            CoreSubAgentKind::Explore => Self::Explore,
            CoreSubAgentKind::Agent => Self::Agent,
        }
    }
}

/// A turn as the transcript needs it: how it ended, and what it was doing.
///
/// `status` is not the stored column. A turn that stopped without recording an
/// ending leaves `running` behind, and reconciliation only rewrites those at
/// startup, so the row alone would have a turn that ended an hour ago read as
/// one still in progress. The coordinator decides, and the answer arrives
/// already decided — the front end has no way to ask.
///
/// What it does not say is why. The rule is "no recorded ending, and not being
/// run", which the application being killed satisfies and so does a task that
/// panicked while it carried on.
#[derive(serde::Serialize)]
pub struct TurnInfoResponse {
    pub id: String,
    pub status: TurnStatus,
    pub phase: Option<TurnPhase>,
    pub phase_tool: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// Durable, audit-backed cost for this turn. `None` means no billed audit
    /// row carried this turn id; pricing status inside distinguishes an exact
    /// local zero from subscription/external/unavailable cost.
    pub usage: Option<TurnUsageInfoResponse>,
}

/// A delegated run as the card on the parent's turn needs it.
///
/// `status` is judged the same way `TurnInfoResponse`'s is, against the coordinator —
/// but against the *sub-agent's* conversation, not the parent's. The parent's
/// revision does not move when a child's lease is taken or released, so reusing
/// the parent's reading here would leave a sub-agent that died in a panic
/// spinning on the card for ever.
#[derive(serde::Serialize)]
pub struct SubAgentRunInfoResponse {
    pub conversation_id: String,
    pub spawned_by_message_id: Option<String>,
    pub spawned_by_call_id: Option<String>,
    pub spawned_turn_id: Option<String>,
    pub agent_kind: SubAgentKind,
    pub title: Option<String>,
    pub steps: i64,
    /// `None` when the delegating turn's row has gone. The card reads that as
    /// "no longer running" rather than inventing an ending.
    pub status: Option<TurnStatus>,
}

fn parse_sub_agent_kind(value: Option<&str>, conversation_id: &str) -> Result<SubAgentKind, String> {
    let value = value.ok_or_else(|| format!("delegated conversation {conversation_id} is missing agent_kind"))?;
    CoreSubAgentKind::parse(value)
        .map(Into::into)
        .map_err(|error| format!("delegated conversation {conversation_id}: {error}"))
}

/// Everything one conversation needs to be drawn, as of one moment.
pub type TurnListResponse = Vec<TurnInfoResponse>;
pub type SubAgentRunListResponse = Vec<SubAgentRunInfoResponse>;

#[derive(serde::Serialize)]
pub struct ConversationSnapshotResponse {
    pub conversation: ConversationInfoResponse,
    pub tree: MessageTreeResponse,
    pub turns: TurnListResponse,
    pub pending_approvals: crate::commands::approval::PendingApprovalListResponse,
    pub plan_reviews: crate::commands::plan_review::PlanReviewSummaryListResponse,
    /// Durable conversation-wide gate. Unlike `plan_reviews`, this does not
    /// depend on which transcript branch is currently visible.
    pub plan_review_barrier: bool,
    /// Empty for every conversation that has never delegated.
    pub sub_agent_runs: SubAgentRunListResponse,
}

/// One conversation, read as one state rather than assembled from several.
///
/// Replaces three parallel commands. Those could interleave with a running
/// turn — the tree read before a tool result landed, the turns read after —
/// and the front end would draw a conversation that was never true at any
/// instant, with a turn recorded as finished above a transcript that stops
/// mid-tool.
///
/// Three reads, and neither ordering of the first two is safe on its own:
///
/// 1. **The coordinator, then the database, then the coordinator again.**
///    Reading the register first and trusting it lets a turn start in the gap:
///    the register says nobody is running, the transaction then reads that
///    turn's fresh `running` row, and a live turn is reported as one that
///    crashed. Reading it afterwards has the mirror fault — a turn that
///    finished cleanly in the gap leaves its row read as `running` and its
///    lease already gone. So the register is read on both sides and the pass is
///    only believed if it did not move; `Observed` carries a revision because
///    comparing the held id would miss "nobody, then a short turn, then nobody
///    again", which is the sequence that produces exactly this.
/// 2. **The database, in one transaction.** WAL gives a deferred transaction a
///    consistent view from its first read, so the head, the messages and the
///    turns all describe the same instant. Without it a row written between two
///    of the queries produces a state that never existed.
/// 3. **The approval registry, last.** It is memory, not rows, so it cannot
///    join the transaction — but read after the tree, every approval belonging
///    to a row that was read is visible. Read first, one registered in between
///    would be missing while its row was present, and a live card would draw as
///    orphaned. The other way round, an approval for a row not in the tree
///    matches nothing and is dropped, which costs nothing.
#[tauri::command]
pub async fn conversation_snapshot(
    app: tauri::AppHandle,
    request: ConversationSnapshotRequest,
) -> Result<ConversationSnapshotResponse, String> {
    let ConversationSnapshotRequest { conversation_id } = request;
    let services = app.services();
    let coordinator = services.turns.clone();
    let pool = services.db.clone();

    let mut settled = None;
    for attempt in 0..SNAPSHOT_ATTEMPTS {
        // The children have to be named before the coordinator is read, because
        // each of them is a separate entry in it. Reading them after would leave
        // a sub-agent spawned in the gap judged against a reading that never
        // looked at its conversation.
        let children = children_off_thread(&pool, &conversation_id).await?;
        let mut seen = Vec::with_capacity(children.len() + 1);
        seen.push(coordinator.observe(&conversation_id));
        seen.extend(children.iter().map(|c| coordinator.observe(c)));

        let read = read_off_thread(&pool, &conversation_id, Live::Holding(&seen)).await?;

        // Two ways this pass can be unusable: something started or stopped in
        // one of the conversations, or the set of conversations itself changed —
        // a run delegated between naming the children and reading them would be
        // judged against no reading at all.
        let same_children = read
            .3
            .iter()
            .map(|r| r.conversation_id.as_str())
            .eq(children.iter().map(String::as_str));
        if same_children && seen.iter().all(|s| coordinator.unchanged_since(s)) {
            settled = Some(read);
            break;
        }
        tracing::debug!(
            conversation_id = %conversation_id,
            attempt,
            "a turn or a sub-agent started or ended mid-snapshot; reading again",
        );
    }

    let (conversation, tree, turns, sub_agent_runs, plan_reviews, plan_review_barrier) = match settled {
        Some(read) => read,
        // Turns are starting and stopping faster than the conversation can be
        // read. Rather than pick one of the passes and hope, this one refuses to
        // call anything interrupted: a crash that really happened is still there
        // at the next open, whereas a live turn labelled as crashed is a lie the
        // user reads now.
        None => {
            tracing::warn!(
                conversation_id = %conversation_id,
                "could not read this conversation and its turns as one state",
            );
            read_off_thread(&pool, &conversation_id, Live::Unsettled).await?
        }
    };

    let pending_approvals = crate::commands::approval::pending_for(&app, &conversation_id);
    Ok(ConversationSnapshotResponse {
        conversation: conversation.try_into()?,
        tree,
        turns,
        pending_approvals,
        plan_reviews,
        plan_review_barrier,
        sub_agent_runs,
    })
}

/// How many passes before the snapshot gives up on pinning the coordinator down.
///
/// Occupancy changes once when a turn starts and once when it ends, not per
/// token, so a second pass is already unusual and a fourth means something is
/// hammering this process.
const SNAPSHOT_ATTEMPTS: usize = 4;

type SnapshotRead = (
    db::models::conversation::ConversationRow,
    MessageTreeResponse,
    Vec<TurnInfoResponse>,
    Vec<SubAgentRunInfoResponse>,
    crate::commands::plan_review::PlanReviewSummaryListResponse,
    bool,
);

async fn children_off_thread(pool: &db::DbPool, conversation_id: &str) -> Result<Vec<String>, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::sub_agent_conversation_ids(&mut conn, &conv_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn read_off_thread(pool: &db::DbPool, conversation_id: &str, live: Live<'_>) -> Result<SnapshotRead, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    let live = live.owned();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        read_snapshot(&mut conn, &conv_id, &live)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the coordinator had to say about the conversations being read, or that
/// it would not hold still long enough to say anything.
///
/// Several conversations, not one: a turn and every sub-agent it delegated to
/// occupy separate entries, and a row is only judged against the reading of its
/// own conversation.
#[derive(Clone)]
enum Live<'a> {
    Holding(&'a [meridian_core::turn::Observed]),
    /// It kept moving. No row is called interrupted on this pass.
    Unsettled,
}

/// The same thing, minus the borrow, for crossing into `spawn_blocking`.
#[derive(Clone)]
enum OwnedLive {
    Holding(std::collections::HashMap<String, Option<String>>),
    Unsettled,
}

impl Live<'_> {
    fn owned(&self) -> OwnedLive {
        match self {
            Live::Holding(seen) => OwnedLive::Holding(
                seen.iter()
                    .map(|o| (o.conversation_id().to_string(), o.held().map(str::to_string)))
                    .collect(),
            ),
            Live::Unsettled => OwnedLive::Unsettled,
        }
    }
}

impl OwnedLive {
    /// Whether this row belongs to a turn that stopped without saying so.
    ///
    /// A conversation nobody read is never judged: `Unsettled` means the whole
    /// pass is untrustworthy, and a missing entry means this reader never looked
    /// at that conversation, which is the same thing for the rows in it.
    fn cut_off(&self, turn: &db::models::turn::TurnRow) -> Result<bool, String> {
        match self {
            OwnedLive::Holding(held) => match held.get(&turn.conversation_id) {
                Some(h) => meridian_core::agent::interrupted::was_cut_off(turn, h.as_deref()),
                None => Ok(false),
            },
            OwnedLive::Unsettled => Ok(false),
        }
    }
}

/// The database half, in one transaction.
///
/// The transaction is the point. WAL gives a deferred one a consistent view
/// from its first read, so the head this returns, the rows it selected and the
/// turns it judged all describe the same instant. Read without it, a turn
/// appending a tool result between two of these queries yields a conversation
/// that was never true: a turn recorded as finished sitting above a transcript
/// that stops mid-tool, or a message belonging to a turn the caller has no
/// record of.
fn read_snapshot(conn: &mut db::PooledConn, conversation_id: &str, live: &OwnedLive) -> Result<SnapshotRead, String> {
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        let (conversation, tree) = read_tree_with_conversation(conn, conversation_id)
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        let mut usage_by_turn = db::ops::usage::turn_summaries(conn, conversation_id)?;
        let turns = db::ops::turn::list_for_conversation(conn, conversation_id)?
            .into_iter()
            .map(|t| {
                let status = effective_status(&t, live)
                    .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
                let phase = t
                    .phase()
                    .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
                Ok(TurnInfoResponse {
                    status: status.into(),
                    usage: usage_by_turn.remove(&t.id).map(Into::into),
                    id: t.id,
                    phase: phase.map(Into::into),
                    phase_tool: t.phase_tool,
                    error: t.error,
                    started_at: t.started_at,
                    ended_at: t.ended_at,
                })
            })
            .collect::<Result<Vec<_>, diesel::result::Error>>()?;
        let sub_agent_runs = db::ops::conversation::sub_agent_runs(conn, conversation_id)?
            .into_iter()
            .map(|r| {
                let agent_kind = parse_sub_agent_kind(r.agent_kind.as_deref(), &r.conversation_id)
                    .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
                let status = r
                    .turn
                    .as_ref()
                    .map(|turn| effective_status(turn, live))
                    .transpose()
                    .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
                Ok(SubAgentRunInfoResponse {
                    status: status.map(Into::into),
                    conversation_id: r.conversation_id,
                    spawned_by_message_id: r.spawned_by_message_id,
                    spawned_by_call_id: r.spawned_by_call_id,
                    spawned_turn_id: r.spawned_turn_id,
                    agent_kind,
                    title: r.title,
                    steps: r.steps,
                })
            })
            .collect::<Result<Vec<_>, diesel::result::Error>>()?;
        let visible_message_ids = tree.messages.iter().map(|message| message.id.as_str()).collect();
        let plan_reviews =
            crate::commands::plan_review::summaries_for_conversation(conn, conversation_id, &visible_message_ids)
                .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        let plan_review_barrier = db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(error.into()))?;
        Ok((
            conversation,
            tree,
            turns,
            sub_agent_runs,
            plan_reviews,
            plan_review_barrier,
        ))
    })
    .map_err(|e| e.to_string())
}

/// What the row says, unless the coordinator says otherwise.
///
fn effective_status(turn: &db::models::turn::TurnRow, live: &OwnedLive) -> Result<CoreTurnStatus, String> {
    let status = turn.status()?;
    if live.cut_off(turn)? {
        Ok(CoreTurnStatus::Interrupted)
    } else {
        Ok(status)
    }
}

// `load_messages` was here: the same read as the tree, minus the head and the
// branch points, and nothing had called it since the front end started needing
// all three together. `conversation_snapshot` is the only way in now, and a
// second entrance that answers a third of the question is how the two drift.

fn switch_branch_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
    message_id: &str,
) -> diesel::QueryResult<bool> {
    conn.immediate_transaction(|conn| {
        if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
        {
            return Ok(false);
        }
        db::ops::message::switch_branch(conn, conversation_id, message_id).map(|_| true)
    })
}

fn delete_message_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
    message_id: &str,
) -> diesel::QueryResult<bool> {
    conn.immediate_transaction(|conn| {
        if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
        {
            return Ok(false);
        }
        db::ops::message::delete_subtree(conn, conversation_id, message_id).map(|_| true)
    })
}

const PLAN_REVIEW_MUTATION_BARRIER: &str =
    "This conversation is waiting for plan review or its continuation. Finish it before changing transcript branches.";

/// Make `message_id`'s branch the active one, landing on its most recent tip.
///
/// Refused while a turn is running: the head this moves is the same one the
/// turn's next `append_message` sets, so the switch would be silently undone a
/// moment later.
///
/// Returns nothing. It used to hand back the new tree, which the caller then
/// threw away — a conversation is read with `conversation_snapshot` now, and a
/// tree without the turns and approvals that belong to it is exactly the
/// half-answer that command exists to replace.
#[tauri::command]
pub async fn switch_branch(app: tauri::AppHandle, request: MessageBranchSwitchRequest) -> Result<(), String> {
    let MessageBranchSwitchRequest {
        conversation_id,
        message_id,
    } = request;
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "a branch switch")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changed =
            switch_branch_unless_plan_barrier(&mut conn, &conversation_id, &message_id).map_err(|e| e.to_string())?;
        changed
            .then_some(())
            .ok_or_else(|| PLAN_REVIEW_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// `update_message_content` was here. It took only a message id, so it could not
// name the conversation it was about to rewrite — and therefore could not take
// a mutation lease before doing it. That made it the one write path left that
// could edit a row out from under a running turn. Nothing called it, so it is
// gone rather than fixed; anything that needs it back has to arrive with a
// conversation id and take a lease like every other writer.

/// Delete a message together with everything that followed from it.
///
/// Replaces the single-row delete, which could not be made safe: dropping an
/// assistant row left its tool results behind, and dropping a question left the
/// model reading an answer to nothing.
///
/// Refused while a turn is running, and this is the dangerous one. The row it
/// removes may be the very one the turn's `parent_cursor` points at; `parent_id`
/// carries no foreign key (migration 21), so the next append succeeds and hangs
/// the rest of the turn off a node that no longer exists. `path_to_head` stops
/// at the missing id, and the turn's entire output — still in the table —
/// becomes unreachable.
///
/// Returns nothing, like `switch_branch` and for the same reason: the tree it
/// used to hand back was thrown away by its only caller, and a tree on its own
/// is not a state anything can be drawn from.
#[tauri::command]
pub async fn delete_message(app: tauri::AppHandle, request: MessageDeleteRequest) -> Result<(), String> {
    let MessageDeleteRequest { conversation_id, id } = request;
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "a delete")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changed =
            delete_message_unless_plan_barrier(&mut conn, &conversation_id, &id).map_err(|e| e.to_string())?;
        changed
            .then_some(())
            .ok_or_else(|| PLAN_REVIEW_MUTATION_BARRIER.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rate_message(app: tauri::AppHandle, request: MessageRatingUpdateRequest) -> Result<(), String> {
    let MessageRatingUpdateRequest { id, rating } = request;
    let rating = rating.map(Into::into);
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_rating(&mut conn, &id, rating).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What an export may contain: turns somebody took.
///
/// Injected background sits on the active path like everything else, but nobody
/// said it. It has to come off before encoding so a memory block cannot become
/// a training example carrying `<owner_notes>`, which exist on the
/// understanding that they are never quoted back to the person they are about.
fn exportable(path: Vec<MessageRow>) -> Result<Vec<MessageRow>, String> {
    path.into_iter()
        .filter_map(|message| match db::models::message::MessageRole::parse(&message.role) {
            Ok(db::models::message::MessageRole::Context) => None,
            Ok(_) if message.source.as_deref() == Some("shell") => None,
            Ok(_) => Some(Ok(message)),
            Err(error) => Some(Err(format!("message {} cannot be exported: {error}", message.id))),
        })
        .collect()
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationExportFormat {
    Sft,
    Dpo,
}

#[tauri::command]
pub async fn export_conversation(
    app: tauri::AppHandle,
    request: ConversationExportRequest,
) -> Result<ConversationExportResponse, String> {
    let ConversationExportRequest {
        conversation_id,
        format,
        output_path,
    } = request;
    let services = app.services();
    let pool = services.db.clone();
    let result: String = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let conv = db::ops::conversation::get_conversation(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        let history = db::ops::message::list_messages(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        // The active path only. Exporting every branch would interleave rival
        // answers to the same question into one transcript, and the DPO pairing
        // below walks backwards for a prompt — across a fork it would pick up a
        // question that belongs to a different branch.
        //
        // Unlike the chat path this keeps everything from the root, compacted or
        // not: a summary is a token-budget device, and the rows it stands in for
        // are exactly the training data being exported.
        let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
        let messages: Vec<MessageRow> = exportable(ctx.path)?;
        let system_prompt = match conv.assistant_id.as_deref() {
            Some(assistant_id) => {
                db::ops::assistant::get_assistant(&mut conn, assistant_id)
                    .map_err(|error| format!("cannot read export assistant {assistant_id}: {error}"))?
                    .system_prompt
            }
            None => String::new(),
        };

        fn msg_to_openai(m: &MessageRow) -> Result<serde_json::Value, String> {
            let role = db::models::message::MessageRole::parse(&m.role)
                .map_err(|error| format!("message {} cannot be exported: {error}", m.id))?;
            let mut obj = serde_json::json!({ "role": role });
            match role {
                db::models::message::MessageRole::Assistant => {
                    if !m.content.is_empty() {
                        obj["content"] = serde_json::json!(m.content);
                    } else {
                        obj["content"] = serde_json::Value::Null;
                    }
                    // Hidden reasoning is intentionally excluded: exports must
                    // only contain the final visible answer.
                    let tool_calls = parse_stored_tool_calls(m.schema_version, m.tool_calls.as_deref())
                        .map_err(|error| format!("message {} has invalid persisted tool_calls: {error}", m.id))?;
                    if !tool_calls.is_empty() {
                        obj["tool_calls"] = serde_json::json!(
                            tool_calls
                                .iter()
                                .map(|tc| serde_json::json!({
                                    "id": tc.id, "type": "function",
                                    "function": { "name": tc.name, "arguments": tc.arguments }
                                }))
                                .collect::<Vec<_>>()
                        );
                    }
                }
                db::models::message::MessageRole::Tool => {
                    obj["content"] = serde_json::json!(m.content);
                    let cid = m
                        .tool_call_id
                        .as_ref()
                        .ok_or_else(|| format!("tool message {} is missing tool_call_id", m.id))?;
                    obj["tool_call_id"] = serde_json::json!(cid);
                }
                db::models::message::MessageRole::User => {
                    obj["content"] = serde_json::json!(m.content);
                }
                db::models::message::MessageRole::Context => {
                    return Err(format!("context message {} reached the export encoder", m.id));
                }
            }
            Ok(obj)
        }

        match format {
            ConversationExportFormat::Sft => {
                let mut openai_msgs: Vec<serde_json::Value> = Vec::new();
                if !system_prompt.is_empty() {
                    openai_msgs.push(serde_json::json!({"role": "system", "content": system_prompt}));
                }
                for m in &messages {
                    openai_msgs.push(msg_to_openai(m)?);
                }
                serde_json::to_string(&serde_json::json!({"messages": openai_msgs})).map_err(|e| e.to_string())
            }
            ConversationExportFormat::Dpo => {
                let mut lines = Vec::new();
                // Build context prefix (system + user messages up to each rated assistant msg)
                for (i, m) in messages.iter().enumerate() {
                    if m.role != "assistant" || m.rating.is_none() {
                        continue;
                    }
                    // Find the user message that prompted this response
                    let prompt_msgs: Vec<serde_json::Value> = {
                        let mut p = Vec::new();
                        if !system_prompt.is_empty() {
                            p.push(serde_json::json!({"role": "system", "content": system_prompt}));
                        }
                        // Walk backwards from this assistant message to find the preceding user message
                        let user_idx = messages[..i].iter().rposition(|m| m.role == "user");
                        if let Some(ui) = user_idx {
                            p.push(serde_json::json!({"role": "user", "content": messages[ui].content}));
                        }
                        p
                    };
                    let response = msg_to_openai(m)?;
                    let rating = m.rating.unwrap_or(0);
                    lines.push(serde_json::json!({
                        "prompt": prompt_msgs,
                        "response": [response],
                        "rating": rating,
                    }));
                }
                let result: Vec<String> = lines
                    .iter()
                    .map(|l| serde_json::to_string(l).expect("serializing export rows cannot fail"))
                    .collect();
                Ok(result.join("\n"))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(ref path) = output_path {
        std::fs::write(path, &result).map_err(|e| e.to_string())?;
    }
    Ok(ConversationExportResponse { path: result })
}

#[tauri::command]
pub async fn upload_file(
    app: tauri::AppHandle,
    request: MessageFileUploadRequest,
) -> Result<UploadFileResponse, String> {
    let MessageFileUploadRequest {
        conversation_id,
        file_path,
    } = request;
    let services = app.services();
    let app_data_dir = services.paths.data_dir.clone();

    // Android: handle content:// URIs from SAF file picker
    #[cfg(target_os = "android")]
    if file_path.starts_with("content://") {
        let stat = meridian_core::android_bridge::content_stat(&file_path).await?;
        let original_name = stat.name.unwrap_or_else(|| "file".to_string());
        let ext = original_name
            .rsplit('.')
            .next()
            .filter(|e| e.len() <= 10 && !e.contains('/'))
            .unwrap_or("bin");
        let (dest_path, uri) = meridian_core::files::alloc_dest(&app_data_dir, &conversation_id, ext)?;
        meridian_core::android_bridge::content_copy(&file_path, dest_path.to_str().ok_or("invalid path")?).await?;
        let mime = stat.mime.unwrap_or_else(|| {
            mime_guess::from_path(&original_name)
                .first_or_octet_stream()
                .to_string()
        });
        return Ok(UploadFileResponse::from_stored(uri, mime, original_name));
    }

    let src = std::path::Path::new(&file_path);
    let uri = meridian_core::files::store_file(&app_data_dir, &conversation_id, src)?;

    let mime = mime_guess::from_path(src).first_or_octet_stream().to_string();
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();

    Ok(UploadFileResponse::from_stored(uri, mime, name))
}

/// Store bytes that arrived without a path, answering with the same part
/// `upload_file` produces. Two callers: the remote `/upload` endpoint, and
/// `upload_file_bytes` below.
pub fn store_uploaded_bytes(
    app_data_dir: &std::path::Path,
    conversation_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<UploadFileResponse, String> {
    let ext = file_name
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 10 && !e.contains('/') && e.len() < file_name.len())
        .unwrap_or("bin");
    let (dest, uri) = meridian_core::files::alloc_dest(app_data_dir, conversation_id, ext)?;
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    let mime = mime_guess::from_path(file_name).first_or_octet_stream().to_string();
    Ok(UploadFileResponse::from_stored(uri, mime, file_name.to_string()))
}

/// `upload_file` for a file that never had a path. The window's native
/// drag-drop handler is disabled (`dragDropEnabled: false` — in-page HTML5
/// drag and drop cannot work with it on), so a file dropped on the window
/// reaches JavaScript as a `File` object, and no WebView puts a filesystem
/// path on one of those.
#[tauri::command]
pub async fn upload_file_bytes(
    app: tauri::AppHandle,
    request: MessageFileBytesUploadRequest,
) -> Result<UploadFileResponse, String> {
    use base64::Engine as _;
    let MessageFileBytesUploadRequest {
        conversation_id,
        file_name,
        data_base64,
    } = request;
    let services = app.services();
    let app_data_dir = services.paths.data_dir.clone();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("payload is not valid base64: {e}"))?;
    tokio::task::spawn_blocking(move || store_uploaded_bytes(&app_data_dir, &conversation_id, &file_name, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db::models::turn::{TurnPhase as CoreTurnPhase, TurnStatus as CoreTurnStatus};
    use meridian_core::db::ops::turn;
    use meridian_core::db::test_db;
    use meridian_core::turn::TurnOrigin;

    fn seed(pool: &meridian_core::db::DbPool) {
        let mut conn = pool.get().unwrap();
        meridian_core::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
    }

    fn native_plan_runtime() -> db::models::plan_review::NativePlanReviewRuntimeConfig {
        db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: "provider-test".into(),
            model: "model-test".into(),
            assistant_id: None,
            thinking_level: None,
            fast: false,
            project_id: None,
            project_path: None,
            accept_edits: false,
        }
    }

    fn seed_pending_plan_review(conn: &mut diesel::sqlite::SqliteConnection) {
        let document = db::ops::plan_review::create_or_resume_document(conn, "c1", 2).unwrap();
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
        db::ops::turn::begin(conn, "turn-1", "c1", TurnOrigin::Desktop, None, 5).unwrap();
        db::ops::plan_review::submit_native_head_for_review(
            conn,
            &db::ops::plan_review::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: appended.document.working_generation,
                expected_head_sha256: &appended.revision.content_sha256,
                turn_id: Some("turn-1"),
                assistant_message_id: Some("m1"),
                provider_call_id: Some("exit-1"),
                provider_kind: db::models::plan_review::PlanReviewProviderKind::Native,
                now: 6,
            },
            &native_plan_runtime(),
        )
        .unwrap();
    }

    #[test]
    fn delegated_run_agent_kind_is_required_and_closed() {
        assert_eq!(
            parse_sub_agent_kind(Some("explore"), "child").unwrap(),
            SubAgentKind::Explore
        );
        assert!(parse_sub_agent_kind(Some("future_agent"), "child").is_err());
        assert!(parse_sub_agent_kind(None, "child").is_err());
    }

    #[test]
    fn message_requests_are_strict_and_ratings_are_closed() {
        let switch: MessageBranchSwitchRequest = serde_json::from_value(serde_json::json!({
            "conversationId": "conversation-1",
            "messageId": "message-1",
        }))
        .unwrap();
        assert_eq!(switch.conversation_id, "conversation-1");
        assert_eq!(switch.message_id, "message-1");

        assert!(
            serde_json::from_value::<MessageDeleteRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "id": "message-1",
                "legacyCascade": true,
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<MessageRatingUpdateRequest>(serde_json::json!({ "id": "message-1" })).is_err()
        );
        assert!(
            serde_json::from_value::<MessageRatingUpdateRequest>(serde_json::json!({
                "id": "message-1",
                "rating": 0,
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ConversationExportRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "format": "future_format",
                "outputPath": null,
            }))
            .is_err()
        );
    }

    #[test]
    fn snapshot_and_transcript_mutations_use_the_conversation_wide_plan_barrier() {
        let pool = test_db();
        seed(&pool);
        let mut conn = pool.get().unwrap();
        seed_pending_plan_review(&mut conn);

        let snapshot = read_snapshot(&mut conn, "c1", &OwnedLive::Unsettled).unwrap();
        assert_eq!(
            snapshot.4.len(),
            1,
            "an active review remains recoverable even when its tool card is off the visible branch"
        );
        assert!(snapshot.5, "the snapshot still exposes the conversation-wide barrier");
        assert!(!switch_branch_unless_plan_barrier(&mut conn, "c1", "missing-message").unwrap());
        assert!(!delete_message_unless_plan_barrier(&mut conn, "c1", "missing-message").unwrap());
    }

    #[test]
    fn turn_usage_is_explicitly_mapped_and_serializes_decimal_strings() {
        let response = TurnUsageInfoResponse::from(db::ops::usage::TurnUsageSummary {
            messages: 1,
            missing_token_usage_messages: 2,
            incomplete_token_usage_messages: 3,
            input_tokens: 4,
            output_tokens: 5,
            cache_read_tokens: 6,
            cache_write_tokens: 7,
            server_tool_calls: 8,
            input_cost: Some("0.1".parse().unwrap()),
            output_cost: Some("0.2".parse().unwrap()),
            cache_cost: Some("0.3".parse().unwrap()),
            tool_cost: Some("0.4".parse().unwrap()),
            total_cost: Some("1".parse().unwrap()),
            unpriced_token_messages: 9,
            unpriced_input_messages: 10,
            unpriced_output_messages: 11,
            unpriced_cache_messages: 12,
            unpriced_tool_messages: 13,
            estimated_token_messages: 14,
            estimated_tool_messages: 15,
            estimated_messages: 16,
            unpriced_messages: 17,
            metered_messages: 18,
            subscription_messages: 19,
            external_messages: 20,
            pricing_status: db::ops::usage::TurnPricingStatus::LowerBound,
        });
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["total_cost"], "1");
        assert_eq!(value["pricing_status"], "lower_bound");
        assert_eq!(value["external_messages"], 20);
        assert_eq!(value.as_object().unwrap().len(), 26);
    }

    #[test]
    fn auto_review_verdict_is_explicitly_mapped() {
        let response = AutoReviewVerdictInfoResponse::from(CoreAutoReviewVerdict {
            outcome: CoreAutoReviewOutcome::Deny,
            risk: Some(CoreAutoReviewRisk::High),
            authorization: Some(CoreAutoReviewAuthorization::Low),
            rationale: Some("outside the requested path".to_string()),
            stage: Some(CoreAutoReviewStage::Investigate),
            model: Some("reviewer".to_string()),
            evidence: vec![CoreAutoReviewEvidence {
                tool: "read_file".to_string(),
                arguments: "{}".to_string(),
            }],
        });
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "outcome": "deny",
                "risk": "high",
                "authorization": "low",
                "rationale": "outside the requested path",
                "stage": "investigate",
                "model": "reviewer",
                "evidence": [{"tool": "read_file", "arguments": "{}"}],
            })
        );

        let empty = serde_json::to_value(AutoReviewVerdictInfoResponse::from(CoreAutoReviewVerdict {
            outcome: CoreAutoReviewOutcome::Unreadable,
            risk: None,
            authorization: None,
            rationale: None,
            stage: None,
            model: None,
            evidence: Vec::new(),
        }))
        .unwrap();
        assert_eq!(
            empty,
            serde_json::json!({
                "outcome": "unreadable",
                "risk": null,
                "authorization": null,
                "rationale": null,
                "stage": null,
                "model": null,
                "evidence": [],
            })
        );
    }

    fn exported_row(role: &str, content: &str) -> MessageRow {
        MessageRow {
            id: role.into(),
            conversation_id: "c1".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 0,
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
        }
    }

    /// An export is training data. Injected background is not a turn anybody
    /// took, and it carries `<owner_notes>` — the one thing in the whole memory
    /// system that is never meant to be repeated anywhere.
    #[test]
    fn injected_background_is_not_exported() {
        let path = vec![
            exported_row("user", "hi"),
            exported_row("context", "<owner_notes>\n- [general] 他在找工作\n</owner_notes>"),
            exported_row("assistant", "hello"),
        ];

        let kept = exportable(path).unwrap();
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().all(|m| !m.content.contains("找工作")));
        assert!(kept.iter().all(|m| m.role != "context"));
    }

    #[test]
    fn literal_shell_commands_are_not_training_exports() {
        let mut shell = exported_row("user", "!echo $SECRET");
        shell.source = Some("shell".into());
        let kept = exportable(vec![exported_row("user", "explain this"), shell]).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].content, "explain this");
    }

    #[test]
    fn export_rejects_unknown_message_roles() {
        let error = exportable(vec![exported_row("future_role", "opaque")]).unwrap_err();
        assert!(error.contains("unknown message role"));
    }

    #[test]
    fn message_dto_is_an_explicit_public_projection() {
        let mut row = exported_row("assistant", "answer");
        row.provider_state = Some("opaque-provider-state".into());
        let json = serde_json::to_value(MessageInfoResponse::try_from(row).unwrap()).unwrap();
        assert_eq!(json["content"], "answer");
        assert_eq!(json["is_compact_summary"], false);
        assert!(json.get("provider_state").is_none());
        assert!(json.get("server_tool_calls").is_none());
        assert!(json.get("schema_version").is_none());
        assert!(!json.to_string().contains("opaque-provider-state"));
    }

    #[test]
    fn injected_context_body_and_source_do_not_cross_the_transcript_boundary() {
        let mut row = exported_row("context", "<owner_notes>private</owner_notes>");
        row.source = Some("memory|full|100.subject|-|".into());
        let json = serde_json::to_value(MessageInfoResponse::try_from(row).unwrap()).unwrap();
        assert_eq!(json["role"], "context");
        assert_eq!(json["content"], "");
        assert_eq!(json["source"], serde_json::Value::Null);
        assert!(!json.to_string().contains("owner_notes"));
        assert!(!json.to_string().contains("100.subject"));
    }

    #[test]
    fn message_dto_rejects_non_boolean_sqlite_values() {
        let mut row = exported_row("assistant", "answer");
        row.is_compact_summary = 2;
        assert!(MessageInfoResponse::try_from(row).is_err());
    }

    #[test]
    fn message_response_normalizes_stored_tool_calls_and_rejects_extensions() {
        let mut row = exported_row("assistant", "");
        row.tool_calls =
            Some(r#"[{"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{}"}}]"#.into());
        let json = serde_json::to_value(MessageInfoResponse::try_from(row).unwrap()).unwrap();
        assert_eq!(json["tool_calls"][0]["function"]["name"], "read_file");

        let mut extended = exported_row("assistant", "");
        extended.tool_calls = Some(
            r#"[{"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{}"},"future":true}]"#
                .into(),
        );
        assert!(MessageInfoResponse::try_from(extended).is_err());
    }

    /// Compaction summaries sit at `sort_order = -1` by design (migration 21),
    /// so a conversation that has ever compacted carries one. Rejecting it here
    /// used to fail the whole snapshot and blank the transcript.
    #[test]
    fn a_compaction_summary_at_negative_sort_order_is_readable() {
        let mut row = exported_row("assistant", "summary");
        row.is_compact_summary = 1;
        row.sort_order = -1;
        let json = serde_json::to_value(MessageInfoResponse::try_from(row).unwrap()).unwrap();
        assert_eq!(json["sort_order"], -1);
        assert_eq!(json["is_compact_summary"], true);
    }

    /// A verdict for a call the row no longer names — revised, or lost to a
    /// crash — is orphaned metadata, not a broken row. It is dropped rather
    /// than taking the transcript down with it.
    #[test]
    fn an_orphaned_auto_review_verdict_is_dropped_not_fatal() {
        let mut row = exported_row("assistant", "");
        row.tool_calls =
            Some(r#"[{"id":"kept","type":"function","function":{"name":"read_file","arguments":"{}"}}]"#.into());
        row.auto_review = Some(
            r#"{"kept":{"outcome":"allow","risk":null,"authorization":null,"rationale":null,"stage":null,"model":null,"evidence":[]},"gone":{"outcome":"allow","risk":null,"authorization":null,"rationale":null,"stage":null,"model":null,"evidence":[]}}"#
                .into(),
        );
        let json = serde_json::to_value(MessageInfoResponse::try_from(row).unwrap()).unwrap();
        assert!(json["auto_review"].get("kept").is_some());
        assert!(json["auto_review"].get("gone").is_none());
    }

    #[test]
    fn message_response_rejects_cross_role_fields_and_unknown_sources() {
        let mut user = exported_row("user", "hi");
        user.tool_call_id = Some("call-1".into());
        assert!(MessageInfoResponse::try_from(user).is_err());

        let mut user = exported_row("user", "hi");
        user.source = Some("future_source".into());
        assert!(MessageInfoResponse::try_from(user).is_err());

        let mut tool = exported_row("tool", "done");
        tool.tool_call_id = Some("call-1".into());
        tool.rating = Some(1);
        assert!(MessageInfoResponse::try_from(tool).is_err());
    }

    #[test]
    fn context_descriptor_does_not_expose_content_or_metadata() {
        let row = db::models::message_context_item::MessageContextItemRow {
            id: "context-1".into(),
            message_id: "user".into(),
            position: 0,
            kind: "shell_output".into(),
            content: "secret output".into(),
            display_path: None,
            line_start: None,
            line_end: None,
            content_hash: "secret hash".into(),
            byte_count: 13,
            line_count: 1,
            token_count: 3,
            truncated: 0,
            metadata: Some(r#"{"command":"secret"}"#.into()),
            created_at: 1,
        };
        let json = serde_json::to_value(MessageContextInfoResponse::try_from(row).unwrap()).unwrap();
        assert!(json.get("content").is_none());
        assert!(json.get("content_hash").is_none());
        assert!(json.get("metadata").is_none());
        assert!(json.get("created_at").is_none());
    }

    #[test]
    fn upload_response_is_a_closed_tagged_union() {
        assert_eq!(
            serde_json::to_value(UploadFileResponse::from_stored(
                "file://image".into(),
                "image/png".into(),
                "image.png".into(),
            ))
            .unwrap(),
            serde_json::json!({"type":"image_url","image_url":{"url":"file://image"}})
        );
        assert_eq!(
            serde_json::to_value(UploadFileResponse::from_stored(
                "file://doc".into(),
                "application/pdf".into(),
                "doc.pdf".into(),
            ))
            .unwrap(),
            serde_json::json!({
                "type":"file",
                "file":{"url":"file://doc","mime_type":"application/pdf","name":"doc.pdf"}
            })
        );
    }

    /// One conversation's reading, in the shape the snapshot carries several of.
    fn holding(conversation_id: &str, held: Option<&str>) -> OwnedLive {
        OwnedLive::Holding(
            [(conversation_id.to_string(), held.map(str::to_string))]
                .into_iter()
                .collect(),
        )
    }

    fn snapshot(pool: &meridian_core::db::DbPool, held: Option<&str>) -> Vec<TurnInfoResponse> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", &holding("c1", held)).unwrap().2
    }

    /// When the coordinator will not hold still, nothing is called interrupted.
    /// A crash that really happened is still on record at the next open; a live
    /// turn labelled as crashed is a lie the user reads now.
    fn unsettled(pool: &meridian_core::db::DbPool) -> Vec<TurnInfoResponse> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", &OwnedLive::Unsettled).unwrap().2
    }

    /// The whole reason the status is decided here rather than in the front
    /// end. A killed turn leaves `running` behind, and reconciliation only
    /// rewrites those at startup — so the column alone would have a turn that
    /// died an hour ago read as one still in progress.
    #[test]
    fn a_running_turn_nobody_holds_is_reported_as_interrupted() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::set_phase(&mut conn, "t1", CoreTurnPhase::RunningTool, Some("edit_file"), 1001).unwrap();
        }

        let dead = snapshot(&pool, None);
        assert_eq!(dead[0].status, TurnStatus::Interrupted);
        assert_eq!(dead[0].phase, Some(TurnPhase::RunningTool));
        assert_eq!(dead[0].phase_tool.as_deref(), Some("edit_file"));

        // And the same row, while it really is running, is not.
        let live = snapshot(&pool, Some("t1"));
        assert_eq!(live[0].status, TurnStatus::Running);
    }

    /// The coordinator is per conversation, so holding *a* turn is not holding
    /// *this* one — a new turn must not vouch for the dead one before it.
    #[test]
    fn a_newer_turn_does_not_vouch_for_an_older_one() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::begin(&mut conn, "live", "c1", TurnOrigin::Desktop, None, 2000).unwrap();
        }

        let turns = snapshot(&pool, Some("live"));
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["interrupted", "running"]
        );
        assert_eq!(turns[0].id, "dead", "oldest first, as the transcript reads");
    }

    /// A turn that reached an ending said so, and the coordinator has no
    /// opinion to add.
    #[test]
    fn a_finished_turn_keeps_the_ending_it_recorded() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            for (id, status, error) in [
                ("done", CoreTurnStatus::Done, None),
                ("stopped", CoreTurnStatus::Cancelled, None),
                ("broke", CoreTurnStatus::Failed, Some("API Key not set")),
            ] {
                turn::begin(&mut conn, id, "c1", TurnOrigin::Desktop, None, 1000).unwrap();
                turn::finish(&mut conn, id, status, error, 1500).unwrap();
            }
        }

        let turns = snapshot(&pool, None);
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["done", "cancelled", "failed"]
        );
        assert_eq!(turns[2].error.as_deref(), Some("API Key not set"));
        assert!(turns.iter().all(|t| t.ended_at == Some(1500)));
    }

    /// Stored first-party state is a closed contract. A later status cannot be
    /// interpreted by this build, so the snapshot fails rather than inventing
    /// an ending or treating the turn as live.
    #[test]
    fn a_status_this_build_does_not_know_is_rejected() {
        use diesel::prelude::*;
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            diesel::update(meridian_core::db::schema::turns::table.find("t1"))
                .set(meridian_core::db::schema::turns::status.eq("from_the_future"))
                .execute(&mut conn)
                .unwrap();
        }

        let mut conn = pool.get().unwrap();
        let error = read_snapshot(&mut conn, "c1", &holding("c1", None))
            .err()
            .expect("the unknown status must fail the snapshot");
        assert!(error.contains("unknown turn status 'from_the_future'"), "{error}");
    }

    /// The pass the retry loop throws away, and what it falls back to.
    ///
    /// A turn that started after the coordinator was read has a `running` row
    /// and no lease as far as this pass knows, which is indistinguishable from
    /// one that stopped without saying so. The revision check is what catches
    /// it; this is what the read looks like once it has been caught and cannot
    /// be settled.
    #[test]
    fn an_unsettled_read_calls_nothing_interrupted() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::begin(&mut conn, "t2", "c1", TurnOrigin::Desktop, None, 2000).unwrap();
            turn::finish(&mut conn, "t2", CoreTurnStatus::Done, None, 2500).unwrap();
        }

        // Believed, `t1` reads as interrupted.
        assert_eq!(snapshot(&pool, None)[0].status, TurnStatus::Interrupted);
        // Unsettled, it reads as what the row says and nothing is invented.
        let turns = unsettled(&pool);
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["running", "done"]
        );
    }

    /// One read, one state: the turns are the turns of the tree that came back
    /// with them, and the head names a row that is in it.
    #[test]
    fn the_tree_and_the_turns_describe_the_same_conversation() {
        use diesel::RunQueryDsl;

        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            meridian_core::db::ops::message::append_message(
                &mut conn,
                &meridian_core::db::models::message::MessageInsert {
                    id: "m1",
                    conversation_id: "c1",
                    role: "user",
                    content: "hi",
                    provider_id: None,
                    model_id: None,
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
                    turn_id: Some("t1"),
                    tool_outcome: None,
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    server_tool_calls: None,
                    provider_name: None,
                },
                None,
            )
            .unwrap();
            diesel::sql_query(
                "INSERT INTO audit_messages
                    (id, recorded_at, message_id, conversation_id, turn_id, turn_origin,
                     role, content, provider_id, model_id, input_tokens, output_tokens,
                     created_at, input_price, output_price, billing_mode)
                 VALUES
                    ('a1', 2, 'reply-1', 'c1', 't1', 'desktop', 'assistant', '',
                     'p1', 'm1', 1000000, 0, 2, '10', '20', 'metered')",
            )
            .execute(&mut conn)
            .unwrap();
        }

        let mut conn = pool.get().unwrap();
        let (conv, tree, turns, runs, plan_reviews, plan_review_barrier) =
            read_snapshot(&mut conn, "c1", &holding("c1", Some("t1"))).unwrap();

        assert_eq!(conv.id, "c1");
        assert_eq!(tree.messages.len(), 1);
        assert_eq!(tree.messages[0].turn_id.as_deref(), Some("t1"));
        assert_eq!(tree.head_message_id.as_deref(), Some(tree.messages[0].id.as_str()));
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].id, "t1");
        let usage = turns[0].usage.as_ref().expect("the audit-backed turn cost is attached");
        assert_eq!(usage.pricing_status, TurnPricingStatus::Exact);
        assert_eq!(
            usage.total_cost,
            Some("10".parse::<meridian_core::decimal::Decimal>().unwrap())
        );
        assert!(runs.is_empty(), "a conversation that never delegated has no runs");
        assert!(
            plan_reviews.is_empty(),
            "a conversation without plan reviews has no review cards"
        );
        assert!(!plan_review_barrier);
    }

    /// A sub-agent occupies its own conversation, so the parent's revision does
    /// not move when its lease is taken or dropped. Judging the child's row
    /// against the parent's reading would leave a run that died in a panic
    /// spinning on the card for ever.
    #[test]
    fn a_child_that_stopped_without_saying_so_is_judged_against_its_own_conversation() {
        let pool = meridian_core::db::test_db();
        seed(&pool);
        let mut conn = pool.get().unwrap();

        meridian_core::db::ops::conversation::insert(
            &mut conn,
            meridian_core::db::models::conversation::ConversationInsert {
                id: "child",
                title: Some("look it up"),
                created_at: 10,
                updated_at: 10,
                parent_conversation_id: Some("c1"),
                spawned_by_message_id: Some("m1"),
                spawned_by_call_id: Some("0"),
                spawned_turn_id: Some("t-child"),
                agent_kind: Some("explore"),
                ..Default::default()
            },
        )
        .unwrap();
        meridian_core::db::ops::turn::begin(&mut conn, "t-child", "child", TurnOrigin::SubAgent, None, 10).unwrap();

        // The parent is being read while it holds its own turn. Nobody holds the
        // child's, so the child's `running` row is a run that stopped.
        let live = OwnedLive::Holding(
            [("c1".to_string(), Some("t1".to_string())), ("child".to_string(), None)]
                .into_iter()
                .collect(),
        );
        let runs = read_snapshot(&mut conn, "c1", &live).unwrap().3;
        assert_eq!(runs[0].agent_kind, SubAgentKind::Explore);
        assert_eq!(runs[0].status, Some(TurnStatus::Interrupted));

        // Still held: still running.
        let live = OwnedLive::Holding(
            [
                ("c1".to_string(), None),
                ("child".to_string(), Some("t-child".to_string())),
            ]
            .into_iter()
            .collect(),
        );
        let runs = read_snapshot(&mut conn, "c1", &live).unwrap().3;
        assert_eq!(runs[0].status, Some(TurnStatus::Running));

        // And when the coordinator would not hold still, no run is accused.
        let runs = read_snapshot(&mut conn, "c1", &OwnedLive::Unsettled).unwrap().3;
        assert_eq!(runs[0].status, Some(TurnStatus::Running));
    }
}
