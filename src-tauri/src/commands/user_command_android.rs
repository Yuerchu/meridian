//! Standalone Android has no process runner. A remote Android client routes
//! the same command name to the desktop host before Tauri sees this stub.

#[derive(Debug, serde::Serialize)]
pub struct UserCommandResult;

#[tauri::command]
pub async fn run_user_command(
    _app: tauri::AppHandle,
    _conversation_id: String,
    _turn_id: String,
    _command: String,
    _retry_without_sandbox: Option<bool>,
) -> Result<UserCommandResult, String> {
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
    _conversation_id: String,
    _message_id: String,
) -> Result<Option<UserCommandResult>, String> {
    Err("shell commands require a connected Meridian desktop host".into())
}
