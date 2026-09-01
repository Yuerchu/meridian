//! Platform detection and Android storage permission commands.
//! All commands are registered on every platform; non-Android builds return
//! inert values so the frontend can call them unconditionally.

#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInsetsInfoResponse {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
    pub ime_bottom: f32,
}

#[cfg(target_os = "android")]
#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInsetsEvent {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
    pub ime_bottom: f32,
}

#[cfg(target_os = "android")]
impl From<WindowInsetsInfoResponse> for WindowInsetsEvent {
    fn from(insets: WindowInsetsInfoResponse) -> Self {
        Self {
            top: insets.top,
            right: insets.right,
            bottom: insets.bottom,
            left: insets.left,
            ime_bottom: insets.ime_bottom,
        }
    }
}

#[cfg(any(target_os = "android", test))]
use meridian_core::agent::file_access::SafRootEntry;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SafRootInfoResponse {
    pub uri: String,
    pub display_name: String,
    pub virtual_prefix: String,
}

pub type SafRootListResponse = Vec<SafRootInfoResponse>;

#[cfg(any(target_os = "android", test))]
impl From<SafRootEntry> for SafRootInfoResponse {
    fn from(root: SafRootEntry) -> Self {
        Self {
            uri: root.uri,
            display_name: root.display_name,
            virtual_prefix: root.virtual_prefix,
        }
    }
}

#[cfg(any(target_os = "android", test))]
fn saf_root_list_response(roots: Vec<SafRootEntry>) -> SafRootListResponse {
    roots.into_iter().map(SafRootInfoResponse::from).collect()
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformInfoResponse {
    Android,
    Windows,
    Macos,
    Linux,
    Ios,
}

impl PlatformInfoResponse {
    pub fn current() -> Result<Self, String> {
        if cfg!(target_os = "android") {
            return Ok(Self::Android);
        }
        if cfg!(target_os = "windows") {
            return Ok(Self::Windows);
        }
        if cfg!(target_os = "macos") {
            return Ok(Self::Macos);
        }
        if cfg!(target_os = "linux") {
            return Ok(Self::Linux);
        }
        if cfg!(target_os = "ios") {
            return Ok(Self::Ios);
        }
        Err(format!("unsupported target OS `{}`", std::env::consts::OS))
    }
}

#[cfg(test)]
mod platform_info_tests {
    use super::PlatformInfoResponse;

    #[test]
    fn platform_values_use_the_closed_wire_vocabulary() {
        let cases = [
            (PlatformInfoResponse::Android, "android"),
            (PlatformInfoResponse::Windows, "windows"),
            (PlatformInfoResponse::Macos, "macos"),
            (PlatformInfoResponse::Linux, "linux"),
            (PlatformInfoResponse::Ios, "ios"),
        ];
        for (value, expected) in cases {
            assert_eq!(serde_json::to_value(value).unwrap(), expected);
        }
    }
}

#[cfg(test)]
mod saf_root_response_tests {
    use super::{SafRootEntry, SafRootInfoResponse, saf_root_list_response};

    #[test]
    fn persisted_roots_are_explicitly_mapped_to_the_ipc_contract() {
        let response = saf_root_list_response(vec![SafRootEntry {
            uri: "content://tree/documents".to_string(),
            display_name: "Documents".to_string(),
            virtual_prefix: "/saf/Documents".to_string(),
        }]);

        assert_eq!(
            response,
            vec![SafRootInfoResponse {
                uri: "content://tree/documents".to_string(),
                display_name: "Documents".to_string(),
                virtual_prefix: "/saf/Documents".to_string(),
            }]
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!([{
                "uri": "content://tree/documents",
                "display_name": "Documents",
                "virtual_prefix": "/saf/Documents",
            }])
        );
    }

    #[test]
    fn saf_root_response_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<SafRootInfoResponse>(serde_json::json!({
                "uri": "content://tree/documents",
                "display_name": "Documents",
                "virtual_prefix": "/saf/Documents",
                "legacy_path": "/storage/emulated/0/Documents",
            }))
            .is_err()
        );
    }
}

#[cfg(target_os = "android")]
async fn load_saf_roots(pool: &meridian_core::db::DbPool) -> Result<Vec<SafRootEntry>, String> {
    let pool = pool.clone();
    let json = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| format!("db connection error: {e}"))?;
        meridian_core::db::ops::preference::get_preference(&mut conn, "android.saf_roots").map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    match json {
        Some(j) => serde_json::from_str(&j).map_err(|e| format!("corrupt saf_roots: {e}")),
        None => Ok(Vec::new()),
    }
}

#[cfg(target_os = "android")]
async fn save_saf_roots(pool: &meridian_core::db::DbPool, roots: &[SafRootEntry]) -> Result<(), String> {
    let pool = pool.clone();
    let json = serde_json::to_string(roots).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| format!("db connection error: {e}"))?;
        meridian_core::db::ops::preference::set_preference(
            &mut conn,
            "android.saf_roots",
            &json,
            meridian_core::util::now_ms(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_platform(_app: tauri::AppHandle) -> Result<PlatformInfoResponse, String> {
    PlatformInfoResponse::current()
}

#[tauri::command]
pub fn get_window_insets() -> WindowInsetsInfoResponse {
    #[cfg(target_os = "android")]
    {
        crate::android_bridge::current_insets()
    }
    #[cfg(not(target_os = "android"))]
    {
        WindowInsetsInfoResponse::default()
    }
}

/// Whether MANAGE_EXTERNAL_STORAGE ("All files access") is currently granted by the system.
#[tauri::command]
pub fn get_manage_storage_status() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        meridian_core::android_bridge::is_manage_storage_granted()
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
        meridian_core::android_bridge::open_manage_storage_settings()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("only available on Android".to_string())
    }
}

/// Show the system directory picker, persist the grant, and store the new
/// root in preferences. Returns the updated list of authorized directories.
#[tauri::command]
pub async fn pick_saf_directory(app: tauri::AppHandle) -> Result<SafRootListResponse, String> {
    #[cfg(target_os = "android")]
    {
        use crate::ServicesExt;
        let Some((uri, display_name)) = meridian_core::android_bridge::pick_directory().await? else {
            // user cancelled; return the unchanged list
            let pool = app.services().db.clone();
            return load_saf_roots(&pool).await.map(saf_root_list_response);
        };

        let pool = app.services().db.clone();
        let mut roots = load_saf_roots(&pool).await?;
        if roots.iter().any(|r| r.uri == uri) {
            return Ok(saf_root_list_response(roots));
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

        roots.push(SafRootEntry {
            uri,
            display_name,
            virtual_prefix: prefix,
        });
        save_saf_roots(&pool, &roots).await?;
        Ok(saf_root_list_response(roots))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("only available on Android".to_string())
    }
}

/// List authorized SAF directories.
#[tauri::command]
pub async fn list_saf_roots(app: tauri::AppHandle) -> Result<SafRootListResponse, String> {
    #[cfg(target_os = "android")]
    {
        use crate::ServicesExt;
        let pool = app.services().db.clone();
        load_saf_roots(&pool).await.map(saf_root_list_response)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Launch the device camera to take a photo. Returns the content:// URI of the
/// captured image, or None if the user cancelled.
#[tauri::command]
pub async fn take_photo() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        meridian_core::android_bridge::take_photo().await
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("only available on Android".to_string())
    }
}

/// Launch the system photo picker. Returns the content:// URI of the selected
/// image, or None if the user cancelled.
#[tauri::command]
pub async fn pick_gallery_image() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        meridian_core::android_bridge::pick_gallery().await
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("only available on Android".to_string())
    }
}

/// Resolve the display name of a file path or content:// URI.
/// On Android, content:// URIs are resolved via the ContentResolver.
#[tauri::command]
pub async fn resolve_file_name(path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        if path.starts_with("content://") {
            let stat = meridian_core::android_bridge::content_stat(&path).await?;
            return Ok(stat.name.unwrap_or_else(|| "file".to_string()));
        }
    }
    Ok(std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string())
}

/// Remove an authorized SAF directory and release its persisted grant.
#[tauri::command]
pub async fn remove_saf_root(app: tauri::AppHandle, uri: String) -> Result<SafRootListResponse, String> {
    #[cfg(target_os = "android")]
    {
        use crate::ServicesExt;
        let pool = app.services().db.clone();
        let mut roots = load_saf_roots(&pool).await?;
        roots.retain(|r| r.uri != uri);
        save_saf_roots(&pool, &roots).await?;
        // Best-effort: the grant may already be gone (e.g. directory deleted)
        let _ = meridian_core::android_bridge::release_persisted_uri(&uri);
        Ok(saf_root_list_response(roots))
    }
    #[cfg(not(target_os = "android"))]
    {
        let (_, _) = (app, uri);
        Err("only available on Android".to_string())
    }
}
