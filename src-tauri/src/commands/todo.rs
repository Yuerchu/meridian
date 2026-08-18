use crate::ServicesExt;
use crate::db;

/// The checklist the model is currently working through, if any. The chat view
/// rebuilds its status bar from this after a reload or a conversation switch,
/// where the streamed tool events are no longer available.
#[tauri::command]
pub async fn get_active_todo_list(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<db::models::todo::TodoListView>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::todo::get_active_view(&mut conn, &conversation_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
