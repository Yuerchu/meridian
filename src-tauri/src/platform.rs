//! Platform detection and Android storage permission commands.
//! All commands are registered on every platform; non-Android builds return
//! inert values so the frontend can call them unconditionally.

/// Persisted SAF root entry, stored as a JSON array under the
/// "android.saf_roots" preference key.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SafRootEntry {
    pub uri: String,
    pub display_name: String,
    pub virtual_prefix: String,
}

#[cfg(target_os = "android")]
async fn load_saf_roots(pool: &crate::db::DbPool) -> Result<Vec<SafRootEntry>, String> {
    let pool = pool.clone();
    let json = tokio::task::spawn_blocking(move || {
        let mut conn = pool
            .get()
            .map_err(|e| format!("db connection error: {e}"))?;
        crate::db::ops::preference::get_preference(&mut conn, "android.saf_roots")
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    match json {
        Some(j) => serde_json::from_str(&j).map_err(|e| format!("corrupt saf_roots: {e}")),
        None => Ok(Vec::new()),
    }
}

#[cfg(target_os = "android")]
async fn save_saf_roots(pool: &crate::db::DbPool, roots: &[SafRootEntry]) -> Result<(), String> {
    let pool = pool.clone();
    let json = serde_json::to_string(roots).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool
            .get()
            .map_err(|e| format!("db connection error: {e}"))?;
        crate::db::ops::preference::set_preference(
            &mut conn,
            "android.saf_roots",
            &json,
            crate::now_ms(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    }
}

/// Whether MANAGE_EXTERNAL_STORAGE ("All files access") is currently granted by the system.
#[tauri::command]
pub fn get_manage_storage_status() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        crate::android_bridge::is_manage_storage_granted()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}

/// Open the system settings page where the user can grant "All files access".
#[tauri::command]
pub fn request_manage_storage() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android_bridge::open_manage_storage_settings()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("only available on Android".to_string())
    }
}

/// Show the system directory picker, persist the grant, and store the new
/// root in preferences. Returns the updated list of authorized directories.
#[tauri::command]
pub async fn pick_saf_directory(app: tauri::AppHandle) -> Result<Vec<SafRootEntry>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let Some((uri, display_name)) = crate::android_bridge::pick_directory().await? else {
            // user cancelled; return the unchanged list
            let pool = app.state::<crate::AppDb>().0.clone();
            return load_saf_roots(&pool).await;
        };

        let pool = app.state::<crate::AppDb>().0.clone();
        let mut roots = load_saf_roots(&pool).await?;
        if roots.iter().any(|r| r.uri == uri) {
            return Ok(roots);
        }

        let safe_name: String = display_name
            .chars()
            .map(|c| if c == '/' || c == '\\' { '_' } else { c })
            .collect();
        let base = format!("/saf/{safe_name}");
        let mut prefix = base.clone();
        let mut n = 2;
        while roots.iter().any(|r| r.virtual_prefix == prefix) {
            prefix = format!("{base}-{n}");
            n += 1;
        }

        roots.push(SafRootEntry { uri, display_name, virtual_prefix: prefix });
        save_saf_roots(&pool, &roots).await?;
        Ok(roots)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("only available on Android".to_string())
    }
}

/// List authorized SAF directories.
#[tauri::command]
pub async fn list_saf_roots(app: tauri::AppHandle) -> Result<Vec<SafRootEntry>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let pool = app.state::<crate::AppDb>().0.clone();
        load_saf_roots(&pool).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Remove an authorized SAF directory and release its persisted grant.
#[tauri::command]
pub async fn remove_saf_root(app: tauri::AppHandle, uri: String) -> Result<Vec<SafRootEntry>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let pool = app.state::<crate::AppDb>().0.clone();
        let mut roots = load_saf_roots(&pool).await?;
        roots.retain(|r| r.uri != uri);
        save_saf_roots(&pool, &roots).await?;
        // Best-effort: the grant may already be gone (e.g. directory deleted)
        let _ = crate::android_bridge::release_persisted_uri(&uri);
        Ok(roots)
    }
    #[cfg(not(target_os = "android"))]
    {
        let (_, _) = (app, uri);
        Err("only available on Android".to_string())
    }
}
