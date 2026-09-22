use crate::ServicesExt;
use crate::commands::entity_response::{ProviderInfoResponse, ProviderListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::agent::{get_provider_api_key, provider_secret_name};
use meridian_core::db;
use meridian_core::db::models::provider::{ProviderChangeset, ProviderInsert};
use meridian_core::decimal::Decimal;
use meridian_core::provider::registry::{ApiFormat, CredentialKind, ProviderType, TransportProfile};
use meridian_core::provider::{ServerToolKind, ThinkingStyle};
use meridian_core::secrets::{SecretName, SecretScope};
use meridian_core::util::now_ms;
use std::collections::BTreeMap;

const PLAN_REVIEW_PROVIDER_BARRIER: &str = "This provider is frozen into a plan review or its continuation. Finish that review before changing or deleting the provider.";

#[derive(Debug)]
enum GuardedProviderMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
}

fn update_provider_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    provider_id: &str,
    expected_conversation_ids: &[String],
    changeset: &ProviderChangeset,
    clear_cached_models: bool,
) -> diesel::QueryResult<GuardedProviderMutation<db::models::provider::ProviderRow>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedProviderMutation::ConversationsChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_provider(conn, provider_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedProviderMutation::PlanReviewBarrier);
        }
        if clear_cached_models {
            db::ops::cached_model::delete_by_provider(conn, provider_id)?;
        }
        db::ops::provider::update_provider(conn, provider_id, changeset).map(GuardedProviderMutation::Applied)
    })
}

fn delete_provider_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    provider_id: &str,
    expected_conversation_ids: &[String],
) -> diesel::QueryResult<GuardedProviderMutation<()>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedProviderMutation::ConversationsChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_provider(conn, provider_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedProviderMutation::PlanReviewBarrier);
        }
        db::ops::provider::delete_provider(conn, provider_id).map(GuardedProviderMutation::Applied)
    })
}

fn finish_guarded_provider_mutation<T>(result: GuardedProviderMutation<T>) -> Result<T, String> {
    match result {
        GuardedProviderMutation::Applied(value) => Ok(value),
        GuardedProviderMutation::PlanReviewBarrier => Err(PLAN_REVIEW_PROVIDER_BARRIER.into()),
        GuardedProviderMutation::ConversationsChanged => {
            Err("The conversation set changed while the provider mutation was being prepared. Try again.".into())
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderCatalogWebsitesInfoResponse {
    pub official: Option<String>,
    pub api_key: Option<String>,
    pub docs: Option<String>,
    pub models: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderCatalogAuthOptionInfoResponse {
    pub id: String,
    pub credential_kind: CredentialKind,
    pub transport_profile: TransportProfile,
    pub api_formats: Vec<ApiFormat>,
    pub default_base_url: BTreeMap<String, String>,
}

impl TryFrom<&meridian_core::provider::catalog::AuthOption> for ProviderCatalogAuthOptionInfoResponse {
    type Error = String;

    fn try_from(value: &meridian_core::provider::catalog::AuthOption) -> Result<Self, Self::Error> {
        let credential_kind = CredentialKind::parse(&value.credential_kind)?;
        let transport_profile = TransportProfile::parse(&value.transport_profile)?;
        let api_formats = value
            .api_formats
            .iter()
            .map(|format| ApiFormat::parse(format))
            .collect::<Result<Vec<_>, _>>()?;
        let default_base_url = value
            .default_base_url
            .iter()
            .map(|(format, url)| {
                let format = ApiFormat::parse(format)?;
                Ok((format.as_str().to_owned(), url.clone()))
            })
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        Ok(Self {
            id: value.id.clone(),
            credential_kind,
            transport_profile,
            api_formats,
            default_base_url,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderCatalogModelGroupInfoResponse {
    pub family: String,
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderCatalogEntryInfoResponse {
    pub id: String,
    pub provider_type: ProviderType,
    pub name: String,
    pub icon: String,
    pub balance: bool,
    pub websites: ProviderCatalogWebsitesInfoResponse,
    pub auth: Vec<ProviderCatalogAuthOptionInfoResponse>,
    pub models: Vec<ProviderCatalogModelGroupInfoResponse>,
}

impl TryFrom<&meridian_core::provider::catalog::CatalogEntry> for ProviderCatalogEntryInfoResponse {
    type Error = String;

    fn try_from(value: &meridian_core::provider::catalog::CatalogEntry) -> Result<Self, Self::Error> {
        Ok(Self {
            id: value.id.clone(),
            provider_type: ProviderType::parse(&value.provider_type)?,
            name: value.name.clone(),
            icon: value.icon.clone(),
            balance: value.balance,
            websites: ProviderCatalogWebsitesInfoResponse {
                official: value.websites.official.clone(),
                api_key: value.websites.api_key.clone(),
                docs: value.websites.docs.clone(),
                models: value.websites.models.clone(),
            },
            auth: value
                .auth
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<Vec<_>, _>>()?,
            models: value
                .models
                .iter()
                .map(|group| ProviderCatalogModelGroupInfoResponse {
                    family: group.family.clone(),
                    ids: group.ids.clone(),
                })
                .collect(),
        })
    }
}

pub type ProviderCatalogEntryListResponse = Vec<ProviderCatalogEntryInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderModelInfoResponse {
    pub id: String,
    pub name: String,
}

impl From<meridian_core::provider::models::ModelInfo> for ProviderModelInfoResponse {
    fn from(value: meridian_core::provider::models::ModelInfo) -> Self {
        Self {
            id: value.id,
            name: value.name,
        }
    }
}

pub type ProviderModelListResponse = Vec<ProviderModelInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderBalanceAccountInfoResponse {
    pub currency: String,
    pub total_balance: Decimal,
    pub granted_balance: Option<Decimal>,
    pub topped_up_balance: Option<Decimal>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderBalanceInfoResponse {
    pub is_available: bool,
    pub accounts: Vec<ProviderBalanceAccountInfoResponse>,
}

impl From<meridian_core::provider::balance::ProviderBalance> for ProviderBalanceInfoResponse {
    fn from(value: meridian_core::provider::balance::ProviderBalance) -> Self {
        Self {
            is_available: value.is_available,
            accounts: value
                .accounts
                .into_iter()
                .map(|account| ProviderBalanceAccountInfoResponse {
                    currency: account.currency,
                    total_balance: account.total_balance,
                    granted_balance: account.granted_balance,
                    topped_up_balance: account.topped_up_balance,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderCapabilityEffort {
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl ProviderCapabilityEffort {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "minimal" => Ok(Self::Minimal),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            "xhigh" => Ok(Self::Xhigh),
            "max" => Ok(Self::Max),
            _ => Err(format!("unknown provider capability effort `{value}`")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderCapabilityVerbosity {
    Low,
    Medium,
    High,
}

impl ProviderCapabilityVerbosity {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            _ => Err(format!("unknown provider capability verbosity `{value}`")),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderCapabilitiesInfoResponse {
    pub supports_tools: bool,
    pub supports_streaming_tools: bool,
    pub supports_thinking: bool,
    pub supports_thinking_off: bool,
    pub supports_images: bool,
    pub max_context_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub supports_pdf: bool,
    pub supports_temperature: bool,
    pub supports_top_p: bool,
    pub max_temperature: Option<f32>,
    pub thinking_style: ThinkingStyle,
    pub supported_efforts: Vec<ProviderCapabilityEffort>,
    pub default_effort: Option<ProviderCapabilityEffort>,
    pub supports_fast: bool,
    pub supports_verbosity: bool,
    pub default_verbosity: Option<ProviderCapabilityVerbosity>,
    pub server_tools: Vec<ServerToolKind>,
}

impl TryFrom<meridian_core::provider::ProviderCapabilities> for ProviderCapabilitiesInfoResponse {
    type Error = String;

    fn try_from(value: meridian_core::provider::ProviderCapabilities) -> Result<Self, Self::Error> {
        Ok(Self {
            supports_tools: value.supports_tools,
            supports_streaming_tools: value.supports_streaming_tools,
            supports_thinking: value.supports_thinking,
            supports_thinking_off: value.supports_thinking_off,
            supports_images: value.supports_images,
            max_context_tokens: value.max_context_tokens,
            max_output_tokens: value.max_output_tokens,
            supports_pdf: value.supports_pdf,
            supports_temperature: value.supports_temperature,
            supports_top_p: value.supports_top_p,
            max_temperature: value.max_temperature,
            thinking_style: value.thinking_style,
            supported_efforts: value
                .supported_efforts
                .iter()
                .map(|effort| ProviderCapabilityEffort::parse(effort))
                .collect::<Result<Vec<_>, _>>()?,
            default_effort: value
                .default_effort
                .as_deref()
                .map(ProviderCapabilityEffort::parse)
                .transpose()?,
            supports_fast: value.supports_fast,
            supports_verbosity: value.supports_verbosity,
            default_verbosity: value
                .default_verbosity
                .as_deref()
                .map(ProviderCapabilityVerbosity::parse)
                .transpose()?,
            server_tools: value.server_tools,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexAuthStorage {
    File,
    Keyring,
}

impl CodexAuthStorage {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "file" => Ok(Self::File),
            "keyring" => Ok(Self::Keyring),
            _ => Err(format!("unknown Codex auth storage `{value}`")),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexAuthStatusResponse {
    pub logged_in: bool,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub storage: Option<CodexAuthStorage>,
    pub codex_home: Option<String>,
    pub problem: Option<String>,
}

impl TryFrom<meridian_core::codex_auth::AuthStatus> for CodexAuthStatusResponse {
    type Error = String;

    fn try_from(value: meridian_core::codex_auth::AuthStatus) -> Result<Self, Self::Error> {
        Ok(Self {
            logged_in: value.logged_in,
            email: value.email,
            plan: value.plan,
            storage: value.storage.as_deref().map(CodexAuthStorage::parse).transpose()?,
            codex_home: value.codex_home,
            problem: value.problem,
        })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderCreateRequest {
    name: String,
    provider_type: ProviderType,
    base_url: String,
    api_format: RequiredNullable<ApiFormat>,
    catalog_id: RequiredNullable<String>,
    auth_option: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderUpdateRequest {
    id: String,
    name: Option<String>,
    provider_type: Option<ProviderType>,
    base_url: Option<String>,
    is_enabled: Option<bool>,
    api_format: Option<ApiFormat>,
    credential_kind: Option<CredentialKind>,
    transport_profile: Option<TransportProfile>,
    /// Absent leaves the logo alone, `null` puts it back to whatever the
    /// catalog says this vendor is, and a string names a mark.
    #[serde(default, deserialize_with = "patch_nullable")]
    icon: Option<RequiredNullable<String>>,
    /// A plain `Option`, unlike `icon` above: the column is `NOT NULL` with two
    /// values, so there is no third state to distinguish and absent means
    /// "leave it alone" with nothing to be confused with.
    codex_request_shape: Option<bool>,
}

/// A patch key with three states: absent, null, or a value.
///
/// `Option<RequiredNullable<T>>` cannot express it on its own — serde's derive
/// for `Option` answers a JSON `null` with `None` before the inner type is
/// reached, so "put it back to the default" and "leave it alone" arrive
/// identical, and the picker's own default entry would silently do nothing.
/// `default` supplies the absent case; this is called only when the key is
/// present, so a null reaching it is an answer somebody gave.
fn patch_nullable<'de, D, T>(deserializer: D) -> Result<Option<RequiredNullable<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    <RequiredNullable<T> as serde::Deserialize>::deserialize(deserializer).map(Some)
}

/// The longest logo name worth storing.
///
/// Not a claim about the icon set — it is a bound on a free-text column whose
/// only writer is a picker offering a fixed list. A value past this is a caller
/// doing something other than picking.
const MAX_ICON_NAME: usize = 64;

/// The shipped vendor catalog, for the panel that offers a list to create from.
///
/// Reads a `LazyLock` over data compiled into the binary, so it takes no lock
/// and touches no disk — hence sync rather than `spawn_blocking`. It is also why
/// it cannot fail: a malformed catalog would have panicked at first use, and the
/// checker keeps one from being committed.
#[tauri::command]
pub fn list_provider_catalog(_app: tauri::AppHandle) -> Result<ProviderCatalogEntryListResponse, String> {
    meridian_core::provider::catalog::entries()
        .iter()
        .map(TryInto::try_into)
        .collect()
}

/// Which ChatGPT account a Codex-backed provider is signed in as.
///
/// Reads the credential and decodes what it says about itself; it never
/// refreshes, because opening a settings page must not spend a refresh token.
/// The reply carries no token material — an email, a plan name, where the login
/// was found, and a sentence about what is wrong if anything is.
///
/// Blocking: reads a file, and on some installs the OS credential store.
#[tauri::command]
pub async fn codex_auth_status(_app: tauri::AppHandle) -> Result<CodexAuthStatusResponse, String> {
    tokio::task::spawn_blocking(|| {
        let home = meridian_core::codex_auth::storage::find_codex_home()
            .ok_or("Could not work out where the Codex CLI keeps its login (no home directory).")?;
        meridian_core::codex_auth::registry()
            .get(meridian_core::codex_auth::StoreId::CodexCli { home })
            .status()
            .try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_providers(app: tauri::AppHandle) -> Result<ProviderListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::provider::list_providers(&mut conn).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_provider(
    app: tauri::AppHandle,
    request: ProviderCreateRequest,
) -> Result<ProviderInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let ProviderCreateRequest {
        name,
        provider_type,
        base_url,
        api_format,
        catalog_id,
        auth_option,
    } = request;
    let provider_type = provider_type.as_str().to_owned();
    let api_format = api_format.0.map(|format| format.as_str().to_owned());
    let catalog_id = catalog_id.0;
    let auth_option = auth_option.0;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        // What the caller picked out of the catalog wins over anything inferred
        // from the address: choosing "OpenAI" and then pointing it at a relay is
        // still OpenAI, and `identify` would refuse that URL. Inference is only
        // the fallback for callers that name no vendor at all.
        let catalog = match catalog_id.as_deref() {
            Some(catalog_id) => Some(
                meridian_core::provider::catalog::find(catalog_id)
                    .ok_or_else(|| format!("unknown provider catalog id `{catalog_id}`"))?,
            ),
            None => meridian_core::provider::catalog::identify(&provider_type, &base_url)
                .and_then(meridian_core::provider::catalog::find),
        };
        if let Some(entry) = catalog
            && entry.provider_type != provider_type
        {
            return Err(format!(
                "catalog entry `{}` belongs to provider type `{}`, not `{provider_type}`",
                entry.id, entry.provider_type
            ));
        }
        // Which login this row uses, and therefore which endpoint it reaches,
        // comes from the vendor's own entry rather than from a default here.
        // The caller may name one of the entry's other logins (`auth_option`).
        // Unknown ids are contract errors; interpreting one as the default
        // would silently select a different credential and endpoint.
        let login = match (catalog, auth_option.as_deref()) {
            (Some(entry), Some(wanted)) => Some(
                entry
                    .auth_option(wanted)
                    .ok_or_else(|| format!("unknown auth option `{wanted}` for catalog entry `{}`", entry.id))?,
            ),
            (Some(entry), None) => Some(
                entry
                    .default_auth()
                    .ok_or_else(|| format!("catalog entry `{}` has no auth options", entry.id))?,
            ),
            (None, Some(wanted)) => {
                return Err(format!("auth option `{wanted}` requires a provider catalog entry"));
            }
            (None, None) => None,
        };
        let format = match api_format.as_deref() {
            Some(format) => format,
            None => login
                .and_then(|auth| auth.default_api_format())
                .unwrap_or("chat_completions"),
        };
        if let Some(auth) = login
            && !auth.api_formats.iter().any(|candidate| candidate == format)
        {
            return Err(format!(
                "auth option `{}` does not support API format `{format}`",
                auth.id
            ));
        }
        let credential_kind = login.map_or("api_key", |auth| auth.credential_kind.as_str());
        let transport_profile = login.map_or("standard", |auth| auth.transport_profile.as_str());
        meridian_core::provider::registry::validate_stored_contract(
            &provider_type,
            format,
            transport_profile,
            credential_kind,
        )?;
        let row = db::ops::provider::create_provider(
            &mut conn,
            &ProviderInsert {
                id: &id,
                name: &name,
                provider_type: &provider_type,
                base_url: &base_url,
                is_enabled: 1,
                sort_order: 0,
                created_at: now,
                updated_at: now,
                api_format: format,
                catalog_id: catalog.map(|entry| entry.id.as_str()),
                credential_kind,
                transport_profile,
                // A new row follows its vendor's mark. Choosing another one is
                // an edit on the provider page, not part of creating it.
                icon: None,
                // Likewise: a new row is an ordinary one until somebody says
                // the address behind it is a relay for a Codex backend.
                codex_request_shape: 0,
            },
        )
        .map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_provider(
    app: tauri::AppHandle,
    request: ProviderUpdateRequest,
) -> Result<ProviderInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let mut conversation_ids = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            db::ops::conversation::all_ids(&mut conn).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    };
    conversation_ids.sort();
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a provider update")
        .map_err(|busy| busy.to_string())?;
    let provider_type = request.provider_type.map(|value| value.as_str().to_owned());
    let api_format = request.api_format.map(|value| value.as_str().to_owned());
    let credential_kind = request.credential_kind.map(|value| value.as_str().to_owned());
    let transport_profile = request.transport_profile.map(|value| value.as_str().to_owned());
    // The transport decides which adapter answers and what the model may be
    // asked, so a change of login invalidates the cached model list the same
    // way a change of address does.
    let should_clear_cache = request.base_url.is_some()
        || provider_type.is_some()
        || api_format.is_some()
        || credential_kind.is_some()
        || transport_profile.is_some();
    // Deliberately not part of the line above: a logo decides nothing about
    // which adapter answers or what it can be asked, so changing one must not
    // throw away a model list that costs a round trip to rebuild.
    //
    // An empty string is refused rather than read as "back to the default":
    // null already says that, and accepting a second spelling of it is the
    // kind of forward-compatible guess that makes a contract unreadable.
    let icon = match request.icon {
        Some(RequiredNullable(Some(name))) => {
            if name.trim().is_empty() || name.len() > MAX_ICON_NAME {
                return Err(format!(
                    "provider icon name is empty or longer than {MAX_ICON_NAME} characters"
                ));
            }
            Some(Some(name))
        }
        Some(RequiredNullable(None)) => Some(None),
        None => None,
    };
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let current = db::ops::provider::get_provider(&mut conn, &request.id).map_err(|e| e.to_string())?;
        let final_api_format = api_format.as_deref().unwrap_or(&current.api_format);
        let final_transport_profile = transport_profile.as_deref().unwrap_or(&current.transport_profile);
        let final_credential_kind = credential_kind.as_deref().unwrap_or(&current.credential_kind);
        meridian_core::provider::registry::validate_stored_contract(
            provider_type.as_deref().unwrap_or(&current.provider_type),
            final_api_format,
            final_transport_profile,
            final_credential_kind,
        )?;
        // A changed *type* re-decides the catalog identity; a changed address
        // alone never does (a relay is still the vendor the user picked). The
        // row starts as the catalog's default entry and is often re-typed into
        // the vendor actually wanted — without this, that row kept the default
        // vendor's logo and key page forever. Same conservative rule as
        // creation and the migration backfill: exactly one entry fits or the
        // answer is no identity, and `Some(None)` is how the changeset says so.
        let catalog_id = match &provider_type {
            Some(next_type) => {
                let final_url = request.base_url.as_deref().unwrap_or(&current.base_url);
                Some(meridian_core::provider::catalog::identify(next_type, final_url).map(str::to_string))
            }
            None => None,
        };
        let changeset = ProviderChangeset {
            name: request.name,
            provider_type,
            base_url: request.base_url,
            is_enabled: request.is_enabled.map(i32::from),
            api_format,
            updated_at: Some(now_ms()),
            credential_kind,
            transport_profile,
            catalog_id,
            icon,
            codex_request_shape: request.codex_request_shape.map(i32::from),
            ..Default::default()
        };
        let row = finish_guarded_provider_mutation(
            update_provider_unless_plan_barrier(
                &mut conn,
                &request.id,
                &conversation_ids,
                &changeset,
                should_clear_cache,
            )
            .map_err(|e| e.to_string())?,
        )?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_provider(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let mut conversation_ids = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            db::ops::conversation::all_ids(&mut conn).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    };
    conversation_ids.sort();
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a provider delete")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        finish_guarded_provider_mutation(
            delete_provider_unless_plan_barrier(&mut conn, &id, &conversation_ids).map_err(|e| e.to_string())?,
        )?;
        let key_name = provider_secret_name(&id);
        let _ = secrets.delete(&SecretScope::Global, &SecretName::new(&key_name).unwrap());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderKeyUpdateRequest {
    pub provider_id: String,
    pub api_key: String,
}

#[tauri::command]
pub async fn set_provider_key(app: tauri::AppHandle, request: ProviderKeyUpdateRequest) -> Result<(), String> {
    let services = app.services();
    let key_name = provider_secret_name(&request.provider_id);
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let mut conversation_ids = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            db::ops::conversation::all_ids(&mut conn).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    };
    conversation_ids.sort();
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a provider credential update")
        .map_err(|busy| busy.to_string())?;
    let pid = request.provider_id;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|error| error.to_string())?;
        let result = conn
            .immediate_transaction::<_, diesel::result::Error, _>(|conn| {
                let mut current = db::ops::conversation::all_ids(conn)?;
                current.sort();
                if current != conversation_ids {
                    return Ok(GuardedProviderMutation::ConversationsChanged);
                }
                if !db::ops::plan_review::barrier_conversations_for_provider(conn, &pid)
                    .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
                    .is_empty()
                {
                    return Ok(GuardedProviderMutation::PlanReviewBarrier);
                }
                secrets
                    .set(
                        &SecretScope::Global,
                        &SecretName::new(&key_name).expect("provider secret name is valid"),
                        &request.api_key,
                    )
                    .map_err(|error| {
                        diesel::result::Error::QueryBuilderError(Box::new(std::io::Error::other(error.to_string())))
                    })?;
                db::ops::cached_model::delete_by_provider(conn, &pid)?;
                Ok(GuardedProviderMutation::Applied(()))
            })
            .map_err(|error| error.to_string())?;
        finish_guarded_provider_mutation(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_provider_key_exists(app: tauri::AppHandle, provider_id: String) -> Result<bool, String> {
    let services = app.services();
    let key_name = provider_secret_name(&provider_id);
    // A read failure is not the same as "no key". Reporting it as absent sends
    // the user to enter a key they already have, and re-entering rewrites the
    // store under a fresh passphrase — taking the other providers' keys with it.
    match services
        .secrets
        .get(&SecretScope::Global, &SecretName::new(&key_name).unwrap())
    {
        Ok(value) => Ok(value.is_some()),
        Err(e) => {
            tracing::error!(
                provider_id = %provider_id,
                error = %e,
                "could not read the stored API key while checking whether one is set"
            );
            Err(format!("Could not read the saved key: {e}"))
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderModelListRequest {
    pub provider_id: String,
    pub force_refresh: RequiredNullable<bool>,
}

#[tauri::command]
pub async fn fetch_provider_models(
    app: tauri::AppHandle,
    request: ProviderModelListRequest,
) -> Result<ProviderModelListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let provider_id = request.provider_id;
    let force = request.force_refresh.0.unwrap_or(false);

    if !force {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let cached = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            db::ops::cached_model::list_by_provider(&mut conn, &pid).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        if !cached.is_empty() {
            return Ok(cached
                .into_iter()
                .map(|c| ProviderModelInfoResponse {
                    id: c.model_id,
                    name: c.model_name,
                })
                .collect());
        }
    }

    let (provider_type, base_url, api_format, transport_profile, credential_kind) = {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((
                p.provider_type,
                p.base_url,
                p.api_format,
                p.transport_profile,
                p.credential_kind,
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // Existing rows are part of the same closed first-party contract as create
    // and update requests. Do not silently route an unknown stored selector
    // through an arbitrary model-list endpoint.
    meridian_core::provider::registry::validate_stored_contract(
        &provider_type,
        &api_format,
        &transport_profile,
        &credential_kind,
    )?;

    // A transport that lists its models from local knowledge needs no key, and
    // demanding one would make the picker unusable for a login that never has
    // one. Everything else still fails here rather than sending an anonymous
    // request that comes back as an unexplained 401.
    let api_key = match get_provider_api_key(&secrets, &provider_id) {
        Some(key) => key,
        None if transport_profile == "chatgpt_codex" => String::new(),
        None => return Err("API Key not set for this provider".into()),
    };

    let models = meridian_core::provider::models::fetch_models_on(
        &provider_type,
        Some(&api_format),
        Some(&transport_profile),
        &base_url,
        &api_key,
    )
    .await
    .map_err(|e| e.to_string())?;

    {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let models_clone = models.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let now = now_ms();
            let new_models: Vec<_> = models_clone
                .iter()
                .map(|m| db::models::cached_model::CachedModelInsert {
                    provider_id: &pid,
                    model_id: &m.id,
                    model_name: &m.name,
                    fetched_at: now,
                })
                .collect();
            db::ops::cached_model::replace_models(&mut conn, &pid, &new_models).map_err(|e| e.to_string())
        })
        .await;
    }

    Ok(models.into_iter().map(Into::into).collect())
}

/// What is left on this provider's account, for the few upstreams that say.
///
/// Never cached. A balance is the one figure here whose whole value is being
/// current, and a stale one is worse than none — it is the number somebody
/// decides not to top up on. `Ok(None)` means this upstream publishes nothing,
/// which is most of them and is not an error to show anybody.
#[tauri::command]
pub async fn get_provider_balance(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Option<ProviderBalanceInfoResponse>, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();

    let (catalog_id, provider_type, base_url) = {
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((p.catalog_id, p.provider_type, p.base_url))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // The vendor decides whose account endpoint this is, not the adapter
    // family: every upstream added since the original five is
    // OpenAI-compatible, so `provider_type` cannot tell them apart.
    let identity =
        meridian_core::provider::balance::ProviderIdentity::new(catalog_id.as_deref(), &provider_type, &base_url);
    if !meridian_core::provider::balance::supports_balance(identity) {
        return Ok(None);
    }

    let api_key = get_provider_api_key(&secrets, &provider_id).ok_or("API Key not set for this provider")?;
    meridian_core::provider::balance::fetch_balance(identity, &api_key)
        .await
        .map(|balance| Some(balance.into()))
        .map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderCapabilitiesReadRequest {
    pub provider_id: String,
    pub model_id: String,
}

#[tauri::command]
pub async fn get_provider_capabilities(
    app: tauri::AppHandle,
    request: ProviderCapabilitiesReadRequest,
) -> Result<ProviderCapabilitiesInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let provider_id = request.provider_id;
    let model_id = request.model_id;
    let (provider_type, api_format, transport_profile, codex_request_shape, overrides) = {
        let pid = provider_id.clone();
        let mid = model_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            // The patch is the model's, not this provider's door to it: the
            // same correction applies wherever that model is reached.
            let overrides = meridian_core::agent::model_config::load(&mut conn, &pid, &mid)
                .ok()
                .flatten()
                .and_then(|config| config.capability_overrides);
            Ok::<_, String>((
                p.provider_type,
                p.api_format,
                p.transport_profile,
                p.codex_request_shape != 0,
                overrides,
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let mut caps = meridian_core::provider::registry::get_capabilities(
        &provider_type,
        &api_format,
        &transport_profile,
        &model_id,
    )?;
    meridian_core::provider::capabilities::apply_overrides(&mut caps, overrides.as_deref())?;
    // After the model's own patch, not before: the shape decides what this
    // adapter is able to put on the wire, and no per-model correction can hand
    // back a field the request will not carry. A temperature slider that
    // renders and then changes nothing is worse than one that is absent.
    if codex_request_shape {
        meridian_core::provider::capabilities::narrow_to_codex_shape(&mut caps);
    }
    caps.try_into()
}

#[cfg(test)]
mod response_contract_tests {
    use super::*;

    fn seed_provider_with_pending_review(conn: &mut diesel::sqlite::SqliteConnection) {
        db::ops::provider::create_provider(
            conn,
            &ProviderInsert {
                id: "provider-1",
                name: "Provider",
                provider_type: "openai",
                base_url: "https://old.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
                api_format: "responses",
                catalog_id: None,
                credential_kind: "api_key",
                transport_profile: "standard",
                icon: None,
                codex_request_shape: 0,
            },
        )
        .unwrap();
        db::ops::conversation::create_conversation(conn, "conversation-1", None, None, None, 1).unwrap();
        let runtime = db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: "provider-1".into(),
            model: "model-1".into(),
            assistant_id: None,
            thinking_level: None,
            fast: false,
            project_id: None,
            project_path: None,
            accept_edits: false,
        };
        let document = db::ops::plan_review::create_or_resume_document(conn, "conversation-1", 2).unwrap();
        let appended = db::ops::plan_review::append_assistant_revision(
            conn,
            &db::ops::plan_review::PlanRevisionAppend {
                document_id: &document.id,
                expected_generation: 0,
                expected_head_sha256: None,
                content_markdown: "# Plan\n",
                patch: "first patch",
                source_message_id: Some("message-1"),
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
                assistant_message_id: Some("message-1"),
                provider_call_id: Some("exit-1"),
                provider_kind: db::models::plan_review::PlanReviewProviderKind::Native,
                now: 5,
            },
            &runtime,
        )
        .unwrap();
    }

    #[test]
    fn provider_requests_are_strict_and_require_nullable_keys() {
        let mut create = serde_json::json!({
            "name": "OpenAI",
            "providerType": "openai",
            "baseUrl": "https://api.openai.com",
            "apiFormat": null,
            "catalogId": null,
            "authOption": null
        });
        assert!(serde_json::from_value::<ProviderCreateRequest>(create.clone()).is_ok());
        create.as_object_mut().unwrap().remove("catalogId");
        assert!(serde_json::from_value::<ProviderCreateRequest>(create).is_err());

        let mut models = serde_json::json!({ "providerId": "provider-1", "forceRefresh": null });
        assert!(serde_json::from_value::<ProviderModelListRequest>(models.clone()).is_ok());
        models.as_object_mut().unwrap().remove("forceRefresh");
        assert!(serde_json::from_value::<ProviderModelListRequest>(models).is_err());

        assert!(
            serde_json::from_value::<ProviderKeyUpdateRequest>(serde_json::json!({
                "providerId": "provider-1",
                "apiKey": "secret",
                "legacy": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ProviderCapabilitiesReadRequest>(serde_json::json!({
                "providerId": "provider-1",
                "modelId": "model-1",
                "futureField": true
            }))
            .is_err()
        );
    }

    #[test]
    fn provider_update_and_delete_are_blocked_by_its_active_review_runtime() {
        let pool = db::test_db();
        let mut conn = pool.get().unwrap();
        seed_provider_with_pending_review(&mut conn);
        let conversations = vec!["conversation-1".to_string()];

        let updated = update_provider_unless_plan_barrier(
            &mut conn,
            "provider-1",
            &conversations,
            &ProviderChangeset {
                base_url: Some("https://new.invalid".into()),
                updated_at: Some(4),
                ..Default::default()
            },
            true,
        )
        .unwrap();
        assert!(matches!(updated, GuardedProviderMutation::PlanReviewBarrier));
        assert_eq!(
            db::ops::provider::get_provider(&mut conn, "provider-1")
                .unwrap()
                .base_url,
            "https://old.invalid"
        );

        let deleted = delete_provider_unless_plan_barrier(&mut conn, "provider-1", &conversations).unwrap();
        assert!(matches!(deleted, GuardedProviderMutation::PlanReviewBarrier));
        assert!(db::ops::provider::get_provider(&mut conn, "provider-1").is_ok());
    }

    #[test]
    fn capability_response_rejects_unknown_effort_and_verbosity() {
        let capabilities = meridian_core::provider::ProviderCapabilities {
            supported_efforts: vec!["turbo".into()],
            ..Default::default()
        };
        assert!(ProviderCapabilitiesInfoResponse::try_from(capabilities).is_err());

        let capabilities = meridian_core::provider::ProviderCapabilities {
            default_verbosity: Some("verbose".into()),
            ..Default::default()
        };
        assert!(ProviderCapabilitiesInfoResponse::try_from(capabilities).is_err());
    }

    #[test]
    fn shipped_catalog_maps_to_the_public_response_contract() {
        let responses = meridian_core::provider::catalog::entries()
            .iter()
            .map(ProviderCatalogEntryInfoResponse::try_from)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!responses.is_empty());
        assert!(responses.iter().all(|entry| !entry.auth.is_empty()));
    }

    #[test]
    fn balance_response_serializes_decimal_amounts_as_strings() {
        let response = ProviderBalanceInfoResponse {
            is_available: true,
            accounts: vec![ProviderBalanceAccountInfoResponse {
                currency: "USD".into(),
                total_balance: "12.3400".parse().unwrap(),
                granted_balance: Some("0.1".parse().unwrap()),
                topped_up_balance: None,
            }],
        };
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["accounts"][0]["total_balance"], "12.34");
        assert_eq!(value["accounts"][0]["granted_balance"], "0.1");
        assert!(value["accounts"][0]["topped_up_balance"].is_null());
    }

    /// The logo key has three states and the wire has to keep them apart.
    ///
    /// Absent means "leave it", `null` means "put it back to the vendor's own
    /// mark", and a string names one. Serde's derive for `Option` answers a
    /// JSON `null` with `None` before the inner type is reached, so written the
    /// obvious way the second collapses into the first — the picker's default
    /// entry would save successfully and change nothing, while going on
    /// showing itself as selected.
    #[test]
    fn the_logo_patch_key_keeps_absent_null_and_a_name_apart() {
        let absent: ProviderUpdateRequest = serde_json::from_value(serde_json::json!({ "id": "p1" })).unwrap();
        assert!(absent.icon.is_none(), "an omitted key leaves the logo alone");

        let cleared: ProviderUpdateRequest =
            serde_json::from_value(serde_json::json!({ "id": "p1", "icon": null })).unwrap();
        assert!(
            matches!(cleared.icon, Some(RequiredNullable(None))),
            "null is an answer: follow the vendor again"
        );

        let named: ProviderUpdateRequest =
            serde_json::from_value(serde_json::json!({ "id": "p1", "icon": "vertexai" })).unwrap();
        assert!(matches!(named.icon, Some(RequiredNullable(Some(ref name))) if name == "vertexai"));
    }
}
