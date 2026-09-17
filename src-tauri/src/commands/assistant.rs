use crate::ServicesExt;
use crate::commands::entity_response::{AssistantInfoResponse, AssistantListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::assistant::{AssistantChangeset, AssistantInsert};
use meridian_core::template;
use meridian_core::util::{double_option, now_ms};

const PLAN_REVIEW_ASSISTANT_BARRIER: &str = "This assistant is frozen into a plan review or its continuation. Finish that review before changing or deleting the assistant.";

#[derive(Debug)]
enum GuardedAssistantMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
}

fn update_assistant_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    assistant_id: &str,
    expected_conversation_ids: &[String],
    changeset: &AssistantChangeset,
) -> diesel::QueryResult<GuardedAssistantMutation<db::models::assistant::AssistantRow>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedAssistantMutation::ConversationsChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_assistant(conn, assistant_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedAssistantMutation::PlanReviewBarrier);
        }
        db::ops::assistant::update_assistant(conn, assistant_id, changeset).map(GuardedAssistantMutation::Applied)
    })
}

fn delete_assistant_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    assistant_id: &str,
    expected_conversation_ids: &[String],
) -> diesel::QueryResult<GuardedAssistantMutation<()>> {
    conn.immediate_transaction(|conn| {
        let mut current = db::ops::conversation::all_ids(conn)?;
        current.sort();
        if current != expected_conversation_ids {
            return Ok(GuardedAssistantMutation::ConversationsChanged);
        }
        if !db::ops::plan_review::barrier_conversations_for_assistant(conn, assistant_id)
            .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            .is_empty()
        {
            return Ok(GuardedAssistantMutation::PlanReviewBarrier);
        }
        db::ops::assistant::delete_assistant(conn, assistant_id).map(GuardedAssistantMutation::Applied)
    })
}

fn finish_guarded_assistant_mutation<T>(result: GuardedAssistantMutation<T>) -> Result<T, String> {
    match result {
        GuardedAssistantMutation::Applied(value) => Ok(value),
        GuardedAssistantMutation::PlanReviewBarrier => Err(PLAN_REVIEW_ASSISTANT_BARRIER.into()),
        GuardedAssistantMutation::ConversationsChanged => {
            Err("The conversation set changed while the assistant mutation was being prepared. Try again.".into())
        }
    }
}

fn encode_optional_string_list(value: Option<Option<Vec<String>>>) -> Result<Option<Option<String>>, String> {
    value
        .map(|items| {
            items
                .map(|items| serde_json::to_string(&items).map_err(|error| error.to_string()))
                .transpose()
        })
        .transpose()
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantCreateRequest {
    name: String,
    system_prompt: String,
    model_id: RequiredNullable<String>,
    temperature: RequiredNullable<f32>,
    top_p: RequiredNullable<f32>,
    max_tokens: RequiredNullable<i32>,
}

#[tauri::command]
pub async fn list_assistants(app: tauri::AppHandle) -> Result<AssistantListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::assistant::list_assistants(&mut conn).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_assistant(
    app: tauri::AppHandle,
    request: AssistantCreateRequest,
) -> Result<AssistantInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let new = AssistantInsert {
            id: &id,
            name: &request.name,
            description: None,
            avatar: None,
            system_prompt: &request.system_prompt,
            provider_id: None,
            model_id: request.model_id.0.as_deref(),
            temperature: request.temperature.0,
            top_p: request.top_p.0,
            max_tokens: request.max_tokens.0,
            is_default: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            context_limit: 128000,
            compact_keep_recent: 10,
            enabled_tools: None,
            thinking_enabled: 0,
            thinking_budget: None,
            tool_preset_id: None,
            auto_compact_enabled: 0,
        };
        let row = db::ops::assistant::create_assistant(&mut conn, &new).map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantUpdateRequest {
    id: String,
    name: Option<String>,
    system_prompt: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    provider_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    model_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    temperature: Option<Option<f32>>,
    context_limit: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    enabled_tools: Option<Option<Vec<String>>>,
    thinking_enabled: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    thinking_budget: Option<Option<i32>>,
    #[serde(default, deserialize_with = "double_option")]
    tool_preset_id: Option<Option<String>>,
    auto_compact_enabled: Option<bool>,
}

#[tauri::command]
pub async fn update_assistant(
    app: tauri::AppHandle,
    request: AssistantUpdateRequest,
) -> Result<AssistantInfoResponse, String> {
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
        .try_acquire_mutations(&conversation_ids, "an assistant update")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let enabled_tools = encode_optional_string_list(request.enabled_tools)?;
        let changeset = AssistantChangeset {
            name: request.name,
            system_prompt: request.system_prompt,
            provider_id: request.provider_id,
            model_id: request.model_id,
            temperature: request.temperature,
            context_limit: request.context_limit,
            enabled_tools,
            thinking_enabled: request.thinking_enabled.map(i32::from),
            thinking_budget: request.thinking_budget,
            tool_preset_id: request.tool_preset_id,
            auto_compact_enabled: request.auto_compact_enabled.map(i32::from),
            updated_at: Some(now_ms()),
            ..Default::default()
        };
        let row = finish_guarded_assistant_mutation(
            update_assistant_unless_plan_barrier(&mut conn, &request.id, &conversation_ids, &changeset)
                .map_err(|e| e.to_string())?,
        )?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_assistant(app: tauri::AppHandle, id: String) -> Result<(), String> {
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
        .try_acquire_mutations(&conversation_ids, "an assistant delete")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        finish_guarded_assistant_mutation(
            delete_assistant_unless_plan_barrier(&mut conn, &id, &conversation_ids).map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemplateVariableInfoResponse {
    pub name: String,
    pub description_en: String,
    pub description_zh: String,
}

pub type TemplateVariableListResponse = Vec<TemplateVariableInfoResponse>;

#[tauri::command]
pub fn list_template_variables(_app: tauri::AppHandle) -> Result<TemplateVariableListResponse, String> {
    Ok(template::available_variables()
        .into_iter()
        .map(|variable| TemplateVariableInfoResponse {
            name: variable.name.to_owned(),
            description_en: variable.description_en.to_owned(),
            description_zh: variable.description_zh.to_owned(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assistant_boolean_updates_reject_integer_encodings() {
        let request = serde_json::from_value::<AssistantUpdateRequest>(serde_json::json!({
            "id": "assistant-1",
            "thinkingEnabled": true,
            "autoCompactEnabled": false
        }))
        .unwrap();
        assert_eq!(request.thinking_enabled, Some(true));
        assert_eq!(request.auto_compact_enabled, Some(false));

        assert!(
            serde_json::from_value::<AssistantUpdateRequest>(serde_json::json!({
                "id": "assistant-1",
                "thinkingEnabled": 1
            }))
            .is_err()
        );
    }
}
