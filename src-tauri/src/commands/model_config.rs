use std::collections::HashMap;

use crate::ServicesExt;
use crate::commands::entity_response::{
    LogicalModelInfoResponse, LogicalModelListResponse, ModelConfigInfoResponse, ModelConfigListResponse,
    ModelDeploymentInfoResponse, ModelPricingInfoResponse, ModelProfileInfoResponse, ModelProfileListResponse,
    ProviderCapabilityOverrides, validate_model_server_tools,
};
use meridian_core::db::entity::model_profile::ModelProfileChangeset;
use meridian_core::db::entity::{model_config, model_profile, provider};
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::{Db, Snapshot, WriteTx};
use meridian_core::db::sea::ops::{
    conversation as conversation_ops, model_config as config_ops, model_profile as profile_ops,
    provider as provider_ops,
};
use meridian_core::db::types::SqlBool;
use meridian_core::provider::{CapabilityDomain, ProtocolCompliance, RoutingPolicy};
use meridian_core::util::now_ms;

#[derive(Debug)]
enum GuardedModelConfigMutation<T> {
    Applied(T),
    ConversationsChanged,
    ModelChanged,
}

/// What stops a model configuration mutation before it writes anything: the
/// conversation set having changed since the caller took its leases.
async fn model_config_barrier<T>(
    tx: &WriteTx,
    _provider_id: &str,
    _model_id: &str,
    expected_conversation_ids: &[String],
) -> Result<Option<GuardedModelConfigMutation<T>>, DbErr> {
    let mut current = conversation_ops::all_ids(tx).await?;
    current.sort();
    if current != expected_conversation_ids {
        return Ok(Some(GuardedModelConfigMutation::ConversationsChanged));
    }
    Ok(None)
}

/// A saved config, its profile, and how many providers reach that profile.
type SavedModelConfig = (model_config::Model, model_profile::Model, i64);

/// The profile and the config are written in one transaction, and the profile
/// goes first: the config's `profile_id` is a foreign key, so a half-applied
/// save would either point at nothing or leave a profile nothing describes.
async fn upsert_model_config_unless_plan_barrier(
    tx: &WriteTx,
    expected_conversation_ids: &[String],
    profile_is_new: bool,
    profile: ProfileWrite,
    new: model_config::Model,
) -> Result<GuardedModelConfigMutation<SavedModelConfig>, DbErr> {
    if let Some(refused) = model_config_barrier(tx, &new.provider_id, &new.model_id, expected_conversation_ids).await? {
        return Ok(refused);
    }
    let profile_id = new.profile_id.clone();
    let saved_profile = if profile_is_new {
        profile_ops::insert(tx, profile.into_model(profile_id)).await?
    } else {
        if profile_ops::get(tx, &profile_id).await?.is_none() {
            return Ok(GuardedModelConfigMutation::ModelChanged);
        }
        profile_ops::update(tx, &profile_id, profile.into_changeset()).await?
    };
    let row = config_ops::upsert(tx, new).await?;
    let count = profile_model_counts(tx)
        .await?
        .get(&saved_profile.id)
        .copied()
        .unwrap_or_default();
    Ok(GuardedModelConfigMutation::Applied((row, saved_profile, count)))
}

/// The profile half of a save, already encoded, so the transaction above can
/// either insert or update it without re-deciding anything.
struct ProfileWrite {
    name: String,
    capability_domain: CapabilityDomain,
    canonical_id: Option<String>,
    family: Option<String>,
    routing_policy: RoutingPolicy,
    context_window: i32,
    compact_threshold: i32,
    max_output_tokens: Option<i32>,
    input_price: Option<meridian_core::decimal::Decimal>,
    output_price: Option<meridian_core::decimal::Decimal>,
    cache_read_price: Option<meridian_core::decimal::Decimal>,
    cache_write_price: Option<meridian_core::decimal::Decimal>,
    pricing_tiers: Option<String>,
    capability_overrides: Option<String>,
    now: i64,
}

impl ProfileWrite {
    fn into_model(self, id: String) -> model_profile::Model {
        model_profile::Model {
            id,
            name: self.name,
            context_window: self.context_window,
            compact_threshold: self.compact_threshold,
            max_output_tokens: self.max_output_tokens,
            input_price: self.input_price,
            output_price: self.output_price,
            cache_read_price: self.cache_read_price,
            cache_write_price: self.cache_write_price,
            pricing_tiers: self.pricing_tiers,
            capability_overrides: self.capability_overrides,
            created_at: self.now,
            updated_at: self.now,
            canonical_id: self.canonical_id,
            capability_domain: self.capability_domain,
            family: self.family,
            icon: None,
            routing_policy: self.routing_policy,
            is_archived: SqlBool::FALSE,
        }
    }

    fn into_changeset(self) -> ModelProfileChangeset {
        ModelProfileChangeset {
            name: self.name,
            capability_domain: self.capability_domain,
            context_window: self.context_window,
            compact_threshold: self.compact_threshold,
            max_output_tokens: self.max_output_tokens,
            input_price: self.input_price,
            output_price: self.output_price,
            cache_read_price: self.cache_read_price,
            cache_write_price: self.cache_write_price,
            pricing_tiers: self.pricing_tiers,
            capability_overrides: self.capability_overrides,
            updated_at: self.now,
        }
    }
}

async fn delete_model_config_unless_plan_barrier(
    tx: &WriteTx,
    id: &str,
    expected_provider_id: &str,
    expected_model_id: &str,
    expected_conversation_ids: &[String],
) -> Result<GuardedModelConfigMutation<()>, DbErr> {
    if let Some(refused) =
        model_config_barrier(tx, expected_provider_id, expected_model_id, expected_conversation_ids).await?
    {
        return Ok(refused);
    }
    let Some(row) = config_ops::get(tx, id).await? else {
        return Ok(GuardedModelConfigMutation::ModelChanged);
    };
    if row.provider_id != expected_provider_id || row.model_id != expected_model_id {
        return Ok(GuardedModelConfigMutation::ModelChanged);
    }
    config_ops::delete(tx, id)
        .await
        .map(|_| GuardedModelConfigMutation::Applied(()))
}

fn finish_guarded_model_config_mutation<T>(result: GuardedModelConfigMutation<T>) -> Result<T, String> {
    match result {
        GuardedModelConfigMutation::Applied(value) => Ok(value),
        GuardedModelConfigMutation::ConversationsChanged => Err(
            "The conversation set changed while the model configuration mutation was being prepared. Try again.".into(),
        ),
        GuardedModelConfigMutation::ModelChanged => {
            Err("The model configuration changed while the mutation was being prepared. Try again.".into())
        }
    }
}

/// How many providers reach each profile, for the responses that carry it.
async fn profile_model_counts(db: &impl Snapshot) -> Result<HashMap<String, i64>, DbErr> {
    Ok(profile_ops::list_with_model_counts(db)
        .await?
        .into_iter()
        .map(|(profile, count)| (profile.id, count))
        .collect())
}

/// Every conversation's id, sorted: which turn leases a model configuration
/// mutation takes before it opens its write.
async fn sorted_conversation_ids(db: &Db) -> Result<Vec<String>, String> {
    let mut ids = conversation_ops::all_ids(db).await.map_err(|e| e.to_string())?;
    ids.sort();
    Ok(ids)
}

/// A nullable field that must still be present in the request object.
///
/// Plain `Option<T>` makes serde treat an omitted key and an explicit `null` as
/// the same value. Prices use `null` as a real state (unconfigured), so omission
/// is a malformed DTO rather than another spelling for that state.
#[derive(Debug, Clone)]
pub struct RequiredNullable<T>(pub Option<T>);

impl<'de, T> serde::Deserialize<'de> for RequiredNullable<T>
where
    T: serde::de::DeserializeOwned,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = <serde_json::Value as serde::Deserialize>::deserialize(deserializer)?;
        if value.is_null() {
            Ok(Self(None))
        } else {
            serde_json::from_value(value)
                .map(Some)
                .map(Self)
                .map_err(serde::de::Error::custom)
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PriceTierRequest {
    pub min_prompt_tokens: i64,
    pub input_price: meridian_core::decimal::Decimal,
    pub output_price: meridian_core::decimal::Decimal,
    pub cache_read_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_write_price: RequiredNullable<meridian_core::decimal::Decimal>,
}

impl From<PriceTierRequest> for meridian_core::agent::pricing::PriceTier {
    fn from(value: PriceTierRequest) -> Self {
        Self {
            min_prompt_tokens: value.min_prompt_tokens,
            input_price: value.input_price,
            output_price: value.output_price,
            cache_read_price: value.cache_read_price.0,
            cache_write_price: value.cache_write_price.0,
        }
    }
}

fn deserialize_price_tiers<'de, D>(deserializer: D) -> Result<Vec<meridian_core::agent::pricing::PriceTier>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let requests = <Vec<PriceTierRequest> as serde::Deserialize>::deserialize(deserializer)?;
    Ok(requests.into_iter().map(Into::into).collect())
}

/// The model half of a save: what this model is, wherever it is served from.
///
/// `id` absent means a new profile; naming an existing one is how two providers
/// come to share a single description, which is the whole point of the split.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelProfileUpsertRequest {
    pub id: RequiredNullable<String>,
    pub name: String,
    pub capability_domain: CapabilityDomain,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: RequiredNullable<i32>,
    pub input_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub output_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_read_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_write_price: RequiredNullable<meridian_core::decimal::Decimal>,
    #[serde(deserialize_with = "deserialize_price_tiers")]
    pub pricing_tiers: Vec<meridian_core::agent::pricing::PriceTier>,
    pub capability_overrides: RequiredNullable<ProviderCapabilityOverrides>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigUpsertRequest {
    pub provider_id: String,
    pub model_id: String,
    pub profile: ModelProfileUpsertRequest,
    pub protocol_override: RequiredNullable<String>,
    pub overrides_pricing: bool,
    pub input_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub output_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_read_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_write_price: RequiredNullable<meridian_core::decimal::Decimal>,
    #[serde(deserialize_with = "deserialize_price_tiers")]
    pub pricing_tiers: Vec<meridian_core::agent::pricing::PriceTier>,
    pub server_tools: RequiredNullable<Vec<meridian_core::provider::ServerToolKind>>,
    pub server_tool_price: RequiredNullable<meridian_core::decimal::Decimal>,
}

impl ModelProfileUpsertRequest {
    fn validate(mut self) -> Result<Self, String> {
        if self.name.trim().is_empty() {
            return Err("profile.name is required".into());
        }
        if self.capability_domain == CapabilityDomain::Chat {
            if self.context_window <= 0 {
                return Err("context_window must be positive".into());
            }
            if self.compact_threshold <= 0 || self.compact_threshold >= self.context_window {
                return Err("compact_threshold must be positive and smaller than context_window".into());
            }
        } else if self.context_window < 0 || self.compact_threshold < 0 {
            return Err("context_window and compact_threshold must be non-negative".into());
        }
        if self.max_output_tokens.0.is_some_and(|value| value <= 0) {
            return Err("max_output_tokens must be positive".into());
        }
        if self.input_price.0.is_some() != self.output_price.0.is_some() {
            return Err("input_price and output_price must be configured together".into());
        }
        for (field, value) in [
            ("input_price", self.input_price.0.as_ref()),
            ("output_price", self.output_price.0.as_ref()),
            ("cache_read_price", self.cache_read_price.0.as_ref()),
            ("cache_write_price", self.cache_write_price.0.as_ref()),
        ] {
            if value.is_some_and(meridian_core::decimal::Decimal::is_negative) {
                return Err(format!("profile.{field} must be non-negative"));
            }
        }
        if !self.pricing_tiers.is_empty() && self.input_price.0.is_none() {
            return Err("pricing_tiers requires configured input_price and output_price".into());
        }
        self.pricing_tiers =
            meridian_core::agent::pricing::validate_tiers(self.pricing_tiers).map_err(|error| error.to_string())?;
        if let Some(overrides) = self.capability_overrides.0.as_ref() {
            overrides.storage_json()?;
        }
        Ok(self)
    }
}

impl ModelConfigUpsertRequest {
    fn validate(mut self) -> Result<Self, String> {
        if self.provider_id.trim().is_empty() || self.model_id.trim().is_empty() {
            return Err("provider_id and model_id are required".into());
        }
        if let Some(protocol) = self.protocol_override.0.as_deref() {
            validate_protocol_id(protocol)?;
        }
        self.profile = self.profile.validate()?;

        // Blank-and-ignored and blank-and-meaningful are different states, and
        // the switch is what says which. A row carrying rates it has switched
        // off would be a second answer to "what does this cost" — the thing the
        // profile split exists to prevent.
        if !self.overrides_pricing {
            let carried = self.input_price.0.is_some()
                || self.output_price.0.is_some()
                || self.cache_read_price.0.is_some()
                || self.cache_write_price.0.is_some()
                || !self.pricing_tiers.is_empty();
            if carried {
                return Err("overrides_pricing is off, so the provider price fields must be null".into());
            }
        }
        if self.input_price.0.is_some() != self.output_price.0.is_some() {
            return Err("input_price and output_price must be configured together".into());
        }
        for (field, value) in [
            ("input_price", self.input_price.0.as_ref()),
            ("output_price", self.output_price.0.as_ref()),
            ("cache_read_price", self.cache_read_price.0.as_ref()),
            ("cache_write_price", self.cache_write_price.0.as_ref()),
            ("server_tool_price", self.server_tool_price.0.as_ref()),
        ] {
            if value.is_some_and(meridian_core::decimal::Decimal::is_negative) {
                return Err(format!("{field} must be non-negative"));
            }
        }

        if !self.pricing_tiers.is_empty() && self.input_price.0.is_none() {
            return Err("pricing_tiers requires configured input_price and output_price".into());
        }
        self.pricing_tiers =
            meridian_core::agent::pricing::validate_tiers(self.pricing_tiers).map_err(|error| error.to_string())?;

        if let Some(tools) = self.server_tools.0.as_ref() {
            validate_model_server_tools(tools)?;
            if tools.is_empty() {
                self.server_tools.0 = None;
            }
        }
        Ok(self)
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigListRequest {
    pub provider_id: String,
}

/// Every model configured on one provider, each beside the profile describing
/// it and how many providers share that profile.
#[tauri::command]
pub async fn list_model_configs(
    app: tauri::AppHandle,
    request: ModelConfigListRequest,
) -> Result<ModelConfigListResponse, String> {
    let provider_id = request.provider_id;
    let (rows, counts) = app
        .services()
        .db
        .read(async |tx| {
            let rows = config_ops::list_by_provider_with_profiles(tx, &provider_id).await?;
            Ok::<_, DbErr>((rows, profile_model_counts(tx).await?))
        })
        .await
        .map_err(|error| error.to_string())?;
    rows.into_iter()
        .map(|(row, profile)| {
            let count = counts.get(&profile.id).copied().unwrap_or_default();
            ModelConfigInfoResponse::from_rows(row, profile, count)
        })
        .collect()
}

/// The profiles a model page offers to point at.
///
/// Configuring the same model on a second provider is choosing one of these
/// rather than typing the window and the prices again — which is the whole
/// reason the two tables are separate.
#[tauri::command]
pub async fn list_model_profiles(app: tauri::AppHandle) -> Result<ModelProfileListResponse, String> {
    app.services()
        .db
        .read(async |tx| profile_ops::list_with_model_counts(tx).await)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(profile, count)| ModelProfileInfoResponse::from_row(profile, count))
        .collect()
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigReadRequest {
    pub provider_id: String,
    pub model_id: String,
}

#[tauri::command]
pub async fn get_model_config(
    app: tauri::AppHandle,
    request: ModelConfigReadRequest,
) -> Result<Option<ModelConfigInfoResponse>, String> {
    let found = app
        .services()
        .db
        .read(async |tx| {
            let Some((row, profile)) =
                config_ops::get_with_profile(tx, &request.provider_id, &request.model_id).await?
            else {
                return Ok::<_, DbErr>(None);
            };
            let count = profile_model_counts(tx)
                .await?
                .get(&profile.id)
                .copied()
                .unwrap_or_default();
            Ok(Some((row, profile, count)))
        })
        .await
        .map_err(|error| error.to_string())?;
    found
        .map(|(row, profile, count)| ModelConfigInfoResponse::from_rows(row, profile, count))
        .transpose()
}

#[tauri::command]
pub async fn set_model_config(
    app: tauri::AppHandle,
    request: ModelConfigUpsertRequest,
) -> Result<ModelConfigInfoResponse, String> {
    Box::pin(set_model_config_inner(app, request)).await
}

async fn set_model_config_inner(
    app: tauri::AppHandle,
    request: ModelConfigUpsertRequest,
) -> Result<ModelConfigInfoResponse, String> {
    let request = request.validate()?;
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the save on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model configuration save")
        .map_err(|busy| busy.to_string())?;
    let now = now_ms();
    // A profile the request did not name is a new one. The id is minted here
    // rather than by the client so a retried save cannot create two.
    let profile_is_new = request.profile.id.0.is_none();
    let profile_id = request
        .profile
        .id
        .0
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let profile_tiers = (!request.profile.pricing_tiers.is_empty())
        .then(|| serde_json::to_string(&request.profile.pricing_tiers).expect("PriceTier always serializes"));
    let capability_overrides = request
        .profile
        .capability_overrides
        .0
        .as_ref()
        .map(ProviderCapabilityOverrides::storage_json)
        .transpose()?;
    let canonical_spec = meridian_core::provider::canonical_models::canonicalize_model_id(&request.model_id);
    let routing_policy = match request.profile.capability_domain {
        CapabilityDomain::ImageGen | CapabilityDomain::VideoGen => RoutingPolicy::AutoFailoverStateless,
        _ => RoutingPolicy::StickyManual,
    };
    let profile = ProfileWrite {
        name: request.profile.name.trim().to_owned(),
        capability_domain: request.profile.capability_domain,
        canonical_id: canonical_spec.as_ref().map(|s| s.canonical_id.clone()),
        family: canonical_spec.as_ref().map(|s| s.family.clone()),
        routing_policy,
        context_window: request.profile.context_window,
        compact_threshold: request.profile.compact_threshold,
        max_output_tokens: request.profile.max_output_tokens.0,
        input_price: request.profile.input_price.0,
        output_price: request.profile.output_price.0,
        cache_read_price: request.profile.cache_read_price.0,
        cache_write_price: request.profile.cache_write_price.0,
        pricing_tiers: profile_tiers,
        capability_overrides,
        now,
    };

    let pricing_tiers = (!request.pricing_tiers.is_empty())
        .then(|| serde_json::to_string(&request.pricing_tiers).expect("PriceTier always serializes"));
    let server_tools = request
        .server_tools
        .0
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("cannot encode model_config.server_tools: {error}"))?;
    let new = model_config::Model {
        id: uuid::Uuid::new_v4().to_string(),
        provider_id: request.provider_id,
        model_id: request.model_id,
        profile_id,
        overrides_pricing: SqlBool::from(request.overrides_pricing),
        input_price: request.input_price.0,
        output_price: request.output_price.0,
        cache_read_price: request.cache_read_price.0,
        cache_write_price: request.cache_write_price.0,
        pricing_tiers,
        server_tools,
        server_tool_price: request.server_tool_price.0,
        created_at: now,
        updated_at: now,
        protocol_override: request.protocol_override.0,
        is_enabled: SqlBool::TRUE,
        priority: 100,
        capability_overrides: None,
    };
    let guarded = services
        .db
        .write(async |tx| {
            upsert_model_config_unless_plan_barrier(tx, &conversation_ids, profile_is_new, profile, new).await
        })
        .await
        .map_err(|error| error.to_string())?;
    let (row, saved_profile, count) = finish_guarded_model_config_mutation(guarded)?;
    // A save is when prices are looked at, and the daily pass would leave a
    // blank on screen for up to a day. This only fills rates nobody typed
    // (see `provider::models_dev`), and does nothing when the snapshot is not
    // in memory yet.
    meridian_core::provider::models_dev::fill_for_config(
        &services.db,
        &services.models_dev,
        &row.provider_id,
        &row.model_id,
    )
    .await;
    let saved_profile = profile_ops::get(&services.db, &row.profile_id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(saved_profile);
    ModelConfigInfoResponse::from_rows(row, saved_profile, count)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigDeleteRequest {
    pub id: String,
}

#[tauri::command]
pub async fn delete_model_config(app: tauri::AppHandle, request: ModelConfigDeleteRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    // pool-read-before-write: the row only names the model whose barrier the
    // write checks; the write re-reads it and refuses on any difference.
    let row = config_ops::get(&services.db, &id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "model configuration was not found".to_string())?;
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the delete on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model configuration delete")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .db
        .write(async |tx| {
            delete_model_config_unless_plan_barrier(tx, &id, &row.provider_id, &row.model_id, &conversation_ids).await
        })
        .await
        .map_err(|error| error.to_string())?;
    finish_guarded_model_config_mutation(guarded)
}

fn patch_nullable<'de, D, T>(deserializer: D) -> Result<Option<RequiredNullable<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    <RequiredNullable<T> as serde::Deserialize>::deserialize(deserializer).map(Some)
}

fn validate_protocol_id(protocol: &str) -> Result<(), String> {
    if meridian_core::provider::protocols::BUILTIN_PROTOCOLS
        .iter()
        .any(|p| p.id == protocol)
    {
        Ok(())
    } else {
        Err(format!("unknown wire protocol `{protocol}`"))
    }
}

fn build_deployment_response(
    row: model_config::Model,
    profile: &model_profile::Model,
    provider: Option<&provider::Model>,
) -> Result<ModelDeploymentInfoResponse, String> {
    let resolved = meridian_core::agent::model_config::effective(&row, profile);
    let effective_pricing = ModelPricingInfoResponse {
        input_price: resolved.input_price,
        output_price: resolved.output_price,
        cache_read_price: resolved.cache_read_price,
        cache_write_price: resolved.cache_write_price,
        pricing_tiers: meridian_core::agent::pricing::parse_tiers(resolved.pricing_tiers.as_deref())
            .map_err(|error| error.to_string())?,
        server_tool_price: resolved.server_tool_price,
    };
    let capability_overrides = row
        .capability_overrides
        .as_deref()
        .map(ProviderCapabilityOverrides::from_storage_json)
        .transpose()?;
    let effective_protocol = match row.protocol_override.as_deref() {
        Some(override_id) => override_id.to_owned(),
        None => match profile.capability_domain {
            CapabilityDomain::ImageGen | CapabilityDomain::VideoGen => provider
                .and_then(|p| {
                    meridian_core::media::resolve_media_protocol(
                        profile.capability_domain,
                        None,
                        p.provider_type.as_str(),
                        p.catalog_id.as_deref(),
                        &row.model_id,
                    )
                    .ok()
                })
                .unwrap_or("openai_images")
                .to_owned(),
            _ => provider
                .and_then(|p| {
                    meridian_core::provider::protocols::canonical_protocol_id(
                        p.provider_type.as_str(),
                        p.api_format.as_str(),
                    )
                })
                .unwrap_or("openai_chat")
                .to_owned(),
        },
    };
    let canonical_key = profile.canonical_id.as_deref().unwrap_or(&row.model_id);
    let compliance =
        meridian_core::provider::canonical_models::evaluate_protocol_compliance(canonical_key, &effective_protocol);
    Ok(ModelDeploymentInfoResponse {
        id: row.id,
        provider_id: row.provider_id,
        provider_name: provider
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown Provider".into()),
        provider_icon: provider.and_then(|p| p.icon.clone()),
        provider_catalog_id: provider.and_then(|p| p.catalog_id.clone()),
        provider_enabled: provider.is_some_and(|p| p.is_enabled.get()),
        model_id: row.model_id,
        profile_id: row.profile_id,
        effective_protocol,
        protocol_override: row.protocol_override,
        compliance,
        is_enabled: row.is_enabled.get(),
        priority: row.priority,
        overrides_pricing: row.overrides_pricing.get(),
        effective_pricing,
        capability_overrides,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn compliance_rank(compliance: &ProtocolCompliance) -> u8 {
    match compliance {
        ProtocolCompliance::Standard => 0,
        ProtocolCompliance::Unknown => 1,
        ProtocolCompliance::Degraded { .. } => 2,
    }
}

/// First-class list of every logical model alongside its ordered provider
/// deployments (including 0-deployment logical models).
#[tauri::command]
pub async fn list_logical_models(app: tauri::AppHandle) -> Result<LogicalModelListResponse, String> {
    let (models_with_deps, providers) = app
        .services()
        .db
        .read(async |tx| {
            let models = profile_ops::list_with_deployments(tx, false).await?;
            let providers = provider_ops::list(tx).await?;
            Ok::<_, DbErr>((models, providers))
        })
        .await
        .map_err(|error| error.to_string())?;
    let provider_map: HashMap<&str, &provider::Model> = providers.iter().map(|p| (p.id.as_str(), p)).collect();
    let mut out = Vec::with_capacity(models_with_deps.len());
    for (profile, deps) in models_with_deps {
        let count = deps.len() as i64;
        let mut built_deps = Vec::with_capacity(deps.len());
        for dep in deps {
            let prov = provider_map.get(dep.provider_id.as_str()).copied();
            built_deps.push(build_deployment_response(dep, &profile, prov)?);
        }
        built_deps.sort_by(|a, b| {
            b.is_enabled
                .cmp(&a.is_enabled)
                .then_with(|| compliance_rank(&a.compliance).cmp(&compliance_rank(&b.compliance)))
                .then_with(|| a.priority.cmp(&b.priority))
                .then_with(|| a.provider_name.cmp(&b.provider_name))
        });
        out.push(LogicalModelInfoResponse {
            profile: ModelProfileInfoResponse::from_row(profile, count)?,
            deployments: built_deps,
        });
    }
    Ok(out)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogicalModelCreateRequest {
    pub name: String,
    pub canonical_id: RequiredNullable<String>,
    pub capability_domain: CapabilityDomain,
    pub family: RequiredNullable<String>,
    pub icon: RequiredNullable<String>,
    pub routing_policy: RoutingPolicy,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: RequiredNullable<i32>,
    pub input_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub output_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_read_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_write_price: RequiredNullable<meridian_core::decimal::Decimal>,
    #[serde(deserialize_with = "deserialize_price_tiers")]
    pub pricing_tiers: Vec<meridian_core::agent::pricing::PriceTier>,
    pub capability_overrides: RequiredNullable<ProviderCapabilityOverrides>,
}

impl LogicalModelCreateRequest {
    fn validate(mut self) -> Result<Self, String> {
        if self.name.trim().is_empty() {
            return Err("logical model name is required".into());
        }
        if self.capability_domain == CapabilityDomain::Chat {
            if self.context_window <= 0 {
                return Err("context_window must be positive".into());
            }
            if self.compact_threshold <= 0 || self.compact_threshold >= self.context_window {
                return Err("compact_threshold must be positive and smaller than context_window".into());
            }
        } else if self.context_window < 0 || self.compact_threshold < 0 {
            return Err("context_window and compact_threshold must be non-negative".into());
        }
        if self.max_output_tokens.0.is_some_and(|v| v <= 0) {
            return Err("max_output_tokens must be positive".into());
        }
        if self.input_price.0.is_some() != self.output_price.0.is_some() {
            return Err("input_price and output_price must be configured together".into());
        }
        for (field, value) in [
            ("input_price", self.input_price.0.as_ref()),
            ("output_price", self.output_price.0.as_ref()),
            ("cache_read_price", self.cache_read_price.0.as_ref()),
            ("cache_write_price", self.cache_write_price.0.as_ref()),
        ] {
            if value.is_some_and(meridian_core::decimal::Decimal::is_negative) {
                return Err(format!("{field} must be non-negative"));
            }
        }
        if !self.pricing_tiers.is_empty() && self.input_price.0.is_none() {
            return Err("pricing_tiers requires configured input_price and output_price".into());
        }
        self.pricing_tiers =
            meridian_core::agent::pricing::validate_tiers(self.pricing_tiers).map_err(|error| error.to_string())?;
        if let Some(overrides) = self.capability_overrides.0.as_ref() {
            overrides.storage_json()?;
        }
        Ok(self)
    }
}

#[tauri::command]
pub async fn create_logical_model(
    app: tauri::AppHandle,
    request: LogicalModelCreateRequest,
) -> Result<ModelProfileInfoResponse, String> {
    let request = request.validate()?;
    let now = now_ms();
    let pricing_tiers = (!request.pricing_tiers.is_empty())
        .then(|| serde_json::to_string(&request.pricing_tiers).expect("PriceTier always serializes"));
    let capability_overrides = request
        .capability_overrides
        .0
        .as_ref()
        .map(ProviderCapabilityOverrides::storage_json)
        .transpose()?;
    let row = model_profile::Model {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name.trim().to_owned(),
        context_window: request.context_window,
        compact_threshold: request.compact_threshold,
        max_output_tokens: request.max_output_tokens.0,
        input_price: request.input_price.0,
        output_price: request.output_price.0,
        cache_read_price: request.cache_read_price.0,
        cache_write_price: request.cache_write_price.0,
        pricing_tiers,
        capability_overrides,
        created_at: now,
        updated_at: now,
        canonical_id: request
            .canonical_id
            .0
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty()),
        capability_domain: request.capability_domain,
        family: request.family.0.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()),
        icon: request.icon.0.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()),
        routing_policy: request.routing_policy,
        is_archived: SqlBool::FALSE,
    };
    let saved = app
        .services()
        .db
        .write(async |tx| profile_ops::insert(tx, row).await)
        .await
        .map_err(|error| error.to_string())?;
    ModelProfileInfoResponse::from_row(saved, 0)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogicalModelUpdateRequest {
    pub id: String,
    pub name: Option<String>,
    #[serde(default, deserialize_with = "patch_nullable")]
    pub canonical_id: Option<RequiredNullable<String>>,
    pub capability_domain: Option<CapabilityDomain>,
    #[serde(default, deserialize_with = "patch_nullable")]
    pub family: Option<RequiredNullable<String>>,
    #[serde(default, deserialize_with = "patch_nullable")]
    pub icon: Option<RequiredNullable<String>>,
    pub routing_policy: Option<RoutingPolicy>,
    pub is_archived: Option<bool>,
}

#[tauri::command]
pub async fn update_logical_model(
    app: tauri::AppHandle,
    request: LogicalModelUpdateRequest,
) -> Result<ModelProfileInfoResponse, String> {
    if let Some(name) = request.name.as_deref()
        && name.trim().is_empty()
    {
        return Err("logical model name cannot be empty".into());
    }
    let services = app.services();
    let now = now_ms();
    let (updated, count) = services
        .db
        .write(async |tx| {
            let Some(existing) = profile_ops::get(tx, &request.id).await? else {
                return Ok::<_, DbErr>(Err(format!("logical model `{}` does not exist", request.id)));
            };
            let meta = profile_ops::LogicalModelMetaChangeset {
                name: request.name.as_deref().map(|s| s.trim().to_owned()),
                canonical_id: match &request.canonical_id {
                    Some(RequiredNullable(Some(v))) => Some(v.trim().to_owned()).filter(|s| !s.is_empty()),
                    Some(RequiredNullable(None)) => None,
                    None => existing.canonical_id,
                },
                capability_domain: request.capability_domain.unwrap_or(existing.capability_domain),
                family: match &request.family {
                    Some(RequiredNullable(Some(v))) => Some(v.trim().to_owned()).filter(|s| !s.is_empty()),
                    Some(RequiredNullable(None)) => None,
                    None => existing.family,
                },
                icon: match &request.icon {
                    Some(RequiredNullable(Some(v))) => Some(v.trim().to_owned()).filter(|s| !s.is_empty()),
                    Some(RequiredNullable(None)) => None,
                    None => existing.icon,
                },
                routing_policy: request.routing_policy.unwrap_or(existing.routing_policy),
                is_archived: request.is_archived.map(SqlBool::from).unwrap_or(existing.is_archived),
                updated_at: now,
            };
            let saved = profile_ops::update_meta(tx, &request.id, meta).await?;
            let count = profile_model_counts(tx)
                .await?
                .get(&saved.id)
                .copied()
                .unwrap_or_default();
            Ok(Ok((saved, count)))
        })
        .await
        .map_err(|error| error.to_string())??;
    ModelProfileInfoResponse::from_row(updated, count)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogicalModelDeleteRequest {
    pub id: String,
    pub cascade_deployments: bool,
}

#[tauri::command]
pub async fn delete_logical_model(app: tauri::AppHandle, request: LogicalModelDeleteRequest) -> Result<(), String> {
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the delete on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a logical model delete")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .db
        .write(async |tx| {
            if let Some(refused) = model_config_barrier(tx, "", "", &conversation_ids).await? {
                return Ok::<_, DbErr>(refused);
            }
            profile_ops::delete_logical_model(tx, &request.id, request.cascade_deployments).await?;
            Ok(GuardedModelConfigMutation::Applied(()))
        })
        .await
        .map_err(|error| error.to_string())?;
    finish_guarded_model_config_mutation(guarded)
}

/// Explicit opt-in from a provider's discovered model list: links
/// `(provider_id, model_id)` to an existing logical model (either explicit
/// `profile_id` or matched by canonical ID) or creates a new logical model +
/// deployment in one transaction.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDeploymentAttachRequest {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: RequiredNullable<String>,
    pub profile_id: RequiredNullable<String>,
    pub protocol_override: RequiredNullable<String>,
    pub priority: RequiredNullable<i32>,
}

#[tauri::command]
pub async fn attach_model_deployment(
    app: tauri::AppHandle,
    request: ModelDeploymentAttachRequest,
) -> Result<ModelConfigInfoResponse, String> {
    if request.provider_id.trim().is_empty() || request.model_id.trim().is_empty() {
        return Err("provider_id and model_id are required".into());
    }
    if let Some(protocol) = request.protocol_override.0.as_deref() {
        validate_protocol_id(protocol)?;
    }
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the attach on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model deployment attach")
        .map_err(|busy| busy.to_string())?;
    let now = now_ms();
    let canonical_spec = meridian_core::provider::canonical_models::canonicalize_model_id(&request.model_id);
    let priority = request.priority.0.unwrap_or(100);
    let guarded = services
        .db
        .write(async |tx| {
            if let Some(refused) =
                model_config_barrier(tx, &request.provider_id, &request.model_id, &conversation_ids).await?
            {
                return Ok::<_, DbErr>(Ok(refused));
            }
            let Some(provider_row) = provider_ops::get(tx, &request.provider_id).await? else {
                return Ok(Err(format!("provider `{}` does not exist", request.provider_id)));
            };
            let target_profile = if let Some(explicit_profile_id) = request.profile_id.0.as_deref() {
                match profile_ops::get(tx, explicit_profile_id).await? {
                    Some(found) => found,
                    None => return Ok(Err(format!("logical model `{explicit_profile_id}` does not exist"))),
                }
            } else if let Some(spec) = canonical_spec.as_ref()
                && let Some(existing) = profile_ops::find_by_canonical_id(tx, &spec.canonical_id).await?
            {
                existing
            } else {
                let domain = canonical_spec
                    .as_ref()
                    .map(meridian_core::provider::canonical_models::CanonicalModelMatch::capability_domain)
                    .unwrap_or(provider_row.capability_domain);
                let (context_window, compact_threshold, max_output_tokens) = if domain == CapabilityDomain::Chat {
                    let model_caps = meridian_core::provider::capabilities::resolve(
                        provider_row.provider_type.as_str(),
                        Some(provider_row.api_format.as_str()),
                        &request.model_id,
                    );
                    let Some(max_context) = model_caps.max_context_tokens else {
                        return Ok(Err(format!(
                            "model `{}` has no known context window in the catalog; open its configuration page to set one explicitly",
                            request.model_id
                        )));
                    };
                    let cw = max_context as i32;
                    let ct = (cw / 5 * 4).max(1).min(cw - 1);
                    (cw, ct, model_caps.max_output_tokens.map(|v| v as i32))
                } else {
                    (0, 0, None)
                };
                let routing_policy = match domain {
                    CapabilityDomain::ImageGen | CapabilityDomain::VideoGen => RoutingPolicy::AutoFailoverStateless,
                    _ => RoutingPolicy::StickyManual,
                };
                let name = request
                    .display_name
                    .0
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .or_else(|| canonical_spec.as_ref().map(|s| s.matched_prefix.clone()))
                    .unwrap_or_else(|| request.model_id.clone());
                let new_profile = model_profile::Model {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    context_window,
                    compact_threshold,
                    max_output_tokens,
                    input_price: None,
                    output_price: None,
                    cache_read_price: None,
                    cache_write_price: None,
                    pricing_tiers: None,
                    capability_overrides: None,
                    created_at: now,
                    updated_at: now,
                    canonical_id: canonical_spec.as_ref().map(|s| s.canonical_id.clone()),
                    capability_domain: domain,
                    family: canonical_spec.as_ref().map(|s| s.family.clone()),
                    icon: None,
                    routing_policy,
                    is_archived: SqlBool::FALSE,
                };
                profile_ops::insert(tx, new_profile).await?
            };
            let resolved_protocol_override = request.protocol_override.0.clone().or_else(|| {
                if matches!(
                    target_profile.capability_domain,
                    CapabilityDomain::ImageGen | CapabilityDomain::VideoGen
                ) {
                    meridian_core::media::resolve_media_protocol(
                        target_profile.capability_domain,
                        None,
                        provider_row.provider_type.as_str(),
                        provider_row.catalog_id.as_deref(),
                        &request.model_id,
                    )
                    .ok()
                    .map(str::to_owned)
                } else {
                    None
                }
            });
            let deployment = model_config::Model {
                id: uuid::Uuid::new_v4().to_string(),
                provider_id: request.provider_id.clone(),
                model_id: request.model_id.clone(),
                profile_id: target_profile.id.clone(),
                overrides_pricing: SqlBool::FALSE,
                input_price: None,
                output_price: None,
                cache_read_price: None,
                cache_write_price: None,
                pricing_tiers: None,
                server_tools: None,
                server_tool_price: None,
                created_at: now,
                updated_at: now,
                protocol_override: resolved_protocol_override,
                is_enabled: SqlBool::TRUE,
                priority,
                capability_overrides: None,
            };
            let saved = config_ops::upsert(tx, deployment).await?;
            let count = profile_model_counts(tx)
                .await?
                .get(&target_profile.id)
                .copied()
                .unwrap_or_default();
            Ok(Ok(GuardedModelConfigMutation::Applied((saved, target_profile, count))))
        })
        .await
        .map_err(|error| error.to_string())??;
    let (row, saved_profile, count) = finish_guarded_model_config_mutation(guarded)?;
    meridian_core::provider::models_dev::fill_for_config(
        &services.db,
        &services.models_dev,
        &row.provider_id,
        &row.model_id,
    )
    .await;
    let saved_profile = profile_ops::get(&services.db, &row.profile_id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(saved_profile);
    ModelConfigInfoResponse::from_rows(row, saved_profile, count)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDeploymentUpdateRequest {
    pub id: String,
    pub is_enabled: Option<bool>,
    pub priority: Option<i32>,
    #[serde(default, deserialize_with = "patch_nullable")]
    pub protocol_override: Option<RequiredNullable<String>>,
    #[serde(default, deserialize_with = "patch_nullable")]
    pub capability_overrides: Option<RequiredNullable<ProviderCapabilityOverrides>>,
}

#[tauri::command]
pub async fn update_model_deployment(
    app: tauri::AppHandle,
    request: ModelDeploymentUpdateRequest,
) -> Result<ModelConfigInfoResponse, String> {
    if let Some(RequiredNullable(Some(protocol))) = &request.protocol_override {
        validate_protocol_id(protocol)?;
    }
    let capability_overrides = match &request.capability_overrides {
        Some(RequiredNullable(Some(ov))) => Some(Some(ov.storage_json()?)),
        Some(RequiredNullable(None)) => Some(None),
        None => None,
    };
    let protocol_override = match &request.protocol_override {
        Some(RequiredNullable(Some(p))) => Some(Some(p.clone())),
        Some(RequiredNullable(None)) => Some(None),
        None => None,
    };
    let services = app.services();
    let now = now_ms();
    let (row, profile, count) = services
        .db
        .write(async |tx| {
            let updated = config_ops::update_deployment(
                tx,
                &request.id,
                config_ops::DeploymentUpdate {
                    profile_id: None,
                    protocol_override,
                    is_enabled: request.is_enabled.map(SqlBool::from),
                    priority: request.priority,
                    capability_overrides,
                    updated_at: now,
                },
            )
            .await?;
            let profile = profile_ops::get(tx, &updated.profile_id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("logical model `{}`", updated.profile_id)))?;
            let count = profile_model_counts(tx)
                .await?
                .get(&profile.id)
                .copied()
                .unwrap_or_default();
            Ok::<_, DbErr>((updated, profile, count))
        })
        .await
        .map_err(|error| error.to_string())?;
    ModelConfigInfoResponse::from_rows(row, profile, count)
}

/// Merge a deployment into an existing logical model (`target_profile_id: Some`)
/// or split it out onto a brand-new logical model (`target_profile_id: None`).
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDeploymentProfileSwitchRequest {
    pub deployment_id: String,
    pub target_profile_id: RequiredNullable<String>,
    pub new_profile_name: RequiredNullable<String>,
}

#[tauri::command]
pub async fn switch_model_deployment_profile(
    app: tauri::AppHandle,
    request: ModelDeploymentProfileSwitchRequest,
) -> Result<ModelConfigInfoResponse, String> {
    let services = app.services();
    let now = now_ms();
    let (row, profile, count) = services
        .db
        .write(async |tx| {
            let Some(existing_dep) = config_ops::get(tx, &request.deployment_id).await? else {
                return Ok::<_, DbErr>(Err(format!(
                    "model deployment `{}` does not exist",
                    request.deployment_id
                )));
            };
            let (updated, profile) = if let Some(target_id) = request.target_profile_id.0.as_deref() {
                let updated =
                    config_ops::merge_deployment_into_model(tx, &request.deployment_id, target_id, now).await?;
                let profile = profile_ops::get(tx, target_id)
                    .await?
                    .ok_or_else(|| DbErr::RecordNotFound(format!("logical model `{target_id}`")))?;
                (updated, profile)
            } else {
                let source = profile_ops::get(tx, &existing_dep.profile_id)
                    .await?
                    .ok_or_else(|| DbErr::RecordNotFound(format!("logical model `{}`", existing_dep.profile_id)))?;
                let split_name = request
                    .new_profile_name
                    .0
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| existing_dep.model_id.clone());
                let cloned = model_profile::Model {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: split_name,
                    canonical_id: None,
                    created_at: now,
                    updated_at: now,
                    ..source
                };
                let (created, updated) =
                    config_ops::split_deployment_to_new_model(tx, &request.deployment_id, cloned, now).await?;
                (updated, created)
            };
            let count = profile_model_counts(tx)
                .await?
                .get(&profile.id)
                .copied()
                .unwrap_or_default();
            Ok(Ok((updated, profile, count)))
        })
        .await
        .map_err(|error| error.to_string())??;
    ModelConfigInfoResponse::from_rows(row, profile, count)
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDeploymentDeleteRequest {
    pub id: String,
}

/// Unlink one provider deployment without deleting its logical model even when
/// it drops to zero channels.
#[tauri::command]
pub async fn delete_model_deployment(
    app: tauri::AppHandle,
    request: ModelDeploymentDeleteRequest,
) -> Result<(), String> {
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the delete on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model deployment unlink")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .db
        .write(async |tx| {
            if let Some(refused) = model_config_barrier(tx, "", "", &conversation_ids).await? {
                return Ok::<_, DbErr>(refused);
            }
            config_ops::unlink_deployment(tx, &request.id).await?;
            Ok(GuardedModelConfigMutation::Applied(()))
        })
        .await
        .map_err(|error| error.to_string())?;
    finish_guarded_model_config_mutation(guarded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db;

    async fn seed_provider(sea: &Db) {
        db::sea::execute_for_tests(
            sea,
            "INSERT INTO providers (id, name, base_url, created_at, updated_at)
                 VALUES ('provider', 'Provider', 'https://example.invalid', 1, 1)",
        )
        .await
        .unwrap();
    }

    fn model_row() -> model_config::Model {
        model_config::Model {
            id: "model-config-1".into(),
            provider_id: "provider".into(),
            model_id: "model".into(),
            profile_id: "profile-1".into(),
            overrides_pricing: SqlBool::FALSE,
            input_price: None,
            output_price: None,
            cache_read_price: None,
            cache_write_price: None,
            pricing_tiers: None,
            server_tools: None,
            server_tool_price: None,
            created_at: 4,
            updated_at: 4,
            protocol_override: None,
            is_enabled: SqlBool::TRUE,
            priority: 100,
            capability_overrides: None,
        }
    }

    fn profile_write() -> ProfileWrite {
        ProfileWrite {
            name: "Model".into(),
            capability_domain: CapabilityDomain::Chat,
            canonical_id: None,
            family: None,
            routing_policy: RoutingPolicy::StickyManual,
            context_window: 128_000,
            compact_threshold: 100_000,
            max_output_tokens: None,
            input_price: None,
            output_price: None,
            cache_read_price: None,
            cache_write_price: None,
            pricing_tiers: None,
            capability_overrides: None,
            now: 4,
        }
    }

    fn request() -> serde_json::Value {
        serde_json::json!({
            "provider_id": "provider",
            "model_id": "model",
            "profile": {
                "id": null,
                "name": "Model",
                "capability_domain": "chat",
                "context_window": 128000,
                "compact_threshold": 100000,
                "max_output_tokens": null,
                "input_price": null,
                "output_price": null,
                "cache_read_price": null,
                "cache_write_price": null,
                "pricing_tiers": [],
                "capability_overrides": null
            },
            "protocol_override": null,
            "overrides_pricing": false,
            "input_price": null,
            "output_price": null,
            "cache_read_price": null,
            "cache_write_price": null,
            "pricing_tiers": [],
            "server_tools": null,
            "server_tool_price": null
        })
    }

    /// A request that overrides nothing may not carry rates anyway.
    ///
    /// Blank-and-ignored and blank-and-meaningful are different states, and the
    /// switch is what tells them apart. Without this a client could write the
    /// profile's rates onto the row as well, and the two copies would be free to
    /// drift — which is the duplication the split exists to end.
    #[test]
    fn a_row_that_does_not_override_may_not_carry_prices() {
        let mut carried = request();
        carried["input_price"] = serde_json::json!("3");
        carried["output_price"] = serde_json::json!("15");
        let error = serde_json::from_value::<ModelConfigUpsertRequest>(carried)
            .unwrap()
            .validate()
            .unwrap_err();
        assert!(error.contains("overrides_pricing"), "{error}");

        let mut overriding = request();
        overriding["overrides_pricing"] = serde_json::json!(true);
        overriding["input_price"] = serde_json::json!("3");
        overriding["output_price"] = serde_json::json!("15");
        assert!(
            serde_json::from_value::<ModelConfigUpsertRequest>(overriding)
                .unwrap()
                .validate()
                .is_ok()
        );
    }

    /// Both halves of a save land, and they land together.
    #[tokio::test]
    async fn a_save_writes_the_profile_and_the_row_in_one_transaction() {
        let sea = db::sea::sea_test_db().await;
        seed_provider(&sea).await;

        let applied = sea
            .write(async |tx| {
                upsert_model_config_unless_plan_barrier(tx, &[], true, profile_write(), model_row()).await
            })
            .await
            .unwrap();
        let GuardedModelConfigMutation::Applied((row, profile, count)) = applied else {
            panic!("nothing blocks this save: {applied:?}");
        };
        assert_eq!(
            (row.profile_id.as_str(), profile.name.as_str(), count),
            ("profile-1", "Model", 1)
        );

        // Naming a profile that is not there is a stale form, not a new profile:
        // minting one under an id the client chose would let a retry create two.
        let stale = sea
            .write(async |tx| {
                let gone = model_config::Model {
                    profile_id: "profile-gone".into(),
                    ..model_row()
                };
                upsert_model_config_unless_plan_barrier(tx, &[], false, profile_write(), gone).await
            })
            .await
            .unwrap();
        assert!(matches!(stale, GuardedModelConfigMutation::ModelChanged));
    }

    #[test]
    fn every_monetary_field_is_required_even_when_unconfigured() {
        let mut missing = request();
        missing.as_object_mut().unwrap().remove("input_price");
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(missing).is_err());

        let parsed = serde_json::from_value::<ModelConfigUpsertRequest>(request()).unwrap();
        assert!(parsed.input_price.0.is_none());
    }

    #[tokio::test]
    async fn delete_model_config_refuses_when_conversations_changed() {
        let sea = db::sea::sea_test_db().await;
        seed_provider(&sea).await;
        sea.write(async |tx| {
            db::sea::ops::conversation::create(tx, "conversation-1", None, None, None, 1).await?;
            profile_ops::insert(tx, profile_write().into_model("profile-2".into())).await?;
            config_ops::upsert(
                tx,
                model_config::Model {
                    id: "model-config-2".into(),
                    profile_id: "profile-2".into(),
                    ..model_row()
                },
            )
            .await
        })
        .await
        .unwrap();

        let stale = sea
            .write(async |tx| {
                delete_model_config_unless_plan_barrier(tx, "model-config-2", "provider", "model", &[]).await
            })
            .await
            .unwrap();
        assert!(matches!(stale, GuardedModelConfigMutation::ConversationsChanged));
        assert!(config_ops::get(&sea, "model-config-2").await.unwrap().is_some());
    }

    #[test]
    fn non_monetary_nullable_fields_and_read_requests_are_strict() {
        for field in ["id", "max_output_tokens"] {
            let mut missing = request();
            missing["profile"].as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<ModelConfigUpsertRequest>(missing).is_err(),
                "{field}"
            );
        }

        let valid = serde_json::json!({ "provider_id": "provider-1", "model_id": "model-1" });
        assert!(serde_json::from_value::<ModelConfigReadRequest>(valid).is_ok());
        assert!(
            serde_json::from_value::<ModelConfigReadRequest>(serde_json::json!({
                "provider_id": "provider-1",
                "model_id": "model-1",
                "legacy": true
            }))
            .is_err()
        );
    }

    #[test]
    fn tier_nullable_prices_must_be_present() {
        let mut value = request();
        value["overrides_pricing"] = serde_json::json!(true);
        value["input_price"] = serde_json::json!("1");
        value["output_price"] = serde_json::json!("2");
        value["pricing_tiers"] = serde_json::json!([{
            "min_prompt_tokens": 1000,
            "input_price": "2",
            "output_price": "4",
            "cache_read_price": null,
            "cache_write_price": null
        }]);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(value.clone()).is_ok());

        value["pricing_tiers"][0]
            .as_object_mut()
            .unwrap()
            .remove("cache_read_price");
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(value).is_err());
    }

    #[test]
    fn structured_nullable_fields_are_required_and_reject_json_text() {
        let mut missing_overrides = request();
        missing_overrides["profile"]
            .as_object_mut()
            .unwrap()
            .remove("capability_overrides");
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(missing_overrides).is_err());

        let mut missing_tools = request();
        missing_tools.as_object_mut().unwrap().remove("server_tools");
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(missing_tools).is_err());

        let mut text = request();
        text["profile"]["capability_overrides"] = serde_json::json!(r#"{"supports_thinking":true}"#);
        text["server_tools"] = serde_json::json!(r#"["web_search"]"#);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(text).is_err());
    }

    #[test]
    fn capability_overrides_and_server_tools_use_closed_typed_shapes() {
        let mut value = request();
        value["profile"]["capability_overrides"] = serde_json::json!({
            "supports_thinking": true,
            "supported_efforts": ["low", "high"],
            "default_effort": null
        });
        value["server_tools"] = serde_json::json!(["web_search", "x_search"]);
        let parsed = serde_json::from_value::<ModelConfigUpsertRequest>(value)
            .unwrap()
            .validate()
            .unwrap();
        let stored: serde_json::Value = serde_json::from_str(
            &parsed
                .profile
                .capability_overrides
                .0
                .as_ref()
                .unwrap()
                .storage_json()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(stored["supports_thinking"], true);
        assert!(stored.get("default_effort").is_some_and(serde_json::Value::is_null));

        let mut unknown = request();
        unknown["profile"]["capability_overrides"] = serde_json::json!({"future_capability": true});
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(unknown).is_err());

        let mut null_boolean = request();
        null_boolean["profile"]["capability_overrides"] = serde_json::json!({"supports_thinking": null});
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(null_boolean).is_err());

        let mut unknown_override_tool = request();
        unknown_override_tool["profile"]["capability_overrides"] =
            serde_json::json!({"server_tools": ["future_search"]});
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(unknown_override_tool).is_err());

        let mut unknown_model_tool = request();
        unknown_model_tool["server_tools"] = serde_json::json!(["future_search"]);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(unknown_model_tool).is_err());

        let mut duplicate_tools = request();
        duplicate_tools["server_tools"] = serde_json::json!(["web_search", "web_search"]);
        assert!(
            serde_json::from_value::<ModelConfigUpsertRequest>(duplicate_tools)
                .unwrap()
                .validate()
                .is_err()
        );
    }

    #[test]
    fn prices_are_canonical_decimal_strings_and_unknown_fields_fail() {
        let mut numeric = request();
        numeric["input_price"] = serde_json::json!(1.25);
        numeric["output_price"] = serde_json::json!(2);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(numeric).is_err());

        let mut noncanonical = request();
        noncanonical["input_price"] = serde_json::json!("01.25");
        noncanonical["output_price"] = serde_json::json!("2");
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(noncanonical).is_err());

        let mut unknown = request();
        unknown["future_field"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(unknown).is_err());
    }

    #[test]
    fn logical_model_and_deployment_requests_are_strict_and_validate_protocols() {
        assert!(validate_protocol_id("anthropic_messages").is_ok());
        assert!(validate_protocol_id("openai_chat").is_ok());
        assert!(validate_protocol_id("invented_private_protocol").is_err());

        let valid_attach = serde_json::json!({
            "provider_id": "p1",
            "model_id": "claude-sonnet-4-6",
            "display_name": null,
            "profile_id": null,
            "protocol_override": null,
            "priority": 10
        });
        assert!(serde_json::from_value::<ModelDeploymentAttachRequest>(valid_attach.clone()).is_ok());
        let mut missing_nullable = valid_attach.clone();
        missing_nullable.as_object_mut().unwrap().remove("protocol_override");
        assert!(serde_json::from_value::<ModelDeploymentAttachRequest>(missing_nullable).is_err());

        let mut unknown_attach = valid_attach;
        unknown_attach["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ModelDeploymentAttachRequest>(unknown_attach).is_err());

        let omitted: ModelDeploymentUpdateRequest = serde_json::from_value(serde_json::json!({"id": "dep-1"})).unwrap();
        assert!(omitted.protocol_override.is_none());
        let cleared: ModelDeploymentUpdateRequest =
            serde_json::from_value(serde_json::json!({"id": "dep-1", "protocol_override": null})).unwrap();
        assert!(matches!(cleared.protocol_override, Some(RequiredNullable(None))));
        let set: ModelDeploymentUpdateRequest =
            serde_json::from_value(serde_json::json!({"id": "dep-1", "protocol_override": "anthropic_messages"}))
                .unwrap();
        assert!(matches!(
            set.protocol_override,
            Some(RequiredNullable(Some(ref p))) if p == "anthropic_messages"
        ));
    }

    #[test]
    fn build_deployment_response_marks_claude_on_openai_chat_as_degraded() {
        let profile = model_profile::Model {
            canonical_id: Some("anthropic/claude-sonnet-4-6".into()),
            ..profile_write().into_model("profile-claude".into())
        };
        let official_provider = provider::Model {
            id: "p-anthropic".into(),
            name: "Anthropic".into(),
            provider_type: meridian_core::provider::registry::ProviderType::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            is_enabled: SqlBool::TRUE,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
            api_format: meridian_core::provider::registry::ApiFormat::ChatCompletions,
            catalog_id: Some("anthropic".into()),
            credential_kind: meridian_core::provider::registry::CredentialKind::ApiKey,
            transport_profile: meridian_core::provider::registry::TransportProfile::Standard,
            icon: None,
            codex_request_shape: SqlBool::FALSE,
            local_backend: None,
            capability_domain: CapabilityDomain::Chat,
            config_json: None,
        };
        let relay_provider = provider::Model {
            id: "p-relay".into(),
            name: "Relay".into(),
            provider_type: meridian_core::provider::registry::ProviderType::Openai,
            base_url: "https://relay.invalid/v1".into(),
            api_format: meridian_core::provider::registry::ApiFormat::ChatCompletions,
            catalog_id: None,
            ..official_provider.clone()
        };
        let dep_official = model_config::Model {
            id: "dep-1".into(),
            provider_id: "p-anthropic".into(),
            model_id: "claude-sonnet-4-6".into(),
            profile_id: "profile-claude".into(),
            ..model_row()
        };
        let dep_relay = model_config::Model {
            id: "dep-2".into(),
            provider_id: "p-relay".into(),
            model_id: "anthropic/claude-sonnet-4-6".into(),
            profile_id: "profile-claude".into(),
            ..model_row()
        };
        let r_official = build_deployment_response(dep_official, &profile, Some(&official_provider)).unwrap();
        let r_relay = build_deployment_response(dep_relay, &profile, Some(&relay_provider)).unwrap();
        assert_eq!(r_official.effective_protocol, "anthropic_messages");
        assert_eq!(r_official.compliance, ProtocolCompliance::Standard);
        assert_eq!(r_relay.effective_protocol, "openai_chat");
        assert!(matches!(r_relay.compliance, ProtocolCompliance::Degraded { .. }));
    }

    #[test]
    fn media_domain_models_allow_zero_context_window_and_resolve_official_media_protocols() {
        let mut req = request();
        req["model_id"] = serde_json::json!("kling-3.0");
        req["profile"]["capability_domain"] = serde_json::json!("video_gen");
        req["profile"]["context_window"] = serde_json::json!(0);
        req["profile"]["compact_threshold"] = serde_json::json!(0);
        req["protocol_override"] = serde_json::json!("kling_video");
        let parsed = serde_json::from_value::<ModelConfigUpsertRequest>(req)
            .unwrap()
            .validate()
            .unwrap();
        assert_eq!(parsed.profile.capability_domain, CapabilityDomain::VideoGen);
        assert_eq!(parsed.protocol_override.0.as_deref(), Some("kling_video"));

        let kling_provider = provider::Model {
            id: "p-kling".into(),
            name: "Kling AI".into(),
            provider_type: meridian_core::provider::registry::ProviderType::Media,
            base_url: "https://api-beijing.klingai.com".into(),
            is_enabled: SqlBool::TRUE,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
            api_format: meridian_core::provider::registry::ApiFormat::MediaNative,
            catalog_id: Some("kling".into()),
            credential_kind: meridian_core::provider::registry::CredentialKind::ApiKey,
            transport_profile: meridian_core::provider::registry::TransportProfile::Standard,
            icon: None,
            codex_request_shape: SqlBool::FALSE,
            local_backend: None,
            capability_domain: CapabilityDomain::VideoGen,
            config_json: None,
        };
        let video_profile = model_profile::Model {
            capability_domain: CapabilityDomain::VideoGen,
            canonical_id: Some("kling/kling-3.0".into()),
            context_window: 0,
            compact_threshold: 0,
            routing_policy: RoutingPolicy::AutoFailoverStateless,
            ..profile_write().into_model("profile-kling".into())
        };
        let dep = model_config::Model {
            id: "dep-kling".into(),
            provider_id: "p-kling".into(),
            model_id: "kling-3.0".into(),
            profile_id: "profile-kling".into(),
            protocol_override: None,
            ..model_row()
        };
        let built = build_deployment_response(dep, &video_profile, Some(&kling_provider)).unwrap();
        assert_eq!(built.effective_protocol, "kling_video");
        assert_eq!(built.compliance, ProtocolCompliance::Standard);
    }
}
