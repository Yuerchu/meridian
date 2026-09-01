use crate::ServicesExt;
use meridian_core::secrets::{SecretName, SecretScope};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub enum SecretKey {
    #[serde(rename = "REMOTE_TOKEN")]
    RemoteToken,
}

impl SecretKey {
    fn as_str(self) -> &'static str {
        match self {
            Self::RemoteToken => "REMOTE_TOKEN",
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecretUpsertRequest {
    pub key: SecretKey,
    pub value: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecretReadRequest {
    pub key: SecretKey,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecretDeleteRequest {
    pub key: SecretKey,
}

#[tauri::command]
pub async fn set_secret(app: tauri::AppHandle, request: SecretUpsertRequest) -> Result<(), String> {
    let services = app.services();
    let name = SecretName::new(request.key.as_str()).map_err(|e| e.to_string())?;
    services
        .secrets
        .set(&SecretScope::Global, &name, &request.value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_secret(app: tauri::AppHandle, request: SecretReadRequest) -> Result<Option<String>, String> {
    let services = app.services();
    let name = SecretName::new(request.key.as_str()).map_err(|e| e.to_string())?;
    services
        .secrets
        .get(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_secret(app: tauri::AppHandle, request: SecretDeleteRequest) -> Result<bool, String> {
    let services = app.services();
    let name = SecretName::new(request.key.as_str()).map_err(|e| e.to_string())?;
    services
        .secrets
        .delete(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn secret_requests_accept_only_declared_keys_and_complete_objects() {
        assert!(serde_json::from_value::<SecretReadRequest>(json!({"key": "REMOTE_TOKEN"})).is_ok());
        assert!(serde_json::from_value::<SecretReadRequest>(json!({"key": "REMOTE_TOKEN", "legacy": true})).is_err());
        assert!(serde_json::from_value::<SecretReadRequest>(json!({"key": "MY_KEY"})).is_err());

        assert!(
            serde_json::from_value::<SecretUpsertRequest>(json!({
                "key": "REMOTE_TOKEN",
                "value": "token"
            }))
            .is_ok()
        );
        assert!(serde_json::from_value::<SecretUpsertRequest>(json!({"key": "REMOTE_TOKEN"})).is_err());
    }
}
