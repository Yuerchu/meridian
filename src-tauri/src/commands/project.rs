use tauri::Manager;

use crate::db;
use crate::state::AppDb;
use crate::util::now_ms;

#[tauri::command]
pub async fn list_projects(app: tauri::AppHandle) -> Result<Vec<db::models::project::Project>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::list_projects(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    name: String,
    path: Option<String>,
    source_type: Option<String>,
    source_id: Option<String>,
    assistant_id: Option<String>,
    description: Option<String>,
) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let st = source_type.as_deref().unwrap_or("local");
        db::ops::project::create_project(&mut conn, &db::models::project::NewProject {
            id: &id,
            name: &name,
            path: path.as_deref(),
            source_type: st,
            source_id: source_id.as_deref(),
            assistant_id: assistant_id.as_deref(),
            description: description.as_deref(),
            created_at: now,
            updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_project(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    path: Option<String>,
    assistant_id: Option<String>,
    description: Option<String>,
) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::update_project(&mut conn, &id, &db::models::project::ProjectUpdate {
            name,
            path: path.map(Some),
            assistant_id: assistant_id.map(Some),
            description: description.map(Some),
            updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::delete_project(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
