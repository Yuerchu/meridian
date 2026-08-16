use tauri::Manager;

use crate::db;
use crate::db::models::model_config::{ModelConfig, ModelConfigInput, NewModelConfig};
use crate::state::AppDb;
use crate::util::{get_conn, now_ms};

#[tauri::command]
pub async fn list_model_configs(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Vec<ModelConfig>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::model_config::list_by_provider(&mut conn, &provider_id)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_model_config(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<Option<ModelConfig>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::model_config::get_by_provider_and_model(&mut conn, &provider_id, &model_id)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_model_config(
    app: tauri::AppHandle,
    input: ModelConfigInput,
) -> Result<ModelConfig, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let new = NewModelConfig {
            id: &id,
            provider_id: &input.provider_id,
            model_id: &input.model_id,
            display_name: input.display_name.as_deref(),
            context_window: input.context_window,
            compact_threshold: input.compact_threshold,
            max_output_tokens: input.max_output_tokens,
            input_price: input.input_price,
            output_price: input.output_price,
            cache_price: input.cache_price,
            cache_write_price: input.cache_write_price,
            created_at: now,
            updated_at: now,
            capability_overrides: input.capability_overrides.as_deref(),
        };
        db::ops::model_config::upsert(&mut conn, &new).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_model_config(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::model_config::delete(&mut conn, &id).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    }).await.map_err(|e| e.to_string())?
}
