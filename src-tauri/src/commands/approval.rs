use tauri::Manager;

use crate::state::{ApprovalDecision, ApprovalWaiters};

#[tauri::command]
pub async fn approve_tool_call(app: tauri::AppHandle, call_id: String) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Approved);
    }
    Ok(())
}

#[tauri::command]
pub async fn deny_tool_call(app: tauri::AppHandle, call_id: String, reason: Option<String>) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Denied(reason));
    }
    Ok(())
}

#[tauri::command]
pub async fn respond_to_ask(app: tauri::AppHandle, call_id: String, response: String) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Response(response));
    }
    Ok(())
}
