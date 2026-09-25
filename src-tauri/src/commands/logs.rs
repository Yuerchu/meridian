//! IPC surface for the log viewer in Settings → About.
//!
//! Thin wrappers: the reading logic lives in `logging::reader`, shared with the
//! `read_app_logs` tool so the panel and the assistant never disagree about what
//! the log says.

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::logging::{self, reader};
use meridian_core::util::now_ms;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogRecordLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl From<reader::LogRecordLevel> for LogRecordLevel {
    fn from(value: reader::LogRecordLevel) -> Self {
        match value {
            reader::LogRecordLevel::Error => Self::Error,
            reader::LogRecordLevel::Warn => Self::Warn,
            reader::LogRecordLevel::Info => Self::Info,
            reader::LogRecordLevel::Debug => Self::Debug,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogCursorRequest {
    pub file_index: usize,
    pub byte_offset: u64,
}

impl From<LogCursorRequest> for reader::Cursor {
    fn from(value: LogCursorRequest) -> Self {
        Self {
            file_index: value.file_index,
            byte_offset: value.byte_offset,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCursorInfoResponse {
    pub file_index: usize,
    pub byte_offset: u64,
}

impl From<reader::Cursor> for LogCursorInfoResponse {
    fn from(value: reader::Cursor) -> Self {
        Self {
            file_index: value.file_index,
            byte_offset: value.byte_offset,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryInfoResponse {
    pub ts: String,
    pub ts_ms: i64,
    pub level: LogRecordLevel,
    pub target: String,
    pub msg: String,
    pub fields: serde_json::Map<String, serde_json::Value>,
    pub spans: Vec<String>,
    pub span_fields: serde_json::Map<String, serde_json::Value>,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub cursor: LogCursorInfoResponse,
}

impl From<reader::LogEntry> for LogEntryInfoResponse {
    fn from(value: reader::LogEntry) -> Self {
        Self {
            ts: value.ts,
            ts_ms: value.ts_ms,
            level: value.level.into(),
            target: value.target,
            msg: value.msg,
            fields: value.fields,
            spans: value.spans,
            span_fields: value.span_fields,
            file: value.file,
            line: value.line,
            cursor: value.cursor.into(),
        }
    }
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPageResponse {
    pub entries: Vec<LogEntryInfoResponse>,
    pub next_cursor: Option<LogCursorInfoResponse>,
    pub scan_truncated: bool,
    pub files_scanned: Vec<String>,
}

impl From<reader::LogPage> for LogPageResponse {
    fn from(value: reader::LogPage) -> Self {
        Self {
            entries: value.entries.into_iter().map(Into::into).collect(),
            next_cursor: value.next_cursor.map(Into::into),
            scan_truncated: value.scan_truncated,
            files_scanned: value.files_scanned,
        }
    }
}

/// Arguments from the panel. Every field is optional so the frontend can send
/// only what the user actually chose.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogQueryRequest {
    pub min_level: Option<logging::LogLevel>,
    pub limit: Option<usize>,
    pub contains: Option<String>,
    pub target_prefix: Option<String>,
    pub conversation_id: Option<String>,
    pub since_ts_ms: Option<i64>,
    pub until_ts_ms: Option<i64>,
    pub cursor: Option<LogCursorRequest>,
}

/// Upper bound on one page. The panel caps what it renders anyway; this stops a
/// hand-crafted request from pulling the whole file into the webview.
const MAX_LIMIT: usize = 1000;
const DEFAULT_LIMIT: usize = 200;

#[tauri::command]
pub async fn read_logs(_app: tauri::AppHandle, request: LogQueryRequest) -> Result<LogPageResponse, String> {
    let Some(dir) = logging::log_dir() else {
        return Err("Logging is not available in this session.".into());
    };
    let q = reader::LogQuery {
        min_level: request.min_level,
        // domain-default: how many log lines to page back, this command's own choice
        limit: request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        contains: request.contains.filter(|s| !s.trim().is_empty()),
        target_prefix: request.target_prefix.filter(|s| !s.trim().is_empty()),
        conversation_id: request.conversation_id,
        since_ts_ms: request.since_ts_ms,
        until_ts_ms: request.until_ts_ms,
        include_rotated: true,
        cursor: request.cursor.map(Into::into),
    };
    // Reading walks the filesystem, so keep it off the async runtime's threads.
    tokio::task::spawn_blocking(move || reader::query(dir, &q))
        .await
        .map_err(|e| e.to_string())?
        .map(Into::into)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfoResponse {
    pub name: String,
    pub size: u64,
}

pub type LogFileListResponse = Vec<LogFileInfoResponse>;

#[tauri::command]
pub async fn list_log_files(_app: tauri::AppHandle) -> Result<LogFileListResponse, String> {
    let Some(dir) = logging::log_dir() else {
        return Ok(Vec::new());
    };
    tokio::task::spawn_blocking(move || {
        logging::list_files(dir)
            .into_iter()
            .map(|(name, size)| LogFileInfoResponse { name, size })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettingsResponse {
    pub level: logging::LogLevel,
    pub levels: Vec<logging::LogLevel>,
    pub directory: String,
    pub max_file_bytes: u64,
    pub max_files: usize,
    /// False when the file sink failed to start; the panel says so instead of
    /// showing an empty list that looks like "nothing has happened yet".
    pub available: bool,
}

#[tauri::command]
pub async fn get_log_settings(app: tauri::AppHandle) -> Result<LogSettingsResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let level = tokio::task::spawn_blocking(move || logging::load_saved_level(&pool))
        .await
        .map_err(|e| e.to_string())??;

    let (max_file_bytes, max_files) = logging::file_limits();
    Ok(LogSettingsResponse {
        level,
        levels: logging::selectable_levels().to_vec(),
        directory: logging::log_dir().map(|d| d.display().to_string()).unwrap_or_default(),
        max_file_bytes,
        max_files,
        available: logging::log_dir().is_some(),
    })
}

/// Change the level for this session and remember it for the next one.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogLevelUpdateRequest {
    pub level: logging::LogLevel,
}

#[tauri::command]
pub async fn set_log_level(app: tauri::AppHandle, request: LogLevelUpdateRequest) -> Result<(), String> {
    logging::set_level(request.level)?;

    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::set_preference(
            &mut conn,
            logging::LEVEL_PREFERENCE_KEY,
            request.level.as_str(),
            now_ms(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogExportRequest {
    pub output_path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExportResponse {
    pub bytes_written: u64,
}

/// Write every log file to `output_path`, oldest first.
///
/// The frontend picks the path through the dialog plugin and hands it here,
/// the same split conversation export uses — the webview has no filesystem
/// access of its own.
#[tauri::command]
pub async fn export_logs(request: LogExportRequest) -> Result<LogExportResponse, String> {
    let Some(dir) = logging::log_dir() else {
        return Err("Logging is not available in this session.".into());
    };
    let output_path = request.output_path;
    tokio::task::spawn_blocking(move || {
        logging::export_to(dir, std::path::Path::new(&output_path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|bytes_written| LogExportResponse { bytes_written })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_query_rejects_unknown_cursor_fields() {
        assert!(
            serde_json::from_value::<LogQueryRequest>(serde_json::json!({
                "cursor": { "fileIndex": 1, "byteOffset": 24, "future": true }
            }))
            .is_err()
        );
    }

    #[test]
    fn log_page_maps_every_core_field_into_the_shell_response() {
        let mut fields = serde_json::Map::new();
        fields.insert("conversation_id".into(), serde_json::json!("conversation-1"));
        let page = reader::LogPage {
            entries: vec![reader::LogEntry {
                ts: "2026-09-01T00:00:00Z".into(),
                ts_ms: 1,
                level: reader::LogRecordLevel::Warn,
                target: "meridian::test".into(),
                msg: "warning".into(),
                fields,
                spans: vec!["request".into()],
                span_fields: serde_json::Map::new(),
                file: Some("test.rs".into()),
                line: Some(42),
                cursor: reader::Cursor {
                    file_index: 2,
                    byte_offset: 64,
                },
            }],
            next_cursor: Some(reader::Cursor {
                file_index: 2,
                byte_offset: 16,
            }),
            scan_truncated: true,
            files_scanned: vec!["meridian.2.log".into()],
        };

        let response = LogPageResponse::from(page);
        assert_eq!(response.entries[0].level, LogRecordLevel::Warn);
        assert_eq!(response.entries[0].cursor.file_index, 2);
        assert_eq!(response.next_cursor.unwrap().byte_offset, 16);
        let value = serde_json::to_value(response).unwrap();
        assert!(value["entries"][0].get("fields").is_some());
        assert!(value["entries"][0].get("file").is_some());
    }
}
