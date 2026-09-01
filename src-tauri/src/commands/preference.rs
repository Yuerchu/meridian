//! The deliberately small public view of the preferences table.
//!
//! Storage remains string K/V because many headless subsystems read it without
//! a Tauri shell. IPC does not: every reachable key and every value shape is a
//! closed contract here, so adding an internal preference cannot silently add
//! a remote write API for it.

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
#[cfg(not(target_os = "android"))]
use meridian_core::sandbox::ExecutionMode;
use meridian_core::tools::ShellType;
use meridian_core::util::now_ms;

const MAX_APPROVAL_TTL_MINUTES: u64 = 7 * 24 * 60;

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Off,
    Auto,
    Container,
}

#[cfg(target_os = "android")]
impl ExecutionMode {
    fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw {
            None | Some("auto") => Ok(Self::Auto),
            Some("off") => Ok(Self::Off),
            Some("container") => Ok(Self::Container),
            Some(value) => Err(format!("unknown execution mode `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub enum PreferenceKey {
    #[serde(rename = "shell")]
    Shell,
    #[serde(rename = "sandbox.enabled")]
    SandboxMode,
    #[serde(rename = "search_provider")]
    SearchProvider,
    #[serde(rename = "voice.filter_level")]
    VoiceFilterLevel,
    #[serde(rename = "voice.download_url")]
    VoiceDownloadUrl,
    #[serde(rename = "android.manage_storage_enabled")]
    AndroidManageStorageEnabled,
    #[serde(rename = "autoreview.enabled")]
    AutoReviewEnabled,
    #[serde(rename = "autoreview.model")]
    AutoReviewModel,
    #[serde(rename = "autoreview.escalate")]
    AutoReviewEscalate,
    #[serde(rename = "autoreview.allow_rules")]
    AutoReviewAllowRules,
    #[serde(rename = "autoreview.deny_rules")]
    AutoReviewDenyRules,
    #[serde(rename = "autoreview.environment")]
    AutoReviewEnvironment,
    #[serde(rename = "approvals.ttl_minutes")]
    ApprovalsTtlMinutes,
    #[serde(rename = "sub_agent.explore.model")]
    SubAgentExploreModel,
    #[serde(rename = "sub_agent.agent.model")]
    SubAgentAgentModel,
}

impl PreferenceKey {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::SandboxMode => "sandbox.enabled",
            Self::SearchProvider => "search_provider",
            Self::VoiceFilterLevel => "voice.filter_level",
            Self::VoiceDownloadUrl => "voice.download_url",
            Self::AndroidManageStorageEnabled => "android.manage_storage_enabled",
            Self::AutoReviewEnabled => "autoreview.enabled",
            Self::AutoReviewModel => "autoreview.model",
            Self::AutoReviewEscalate => "autoreview.escalate",
            Self::AutoReviewAllowRules => "autoreview.allow_rules",
            Self::AutoReviewDenyRules => "autoreview.deny_rules",
            Self::AutoReviewEnvironment => "autoreview.environment",
            Self::ApprovalsTtlMinutes => "approvals.ttl_minutes",
            Self::SubAgentExploreModel => "sub_agent.explore.model",
            Self::SubAgentAgentModel => "sub_agent.agent.model",
        }
    }

    /// These values control code execution or who answers an approval. A
    /// remote client may use the typed command for ordinary preferences, but
    /// must change these on the host that will execute the result.
    pub(crate) const fn is_server_owned(self) -> bool {
        matches!(
            self,
            Self::SandboxMode
                | Self::AutoReviewEnabled
                | Self::AutoReviewModel
                | Self::AutoReviewEscalate
                | Self::AutoReviewAllowRules
                | Self::AutoReviewDenyRules
                | Self::AutoReviewEnvironment
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchProvider {
    Tavily,
    Zhipu,
}

impl SearchProvider {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Tavily => "tavily",
            Self::Zhipu => "zhipu",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "tavily" => Ok(Self::Tavily),
            "zhipu" => Ok(Self::Zhipu),
            _ => Err(format!("preference `search_provider` has unknown value {value:?}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceFilterLevel {
    Off,
    Standard,
    Aggressive,
}

impl VoiceFilterLevel {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Standard => "standard",
            Self::Aggressive => "aggressive",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "off" => Ok(Self::Off),
            "standard" => Ok(Self::Standard),
            "aggressive" => Ok(Self::Aggressive),
            _ => Err(format!("preference `voice.filter_level` has unknown value {value:?}")),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceReadRequest {
    pub key: PreferenceKey,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceModelSelectionRequest {
    provider_id: String,
    model_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PreferenceModelSelectionInfoResponse {
    pub provider_id: String,
    pub model_id: String,
}

/// A tagged union rather than a generic `{ key, value: string }`: serde checks
/// the value against the selected key before anything reaches storage.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "key", deny_unknown_fields)]
pub enum PreferenceUpdateRequest {
    #[serde(rename = "shell")]
    Shell { value: ShellType },
    #[serde(rename = "sandbox.enabled")]
    SandboxMode { value: ExecutionMode },
    #[serde(rename = "search_provider")]
    SearchProvider { value: SearchProvider },
    #[serde(rename = "voice.filter_level")]
    VoiceFilterLevel { value: VoiceFilterLevel },
    #[serde(rename = "voice.download_url")]
    VoiceDownloadUrl { value: RequiredNullable<String> },
    #[serde(rename = "android.manage_storage_enabled")]
    AndroidManageStorageEnabled { value: bool },
    #[serde(rename = "autoreview.enabled")]
    AutoReviewEnabled { value: bool },
    #[serde(rename = "autoreview.model")]
    AutoReviewModel {
        value: RequiredNullable<PreferenceModelSelectionRequest>,
    },
    #[serde(rename = "autoreview.escalate")]
    AutoReviewEscalate { value: bool },
    #[serde(rename = "autoreview.allow_rules")]
    AutoReviewAllowRules { value: String },
    #[serde(rename = "autoreview.deny_rules")]
    AutoReviewDenyRules { value: String },
    #[serde(rename = "autoreview.environment")]
    AutoReviewEnvironment { value: String },
    #[serde(rename = "approvals.ttl_minutes")]
    ApprovalsTtlMinutes { value: u64 },
    #[serde(rename = "sub_agent.explore.model")]
    SubAgentExploreModel {
        value: RequiredNullable<PreferenceModelSelectionRequest>,
    },
    #[serde(rename = "sub_agent.agent.model")]
    SubAgentAgentModel {
        value: RequiredNullable<PreferenceModelSelectionRequest>,
    },
}

/// Typed current value. `null` means the row is absent; it is not a second
/// spelling accepted by a non-null update variant.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "key", content = "value")]
pub enum PreferenceInfoResponse {
    #[serde(rename = "shell")]
    Shell(Option<ShellType>),
    #[serde(rename = "sandbox.enabled")]
    SandboxMode(Option<ExecutionMode>),
    #[serde(rename = "search_provider")]
    SearchProvider(Option<SearchProvider>),
    #[serde(rename = "voice.filter_level")]
    VoiceFilterLevel(Option<VoiceFilterLevel>),
    #[serde(rename = "voice.download_url")]
    VoiceDownloadUrl(Option<String>),
    #[serde(rename = "android.manage_storage_enabled")]
    AndroidManageStorageEnabled(Option<bool>),
    #[serde(rename = "autoreview.enabled")]
    AutoReviewEnabled(Option<bool>),
    #[serde(rename = "autoreview.model")]
    AutoReviewModel(Option<PreferenceModelSelectionInfoResponse>),
    #[serde(rename = "autoreview.escalate")]
    AutoReviewEscalate(Option<bool>),
    #[serde(rename = "autoreview.allow_rules")]
    AutoReviewAllowRules(Option<String>),
    #[serde(rename = "autoreview.deny_rules")]
    AutoReviewDenyRules(Option<String>),
    #[serde(rename = "autoreview.environment")]
    AutoReviewEnvironment(Option<String>),
    #[serde(rename = "approvals.ttl_minutes")]
    ApprovalsTtlMinutes(Option<u64>),
    #[serde(rename = "sub_agent.explore.model")]
    SubAgentExploreModel(Option<PreferenceModelSelectionInfoResponse>),
    #[serde(rename = "sub_agent.agent.model")]
    SubAgentAgentModel(Option<PreferenceModelSelectionInfoResponse>),
}

fn optional_bool(key: PreferenceKey, raw: Option<String>) -> Result<Option<bool>, String> {
    raw.map(|value| match value.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("preference `{}` has invalid boolean {value:?}", key.as_str())),
    })
    .transpose()
}

fn parse_model_selection(
    key: PreferenceKey,
    raw: Option<String>,
) -> Result<Option<PreferenceModelSelectionInfoResponse>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let (provider_id, model_id) = raw
        .split_once(':')
        .ok_or_else(|| format!("preference `{}` must contain provider:model", key.as_str()))?;
    validate_model_parts(key, provider_id, model_id)?;
    Ok(Some(PreferenceModelSelectionInfoResponse {
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
    }))
}

fn validate_model_parts(key: PreferenceKey, provider_id: &str, model_id: &str) -> Result<(), String> {
    if provider_id.is_empty()
        || model_id.is_empty()
        || provider_id.trim() != provider_id
        || model_id.trim() != model_id
        || provider_id.contains(':')
    {
        return Err(format!(
            "preference `{}` requires non-empty canonical providerId and modelId",
            key.as_str()
        ));
    }
    Ok(())
}

fn encode_model_selection(
    key: PreferenceKey,
    selection: Option<PreferenceModelSelectionRequest>,
) -> Result<Option<String>, String> {
    selection
        .map(|selection| {
            validate_model_parts(key, &selection.provider_id, &selection.model_id)?;
            Ok(format!("{}:{}", selection.provider_id, selection.model_id))
        })
        .transpose()
}

fn parse_ttl(raw: Option<String>) -> Result<Option<u64>, String> {
    raw.map(|raw| {
        let value = raw
            .parse::<u64>()
            .map_err(|error| format!("preference `approvals.ttl_minutes` has invalid value {raw:?}: {error}"))?;
        if value.to_string() != raw {
            return Err(format!(
                "preference `approvals.ttl_minutes` must use canonical decimal digits, got {raw:?}"
            ));
        }
        validate_ttl(value)?;
        Ok(value)
    })
    .transpose()
}

fn validate_ttl(value: u64) -> Result<(), String> {
    if value > MAX_APPROVAL_TTL_MINUTES {
        return Err(format!(
            "approvals.ttl_minutes cannot exceed {MAX_APPROVAL_TTL_MINUTES}"
        ));
    }
    Ok(())
}

fn validate_download_url(value: String) -> Result<String, String> {
    if value.trim() != value || value.is_empty() {
        return Err("voice.download_url must be a non-empty URL without surrounding whitespace".into());
    }
    let parsed = url::Url::parse(&value).map_err(|error| format!("voice.download_url is invalid: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("voice.download_url must use http or https and include a host".into());
    }
    Ok(parsed.to_string())
}

fn decode_preference(key: PreferenceKey, raw: Option<String>) -> Result<PreferenceInfoResponse, String> {
    Ok(match key {
        PreferenceKey::Shell => PreferenceInfoResponse::Shell(raw.map(|value| ShellType::parse(&value)).transpose()?),
        PreferenceKey::SandboxMode => {
            PreferenceInfoResponse::SandboxMode(raw.map(|value| ExecutionMode::parse(Some(&value))).transpose()?)
        }
        PreferenceKey::SearchProvider => {
            PreferenceInfoResponse::SearchProvider(raw.map(|value| SearchProvider::parse(&value)).transpose()?)
        }
        PreferenceKey::VoiceFilterLevel => {
            PreferenceInfoResponse::VoiceFilterLevel(raw.map(|value| VoiceFilterLevel::parse(&value)).transpose()?)
        }
        PreferenceKey::VoiceDownloadUrl => {
            PreferenceInfoResponse::VoiceDownloadUrl(raw.map(validate_download_url).transpose()?)
        }
        PreferenceKey::AndroidManageStorageEnabled => {
            PreferenceInfoResponse::AndroidManageStorageEnabled(optional_bool(key, raw)?)
        }
        PreferenceKey::AutoReviewEnabled => PreferenceInfoResponse::AutoReviewEnabled(optional_bool(key, raw)?),
        PreferenceKey::AutoReviewModel => PreferenceInfoResponse::AutoReviewModel(parse_model_selection(key, raw)?),
        PreferenceKey::AutoReviewEscalate => PreferenceInfoResponse::AutoReviewEscalate(optional_bool(key, raw)?),
        PreferenceKey::AutoReviewAllowRules => PreferenceInfoResponse::AutoReviewAllowRules(raw),
        PreferenceKey::AutoReviewDenyRules => PreferenceInfoResponse::AutoReviewDenyRules(raw),
        PreferenceKey::AutoReviewEnvironment => PreferenceInfoResponse::AutoReviewEnvironment(raw),
        PreferenceKey::ApprovalsTtlMinutes => PreferenceInfoResponse::ApprovalsTtlMinutes(parse_ttl(raw)?),
        PreferenceKey::SubAgentExploreModel => {
            PreferenceInfoResponse::SubAgentExploreModel(parse_model_selection(key, raw)?)
        }
        PreferenceKey::SubAgentAgentModel => {
            PreferenceInfoResponse::SubAgentAgentModel(parse_model_selection(key, raw)?)
        }
    })
}

impl PreferenceUpdateRequest {
    fn into_storage(self) -> Result<(PreferenceKey, Option<String>), String> {
        Ok(match self {
            Self::Shell { value } => {
                let value = match value {
                    ShellType::Bash => "bash",
                    ShellType::PowerShell => "powershell",
                    ShellType::Cmd => "cmd",
                };
                (PreferenceKey::Shell, Some(value.into()))
            }
            Self::SandboxMode { value } => {
                let value = match value {
                    ExecutionMode::Off => "off",
                    ExecutionMode::Auto => "auto",
                    ExecutionMode::Container => "container",
                };
                (PreferenceKey::SandboxMode, Some(value.into()))
            }
            Self::SearchProvider { value } => (PreferenceKey::SearchProvider, Some(value.as_str().into())),
            Self::VoiceFilterLevel { value } => (PreferenceKey::VoiceFilterLevel, Some(value.as_str().into())),
            Self::VoiceDownloadUrl { value } => (
                PreferenceKey::VoiceDownloadUrl,
                value.0.map(validate_download_url).transpose()?,
            ),
            Self::AndroidManageStorageEnabled { value } => {
                (PreferenceKey::AndroidManageStorageEnabled, Some(value.to_string()))
            }
            Self::AutoReviewEnabled { value } => (PreferenceKey::AutoReviewEnabled, Some(value.to_string())),
            Self::AutoReviewModel { value } => (
                PreferenceKey::AutoReviewModel,
                encode_model_selection(PreferenceKey::AutoReviewModel, value.0)?,
            ),
            Self::AutoReviewEscalate { value } => (PreferenceKey::AutoReviewEscalate, Some(value.to_string())),
            Self::AutoReviewAllowRules { value } => (PreferenceKey::AutoReviewAllowRules, Some(value)),
            Self::AutoReviewDenyRules { value } => (PreferenceKey::AutoReviewDenyRules, Some(value)),
            Self::AutoReviewEnvironment { value } => (PreferenceKey::AutoReviewEnvironment, Some(value)),
            Self::ApprovalsTtlMinutes { value } => {
                validate_ttl(value)?;
                (PreferenceKey::ApprovalsTtlMinutes, Some(value.to_string()))
            }
            Self::SubAgentExploreModel { value } => (
                PreferenceKey::SubAgentExploreModel,
                encode_model_selection(PreferenceKey::SubAgentExploreModel, value.0)?,
            ),
            Self::SubAgentAgentModel { value } => (
                PreferenceKey::SubAgentAgentModel,
                encode_model_selection(PreferenceKey::SubAgentAgentModel, value.0)?,
            ),
        })
    }
}

#[tauri::command]
pub async fn get_preference(
    app: tauri::AppHandle,
    request: PreferenceReadRequest,
) -> Result<PreferenceInfoResponse, String> {
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let raw = db::ops::preference::get_preference(&mut conn, request.key.as_str()).map_err(|e| e.to_string())?;
        decode_preference(request.key, raw)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_preference(app: tauri::AppHandle, request: PreferenceUpdateRequest) -> Result<(), String> {
    let (key, value) = request.into_storage()?;
    let pool = app.services().db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        match value {
            Some(value) => db::ops::preference::set_preference(&mut conn, key.as_str(), &value, now_ms()),
            None => db::ops::preference::delete_preference(&mut conn, key.as_str()),
        }
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_keys_and_values_are_closed_and_typed() {
        serde_json::from_value::<PreferenceReadRequest>(serde_json::json!({ "key": "shell" })).unwrap();
        assert!(
            serde_json::from_value::<PreferenceReadRequest>(serde_json::json!({ "key": "future.setting" })).is_err()
        );
        assert!(
            serde_json::from_value::<PreferenceReadRequest>(serde_json::json!({ "key": "shell", "legacy": true }))
                .is_err()
        );

        serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
            "key": "sandbox.enabled",
            "value": "container"
        }))
        .unwrap();
        for legacy in ["false", "true", "docker"] {
            assert!(
                serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
                    "key": "sandbox.enabled",
                    "value": legacy
                }))
                .is_err(),
                "legacy sandbox value {legacy:?} must be rejected"
            );
        }
        serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
            "key": "shell",
            "value": "cmd"
        }))
        .unwrap();
        assert!(
            serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
                "key": "shell",
                "value": "bash",
                "legacy": true
            }))
            .is_err()
        );
        for key in [
            "voice.download_url",
            "autoreview.model",
            "sub_agent.explore.model",
            "sub_agent.agent.model",
        ] {
            assert!(
                serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({ "key": key })).is_err(),
                "nullable value for {key:?} must still be present explicitly"
            );
        }
        assert!(
            serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
                "key": "future.setting",
                "value": "anything"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
                "key": "autoreview.enabled",
                "value": "true"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
                "key": "approvals.ttl_minutes",
                "value": "30"
            }))
            .is_err()
        );
    }

    #[test]
    fn response_keeps_the_key_and_typed_value_together() {
        let response = decode_preference(PreferenceKey::AndroidManageStorageEnabled, Some("true".into())).unwrap();
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({ "key": "android.manage_storage_enabled", "value": true })
        );

        let missing = decode_preference(PreferenceKey::VoiceFilterLevel, None).unwrap();
        assert_eq!(
            serde_json::to_value(missing).unwrap(),
            serde_json::json!({ "key": "voice.filter_level", "value": null })
        );
    }

    #[test]
    fn model_selection_is_structured_at_ipc_and_canonical_in_storage() {
        let request = serde_json::from_value::<PreferenceUpdateRequest>(serde_json::json!({
            "key": "sub_agent.agent.model",
            "value": { "providerId": "provider-1", "modelId": "qwen:7b" }
        }))
        .unwrap();
        assert_eq!(
            request.into_storage().unwrap(),
            (PreferenceKey::SubAgentAgentModel, Some("provider-1:qwen:7b".into()))
        );

        let response = decode_preference(PreferenceKey::SubAgentAgentModel, Some("provider-1:qwen:7b".into())).unwrap();
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "key": "sub_agent.agent.model",
                "value": { "provider_id": "provider-1", "model_id": "qwen:7b" }
            })
        );
    }

    #[test]
    fn malformed_stored_values_fail_instead_of_falling_back() {
        assert!(decode_preference(PreferenceKey::Shell, Some("fish".into())).is_err());
        assert!(decode_preference(PreferenceKey::SandboxMode, Some("docker".into())).is_err());
        assert!(decode_preference(PreferenceKey::AutoReviewEnabled, Some("1".into())).is_err());
        assert!(decode_preference(PreferenceKey::ApprovalsTtlMinutes, Some("030".into())).is_err());
        assert!(decode_preference(PreferenceKey::SubAgentExploreModel, Some(String::new())).is_err());
        assert!(decode_preference(PreferenceKey::VoiceDownloadUrl, Some("not a url".into())).is_err());
    }
}
