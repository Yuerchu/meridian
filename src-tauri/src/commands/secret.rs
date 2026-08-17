use tauri::Manager;

use crate::secrets::{SecretName, SecretScope};
use crate::state::AppSecrets;

#[tauri::command]
pub async fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0
        .set(&SecretScope::Global, &name, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0.get(&SecretScope::Global, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0.delete(&SecretScope::Global, &name).map_err(|e| e.to_string())
}
