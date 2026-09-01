//! Standalone Android has no process runner. A remote Android client routes
//! the same command name to the desktop host before Tauri sees this stub.

use crate::commands::model_config::RequiredNullable;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserCommandRunRequest {
    pub conversation_id: String,
    pub turn_id: String,
    pub command: String,
    pub retry_without_sandbox: RequiredNullable<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserCommandResultReadRequest {
    pub conversation_id: String,
    pub message_id: String,
}

#[derive(Debug, serde::Serialize)]
pub struct UserCommandResultResponse;

#[tauri::command]
pub async fn run_user_command(
    _app: tauri::AppHandle,
    _request: UserCommandRunRequest,
) -> Result<UserCommandResultResponse, String> {
    Err("shell commands require a connected Meridian desktop host".into())
}

#[tauri::command]
pub async fn active_user_shell_turn(
    _app: tauri::AppHandle,
    _conversation_id: String,
) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn get_user_command_result(
    _app: tauri::AppHandle,
    _request: UserCommandResultReadRequest,
) -> Result<Option<UserCommandResultResponse>, String> {
    Err("shell commands require a connected Meridian desktop host".into())
}
