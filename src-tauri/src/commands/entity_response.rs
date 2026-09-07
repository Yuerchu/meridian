//! Stable IPC response shapes for database-backed entities.
//!
//! Database rows deliberately stop at the command boundary.  Keep these field
//! lists explicit: adding a column to a Diesel row must not silently expand the
//! desktop or remote API.

use meridian_core::db::models::{
    assistant::AssistantRow,
    conversation::ConversationRow,
    custom_tool::CustomToolRow,
    emoji::EmojiRow,
    emoji_pack::EmojiPackRow,
    journal::JournalVersionRow,
    mcp_server::McpServerRow,
    memory::{MemoryRow, MemorySubjectRow},
    model_config::ModelConfigRow,
    project::ProjectRow,
    prompt_template::PromptTemplateRow,
    provider::ProviderRow,
    queue::QueuedPromptRow,
    skill::SkillRow,
    todo::{TodoItemRow, TodoListRow, TodoListView},
    tool_category::ToolCategoryRow,
    tool_preset::ToolPresetRow,
};
use std::collections::BTreeMap;

macro_rules! entity_response {
    ($row:path, $info:ident, $list:ident, { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, serde::Serialize)]
        pub struct $info {
            $(pub $field: $ty,)*
        }

        impl From<$row> for $info {
            fn from(row: $row) -> Self {
                Self {
                    $($field: row.$field,)*
                }
            }
        }

        pub type $list = Vec<$info>;
    };
}

macro_rules! strict_bool_entity_response {
    (
        $row:path, $info:ident, $list:ident,
        |$value:ident| $validate:block,
        { $($field:ident: $ty:ty),* $(,)? },
        { $($bool_field:ident),* $(,)? }
    ) => {
        #[derive(Debug, Clone, serde::Serialize)]
        pub struct $info {
            $(pub $field: $ty,)*
            $(pub $bool_field: bool,)*
        }

        impl TryFrom<$row> for $info {
            type Error = String;

            fn try_from($value: $row) -> Result<Self, Self::Error> {
                $validate
                $(let $bool_field = decode_sqlite_bool($value.$bool_field, stringify!($bool_field))?;)*
                Ok(Self {
                    $($field: $value.$field,)*
                    $($bool_field,)*
                })
            }
        }

        pub type $list = Vec<$info>;
    };
}

/// SQLite stores booleans as integers, but the persistence representation must
/// not leak through IPC. Reject corrupt rows instead of treating every non-zero
/// value as `true`.
fn decode_sqlite_bool(value: i32, field: &str) -> Result<bool, String> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(format!("persisted boolean `{field}` must be 0 or 1, got {value}")),
    }
}

/// The complete set of first-party conversation kinds exposed over IPC.
///
/// Persistence remains nullable because ordinary conversations have no kind.
/// A present value is parsed here rather than copied through as a string, so a
/// corrupt or newer database value cannot silently become part of the public
/// contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationAgentKind {
    Explore,
    Agent,
    ClaudeCode,
    PlanReview,
    ImplReview,
}

impl ConversationAgentKind {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "explore" => Ok(Self::Explore),
            "agent" => Ok(Self::Agent),
            "claude_code" => Ok(Self::ClaudeCode),
            "plan_review" => Ok(Self::PlanReview),
            "impl_review" => Ok(Self::ImplReview),
            _ => Err(format!("unknown conversation agent kind `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmojiPackKind {
    Manual,
    Onebot,
}

impl EmojiPackKind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "manual" => Ok(Self::Manual),
            "onebot" => Ok(Self::Onebot),
            _ => Err(format!("unknown emoji pack kind `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmojiSource {
    Local,
    OnebotFace,
    OnebotMface,
    OnebotImage,
}

impl EmojiSource {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "local" => Ok(Self::Local),
            "onebot_face" => Ok(Self::OnebotFace),
            "onebot_mface" => Ok(Self::OnebotMface),
            "onebot_image" => Ok(Self::OnebotImage),
            _ => Err(format!("unknown emoji source `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmojiSemanticStatus {
    Pending,
    Suggested,
    Confirmed,
}

impl EmojiSemanticStatus {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(Self::Pending),
            "suggested" => Ok(Self::Suggested),
            "confirmed" => Ok(Self::Confirmed),
            _ => Err(format!("unknown emoji semantic status `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalOperation {
    Write,
    Edit,
    Patch,
    Delete,
    RenameFrom,
    RenameTo,
    CommandObserved,
    External,
    Rewind,
}

impl JournalOperation {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "write" => Ok(Self::Write),
            "edit" => Ok(Self::Edit),
            "patch" => Ok(Self::Patch),
            "delete" => Ok(Self::Delete),
            "rename_from" => Ok(Self::RenameFrom),
            "rename_to" => Ok(Self::RenameTo),
            "command_observed" => Ok(Self::CommandObserved),
            "external" => Ok(Self::External),
            "rewind" => Ok(Self::Rewind),
            _ => Err(format!("unknown journal operation `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalSource {
    Native,
    Hosted,
    Inferred,
    External,
    Rewind,
}

impl JournalSource {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "native" => Ok(Self::Native),
            "hosted" => Ok(Self::Hosted),
            "inferred" => Ok(Self::Inferred),
            "external" => Ok(Self::External),
            "rewind" => Ok(Self::Rewind),
            _ => Err(format!("unknown journal source `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    Official,
    User,
    Assistant,
    Imported,
}

impl SkillSource {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "official" => Ok(Self::Official),
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            "imported" => Ok(Self::Imported),
            _ => Err(format!("unknown skill source `{value}`")),
        }
    }
}

fn parse_string_list(raw: &str, field: &str) -> Result<Vec<String>, String> {
    serde_json::from_str(raw).map_err(|error| format!("invalid persisted {field}: {error}"))
}

#[derive(Debug, Clone, PartialEq, Default)]
enum OverrideField<T> {
    #[default]
    Unset,
    Set(T),
}

impl<T> OverrideField<T> {
    fn is_unset(&self) -> bool {
        matches!(self, Self::Unset)
    }
}

impl<'de, T> serde::Deserialize<'de> for OverrideField<T>
where
    T: serde::Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        T::deserialize(deserializer).map(Self::Set)
    }
}

impl<T> serde::Serialize for OverrideField<T>
where
    T: serde::Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Set(value) => value.serialize(serializer),
            Self::Unset => Err(serde::ser::Error::custom("unset override field was not skipped")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum CapabilityEffort {
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum CapabilityVerbosity {
    Low,
    Medium,
    High,
}

/// The closed first-party object carried by `model_configs.capability_overrides`.
///
/// `OverrideField` preserves the distinction between an omitted patch member
/// and an explicitly-null nullable member. It also makes `null` invalid for
/// boolean and enum fields instead of letting `Option<T>` reinterpret it as an
/// omitted override.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProviderCapabilityOverrides {
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_tools: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_streaming_tools: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_thinking: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_thinking_off: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_images: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_pdf: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_temperature: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_top_p: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_fast: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supports_verbosity: OverrideField<bool>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    thinking_style: OverrideField<meridian_core::provider::ThinkingStyle>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    supported_efforts: OverrideField<Vec<CapabilityEffort>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    server_tools: OverrideField<Vec<meridian_core::provider::ServerToolKind>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    default_effort: OverrideField<Option<CapabilityEffort>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    default_verbosity: OverrideField<Option<CapabilityVerbosity>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    max_context_tokens: OverrideField<Option<u32>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    max_output_tokens: OverrideField<Option<u32>>,
    #[serde(skip_serializing_if = "OverrideField::is_unset")]
    max_temperature: OverrideField<Option<f32>>,
}

impl ProviderCapabilityOverrides {
    pub fn from_storage_json(raw: &str) -> Result<Self, String> {
        let value: Self = serde_json::from_str(raw)
            .map_err(|error| format!("invalid persisted model_config.capability_overrides: {error}"))?;
        value.storage_json()?;
        Ok(value)
    }

    pub fn storage_json(&self) -> Result<String, String> {
        let raw = serde_json::to_string(self)
            .map_err(|error| format!("cannot encode model_config.capability_overrides: {error}"))?;
        meridian_core::provider::capabilities::validate_overrides(Some(&raw))?;
        Ok(raw)
    }
}

pub(crate) fn validate_model_server_tools(tools: &[meridian_core::provider::ServerToolKind]) -> Result<(), String> {
    let unique: std::collections::BTreeSet<meridian_core::provider::ServerToolKind> = tools.iter().copied().collect();
    if unique.len() != tools.len() {
        return Err("server_tools cannot contain duplicate names".into());
    }
    Ok(())
}

fn parse_model_server_tools(raw: &str) -> Result<Vec<meridian_core::provider::ServerToolKind>, String> {
    let tools: Vec<meridian_core::provider::ServerToolKind> =
        serde_json::from_str(raw).map_err(|error| format!("invalid persisted model_config.server_tools: {error}"))?;
    validate_model_server_tools(&tools)?;
    Ok(tools)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AssistantInfoResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
    pub is_default: bool,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub context_limit: i32,
    pub compact_keep_recent: i32,
    pub enabled_tools: Option<Vec<String>>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<i32>,
    pub tool_preset_id: Option<String>,
    pub auto_compact_enabled: bool,
}

impl TryFrom<AssistantRow> for AssistantInfoResponse {
    type Error = String;

    fn try_from(row: AssistantRow) -> Result<Self, Self::Error> {
        let enabled_tools = row
            .enabled_tools
            .as_deref()
            .map(|raw| parse_string_list(raw, "assistant.enabled_tools"))
            .transpose()?;
        let is_default = decode_sqlite_bool(row.is_default, "assistant.is_default")?;
        let thinking_enabled = decode_sqlite_bool(row.thinking_enabled, "assistant.thinking_enabled")?;
        let auto_compact_enabled = decode_sqlite_bool(row.auto_compact_enabled, "assistant.auto_compact_enabled")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            description: row.description,
            avatar: row.avatar,
            system_prompt: row.system_prompt,
            provider_id: row.provider_id,
            model_id: row.model_id,
            temperature: row.temperature,
            top_p: row.top_p,
            max_tokens: row.max_tokens,
            is_default,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
            context_limit: row.context_limit,
            compact_keep_recent: row.compact_keep_recent,
            enabled_tools,
            thinking_enabled,
            thinking_budget: row.thinking_budget,
            tool_preset_id: row.tool_preset_id,
            auto_compact_enabled,
        })
    }
}

pub type AssistantListResponse = Vec<AssistantInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConversationInfoResponse {
    pub id: String,
    pub title: Option<String>,
    pub assistant_id: Option<String>,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub message_count: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<String>,
    pub thinking_level: Option<meridian_core::provider::capabilities::StoredThinkingLevel>,
    pub fast_mode: bool,
    pub mode: Option<meridian_core::agent::modes::ChatMode>,
    pub head_message_id: Option<String>,
    pub accept_edits: bool,
    pub parent_conversation_id: Option<String>,
    pub spawned_by_message_id: Option<String>,
    pub spawned_by_call_id: Option<String>,
    pub spawned_turn_id: Option<String>,
    pub agent_kind: Option<ConversationAgentKind>,
    pub agent_provider_id: Option<String>,
    pub agent_model_id: Option<String>,
}

impl TryFrom<ConversationRow> for ConversationInfoResponse {
    type Error = String;

    fn try_from(row: ConversationRow) -> Result<Self, Self::Error> {
        let thinking_level = row
            .thinking_level
            .as_deref()
            .map(meridian_core::provider::capabilities::StoredThinkingLevel::parse)
            .transpose()?;
        let mode = row
            .mode
            .as_deref()
            .map(meridian_core::agent::modes::ChatMode::parse)
            .transpose()?;
        let agent_kind = row
            .agent_kind
            .as_deref()
            .map(ConversationAgentKind::parse)
            .transpose()?;
        let is_pinned = decode_sqlite_bool(row.is_pinned, "conversation.is_pinned")?;
        let is_archived = decode_sqlite_bool(row.is_archived, "conversation.is_archived")?;
        let fast_mode = decode_sqlite_bool(row.fast_mode, "conversation.fast_mode")?;
        let accept_edits = decode_sqlite_bool(row.accept_edits, "conversation.accept_edits")?;
        Ok(Self {
            id: row.id,
            title: row.title,
            assistant_id: row.assistant_id,
            is_pinned,
            is_archived,
            message_count: row.message_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
            project_id: row.project_id,
            thinking_level,
            fast_mode,
            mode,
            head_message_id: row.head_message_id,
            accept_edits,
            parent_conversation_id: row.parent_conversation_id,
            spawned_by_message_id: row.spawned_by_message_id,
            spawned_by_call_id: row.spawned_by_call_id,
            spawned_turn_id: row.spawned_turn_id,
            agent_kind,
            agent_provider_id: row.agent_provider_id,
            agent_model_id: row.agent_model_id,
        })
    }
}

pub type ConversationListResponse = Vec<ConversationInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EmojiPackInfoResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_image: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub kind: EmojiPackKind,
    pub source_account_id: Option<String>,
    pub is_builtin: bool,
}

impl TryFrom<EmojiPackRow> for EmojiPackInfoResponse {
    type Error = String;

    fn try_from(row: EmojiPackRow) -> Result<Self, Self::Error> {
        let kind = EmojiPackKind::parse(&row.kind)?;
        let is_builtin = decode_sqlite_bool(row.is_builtin, "emoji_pack.is_builtin")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            description: row.description,
            cover_image: row.cover_image,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
            kind,
            source_account_id: row.source_account_id,
            is_builtin,
        })
    }
}

pub type EmojiPackListResponse = Vec<EmojiPackInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EmojiInfoResponse {
    pub id: String,
    pub pack_id: String,
    pub name: String,
    pub tags: Option<String>,
    pub file_name: String,
    pub file_format: String,
    pub sort_order: i32,
    pub created_at: i64,
    pub source: EmojiSource,
    pub source_key: Option<String>,
    pub semantic_status: EmojiSemanticStatus,
    pub suggested_name: Option<String>,
    pub suggested_tags: Option<String>,
    pub file_size: i64,
    pub seen_count: i32,
    pub last_seen_at: Option<i64>,
}

impl TryFrom<EmojiRow> for EmojiInfoResponse {
    type Error = String;

    fn try_from(row: EmojiRow) -> Result<Self, Self::Error> {
        let source = EmojiSource::parse(&row.source)?;
        let semantic_status = EmojiSemanticStatus::parse(&row.semantic_status)?;
        Ok(Self {
            id: row.id,
            pack_id: row.pack_id,
            name: row.name,
            tags: row.tags,
            file_name: row.file_name,
            file_format: row.file_format,
            sort_order: row.sort_order,
            created_at: row.created_at,
            source,
            source_key: row.source_key,
            semantic_status,
            suggested_name: row.suggested_name,
            suggested_tags: row.suggested_tags,
            file_size: row.file_size,
            seen_count: row.seen_count,
            last_seen_at: row.last_seen_at,
        })
    }
}

pub type EmojiListResponse = Vec<EmojiInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct JournalVersionInfoResponse {
    pub id: String,
    pub file_id: String,
    pub seq: i64,
    pub op: JournalOperation,
    pub observed_old_sha: Option<String>,
    pub new_sha: Option<String>,
    pub source: JournalSource,
    pub conversation_id: Option<String>,
    pub turn_id: Option<String>,
    pub project_id: Option<String>,
    pub origin: Option<meridian_core::turn::TurnOrigin>,
    pub model_id: Option<String>,
    pub tool_name: Option<String>,
    pub moved_from_version_id: Option<String>,
    pub created_at: i64,
}

impl TryFrom<JournalVersionRow> for JournalVersionInfoResponse {
    type Error = String;

    fn try_from(row: JournalVersionRow) -> Result<Self, Self::Error> {
        let op = JournalOperation::parse(&row.op)?;
        let source = JournalSource::parse(&row.source)?;
        let origin = row
            .origin
            .as_deref()
            .map(meridian_core::turn::TurnOrigin::parse)
            .transpose()?;
        Ok(Self {
            id: row.id,
            file_id: row.file_id,
            seq: row.seq,
            op,
            observed_old_sha: row.observed_old_sha,
            new_sha: row.new_sha,
            source,
            conversation_id: row.conversation_id,
            turn_id: row.turn_id,
            project_id: row.project_id,
            origin,
            model_id: row.model_id,
            tool_name: row.tool_name,
            moved_from_version_id: row.moved_from_version_id,
            created_at: row.created_at,
        })
    }
}

pub type JournalVersionListResponse = Vec<JournalVersionInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerInfoResponse {
    pub id: String,
    pub name: String,
    pub transport_type: meridian_core::db::models::mcp_server::McpTransport,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
    pub url: Option<String>,
    pub is_enabled: bool,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub headers: Option<BTreeMap<String, String>>,
}

impl TryFrom<McpServerRow> for McpServerInfoResponse {
    type Error = String;

    fn try_from(row: McpServerRow) -> Result<Self, Self::Error> {
        let transport_type = meridian_core::db::models::mcp_server::McpTransport::parse(&row.transport_type)?;
        let args = row
            .args
            .as_deref()
            .map(|raw| serde_json::from_str(raw).map_err(|error| format!("invalid persisted mcp_server.args: {error}")))
            .transpose()?;
        let env = row
            .env
            .as_deref()
            .map(|raw| serde_json::from_str(raw).map_err(|error| format!("invalid persisted mcp_server.env: {error}")))
            .transpose()?;
        let headers = row
            .headers
            .as_deref()
            .map(|raw| {
                serde_json::from_str(raw).map_err(|error| format!("invalid persisted mcp_server.headers: {error}"))
            })
            .transpose()?;
        let is_enabled = decode_sqlite_bool(row.is_enabled, "mcp_server.is_enabled")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            transport_type,
            command: row.command,
            args,
            env,
            url: row.url,
            is_enabled,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
            headers,
        })
    }
}

pub type McpServerListResponse = Vec<McpServerInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryInfoResponse {
    pub id: String,
    pub scope_type: meridian_core::db::models::memory::MemoryScope,
    pub scope_id: String,
    pub key: String,
    pub content: String,
    pub memory_type: meridian_core::db::models::memory::MemoryType,
    pub subject_scope_id: Option<String>,
    pub origin: meridian_core::db::models::memory::Origin,
    pub visibility: meridian_core::db::models::memory::Visibility,
    pub source_session_id: Option<String>,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<meridian_core::db::models::memory::DeletedBy>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TryFrom<MemoryRow> for MemoryInfoResponse {
    type Error = String;

    fn try_from(row: MemoryRow) -> Result<Self, Self::Error> {
        use meridian_core::db::models::memory::{DeletedBy, MemoryScope, MemoryType, Origin, Visibility};

        let scope_type = MemoryScope::parse(&row.scope_type)?;
        let memory_type = MemoryType::parse(&row.memory_type)?;
        let origin = Origin::parse(&row.origin)?;
        let visibility = Visibility::parse(&row.visibility)?;
        let deleted_by = row.deleted_by.as_deref().map(DeletedBy::parse).transpose()?;
        Ok(Self {
            id: row.id,
            scope_type,
            scope_id: row.scope_id,
            key: row.key,
            content: row.content,
            memory_type,
            subject_scope_id: row.subject_scope_id,
            origin,
            visibility,
            source_session_id: row.source_session_id,
            deleted_at: row.deleted_at,
            deleted_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

pub type MemoryListResponse = Vec<MemoryInfoResponse>;

strict_bool_entity_response!(MemorySubjectRow, MemorySubjectInfoResponse, MemorySubjectListResponse, |_row| {}, {
    scope_id: String,
    display_name: Option<String>,
    last_seen_at: i64,
    created_at: i64,
}, {
    is_protected,
    is_pinned,
    opted_out,
});

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelConfigInfoResponse {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: Option<String>,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: Option<i32>,
    pub input_price: Option<meridian_core::decimal::Decimal>,
    pub output_price: Option<meridian_core::decimal::Decimal>,
    pub cache_read_price: Option<meridian_core::decimal::Decimal>,
    pub created_at: i64,
    pub updated_at: i64,
    pub capability_overrides: Option<ProviderCapabilityOverrides>,
    pub cache_write_price: Option<meridian_core::decimal::Decimal>,
    pub pricing_tiers: Vec<meridian_core::agent::pricing::PriceTier>,
    pub server_tools: Option<Vec<meridian_core::provider::ServerToolKind>>,
    pub server_tool_price: Option<meridian_core::decimal::Decimal>,
}

impl TryFrom<ModelConfigRow> for ModelConfigInfoResponse {
    type Error = String;

    fn try_from(row: ModelConfigRow) -> Result<Self, Self::Error> {
        let pricing_tiers = meridian_core::agent::pricing::parse_tiers(row.pricing_tiers.as_deref())
            .map_err(|error| error.to_string())?;
        let capability_overrides = row
            .capability_overrides
            .as_deref()
            .map(ProviderCapabilityOverrides::from_storage_json)
            .transpose()?;
        let server_tools = row.server_tools.as_deref().map(parse_model_server_tools).transpose()?;
        Ok(Self {
            id: row.id,
            provider_id: row.provider_id,
            model_id: row.model_id,
            display_name: row.display_name,
            context_window: row.context_window,
            compact_threshold: row.compact_threshold,
            max_output_tokens: row.max_output_tokens,
            input_price: row.input_price,
            output_price: row.output_price,
            cache_read_price: row.cache_read_price,
            created_at: row.created_at,
            updated_at: row.updated_at,
            capability_overrides,
            cache_write_price: row.cache_write_price,
            pricing_tiers,
            server_tools,
            server_tool_price: row.server_tool_price,
        })
    }
}

pub type ModelConfigListResponse = Vec<ModelConfigInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectInfoResponse {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub source_type: meridian_core::db::models::project::ProjectSource,
    pub source_id: Option<String>,
    pub assistant_id: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TryFrom<ProjectRow> for ProjectInfoResponse {
    type Error = String;

    fn try_from(row: ProjectRow) -> Result<Self, Self::Error> {
        let source_type = meridian_core::db::models::project::ProjectSource::parse(&row.source_type)?;
        Ok(Self {
            id: row.id,
            name: row.name,
            path: row.path,
            source_type,
            source_id: row.source_id,
            assistant_id: row.assistant_id,
            description: row.description,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

pub type ProjectListResponse = Vec<ProjectInfoResponse>;

strict_bool_entity_response!(PromptTemplateRow, PromptTemplateInfoResponse, PromptTemplateListResponse, |_row| {}, {
    id: String,
    name: String,
    description: Option<String>,
    category: String,
    template_text: String,
    sort_order: i32,
    created_at: i64,
    updated_at: i64,
}, {
    is_builtin,
});

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderInfoResponse {
    pub id: String,
    pub name: String,
    pub provider_type: meridian_core::provider::registry::ProviderType,
    pub base_url: String,
    pub is_enabled: bool,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub api_format: meridian_core::provider::registry::ApiFormat,
    pub catalog_id: Option<String>,
    pub credential_kind: meridian_core::provider::registry::CredentialKind,
    pub transport_profile: meridian_core::provider::registry::TransportProfile,
}

impl TryFrom<ProviderRow> for ProviderInfoResponse {
    type Error = String;

    fn try_from(row: ProviderRow) -> Result<Self, Self::Error> {
        meridian_core::provider::registry::validate_stored_contract(
            &row.provider_type,
            &row.api_format,
            &row.transport_profile,
            &row.credential_kind,
        )?;
        let is_enabled = decode_sqlite_bool(row.is_enabled, "provider.is_enabled")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            provider_type: meridian_core::provider::registry::ProviderType::parse(&row.provider_type)?,
            base_url: row.base_url,
            is_enabled,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
            api_format: meridian_core::provider::registry::ApiFormat::parse(&row.api_format)?,
            catalog_id: row.catalog_id,
            credential_kind: meridian_core::provider::registry::CredentialKind::parse(&row.credential_kind)?,
            transport_profile: meridian_core::provider::registry::TransportProfile::parse(&row.transport_profile)?,
        })
    }
}

pub type ProviderListResponse = Vec<ProviderInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct QueuedPromptInfoResponse {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub delivery: meridian_core::db::models::queue::Delivery,
    pub position: i32,
    pub created_at: i64,
    pub dispatched_at: Option<i64>,
    pub dispatched_turn_id: Option<String>,
    pub settled_at: Option<i64>,
    pub settled_message_id: Option<String>,
    pub held_at: Option<i64>,
    pub reported_at: Option<i64>,
}

impl TryFrom<QueuedPromptRow> for QueuedPromptInfoResponse {
    type Error = String;

    fn try_from(row: QueuedPromptRow) -> Result<Self, Self::Error> {
        let delivery = meridian_core::db::models::queue::Delivery::parse(&row.delivery)?;
        Ok(Self {
            id: row.id,
            conversation_id: row.conversation_id,
            content: row.content,
            delivery,
            position: row.position,
            created_at: row.created_at,
            dispatched_at: row.dispatched_at,
            dispatched_turn_id: row.dispatched_turn_id,
            settled_at: row.settled_at,
            settled_message_id: row.settled_message_id,
            held_at: row.held_at,
            reported_at: row.reported_at,
        })
    }
}

pub type QueuedPromptListResponse = Vec<QueuedPromptInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillInfoResponse {
    pub dir_name: String,
    pub llm_name: String,
    pub llm_description: String,
    pub display_name: String,
    pub display_description: Option<String>,
    pub source: SkillSource,
    pub mtime_hash: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_enabled: bool,
    pub is_builtin: bool,
}

impl TryFrom<SkillRow> for SkillInfoResponse {
    type Error = String;

    fn try_from(row: SkillRow) -> Result<Self, Self::Error> {
        let source = SkillSource::parse(&row.source)?;
        let is_enabled = decode_sqlite_bool(row.is_enabled, "skill.is_enabled")?;
        let is_builtin = decode_sqlite_bool(row.is_builtin, "skill.is_builtin")?;
        Ok(Self {
            dir_name: row.dir_name,
            llm_name: row.llm_name,
            llm_description: row.llm_description,
            display_name: row.display_name,
            display_description: row.display_description,
            source,
            mtime_hash: row.mtime_hash,
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_enabled,
            is_builtin,
        })
    }
}

pub type SkillListResponse = Vec<SkillInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct TodoListInfoResponse {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub status: meridian_core::db::models::todo::ListStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TryFrom<TodoListRow> for TodoListInfoResponse {
    type Error = String;

    fn try_from(row: TodoListRow) -> Result<Self, Self::Error> {
        let status = meridian_core::db::models::todo::ListStatus::parse(&row.status)?;
        Ok(Self {
            id: row.id,
            conversation_id: row.conversation_id,
            title: row.title,
            status,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TodoItemInfoResponse {
    pub id: String,
    pub list_id: String,
    pub content: String,
    pub active_form: String,
    pub status: meridian_core::db::models::todo::ItemStatus,
    pub sort_order: i32,
    pub created_at: i64,
}

impl TryFrom<TodoItemRow> for TodoItemInfoResponse {
    type Error = String;

    fn try_from(row: TodoItemRow) -> Result<Self, Self::Error> {
        let status = meridian_core::db::models::todo::ItemStatus::parse(&row.status)?;
        Ok(Self {
            id: row.id,
            list_id: row.list_id,
            content: row.content,
            active_form: row.active_form,
            status,
            sort_order: row.sort_order,
            created_at: row.created_at,
        })
    }
}

pub type TodoItemListResponse = Vec<TodoItemInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct TodoInfoResponse {
    pub list: TodoListInfoResponse,
    pub items: TodoItemListResponse,
}

impl TryFrom<TodoListView> for TodoInfoResponse {
    type Error = String;

    fn try_from(view: TodoListView) -> Result<Self, Self::Error> {
        Ok(Self {
            list: view.list.try_into()?,
            items: view
                .items
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
        })
    }
}

entity_response!(ToolCategoryRow, ToolCategoryInfoResponse, ToolCategoryListResponse, {
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
    sort_order: i32,
    created_at: i64,
});

#[derive(Debug, Clone, serde::Serialize)]
pub struct CustomToolInfoResponse {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category_id: Option<String>,
    pub parameters_schema: serde_json::Map<String, serde_json::Value>,
    pub command: String,
    pub args_template: Option<String>,
    pub working_directory: Option<String>,
    pub timeout_ms: Option<i32>,
    pub permission: meridian_core::tools::Permission,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_enabled: bool,
}

impl TryFrom<CustomToolRow> for CustomToolInfoResponse {
    type Error = String;

    fn try_from(row: CustomToolRow) -> Result<Self, Self::Error> {
        let parameters_schema = serde_json::from_str(&row.parameters_schema)
            .map_err(|error| format!("invalid persisted custom_tool.parameters_schema: {error}"))?;
        let permission = meridian_core::tools::Permission::parse(&row.permission)?;
        let is_enabled = decode_sqlite_bool(row.is_enabled, "custom_tool.is_enabled")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            description: row.description,
            category_id: row.category_id,
            parameters_schema,
            command: row.command,
            args_template: row.args_template,
            working_directory: row.working_directory,
            timeout_ms: row.timeout_ms,
            permission,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_enabled,
        })
    }
}

pub type CustomToolListResponse = Vec<CustomToolInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolPresetInfoResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub tool_names: Vec<String>,
    pub is_builtin: bool,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TryFrom<ToolPresetRow> for ToolPresetInfoResponse {
    type Error = String;

    fn try_from(row: ToolPresetRow) -> Result<Self, Self::Error> {
        let tool_names = parse_string_list(&row.tool_names, "tool_preset.tool_names")?;
        let is_builtin = decode_sqlite_bool(row.is_builtin, "tool_preset.is_builtin")?;
        Ok(Self {
            id: row.id,
            name: row.name,
            description: row.description,
            icon: row.icon,
            tool_names,
            is_builtin,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

pub type ToolPresetListResponse = Vec<ToolPresetInfoResponse>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_booleans_are_closed_and_leave_ipc_as_booleans() {
        assert!(!decode_sqlite_bool(0, "test.enabled").unwrap());
        assert!(decode_sqlite_bool(1, "test.enabled").unwrap());
        assert!(decode_sqlite_bool(-1, "test.enabled").is_err());
        assert!(decode_sqlite_bool(2, "test.enabled").is_err());
    }

    fn conversation_row(agent_kind: Option<&str>) -> ConversationRow {
        ConversationRow {
            id: "conversation".into(),
            title: None,
            assistant_id: None,
            is_pinned: 0,
            is_archived: 0,
            message_count: 0,
            created_at: 1,
            updated_at: 1,
            project_id: None,
            thinking_level: None,
            fast_mode: 0,
            mode: None,
            head_message_id: None,
            accept_edits: 0,
            parent_conversation_id: None,
            spawned_by_message_id: None,
            spawned_by_call_id: None,
            spawned_turn_id: None,
            agent_kind: agent_kind.map(str::to_owned),
            agent_provider_id: None,
            agent_model_id: None,
        }
    }

    #[test]
    fn conversation_agent_kind_is_a_closed_response_enum() {
        let response = ConversationInfoResponse::try_from(conversation_row(Some("claude_code"))).unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["agent_kind"], "claude_code");

        let error = ConversationInfoResponse::try_from(conversation_row(Some("future_agent"))).unwrap_err();
        assert!(error.contains("unknown conversation agent kind"));
    }

    #[test]
    fn conversation_preferences_are_closed_response_enums() {
        let mut row = conversation_row(None);
        row.thinking_level = Some("xhigh".into());
        row.mode = Some("plan".into());
        let value = serde_json::to_value(ConversationInfoResponse::try_from(row).unwrap()).unwrap();
        assert_eq!(value["thinking_level"], "xhigh");
        assert_eq!(value["mode"], "plan");

        let mut unknown_thinking = conversation_row(None);
        unknown_thinking.thinking_level = Some("future".into());
        assert!(ConversationInfoResponse::try_from(unknown_thinking).is_err());

        let mut unknown_mode = conversation_row(None);
        unknown_mode.mode = Some("future".into());
        assert!(ConversationInfoResponse::try_from(unknown_mode).is_err());
    }

    #[test]
    fn command_owned_response_enums_reject_unknown_values() {
        assert_eq!(
            serde_json::to_value(EmojiPackKind::parse("onebot").unwrap()).unwrap(),
            "onebot"
        );
        assert_eq!(
            serde_json::to_value(EmojiSource::parse("onebot_mface").unwrap()).unwrap(),
            "onebot_mface"
        );
        assert_eq!(
            serde_json::to_value(EmojiSemanticStatus::parse("confirmed").unwrap()).unwrap(),
            "confirmed"
        );
        assert_eq!(
            serde_json::to_value(JournalOperation::parse("command_observed").unwrap()).unwrap(),
            "command_observed"
        );
        assert_eq!(
            serde_json::to_value(JournalSource::parse("hosted").unwrap()).unwrap(),
            "hosted"
        );
        assert_eq!(
            serde_json::to_value(SkillSource::parse("official").unwrap()).unwrap(),
            "official"
        );
        assert_eq!(
            serde_json::to_value(meridian_core::db::models::memory::DeletedBy::parse("self").unwrap()).unwrap(),
            "self"
        );

        assert!(EmojiPackKind::parse("future").is_err());
        assert!(EmojiSource::parse("future").is_err());
        assert!(EmojiSemanticStatus::parse("future").is_err());
        assert!(JournalOperation::parse("future").is_err());
        assert!(JournalSource::parse("future").is_err());
        assert!(SkillSource::parse("future").is_err());
    }

    fn custom_tool_row(parameters_schema: &str) -> CustomToolRow {
        CustomToolRow {
            id: "tool".into(),
            name: "tool".into(),
            description: "description".into(),
            category_id: None,
            parameters_schema: parameters_schema.into(),
            command: "tool".into(),
            args_template: None,
            working_directory: None,
            timeout_ms: None,
            permission: "ask".into(),
            is_enabled: 1,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn custom_tool_schema_leaves_ipc_as_an_object() {
        let response = CustomToolInfoResponse::try_from(custom_tool_row(
            r#"{"type":"object","properties":{"path":{"type":"string"}}}"#,
        ))
        .unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert!(value["parameters_schema"].is_object());
        assert_eq!(value["parameters_schema"]["type"], "object");
        assert_eq!(value["permission"], "ask");
    }

    #[test]
    fn malformed_or_non_object_custom_tool_schema_fails_at_the_response_boundary() {
        assert!(CustomToolInfoResponse::try_from(custom_tool_row("{")).is_err());
        assert!(CustomToolInfoResponse::try_from(custom_tool_row(r#"["path"]"#)).is_err());
    }

    fn model_config_row() -> ModelConfigRow {
        ModelConfigRow {
            id: "config".into(),
            provider_id: "provider".into(),
            model_id: "model".into(),
            display_name: None,
            context_window: 128_000,
            compact_threshold: 100_000,
            max_output_tokens: None,
            input_price: None,
            output_price: None,
            cache_read_price: None,
            created_at: 1,
            updated_at: 2,
            capability_overrides: Some(
                r#"{"supports_thinking":true,"supported_efforts":["low","high"],"default_effort":null}"#.into(),
            ),
            cache_write_price: None,
            pricing_tiers: None,
            server_tools: Some(r#"["web_search","x_search"]"#.into()),
            server_tool_price: None,
        }
    }

    #[test]
    fn model_config_json_fields_leave_ipc_as_objects_and_arrays() {
        let response = ModelConfigInfoResponse::try_from(model_config_row()).unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert!(value["capability_overrides"].is_object());
        assert_eq!(value["capability_overrides"]["supports_thinking"], true);
        assert!(
            value["capability_overrides"]
                .get("default_effort")
                .is_some_and(serde_json::Value::is_null)
        );
        assert_eq!(value["server_tools"], serde_json::json!(["web_search", "x_search"]));
    }

    #[test]
    fn corrupt_model_config_json_fails_at_the_response_boundary() {
        let mut unknown_override = model_config_row();
        unknown_override.capability_overrides = Some(r#"{"future_capability":true}"#.into());
        assert!(ModelConfigInfoResponse::try_from(unknown_override).is_err());

        let mut malformed_tools = model_config_row();
        malformed_tools.server_tools = Some(r#"{"web_search":true}"#.into());
        assert!(ModelConfigInfoResponse::try_from(malformed_tools).is_err());

        let mut duplicate_tools = model_config_row();
        duplicate_tools.server_tools = Some(r#"["web_search","web_search"]"#.into());
        assert!(ModelConfigInfoResponse::try_from(duplicate_tools).is_err());

        let mut unknown_tools = model_config_row();
        unknown_tools.server_tools = Some(r#"["future_search"]"#.into());
        assert!(ModelConfigInfoResponse::try_from(unknown_tools).is_err());
    }
}
