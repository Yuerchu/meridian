use crate::ServicesExt;
use crate::commands::entity_response::TodoInfoResponse;
use meridian_core::db::sea::ops::todo as todo_ops;

/// The checklist the model is currently working through, if any. The chat view
/// rebuilds its status bar from this after a reload or a conversation switch,
/// where the streamed tool events are no longer available.
#[tauri::command]
pub async fn get_active_todo_list(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<TodoInfoResponse>, String> {
    let view = app
        .services()
        .db
        .read(async |tx| todo_ops::get_active_view(tx, &conversation_id).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(view.map(Into::into))
}
