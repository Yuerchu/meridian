//! IPC surface for the log viewer in Settings → About.
//!
//! Thin wrappers: the reading logic lives in `logging::reader`, shared with the
//! `read_app_logs` tool so the panel and the assistant never disagree about what
//! the log says.

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::logging::{self, reader};
use meridian_core::util::now_ms;

/// Arguments from the panel. Every field is optional so the frontend can send
/// only what the user actually chose.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQueryInput {
    pub min_level: Option<String>,
    pub limit: Option<usize>,
    pub contains: Option<String>,
    pub target_prefix: Option<String>,
    pub conversation_id: Option<String>,
    pub since_ts_ms: Option<i64>,
    pub until_ts_ms: Option<i64>,
    pub cursor: Option<reader::Cursor>,
}

/// Upper bound on one page. The panel caps what it renders anyway; this stops a
/// hand-crafted request from pulling the whole file into the webview.
const MAX_LIMIT: usize = 1000;
const DEFAULT_LIMIT: usize = 200;

#[tauri::command]
pub async fn read_logs(_app: tauri::AppHandle, query: LogQueryInput) -> Result<reader::LogPage, String> {
    let Some(dir) = logging::log_dir() else {
        return Err("Logging is not available in this session.".into());
    };
    let q = reader::LogQuery {
        min_level: query.min_level,
        limit: query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        contains: query.contains.filter(|s| !s.trim().is_empty()),
        target_prefix: query.target_prefix.filter(|s| !s.trim().is_empty()),
        conversation_id: query.conversation_id,
        since_ts_ms: query.since_ts_ms,
        until_ts_ms: query.until_ts_ms,
        include_rotated: true,
        cursor: query.cursor,
    };
    // Reading walks the filesystem, so keep it off the async runtime's threads.
    tokio::task::spawn_blocking(move || reader::query(dir, &q))
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub name: String,
    pub size: u64,
}

#[tauri::command]
pub async fn list_log_files(_app: tauri::AppHandle) -> Result<Vec<LogFileInfo>, String> {
    let Some(dir) = logging::log_dir() else {
        return Ok(Vec::new());
    };
    tokio::task::spawn_blocking(move || {
        logging::list_files(dir)
            .into_iter()
            .map(|(name, size)| LogFileInfo { name, size })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettings {
    pub level: String,
    pub levels: Vec<String>,
    pub directory: String,
    pub max_file_bytes: u64,
    pub max_files: usize,
    /// False when the file sink failed to start; the panel says so instead of
    /// showing an empty list that looks like "nothing has happened yet".
    pub available: bool,
}

#[tauri::command]
pub async fn get_log_settings(app: tauri::AppHandle) -> Result<LogSettings, String> {
    let services = app.services();
    let pool = services.db.clone();
    let level = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        db::ops::preference::get_preference(&mut conn, logging::LEVEL_PREFERENCE_KEY)
            .ok()
            .flatten()
    })
    .await
    .map_err(|e| e.to_string())?
    .unwrap_or_else(|| logging::default_level().to_string());

    let (max_file_bytes, max_files) = logging::file_limits();
    Ok(LogSettings {
        level,
        levels: logging::selectable_levels().iter().map(|l| (*l).to_string()).collect(),
        directory: logging::log_dir().map(|d| d.display().to_string()).unwrap_or_default(),
        max_file_bytes,
        max_files,
        available: logging::log_dir().is_some(),
    })
}

/// Change the level for this session and remember it for the next one.
#[tauri::command]
pub async fn set_log_level(app: tauri::AppHandle, level: String) -> Result<(), String> {
    logging::set_level(&level)?;

    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::set_preference(&mut conn, logging::LEVEL_PREFERENCE_KEY, &level, now_ms())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write every log file to `output_path`, oldest first.
///
/// The frontend picks the path through the dialog plugin and hands it here,
/// the same split conversation export uses — the webview has no filesystem
/// access of its own.
#[tauri::command]
pub async fn export_logs(output_path: String) -> Result<u64, String> {
    let Some(dir) = logging::log_dir() else {
        return Err("Logging is not available in this session.".into());
    };
    tokio::task::spawn_blocking(move || {
        logging::export_to(dir, std::path::Path::new(&output_path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
