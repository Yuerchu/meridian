use std::collections::HashMap;

use crate::ServicesExt;
use crate::commands::entity_response::{
    ModelConfigInfoResponse, ModelConfigListResponse, ModelProfileInfoResponse, ModelProfileListResponse,
    ProviderCapabilityOverrides, validate_model_server_tools,
};
use meridian_core::db::entity::model_profile::ModelProfileChangeset;
use meridian_core::db::entity::{model_config, model_profile};
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::{Db, Snapshot, WriteTx};
use meridian_core::db::sea::ops::{
    conversation as conversation_ops, model_config as config_ops, model_profile as profile_ops,
    plan_review as plan_review_ops,
};
use meridian_core::db::types::SqlBool;
use meridian_core::util::now_ms;

const PLAN_REVIEW_MODEL_CONFIG_BARRIER: &str = "This model configuration is frozen into a plan review or its continuation. Finish that review before changing or deleting it.";

#[derive(Debug)]
enum GuardedModelConfigMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
    ModelChanged,
}

/// What stops a model configuration mutation before it writes anything: the
/// conversation set having changed since the caller took its leases, or a
/// plan review whose blocked continuation was resolved against this exact
/// provider and model. Run first in the mutation's own write, so the answer
/// still holds when the write lands.
async fn model_config_barrier<T>(
    tx: &WriteTx,
    provider_id: &str,
    model_id: &str,
    expected_conversation_ids: &[String],
) -> Result<Option<GuardedModelConfigMutation<T>>, DbErr> {
    let mut current = conversation_ops::all_ids(tx).await?;
    current.sort();
    if current != expected_conversation_ids {
        return Ok(Some(GuardedModelConfigMutation::ConversationsChanged));
    }
    if !plan_review_ops::barrier_conversations_for_model(tx, provider_id, model_id)
        .await?
        .is_empty()
    {
        return Ok(Some(GuardedModelConfigMutation::PlanReviewBarrier));
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
        }
    }

    fn into_changeset(self) -> ModelProfileChangeset {
        ModelProfileChangeset {
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
        GuardedModelConfigMutation::PlanReviewBarrier => Err(PLAN_REVIEW_MODEL_CONFIG_BARRIER.into()),
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
#[derive(Debug)]
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
        if self.context_window <= 0 {
            return Err("context_window must be positive".into());
        }
        if self.compact_threshold <= 0 || self.compact_threshold >= self.context_window {
            return Err("compact_threshold must be positive and smaller than context_window".into());
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

/// Every model configured on one provider, each beside the profile describing
/// it and how many providers share that profile.
#[tauri::command]
pub async fn list_model_configs(app: tauri::AppHandle, provider_id: String) -> Result<ModelConfigListResponse, String> {
    let (rows, counts) = app
        .services()
        .sea
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
        .sea
        .read(async |tx| profile_ops::list_with_model_counts(tx).await)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(profile, count)| ModelProfileInfoResponse::from_row(profile, count))
        .collect()
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
        .sea
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
pub async fn save_model_config(
    app: tauri::AppHandle,
    request: ModelConfigUpsertRequest,
) -> Result<ModelConfigInfoResponse, String> {
    let request = request.validate()?;
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the save on any difference.
    let conversation_ids = sorted_conversation_ids(&services.sea).await?;
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
    let profile = ProfileWrite {
        name: request.profile.name.trim().to_owned(),
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
    };
    let guarded = services
        .sea
        .write(async |tx| {
            upsert_model_config_unless_plan_barrier(tx, &conversation_ids, profile_is_new, profile, new).await
        })
        .await
        .map_err(|error| error.to_string())?;
    let (row, saved_profile, count) = finish_guarded_model_config_mutation(guarded)?;
    ModelConfigInfoResponse::from_rows(row, saved_profile, count)
}

#[tauri::command]
pub async fn delete_model_config(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    // pool-read-before-write: the row only names the model whose barrier the
    // write checks; the write re-reads it and refuses on any difference.
    let row = config_ops::get(&services.sea, &id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "model configuration was not found".to_string())?;
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the delete on any difference.
    let conversation_ids = sorted_conversation_ids(&services.sea).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model configuration delete")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .sea
        .write(async |tx| {
            delete_model_config_unless_plan_barrier(tx, &id, &row.provider_id, &row.model_id, &conversation_ids).await
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

    /// The review is seeded through the Diesel plan-review ops, which have not
    /// moved, on a file both pools open; the guarded mutations run on SeaORM.
    fn seed_pending_model_review(conn: &mut diesel::sqlite::SqliteConnection) {
        db::ops::conversation::create_conversation(conn, "conversation-1", None, None, None, 1).unwrap();
        let runtime = db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: "provider".into(),
            model: "model".into(),
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
        }
    }

    fn profile_write() -> ProfileWrite {
        ProfileWrite {
            name: "Model".into(),
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
    async fn active_review_runtime_blocks_exact_model_config_save_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let (pool, sea) = db::sea::shared_test_db(dir.path()).await;
        seed_provider(&sea).await;
        seed_pending_model_review(&mut pool.get().unwrap());
        let conversations = vec!["conversation-1".to_string()];

        let save = sea
            .write(async |tx| {
                upsert_model_config_unless_plan_barrier(tx, &conversations, true, profile_write(), model_row()).await
            })
            .await
            .unwrap();
        assert!(matches!(save, GuardedModelConfigMutation::PlanReviewBarrier));
        assert_eq!(
            profile_ops::get(&sea, "profile-1").await.unwrap(),
            None,
            "nothing was written"
        );

        // Another model on the same provider is not what the review froze.
        let elsewhere = sea
            .write(async |tx| {
                let other = model_config::Model {
                    model_id: "other-model".into(),
                    ..model_row()
                };
                upsert_model_config_unless_plan_barrier(tx, &conversations, true, profile_write(), other).await
            })
            .await
            .unwrap();
        assert!(matches!(elsewhere, GuardedModelConfigMutation::Applied(_)));

        sea.write(async |tx| {
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
        let delete = sea
            .write(async |tx| {
                delete_model_config_unless_plan_barrier(tx, "model-config-2", "provider", "model", &conversations).await
            })
            .await
            .unwrap();
        assert!(matches!(delete, GuardedModelConfigMutation::PlanReviewBarrier));
        assert!(config_ops::get(&sea, "model-config-2").await.unwrap().is_some());

        let stale = sea
            .write(async |tx| {
                delete_model_config_unless_plan_barrier(tx, "model-config-2", "provider", "model", &[]).await
            })
            .await
            .unwrap();
        assert!(matches!(stale, GuardedModelConfigMutation::ConversationsChanged));
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

        let valid = serde_json::json!({ "providerId": "provider-1", "modelId": "model-1" });
        assert!(serde_json::from_value::<ModelConfigReadRequest>(valid).is_ok());
        assert!(
            serde_json::from_value::<ModelConfigReadRequest>(serde_json::json!({
                "providerId": "provider-1",
                "modelId": "model-1",
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
}
