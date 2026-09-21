use crate::ServicesExt;
use crate::commands::entity_response::{
    ModelConfigInfoResponse, ModelConfigListResponse, ModelProfileInfoResponse, ModelProfileListResponse,
    ProviderCapabilityOverrides, validate_model_server_tools,
};
use meridian_core::db;
use meridian_core::db::models::model_config::ModelConfigInsert;
use meridian_core::db::models::model_profile::{ModelProfileChangeset, ModelProfileInsert, ModelProfileRow};
use meridian_core::util::{get_conn, now_ms};

const PLAN_REVIEW_MODEL_CONFIG_BARRIER: &str = "This model configuration is frozen into a plan review or its continuation. Finish that review before changing or deleting it.";

#[derive(Debug)]
enum GuardedModelConfigMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
    ModelChanged,
}

/// The profile and the config are written in one transaction, and the profile
/// goes first: the config's `profile_id` is a foreign key, so a half-applied
/// save would either point at nothing or leave a profile nothing describes.
type SavedModelConfig = (db::models::model_config::ModelConfigRow, ModelProfileRow);

fn upsert_model_config_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    expected_conversation_ids: &[String],
    profile_id: &str,
    profile_is_new: bool,
    profile: &ProfileWrite<'_>,
    new: &ModelConfigInsert<'_>,
) -> diesel::QueryResult<GuardedModelConfigMutation<SavedModelConfig>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedModelConfigMutation::ConversationsChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_model(conn, new.provider_id, new.model_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedModelConfigMutation::PlanReviewBarrier);
        }
        let saved_profile = if profile_is_new {
            db::ops::model_profile::insert(conn, &profile.insert(profile_id))?
        } else {
            if db::ops::model_profile::get(conn, profile_id)?.is_none() {
                return Ok(GuardedModelConfigMutation::ModelChanged);
            }
            db::ops::model_profile::update(conn, profile_id, &profile.changeset())?
        };
        let row = db::ops::model_config::upsert(conn, new)?;
        Ok(GuardedModelConfigMutation::Applied((row, saved_profile)))
    })
}

/// The profile half of a save, already encoded, so the transaction above can
/// both insert and update it without re-deciding anything.
struct ProfileWrite<'a> {
    name: &'a str,
    context_window: i32,
    compact_threshold: i32,
    max_output_tokens: Option<i32>,
    input_price: Option<meridian_core::decimal::Decimal>,
    output_price: Option<meridian_core::decimal::Decimal>,
    cache_read_price: Option<meridian_core::decimal::Decimal>,
    cache_write_price: Option<meridian_core::decimal::Decimal>,
    pricing_tiers: Option<&'a str>,
    capability_overrides: Option<&'a str>,
    now: i64,
}

impl<'a> ProfileWrite<'a> {
    fn insert(&self, id: &'a str) -> ModelProfileInsert<'a> {
        ModelProfileInsert {
            id,
            name: self.name,
            context_window: self.context_window,
            compact_threshold: self.compact_threshold,
            max_output_tokens: self.max_output_tokens,
            input_price: self.input_price.clone(),
            output_price: self.output_price.clone(),
            cache_read_price: self.cache_read_price.clone(),
            cache_write_price: self.cache_write_price.clone(),
            pricing_tiers: self.pricing_tiers,
            capability_overrides: self.capability_overrides,
            created_at: self.now,
            updated_at: self.now,
        }
    }

    fn changeset(&self) -> ModelProfileChangeset<'a> {
        ModelProfileChangeset {
            name: self.name,
            context_window: self.context_window,
            compact_threshold: self.compact_threshold,
            max_output_tokens: self.max_output_tokens,
            input_price: self.input_price.clone(),
            output_price: self.output_price.clone(),
            cache_read_price: self.cache_read_price.clone(),
            cache_write_price: self.cache_write_price.clone(),
            pricing_tiers: self.pricing_tiers,
            capability_overrides: self.capability_overrides,
            updated_at: self.now,
        }
    }
}

fn delete_model_config_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    id: &str,
    expected_provider_id: &str,
    expected_model_id: &str,
    expected_conversation_ids: &[String],
) -> diesel::QueryResult<GuardedModelConfigMutation<()>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedModelConfigMutation::ConversationsChanged);
        }
        let Some(row) = db::ops::model_config::get(conn, id)? else {
            return Ok(GuardedModelConfigMutation::ModelChanged);
        };
        if row.provider_id != expected_provider_id || row.model_id != expected_model_id {
            return Ok(GuardedModelConfigMutation::ModelChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_model(conn, &row.provider_id, &row.model_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedModelConfigMutation::PlanReviewBarrier);
        }
        db::ops::model_config::delete(conn, id).map(|_| GuardedModelConfigMutation::Applied(()))
    })
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
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let rows = db::ops::model_config::list_by_provider_with_profiles(&mut conn, &provider_id)
            .map_err(|error| error.to_string())?;
        let counts = profile_model_counts(&mut conn)?;
        rows.into_iter()
            .map(|(row, profile)| {
                let count = counts.get(&profile.id).copied().unwrap_or(0);
                ModelConfigInfoResponse::from_rows(row, profile, count)
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How many providers reach each profile, for the responses that carry it.
fn profile_model_counts(
    conn: &mut diesel::sqlite::SqliteConnection,
) -> Result<std::collections::HashMap<String, i64>, String> {
    Ok(db::ops::model_profile::list_with_model_counts(conn)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(profile, count)| (profile.id, count))
        .collect())
}

/// The profiles a model page offers to point at.
///
/// Configuring the same model on a second provider is choosing one of these
/// rather than typing the window and the prices again — which is the whole
/// reason the two tables are separate.
#[tauri::command]
pub async fn list_model_profiles(app: tauri::AppHandle) -> Result<ModelProfileListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::model_profile::list_with_model_counts(&mut conn)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|(profile, count)| ModelProfileInfoResponse::from_row(profile, count))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
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
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let found = db::ops::model_config::get_with_profile(&mut conn, &request.provider_id, &request.model_id)
            .map_err(|error| error.to_string())?;
        let Some((row, profile)) = found else {
            return Ok(None);
        };
        let counts = profile_model_counts(&mut conn)?;
        let count = counts.get(&profile.id).copied().unwrap_or(0);
        ModelConfigInfoResponse::from_rows(row, profile, count).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_model_config(
    app: tauri::AppHandle,
    request: ModelConfigUpsertRequest,
) -> Result<ModelConfigInfoResponse, String> {
    let request = request.validate()?;
    let services = app.services();
    let pool = services.db.clone();
    let mut conversation_ids = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::conversation::all_ids(&mut conn).map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())??
    };
    conversation_ids.sort();
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model configuration save")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        // A profile the request did not name is a new one. The id is minted
        // here rather than by the client so a retried save cannot create two.
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
            name: request.profile.name.trim(),
            context_window: request.profile.context_window,
            compact_threshold: request.profile.compact_threshold,
            max_output_tokens: request.profile.max_output_tokens.0,
            input_price: request.profile.input_price.0.clone(),
            output_price: request.profile.output_price.0.clone(),
            cache_read_price: request.profile.cache_read_price.0.clone(),
            cache_write_price: request.profile.cache_write_price.0.clone(),
            pricing_tiers: profile_tiers.as_deref(),
            capability_overrides: capability_overrides.as_deref(),
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
        let new = ModelConfigInsert {
            id: &id,
            provider_id: &request.provider_id,
            model_id: &request.model_id,
            profile_id: &profile_id,
            overrides_pricing: request.overrides_pricing,
            input_price: request.input_price.0.clone(),
            output_price: request.output_price.0.clone(),
            cache_read_price: request.cache_read_price.0.clone(),
            cache_write_price: request.cache_write_price.0.clone(),
            pricing_tiers: pricing_tiers.as_deref(),
            server_tools: server_tools.as_deref(),
            server_tool_price: request.server_tool_price.0.clone(),
            created_at: now,
            updated_at: now,
        };
        let (row, saved_profile) = finish_guarded_model_config_mutation(
            upsert_model_config_unless_plan_barrier(
                &mut conn,
                &conversation_ids,
                &profile_id,
                profile_is_new,
                &profile,
                &new,
            )
            .map_err(|error| error.to_string())?,
        )?;
        let counts = profile_model_counts(&mut conn)?;
        let count = counts.get(&saved_profile.id).copied().unwrap_or(0);
        ModelConfigInfoResponse::from_rows(row, saved_profile, count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_model_config(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let (provider_id, model_id, mut conversation_ids) = {
        let pool = pool.clone();
        let id = id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let row = db::ops::model_config::get(&mut conn, &id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "model configuration was not found".to_string())?;
            let ids = db::ops::conversation::all_ids(&mut conn).map_err(|error| error.to_string())?;
            Ok::<_, String>((row.provider_id, row.model_id, ids))
        })
        .await
        .map_err(|error| error.to_string())??
    };
    conversation_ids.sort();
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "a model configuration delete")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        finish_guarded_model_config_mutation(
            delete_model_config_unless_plan_barrier(&mut conn, &id, &provider_id, &model_id, &conversation_ids)
                .map_err(|error| error.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_provider(conn: &mut diesel::sqlite::SqliteConnection) {
        db::ops::provider::create_provider(
            conn,
            &db::models::provider::ProviderInsert {
                id: "provider",
                name: "Provider",
                provider_type: "openai",
                base_url: "https://example.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
                api_format: "responses",
                catalog_id: None,
                credential_kind: "api_key",
                transport_profile: "standard",
            },
        )
        .unwrap();
    }

    fn seed_pending_model_review(conn: &mut diesel::sqlite::SqliteConnection) {
        db::ops::provider::create_provider(
            conn,
            &db::models::provider::ProviderInsert {
                id: "provider",
                name: "Provider",
                provider_type: "openai",
                base_url: "https://example.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
                api_format: "responses",
                catalog_id: None,
                credential_kind: "api_key",
                transport_profile: "standard",
            },
        )
        .unwrap();
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

    fn model_insert<'a>() -> ModelConfigInsert<'a> {
        ModelConfigInsert {
            id: "model-config-1",
            provider_id: "provider",
            model_id: "model",
            profile_id: "profile-1",
            overrides_pricing: false,
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

    fn profile_write<'a>() -> ProfileWrite<'a> {
        ProfileWrite {
            name: "Model",
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
    #[test]
    fn a_save_writes_the_profile_and_the_row_in_one_transaction() {
        let pool = db::test_db();
        let mut conn = pool.get().unwrap();
        seed_provider(&mut conn);

        let applied = upsert_model_config_unless_plan_barrier(
            &mut conn,
            &[],
            "profile-1",
            true,
            &profile_write(),
            &model_insert(),
        )
        .unwrap();
        assert!(matches!(applied, GuardedModelConfigMutation::Applied(_)));
        assert_eq!(
            db::ops::model_profile::get(&mut conn, "profile-1")
                .unwrap()
                .unwrap()
                .name,
            "Model"
        );

        // Naming a profile that is not there is a stale form, not a new profile:
        // minting one under an id the client chose would let a retry create two.
        let stale = upsert_model_config_unless_plan_barrier(
            &mut conn,
            &[],
            "profile-gone",
            false,
            &profile_write(),
            &model_insert(),
        )
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

    #[test]
    fn active_review_runtime_blocks_exact_model_config_save_and_delete() {
        let pool = db::test_db();
        let mut conn = pool.get().unwrap();
        seed_pending_model_review(&mut conn);
        let conversations = vec!["conversation-1".to_string()];

        let save = upsert_model_config_unless_plan_barrier(
            &mut conn,
            &conversations,
            "profile-1",
            true,
            &profile_write(),
            &model_insert(),
        )
        .unwrap();
        assert!(matches!(save, GuardedModelConfigMutation::PlanReviewBarrier));

        db::ops::model_profile::insert(&mut conn, &profile_write().insert("profile-1")).unwrap();
        db::ops::model_config::upsert(&mut conn, &model_insert()).unwrap();
        let delete =
            delete_model_config_unless_plan_barrier(&mut conn, "model-config-1", "provider", "model", &conversations)
                .unwrap();
        assert!(matches!(delete, GuardedModelConfigMutation::PlanReviewBarrier));
        assert!(
            db::ops::model_config::get(&mut conn, "model-config-1")
                .unwrap()
                .is_some()
        );
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
