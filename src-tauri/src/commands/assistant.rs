use crate::ServicesExt;
use crate::db;
use crate::db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use crate::util::{double_option, now_ms};

#[tauri::command]
pub async fn list_assistants(app: tauri::AppHandle) -> Result<Vec<Assistant>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::assistant::list_assistants(&mut conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_assistant(
    app: tauri::AppHandle,
    name: String,
    system_prompt: String,
    model_id: Option<String>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<Assistant, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let new = NewAssistant {
            id: &id,
            name: &name,
            description: None,
            avatar: None,
            system_prompt: &system_prompt,
            provider_id: None,
            model_id: model_id.as_deref(),
            temperature,
            top_p,
            max_tokens,
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
        db::ops::assistant::create_assistant(&mut conn, &new).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantPatch {
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
    enabled_tools: Option<Option<String>>,
    thinking_enabled: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    thinking_budget: Option<Option<i32>>,
    #[serde(default, deserialize_with = "double_option")]
    tool_preset_id: Option<Option<String>>,
    auto_compact_enabled: Option<i32>,
}

#[tauri::command]
pub async fn update_assistant(app: tauri::AppHandle, id: String, updates: AssistantPatch) -> Result<Assistant, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = AssistantUpdate {
            name: updates.name,
            system_prompt: updates.system_prompt,
            provider_id: updates.provider_id,
            model_id: updates.model_id,
            temperature: updates.temperature,
            context_limit: updates.context_limit,
            enabled_tools: updates.enabled_tools,
            thinking_enabled: updates.thinking_enabled,
            thinking_budget: updates.thinking_budget,
            tool_preset_id: updates.tool_preset_id,
            auto_compact_enabled: updates.auto_compact_enabled,
            updated_at: Some(now_ms()),
            ..Default::default()
        };
        db::ops::assistant::update_assistant(&mut conn, &id, &changeset).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_assistant(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::assistant::delete_assistant(&mut conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
