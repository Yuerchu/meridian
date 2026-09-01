use crate::ServicesExt;
use crate::commands::entity_response::{
    ModelConfigInfoResponse, ModelConfigListResponse, ProviderCapabilityOverrides, validate_model_server_tools,
};
use meridian_core::db;
use meridian_core::db::models::model_config::ModelConfigInsert;
use meridian_core::util::{get_conn, now_ms};

const PLAN_REVIEW_MODEL_CONFIG_BARRIER: &str = "This model configuration is frozen into a plan review or its continuation. Finish that review before changing or deleting it.";

#[derive(Debug)]
enum GuardedModelConfigMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
    ModelChanged,
}

fn upsert_model_config_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    expected_conversation_ids: &[String],
    new: &ModelConfigInsert<'_>,
) -> diesel::QueryResult<GuardedModelConfigMutation<db::models::model_config::ModelConfigRow>> {
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
        db::ops::model_config::upsert(conn, new).map(GuardedModelConfigMutation::Applied)
    })
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

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigUpsertRequest {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: RequiredNullable<String>,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: RequiredNullable<i32>,
    pub input_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub output_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub cache_read_price: RequiredNullable<meridian_core::decimal::Decimal>,
    pub capability_overrides: RequiredNullable<ProviderCapabilityOverrides>,
    pub cache_write_price: RequiredNullable<meridian_core::decimal::Decimal>,
    #[serde(deserialize_with = "deserialize_price_tiers")]
    pub pricing_tiers: Vec<meridian_core::agent::pricing::PriceTier>,
    pub server_tools: RequiredNullable<Vec<meridian_core::provider::ServerToolKind>>,
    pub server_tool_price: RequiredNullable<meridian_core::decimal::Decimal>,
}

impl ModelConfigUpsertRequest {
    fn validate(mut self) -> Result<Self, String> {
        if self.provider_id.trim().is_empty() || self.model_id.trim().is_empty() {
            return Err("provider_id and model_id are required".into());
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

        if let Some(overrides) = self.capability_overrides.0.as_ref() {
            overrides.storage_json()?;
        }

        if let Some(tools) = self.server_tools.0.as_ref() {
            validate_model_server_tools(tools)?;
            if tools.is_empty() {
                self.server_tools.0 = None;
            }
        }
        Ok(self)
    }
}

#[tauri::command]
pub async fn list_model_configs(app: tauri::AppHandle, provider_id: String) -> Result<ModelConfigListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let rows =
            db::ops::model_config::list_by_provider(&mut conn, &provider_id).map_err(|error| error.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
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
        let row = db::ops::model_config::get_by_provider_and_model(&mut conn, &request.provider_id, &request.model_id)
            .map_err(|error| error.to_string())?;
        row.map(TryInto::try_into).transpose()
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
        let pricing_tiers = (!request.pricing_tiers.is_empty())
            .then(|| serde_json::to_string(&request.pricing_tiers).expect("PriceTier always serializes"));
        let capability_overrides = request
            .capability_overrides
            .0
            .as_ref()
            .map(ProviderCapabilityOverrides::storage_json)
            .transpose()?;
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
            display_name: request.display_name.0.as_deref(),
            context_window: request.context_window,
            compact_threshold: request.compact_threshold,
            max_output_tokens: request.max_output_tokens.0,
            input_price: request.input_price.0,
            output_price: request.output_price.0,
            cache_read_price: request.cache_read_price.0,
            cache_write_price: request.cache_write_price.0,
            created_at: now,
            updated_at: now,
            capability_overrides: capability_overrides.as_deref(),
            pricing_tiers: pricing_tiers.as_deref(),
            server_tools: server_tools.as_deref(),
            server_tool_price: request.server_tool_price.0,
        };
        let row = finish_guarded_model_config_mutation(
            upsert_model_config_unless_plan_barrier(&mut conn, &conversation_ids, &new)
                .map_err(|error| error.to_string())?,
        )?;
        row.try_into()
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
            display_name: None,
            context_window: 128_000,
            compact_threshold: 100_000,
            max_output_tokens: None,
            input_price: None,
            output_price: None,
            cache_read_price: None,
            cache_write_price: None,
            created_at: 4,
            updated_at: 4,
            capability_overrides: None,
            pricing_tiers: None,
            server_tools: None,
            server_tool_price: None,
        }
    }

    fn request() -> serde_json::Value {
        serde_json::json!({
            "provider_id": "provider",
            "model_id": "model",
            "display_name": null,
            "context_window": 128000,
            "compact_threshold": 100000,
            "max_output_tokens": null,
            "input_price": null,
            "output_price": null,
            "cache_read_price": null,
            "capability_overrides": null,
            "cache_write_price": null,
            "pricing_tiers": [],
            "server_tools": null,
            "server_tool_price": null
        })
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

        let save = upsert_model_config_unless_plan_barrier(&mut conn, &conversations, &model_insert()).unwrap();
        assert!(matches!(save, GuardedModelConfigMutation::PlanReviewBarrier));

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
        for field in ["display_name", "max_output_tokens"] {
            let mut missing = request();
            missing.as_object_mut().unwrap().remove(field);
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
        for field in ["capability_overrides", "server_tools"] {
            let mut missing = request();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<ModelConfigUpsertRequest>(missing).is_err(),
                "{field}"
            );
        }

        let mut text = request();
        text["capability_overrides"] = serde_json::json!(r#"{"supports_thinking":true}"#);
        text["server_tools"] = serde_json::json!(r#"["web_search"]"#);
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(text).is_err());
    }

    #[test]
    fn capability_overrides_and_server_tools_use_closed_typed_shapes() {
        let mut value = request();
        value["capability_overrides"] = serde_json::json!({
            "supports_thinking": true,
            "supported_efforts": ["low", "high"],
            "default_effort": null
        });
        value["server_tools"] = serde_json::json!(["web_search", "x_search"]);
        let parsed = serde_json::from_value::<ModelConfigUpsertRequest>(value)
            .unwrap()
            .validate()
            .unwrap();
        let stored: serde_json::Value =
            serde_json::from_str(&parsed.capability_overrides.0.as_ref().unwrap().storage_json().unwrap()).unwrap();
        assert_eq!(stored["supports_thinking"], true);
        assert!(stored.get("default_effort").is_some_and(serde_json::Value::is_null));

        let mut unknown = request();
        unknown["capability_overrides"] = serde_json::json!({"future_capability": true});
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(unknown).is_err());

        let mut null_boolean = request();
        null_boolean["capability_overrides"] = serde_json::json!({"supports_thinking": null});
        assert!(serde_json::from_value::<ModelConfigUpsertRequest>(null_boolean).is_err());

        let mut unknown_override_tool = request();
        unknown_override_tool["capability_overrides"] = serde_json::json!({"server_tools": ["future_search"]});
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
