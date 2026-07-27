use tauri::Manager;

use crate::db;
use crate::db::models::provider::{NewProvider, Provider, ProviderUpdate};
use crate::provider::models::ModelInfo;
use crate::secrets::{SecretName, SecretScope};
use crate::state::{AppDb, AppSecrets};
use crate::util::now_ms;
use crate::agent::{get_provider_api_key, provider_secret_name};

#[tauri::command]
pub async fn list_providers(app: tauri::AppHandle) -> Result<Vec<Provider>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::list_providers(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_provider(
    app: tauri::AppHandle,
    name: String,
    provider_type: String,
    base_url: String,
    api_format: Option<String>,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let format = api_format.as_deref().unwrap_or("chat_completions");
        db::ops::provider::create_provider(&mut conn, &NewProvider {
            id: &id,
            name: &name,
            provider_type: &provider_type,
            base_url: &base_url,
            is_enabled: 1,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            api_format: format,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_provider(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    provider_type: Option<String>,
    base_url: Option<String>,
    is_enabled: Option<i32>,
    api_format: Option<String>,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    let should_clear_cache = base_url.is_some() || provider_type.is_some();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        if should_clear_cache {
            let _ = db::ops::cached_model::delete_by_provider(&mut conn, &id);
        }
        let changeset = ProviderUpdate {
            name,
            provider_type,
            base_url,
            is_enabled,
            api_format,
            updated_at: Some(now_ms()),
            ..Default::default()
        };
        db::ops::provider::update_provider(&mut conn, &id, &changeset).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_provider(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::delete_provider(&mut conn, &id).map_err(|e| e.to_string())?;
        let key_name = provider_secret_name(&id);
        let _ = secrets.delete(&SecretScope::Global, &SecretName::new(&key_name).unwrap());
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_provider_key(
    app: tauri::AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let key_name = provider_secret_name(&provider_id);
    secrets.0.set(&SecretScope::Global, &SecretName::new(&key_name).unwrap(), &api_key)
        .map_err(|e| e.to_string())?;
    let pool = app.state::<AppDb>().0.clone();
    let pid = provider_id.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(mut conn) = pool.get() {
            let _ = db::ops::cached_model::delete_by_provider(&mut conn, &pid);
        }
    }).await;
    Ok(())
}

#[tauri::command]
pub async fn get_provider_key_exists(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<bool, String> {
    let secrets = app.state::<AppSecrets>();
    let key_name = provider_secret_name(&provider_id);
    let exists = secrets.0.get(&SecretScope::Global, &SecretName::new(&key_name).unwrap())
        .ok().flatten().is_some();
    Ok(exists)
}

#[tauri::command]
pub async fn fetch_provider_models(
    app: tauri::AppHandle,
    provider_id: String,
    force_refresh: Option<bool>,
) -> Result<Vec<ModelInfo>, String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>().0.clone();
    let force = force_refresh.unwrap_or(false);

    if !force {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let cached = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            db::ops::cached_model::list_by_provider(&mut conn, &pid)
                .map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())??;

        if !cached.is_empty() {
            return Ok(cached.into_iter().map(|c| ModelInfo {
                id: c.model_id,
                name: c.model_name,
            }).collect());
        }
    }

    let (provider_type, base_url) = {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((p.provider_type, p.base_url))
        }).await.map_err(|e| e.to_string())??
    };

    let api_key = get_provider_api_key(&secrets, &provider_id)
        .ok_or("API Key not set for this provider")?;

    let models = crate::provider::models::fetch_models(&provider_type, &base_url, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let models_clone = models.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let now = now_ms();
            let new_models: Vec<_> = models_clone.iter().map(|m| {
                db::models::cached_model::NewCachedModel {
                    provider_id: &pid,
                    model_id: &m.id,
                    model_name: &m.name,
                    fetched_at: now,
                }
            }).collect();
            db::ops::cached_model::replace_models(&mut conn, &pid, &new_models)
                .map_err(|e| e.to_string())
        }).await;
    }

    Ok(models)
}

#[tauri::command]
pub async fn get_provider_capabilities(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<crate::provider::ProviderCapabilities, String> {
    let pool = app.state::<AppDb>().0.clone();
    let (provider_type, api_format, overrides) = {
        let pid = provider_id.clone();
        let mid = model_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            let overrides = db::ops::model_config::get_by_provider_and_model(&mut conn, &pid, &mid)
                .ok()
                .flatten()
                .and_then(|mc| mc.capability_overrides);
            Ok::<_, String>((p.provider_type, p.api_format, overrides))
        }).await.map_err(|e| e.to_string())??
    };
    let mut caps = crate::provider::registry::get_capabilities(&provider_type, Some(&api_format), &model_id);
    crate::provider::capabilities::apply_overrides(&mut caps, overrides.as_deref());
    Ok(caps)
}
