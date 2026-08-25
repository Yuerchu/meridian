use crate::ServicesExt;
use meridian_core::agent::{get_provider_api_key, provider_secret_name};
use meridian_core::db;
use meridian_core::db::models::provider::{NewProvider, Provider, ProviderUpdate};
use meridian_core::provider::models::ModelInfo;
use meridian_core::secrets::{SecretName, SecretScope};
use meridian_core::util::now_ms;

/// The shipped vendor catalog, for the panel that offers a list to create from.
///
/// Reads a `LazyLock` over data compiled into the binary, so it takes no lock
/// and touches no disk — hence sync rather than `spawn_blocking`. It is also why
/// it cannot fail: a malformed catalog would have panicked at first use, and the
/// checker keeps one from being committed.
#[tauri::command]
pub fn list_provider_catalog(
    _app: tauri::AppHandle,
) -> Result<&'static [meridian_core::provider::catalog::CatalogEntry], String> {
    Ok(meridian_core::provider::catalog::entries())
}

/// Which ChatGPT account a Codex-backed provider is signed in as.
///
/// Reads the credential and decodes what it says about itself; it never
/// refreshes, because opening a settings page must not spend a refresh token.
/// The reply carries no token material — an email, a plan name, where the login
/// was found, and a sentence about what is wrong if anything is.
///
/// Blocking: reads a file, and on some installs the OS credential store.
#[tauri::command]
pub async fn codex_auth_status(_app: tauri::AppHandle) -> Result<meridian_core::codex_auth::AuthStatus, String> {
    tokio::task::spawn_blocking(|| {
        let home = meridian_core::codex_auth::storage::find_codex_home()
            .ok_or("Could not work out where the Codex CLI keeps its login (no home directory).")?;
        Ok(meridian_core::codex_auth::registry()
            .get(meridian_core::codex_auth::StoreId::CodexCli { home })
            .status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_providers(app: tauri::AppHandle) -> Result<Vec<Provider>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::list_providers(&mut conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_provider(
    app: tauri::AppHandle,
    name: String,
    provider_type: String,
    base_url: String,
    api_format: Option<String>,
    catalog_id: Option<String>,
) -> Result<Provider, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let format = api_format.as_deref().unwrap_or("chat_completions");
        // What the caller picked out of the catalog wins over anything inferred
        // from the address: choosing "OpenAI" and then pointing it at a relay is
        // still OpenAI, and `identify` would refuse that URL. Inference is only
        // the fallback for callers that name no vendor at all.
        let catalog = catalog_id
            .as_deref()
            .filter(|id| meridian_core::provider::catalog::find(id).is_some())
            .or_else(|| meridian_core::provider::catalog::identify(&provider_type, &base_url));
        // Which login this row uses, and therefore which endpoint it reaches,
        // comes from the vendor's own entry rather than from a default here.
        // Every entry offers `api_key`/`standard` today, so this is the same
        // answer either way; it stops being so the moment a vendor lists a
        // second way in.
        let login = catalog
            .and_then(meridian_core::provider::catalog::find)
            .and_then(|entry| entry.default_auth());
        let credential_kind = login.map_or("api_key", |auth| auth.credential_kind.as_str());
        let transport_profile = login.map_or("standard", |auth| auth.transport_profile.as_str());
        db::ops::provider::create_provider(
            &mut conn,
            &NewProvider {
                id: &id,
                name: &name,
                provider_type: &provider_type,
                base_url: &base_url,
                is_enabled: 1,
                sort_order: 0,
                created_at: now,
                updated_at: now,
                api_format: format,
                catalog_id: catalog,
                credential_kind,
                transport_profile,
            },
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
    let services = app.services();
    let pool = services.db.clone();
    let should_clear_cache = base_url.is_some() || provider_type.is_some() || api_format.is_some();
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_provider(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::delete_provider(&mut conn, &id).map_err(|e| e.to_string())?;
        let key_name = provider_secret_name(&id);
        let _ = secrets.delete(&SecretScope::Global, &SecretName::new(&key_name).unwrap());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_provider_key(app: tauri::AppHandle, provider_id: String, api_key: String) -> Result<(), String> {
    let services = app.services();
    let key_name = provider_secret_name(&provider_id);
    services
        .secrets
        .set(&SecretScope::Global, &SecretName::new(&key_name).unwrap(), &api_key)
        .map_err(|e| e.to_string())?;
    let pool = services.db.clone();
    let pid = provider_id.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(mut conn) = pool.get() {
            let _ = db::ops::cached_model::delete_by_provider(&mut conn, &pid);
        }
    })
    .await;
    Ok(())
}

#[tauri::command]
pub async fn get_provider_key_exists(app: tauri::AppHandle, provider_id: String) -> Result<bool, String> {
    let services = app.services();
    let key_name = provider_secret_name(&provider_id);
    // A read failure is not the same as "no key". Reporting it as absent sends
    // the user to enter a key they already have, and re-entering rewrites the
    // store under a fresh passphrase — taking the other providers' keys with it.
    match services
        .secrets
        .get(&SecretScope::Global, &SecretName::new(&key_name).unwrap())
    {
        Ok(value) => Ok(value.is_some()),
        Err(e) => {
            tracing::error!(
                provider_id = %provider_id,
                error = %e,
                "could not read the stored API key while checking whether one is set"
            );
            Err(format!("Could not read the saved key: {e}"))
        }
    }
}

#[tauri::command]
pub async fn fetch_provider_models(
    app: tauri::AppHandle,
    provider_id: String,
    force_refresh: Option<bool>,
) -> Result<Vec<ModelInfo>, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let force = force_refresh.unwrap_or(false);

    if !force {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let cached = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            db::ops::cached_model::list_by_provider(&mut conn, &pid).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        if !cached.is_empty() {
            return Ok(cached
                .into_iter()
                .map(|c| ModelInfo {
                    id: c.model_id,
                    name: c.model_name,
                })
                .collect());
        }
    }

    let (provider_type, base_url, api_format, transport_profile) = {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((p.provider_type, p.base_url, p.api_format, p.transport_profile))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // A transport that lists its models from local knowledge needs no key, and
    // demanding one would make the picker unusable for a login that never has
    // one. Everything else still fails here rather than sending an anonymous
    // request that comes back as an unexplained 401.
    let api_key = match get_provider_api_key(&secrets, &provider_id) {
        Some(key) => key,
        None if transport_profile == "chatgpt_codex" => String::new(),
        None => return Err("API Key not set for this provider".into()),
    };

    let models = meridian_core::provider::models::fetch_models_on(
        &provider_type,
        Some(&api_format),
        Some(&transport_profile),
        &base_url,
        &api_key,
    )
    .await
    .map_err(|e| e.to_string())?;

    {
        let pool2 = pool.clone();
        let pid = provider_id.clone();
        let models_clone = models.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().map_err(|e| e.to_string())?;
            let now = now_ms();
            let new_models: Vec<_> = models_clone
                .iter()
                .map(|m| db::models::cached_model::NewCachedModel {
                    provider_id: &pid,
                    model_id: &m.id,
                    model_name: &m.name,
                    fetched_at: now,
                })
                .collect();
            db::ops::cached_model::replace_models(&mut conn, &pid, &new_models).map_err(|e| e.to_string())
        })
        .await;
    }

    Ok(models)
}

/// What is left on this provider's account, for the few upstreams that say.
///
/// Never cached. A balance is the one figure here whose whole value is being
/// current, and a stale one is worse than none — it is the number somebody
/// decides not to top up on. `Ok(None)` means this upstream publishes nothing,
/// which is most of them and is not an error to show anybody.
#[tauri::command]
pub async fn get_provider_balance(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Option<meridian_core::provider::balance::ProviderBalance>, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();

    let (provider_type, base_url) = {
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((p.provider_type, p.base_url))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    if !meridian_core::provider::balance::supports_balance(&provider_type) {
        return Ok(None);
    }

    let api_key = get_provider_api_key(&secrets, &provider_id).ok_or("API Key not set for this provider")?;
    meridian_core::provider::balance::fetch_balance(&provider_type, &base_url, &api_key)
        .await
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_provider_capabilities(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<meridian_core::provider::ProviderCapabilities, String> {
    let services = app.services();
    let pool = services.db.clone();
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
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let mut caps = meridian_core::provider::registry::get_capabilities(&provider_type, Some(&api_format), &model_id);
    meridian_core::provider::capabilities::apply_overrides(&mut caps, overrides.as_deref());
    Ok(caps)
}
