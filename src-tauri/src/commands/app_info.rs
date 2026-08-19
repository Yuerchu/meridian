//! What Settings → About shows about the machine it is running on.
//!
//! The version used to be read straight from `@tauri-apps/api/app` in the
//! panel, which is a call the shell answers and a remote client cannot make —
//! so the phone showed a blank version. Everything here goes through the one
//! command table instead, and a remote session reports the *host*, which is
//! what runs the turns and owns the files these paths point at.

use crate::ServicesExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    /// `windows` / `macos` / `linux` / `android`, as `std::env::consts` spells
    /// them. `get_platform` answers the same question for layout decisions;
    /// this is here so the whole block is one round trip.
    pub os: String,
    pub arch: String,
    /// Where everything this app owns lives. Not the log directory, which sits
    /// inside it and which `get_log_settings` already reports to the panel that
    /// needs it.
    pub data_dir: String,
}

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let services = app.services();
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: services.paths.data_dir.display().to_string(),
    })
}
