//! Setting up the input method from the settings page.
//!
//! Every command here is `local`: what they configure is this machine's
//! keyboard, and half of them run a process or ask for elevation on it.

use tauri::Manager;

use crate::ime::{AppIme, dictionary, host_process, probe, registry};

#[derive(Debug, serde::Serialize)]
pub struct ImeStatusInfoResponse {
    /// The DLL and the host were found beside the app.
    pub installed: bool,
    pub registered_x64: bool,
    pub registered_x86: bool,
    /// The profile is switched on for the current user (per-user, no elevation).
    pub enabled_for_user: bool,
    pub host_running: bool,
    pub host_version: Option<String>,
    /// The running host speaks this build's protocol.
    pub protocol_compatible: bool,
    pub sessions: u32,
    pub data_dir: String,
    pub host_path: Option<String>,
    pub dll_path: Option<String>,
    /// What the registry points the 64-bit registration at, if anything.
    pub registered_dll_path: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeConfigInfoResponse {
    pub scheme: String,
    pub page_size: u8,
    pub punctuation: String,
    pub learning: bool,
    pub private_apps: Vec<String>,
    pub debug_log: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeConfigUpdateRequest {
    pub scheme: String,
    pub page_size: u8,
    pub punctuation: String,
    pub learning: bool,
    pub private_apps: Vec<String>,
    pub debug_log: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeDictionaryInfoResponse {
    pub file: String,
    pub name: String,
    pub entries: u64,
    pub size_bytes: u64,
    pub enabled: bool,
    pub license: String,
    pub source: String,
}

pub type ImeDictionaryListResponse = Vec<ImeDictionaryInfoResponse>;

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeDictionaryImportRequest {
    pub path: String,
    pub license: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeDictionaryImportReportResponse {
    pub file: String,
    pub name: String,
    pub accepted: u64,
    pub duplicates: u64,
    pub skipped: u64,
    pub cache_hit: bool,
    /// One line per file with something to say, for the panel.
    pub notes: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeDictionaryToggleRequest {
    pub file: String,
    pub enabled: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeDictionaryRemoveRequest {
    pub file: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeProfileUpdateRequest {
    pub enabled: bool,
}

fn scheme_str(s: meridian_ime_config::Scheme) -> &'static str {
    match s {
        meridian_ime_config::Scheme::Pinyin => "pinyin",
        meridian_ime_config::Scheme::Zhuyin => "zhuyin",
    }
}

fn punctuation_str(p: meridian_ime_config::Punctuation) -> &'static str {
    match p {
        meridian_ime_config::Punctuation::FullWidth => "full_width",
        meridian_ime_config::Punctuation::HalfWidth => "half_width",
    }
}

impl From<meridian_ime_config::HostConfig> for ImeConfigInfoResponse {
    fn from(c: meridian_ime_config::HostConfig) -> Self {
        Self {
            scheme: scheme_str(c.scheme).into(),
            page_size: c.page_size,
            punctuation: punctuation_str(c.punctuation).into(),
            learning: c.learning,
            private_apps: c.private_apps,
            debug_log: c.debug_log,
        }
    }
}

impl TryFrom<ImeConfigUpdateRequest> for meridian_ime_config::HostConfig {
    type Error = String;

    fn try_from(r: ImeConfigUpdateRequest) -> Result<Self, String> {
        let scheme = match r.scheme.as_str() {
            "pinyin" => meridian_ime_config::Scheme::Pinyin,
            "zhuyin" => meridian_ime_config::Scheme::Zhuyin,
            other => return Err(format!("unknown scheme {other:?}")),
        };
        let punctuation = match r.punctuation.as_str() {
            "full_width" => meridian_ime_config::Punctuation::FullWidth,
            "half_width" => meridian_ime_config::Punctuation::HalfWidth,
            other => return Err(format!("unknown punctuation policy {other:?}")),
        };
        if !(meridian_ime_config::MIN_PAGE_SIZE..=meridian_ime_config::MAX_PAGE_SIZE).contains(&r.page_size) {
            return Err(format!(
                "page size must be {}..={}",
                meridian_ime_config::MIN_PAGE_SIZE,
                meridian_ime_config::MAX_PAGE_SIZE
            ));
        }
        Ok(Self {
            version: meridian_ime_config::CONFIG_VERSION,
            scheme,
            page_size: r.page_size,
            punctuation,
            learning: r.learning,
            private_apps: r.private_apps,
            debug_log: r.debug_log,
        }
        .normalized())
    }
}

async fn bridge(app: &tauri::AppHandle) -> crate::ime::ImeBridge {
    app.state::<AppIme>().0.lock().await.clone()
}

async fn status_of(bridge: crate::ime::ImeBridge) -> ImeStatusInfoResponse {
    tokio::task::spawn_blocking(move || {
        let host = probe::status();
        ImeStatusInfoResponse {
            installed: bridge.host_exe.is_some() && bridge.dll_x64.is_some(),
            registered_x64: registry::is_registered_x64(),
            registered_x86: registry::is_registered_x86(),
            enabled_for_user: registry::is_enabled_for_user(),
            host_running: host.is_some(),
            host_version: host.as_ref().map(|h| h.version.clone()).filter(|v| !v.is_empty()),
            protocol_compatible: host
                .as_ref()
                .is_some_and(|h| h.protocol == meridian_ime_proto::PROTOCOL_VERSION),
            sessions: host.as_ref().map(|h| h.sessions).unwrap_or(0),
            data_dir: bridge.dirs.root.to_string_lossy().into_owned(),
            host_path: bridge.host_exe.as_ref().map(|p| p.to_string_lossy().into_owned()),
            dll_path: bridge.dll_x64.as_ref().map(|p| p.to_string_lossy().into_owned()),
            registered_dll_path: registry::registered_dll_x64(),
        }
    })
    .await
    .expect("status task")
}

#[tauri::command]
pub async fn get_ime_status(app: tauri::AppHandle) -> Result<ImeStatusInfoResponse, String> {
    Ok(status_of(bridge(&app).await).await)
}

#[tauri::command]
pub async fn get_ime_config(app: tauri::AppHandle) -> Result<ImeConfigInfoResponse, String> {
    let bridge = bridge(&app).await;
    meridian_ime_config::load(&bridge.dirs.root)
        .map(Into::into)
        .map_err(|e| e.to_string())
}

/// Writes `host.json`; the host reloads it within a second.
#[tauri::command]
pub async fn save_ime_config(
    app: tauri::AppHandle,
    request: ImeConfigUpdateRequest,
) -> Result<ImeConfigInfoResponse, String> {
    let bridge = bridge(&app).await;
    let config = meridian_ime_config::HostConfig::try_from(request)?;
    meridian_ime_config::save(&bridge.dirs.root, &config).map_err(|e| e.to_string())?;
    Ok(config.into())
}

#[tauri::command]
pub async fn list_ime_dictionaries(app: tauri::AppHandle) -> Result<ImeDictionaryListResponse, String> {
    let bridge = bridge(&app).await;
    let list = tokio::task::spawn_blocking(move || dictionary::list(&bridge.dirs))
        .await
        .expect("list task")?;
    Ok(list.into_iter().map(summary_into).collect())
}

fn summary_into(s: dictionary::DictionarySummary) -> ImeDictionaryInfoResponse {
    ImeDictionaryInfoResponse {
        file: s.file,
        name: s.name,
        entries: s.entries,
        size_bytes: s.size_bytes,
        enabled: s.enabled,
        license: s.license,
        source: s.source,
    }
}

#[tauri::command]
pub async fn import_ime_dictionary(
    app: tauri::AppHandle,
    request: ImeDictionaryImportRequest,
) -> Result<ImeDictionaryImportReportResponse, String> {
    let bridge = bridge(&app).await;
    let path = std::path::PathBuf::from(request.path);
    let report =
        tokio::task::spawn_blocking(move || dictionary::import(&bridge.dirs, &path, request.license, request.name))
            .await
            .expect("import task")?;
    let mut notes = Vec::new();
    for f in &report.files {
        let name = f
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        match &f.reason {
            Some(reason) => notes.push(format!("{name}: skipped ({reason}), {} rows", f.rows)),
            None if f.skipped.total() > 0 => notes.push(format!(
                "{name}: {} accepted, {} skipped",
                f.accepted,
                f.skipped.total()
            )),
            None => {}
        }
    }
    Ok(ImeDictionaryImportReportResponse {
        file: report
            .output
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        name: report.name.clone(),
        accepted: report.accepted,
        duplicates: report.duplicates,
        skipped: report.skipped.total(),
        cache_hit: report.cache_hit,
        notes,
    })
}

#[tauri::command]
pub async fn set_ime_dictionary_enabled(
    app: tauri::AppHandle,
    request: ImeDictionaryToggleRequest,
) -> Result<ImeDictionaryListResponse, String> {
    let bridge = bridge(&app).await;
    let list = tokio::task::spawn_blocking(move || {
        dictionary::set_enabled(&bridge.dirs, &request.file, request.enabled)?;
        dictionary::list(&bridge.dirs)
    })
    .await
    .expect("toggle task")?;
    Ok(list.into_iter().map(summary_into).collect())
}

#[tauri::command]
pub async fn remove_ime_dictionary(
    app: tauri::AppHandle,
    request: ImeDictionaryRemoveRequest,
) -> Result<ImeDictionaryListResponse, String> {
    let bridge = bridge(&app).await;
    let list = tokio::task::spawn_blocking(move || {
        dictionary::remove(&bridge.dirs, &request.file)?;
        dictionary::list(&bridge.dirs)
    })
    .await
    .expect("remove task")?;
    Ok(list.into_iter().map(summary_into).collect())
}

#[tauri::command]
pub async fn start_ime_host(app: tauri::AppHandle) -> Result<ImeStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        if probe::status().is_some() {
            return Ok(());
        }
        host_process::start(&b)
    })
    .await
    .expect("start task")?;
    // Give it a moment to bind before the status probe.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    Ok(status_of(bridge).await)
}

#[tauri::command]
pub async fn stop_ime_host(app: tauri::AppHandle) -> Result<ImeStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(probe::shutdown).await.expect("stop task");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    Ok(status_of(bridge).await)
}

/// Per-user enable/disable of the profiles; no elevation.
#[tauri::command]
pub async fn set_ime_profile_enabled(
    app: tauri::AppHandle,
    request: ImeProfileUpdateRequest,
) -> Result<ImeStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(move || registry::set_enabled_for_user(request.enabled))
        .await
        .expect("profile task")?;
    Ok(status_of(bridge).await)
}

/// `regsvr32` elevated: one UAC prompt, then the status again.
#[tauri::command]
pub async fn register_ime(app: tauri::AppHandle) -> Result<ImeStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || host_process::register(&b))
        .await
        .expect("register task")?;
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        if registry::is_registered_x64() && probe::status().is_none() {
            let _ = host_process::start(&b);
        }
    })
    .await
    .expect("post-register task");
    Ok(status_of(bridge).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn config_request_is_a_closed_object_with_checked_values() {
        let good = json!({
            "scheme": "pinyin", "page_size": 5, "punctuation": "full_width",
            "learning": true, "private_apps": ["KeePass.exe"], "debug_log": false
        });
        let r: ImeConfigUpdateRequest = serde_json::from_value(good.clone()).unwrap();
        let cfg = meridian_ime_config::HostConfig::try_from(r).unwrap();
        assert_eq!(cfg.private_apps, vec!["keepass.exe"]);

        let mut unknown = good.clone();
        unknown["extra"] = json!(1);
        assert!(serde_json::from_value::<ImeConfigUpdateRequest>(unknown).is_err());

        let mut bad = good.clone();
        bad["scheme"] = json!("wubi");
        let r: ImeConfigUpdateRequest = serde_json::from_value(bad).unwrap();
        assert!(meridian_ime_config::HostConfig::try_from(r).is_err());

        let mut bad = good;
        bad["page_size"] = json!(40);
        let r: ImeConfigUpdateRequest = serde_json::from_value(bad).unwrap();
        assert!(meridian_ime_config::HostConfig::try_from(r).is_err());
    }
}
