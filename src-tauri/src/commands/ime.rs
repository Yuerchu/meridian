//! Setting up the input method from the settings page.
//!
//! Every command here is `local`: what they configure is this machine's
//! keyboard, and on Windows half of them run a process or ask for elevation
//! on it. The configuration, dictionaries, models and memory hints are the
//! same files on both platforms; the rest is each platform's own — the TSF
//! registration and host on Windows, the keyboard's system state on Android.

use tauri::Manager;

use crate::ServicesExt;
#[cfg(target_os = "android")]
use crate::ime::android;
use crate::ime::{AppIme, archive, dictionary, hints, models};
#[cfg(windows)]
use crate::ime::{host_process, probe, registry};

#[cfg(windows)]
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
    /// Apps besides Meridian that may be shown memory hints.
    pub context_apps: Vec<String>,
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
    /// Apps besides Meridian that may be shown memory hints.
    pub context_apps: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeDictionaryInfoResponse {
    pub file: String,
    pub name: String,
    pub entries: u64,
    pub size_bytes: Option<u64>,
    pub enabled: bool,
    pub license: String,
    pub source: String,
}

pub type ImeDictionaryListResponse = Vec<ImeDictionaryInfoResponse>;

/// What the person picked: a `.dict.yaml` or a zip of them. On Android a
/// `content://` URI, copied in before it is looked at.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeDictionaryStageRequest {
    pub path: String,
}

/// A dictionary in what was picked that nothing else there imports.
#[derive(Debug, serde::Serialize)]
pub struct ImeDictionaryRootInfoResponse {
    /// Relative to what was picked; what importing names.
    pub path: String,
    /// The header's own name, if it has one.
    pub name: Option<String>,
    pub imports: u32,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeDictionaryStagedInfoResponse {
    pub staging_id: String,
    pub roots: Vec<ImeDictionaryRootInfoResponse>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeDictionaryStagedImportRequest {
    pub staging_id: String,
    /// Paths from `roots`; anything else is refused.
    pub roots: Vec<String>,
    /// SPDX identifier for all of them; `UNKNOWN` when null.
    pub license: Option<String>,
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

/// The Android keyboard as the system sees it.
#[cfg(target_os = "android")]
#[derive(Debug, serde::Serialize)]
pub struct AndroidImeStatusInfoResponse {
    /// On the system's list of enabled keyboards.
    pub enabled: bool,
    /// The keyboard text fields get now.
    pub current: bool,
    pub data_dir: String,
}

#[cfg(windows)]
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeProfileUpdateRequest {
    pub enabled: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeLmBundleInfoResponse {
    /// The directory under `models`, which is what removing names.
    pub dir_name: String,
    pub id: Option<String>,
    pub version: Option<String>,
    pub personal: bool,
    pub license: Option<String>,
    /// Why the host would refuse it; `None` when it checks out.
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeLmStatusInfoResponse {
    pub dir: String,
    /// The bundle the host uses, by directory name.
    pub active: Option<String>,
    /// ONNX Runtime is where the host looks for it.
    pub runtime_found: bool,
    pub bundles: Vec<ImeLmBundleInfoResponse>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeLmImportRequest {
    /// A directory holding a bundle.
    pub path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImeLmRemoveRequest {
    pub dir_name: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ImeMemoryHintsInfoResponse {
    /// Phrases written.
    pub count: u32,
    pub path: String,
}

fn scheme_str(s: meridian_ime_config::Scheme) -> &'static str {
    match s {
        meridian_ime_config::Scheme::Pinyin => "pinyin",
        meridian_ime_config::Scheme::Zhuyin => "zhuyin",
        meridian_ime_config::Scheme::Grid => "grid",
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
            context_apps: c.context_apps,
        }
    }
}

impl TryFrom<ImeConfigUpdateRequest> for meridian_ime_config::HostConfig {
    type Error = String;

    fn try_from(r: ImeConfigUpdateRequest) -> Result<Self, String> {
        let scheme = match r.scheme.as_str() {
            "pinyin" => meridian_ime_config::Scheme::Pinyin,
            "zhuyin" => meridian_ime_config::Scheme::Zhuyin,
            "grid" => meridian_ime_config::Scheme::Grid,
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
            context_apps: r.context_apps,
        }
        .normalized())
    }
}

async fn bridge(app: &tauri::AppHandle) -> crate::ime::ImeBridge {
    app.state::<AppIme>().bridge.lock().await.clone()
}

#[cfg(windows)]
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

#[cfg(windows)]
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

fn report_into(report: meridian_ime_dict::rime::ImportReport) -> ImeDictionaryImportReportResponse {
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
    ImeDictionaryImportReportResponse {
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
    }
}

/// Where picks are copied and archives unpacked, under the input method's
/// own directory so nothing of it lands in the app's shared cache.
fn scratch_root(dirs: &meridian_ime_config::ImeDirs) -> std::path::PathBuf {
    dirs.root.join("import-staging")
}

/// The picked file as a path this process can open, and a directory of ours
/// holding it when it had to be copied (Android's `content://`).
async fn local_copy(
    path: &str,
    scratch: &std::path::Path,
    id: &str,
) -> Result<(std::path::PathBuf, Option<std::path::PathBuf>), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let dir = scratch.join(format!("{id}-picked"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Named as a dictionary so a single file keeps a sensible stem; a zip
        // is recognised by its first bytes, not its name.
        let dest = dir.join("picked.dict.yaml");
        meridian_core::android_bridge::content_copy(path, &dest.to_string_lossy()).await?;
        return Ok((dest, Some(dir)));
    }
    let _ = (scratch, id);
    Ok((std::path::PathBuf::from(path), None))
}

/// Looks at what was picked and lists the dictionaries in it that can be
/// imported. Replaces whatever the previous pick staged.
#[tauri::command]
pub async fn stage_ime_dictionary(
    app: tauri::AppHandle,
    request: ImeDictionaryStageRequest,
) -> Result<ImeDictionaryStagedInfoResponse, String> {
    let dirs = bridge(&app).await.dirs;
    let scratch = scratch_root(&dirs);
    let id = uuid::Uuid::new_v4().to_string();
    let (picked, copy_dir) = local_copy(&request.path, &scratch, &id).await?;
    let staged = {
        let (picked, scratch, id) = (picked.clone(), scratch.clone(), id.clone());
        tokio::task::spawn_blocking(move || archive::stage(&picked, &scratch, id))
            .await
            .map_err(|e| e.to_string())?
    };
    let staged = match (staged, copy_dir) {
        // A zip was unpacked into a directory of its own; the copy can go.
        (Ok(staged), Some(copy)) if staged.scratch.is_some() => {
            let _ = std::fs::remove_dir_all(copy);
            staged
        }
        // A single file copied in is imported from the copy, which goes with it.
        (Ok(mut staged), Some(copy)) => {
            staged.scratch = Some(copy);
            staged
        }
        (Ok(staged), None) => staged,
        (Err(e), copy) => {
            if let Some(copy) = copy {
                let _ = std::fs::remove_dir_all(copy);
            }
            return Err(e);
        }
    };
    let response = ImeDictionaryStagedInfoResponse {
        staging_id: staged.id.clone(),
        roots: staged
            .roots
            .iter()
            .map(|r| ImeDictionaryRootInfoResponse {
                path: r.path.clone(),
                name: r.name.clone(),
                imports: r.imports as u32,
            })
            .collect(),
    };
    let ime = app.state::<AppIme>();
    if let Some(old) = ime.staged.lock().await.replace(staged) {
        old.cleanup();
    }
    Ok(response)
}

/// Imports the chosen roots of the last pick, each into its own `.mdict`,
/// and clears the staging.
#[tauri::command]
pub async fn import_staged_ime_dictionaries(
    app: tauri::AppHandle,
    request: ImeDictionaryStagedImportRequest,
) -> Result<Vec<ImeDictionaryImportReportResponse>, String> {
    if request.roots.is_empty() {
        return Err("choose at least one dictionary".into());
    }
    let dirs = bridge(&app).await.dirs;
    let ime = app.state::<AppIme>();
    let staged = {
        let mut slot = ime.staged.lock().await;
        match slot.as_ref() {
            Some(s) if s.id == request.staging_id => slot.take().expect("checked above"),
            _ => return Err("that pick is no longer staged; pick the file again".into()),
        }
    };
    tokio::task::spawn_blocking(move || {
        let result = request
            .roots
            .iter()
            .map(|root| {
                let path = archive::root_path(&staged, root)?;
                dictionary::import(&dirs, &path, request.license.clone(), None).map(report_into)
            })
            .collect::<Result<Vec<_>, String>>();
        staged.cleanup();
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Downloads rime-ice from GitHub and imports its Chinese root, on the
/// person's request: dictionaries are imported, never shipped.
#[tauri::command]
pub async fn download_ime_rime_ice(app: tauri::AppHandle) -> Result<ImeDictionaryImportReportResponse, String> {
    let dirs = bridge(&app).await.dirs;
    let scratch = scratch_root(&dirs);
    std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let zip = scratch.join(format!("{id}.zip"));
    if let Err(e) = archive::download(archive::RIME_ICE_URL, &zip).await {
        let _ = std::fs::remove_file(&zip);
        return Err(e);
    }
    tokio::task::spawn_blocking(move || {
        let staged = archive::stage(&zip, &scratch, id);
        let _ = std::fs::remove_file(&zip);
        let staged = staged?;
        let result = archive::root_path(&staged, archive::RIME_ICE_ROOT).and_then(|path| {
            dictionary::import(&dirs, &path, Some(archive::RIME_ICE_LICENSE.into()), None).map(report_into)
        });
        staged.cleanup();
        result
    })
    .await
    .map_err(|e| e.to_string())?
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

#[cfg(windows)]
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

#[cfg(windows)]
#[tauri::command]
pub async fn stop_ime_host(app: tauri::AppHandle) -> Result<ImeStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(probe::shutdown).await.expect("stop task");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    Ok(status_of(bridge).await)
}

/// Per-user enable/disable of the profiles; no elevation.
#[cfg(windows)]
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
#[cfg(windows)]
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

/// Where ONNX Runtime is: beside the host on Windows; on Android it is the
/// `libonnxruntime.so` sherpa-onnx puts in the APK, loaded by name.
#[cfg(windows)]
fn runtime_found(bridge: &crate::ime::ImeBridge) -> bool {
    models::runtime_found(bridge.host_exe.as_deref())
}

#[cfg(target_os = "android")]
fn runtime_found(_bridge: &crate::ime::ImeBridge) -> bool {
    true
}

fn lm_status_of(bridge: &crate::ime::ImeBridge) -> ImeLmStatusInfoResponse {
    let s = models::status(&bridge.dirs);
    ImeLmStatusInfoResponse {
        dir: s.dir.to_string_lossy().into_owned(),
        active: s.active,
        runtime_found: runtime_found(bridge),
        bundles: s
            .bundles
            .into_iter()
            .map(|b| ImeLmBundleInfoResponse {
                dir_name: b.dir_name,
                id: b.id,
                version: b.version,
                personal: b.personal,
                license: b.license,
                error: b.error,
            })
            .collect(),
    }
}

/// Installed language model bundles and which one the host uses.
#[tauri::command]
pub async fn get_ime_lm_status(app: tauri::AppHandle) -> Result<ImeLmStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(move || Ok(lm_status_of(&bridge)))
        .await
        .map_err(|e| e.to_string())?
}

/// Installs the bundle in a directory; the host picks it up by itself.
#[tauri::command]
pub async fn import_ime_lm(
    app: tauri::AppHandle,
    request: ImeLmImportRequest,
) -> Result<ImeLmStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(move || {
        models::import(&bridge.dirs, std::path::Path::new(&request.path))?;
        Ok(lm_status_of(&bridge))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_ime_lm(
    app: tauri::AppHandle,
    request: ImeLmRemoveRequest,
) -> Result<ImeLmStatusInfoResponse, String> {
    let bridge = bridge(&app).await;
    tokio::task::spawn_blocking(move || {
        models::remove(&bridge.dirs, &request.dir_name)?;
        Ok(lm_status_of(&bridge))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Recomputes and writes the memory hints now, rather than at the next
/// minute. The file is written even when nothing changed.
#[tauri::command]
pub async fn refresh_ime_memory_hints(app: tauri::AppHandle) -> Result<ImeMemoryHintsInfoResponse, String> {
    let bridge = bridge(&app).await;
    let services = app.services();
    tokio::task::spawn_blocking(move || {
        let found = hints::compute(&services)?;
        let count = found.len() as u32;
        hints::write_if_changed(&bridge.dirs, found, &mut None)?;
        Ok(ImeMemoryHintsInfoResponse {
            count,
            path: bridge.dirs.hints_file().to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn get_android_ime_status(app: tauri::AppHandle) -> Result<AndroidImeStatusInfoResponse, String> {
    let data_dir = bridge(&app).await.dirs.root.to_string_lossy().into_owned();
    tokio::task::spawn_blocking(move || {
        Ok(AndroidImeStatusInfoResponse {
            enabled: android::is_enabled()?,
            current: android::is_current()?,
            data_dir,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The system's keyboard settings, where the keyboard is switched on.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn open_android_ime_settings() -> Result<(), String> {
    tokio::task::spawn_blocking(android::open_settings)
        .await
        .map_err(|e| e.to_string())?
}

/// The system's keyboard picker, where it is chosen.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn show_android_ime_picker() -> Result<(), String> {
    tokio::task::spawn_blocking(android::show_picker)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn config_request_is_a_closed_object_with_checked_values() {
        let good = json!({
            "scheme": "pinyin", "page_size": 5, "punctuation": "full_width",
            "learning": true, "private_apps": ["KeePass.exe"], "debug_log": false,
            "context_apps": [" Notepad.exe "]
        });
        let r: ImeConfigUpdateRequest = serde_json::from_value(good.clone()).unwrap();
        let cfg = meridian_ime_config::HostConfig::try_from(r).unwrap();
        assert_eq!(cfg.private_apps, vec!["keepass.exe"]);
        assert_eq!(cfg.context_apps, vec!["notepad.exe"]);

        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("context_apps");
        assert!(
            serde_json::from_value::<ImeConfigUpdateRequest>(missing).is_err(),
            "omitting a field is not a way to say empty"
        );

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
