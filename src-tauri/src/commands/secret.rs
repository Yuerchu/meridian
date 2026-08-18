use crate::ServicesExt;
use crate::secrets::{SecretName, SecretScope};

#[tauri::command]
pub async fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let services = app.services();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    services
        .secrets
        .set(&SecretScope::Global, &name, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let services = app.services();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    services
        .secrets
        .get(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let services = app.services();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    services
        .secrets
        .delete(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}
