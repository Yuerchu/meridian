use tauri::Manager;

use crate::db;
use crate::state::AppDb;
use crate::util::now_ms;

#[tauri::command]
pub async fn list_memories(app: tauri::AppHandle, project_id: String) -> Result<Vec<db::models::memory::Memory>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::list_memories(&mut conn, &project_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_memory(
    app: tauri::AppHandle,
    project_id: String,
    key: String,
    content: String,
    memory_type: Option<String>,
) -> Result<db::models::memory::Memory, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let mt = memory_type.as_deref().unwrap_or("general");
        db::ops::memory::upsert_memory(&mut conn, &db::models::memory::NewMemory {
            id: &id,
            project_id: &project_id,
            key: &key,
            content: &content,
            memory_type: mt,
            created_at: now,
            updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_memory(
    app: tauri::AppHandle,
    id: String,
    content: Option<String>,
    memory_type: Option<String>,
) -> Result<db::models::memory::Memory, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::update_memory(&mut conn, &id, &db::models::memory::MemoryUpdate {
            content,
            memory_type,
            updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_memory(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::delete_memory(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
