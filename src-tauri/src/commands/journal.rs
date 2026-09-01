//! The journal's read side: who wrote which line, what a file's history is,
//! what a version contained. All read-only and none `local` — in remote mode
//! the phone is asking about the host's attribution record, same as the
//! workspace commands beside these.

use std::io::Read;
use std::path::PathBuf;

use crate::ServicesExt;
use crate::commands::entity_response::JournalVersionListResponse;
use meridian_core::db;
use meridian_core::journal::blame::{BlameKind, BlameResult, BlameSpan};
use meridian_core::turn::TurnOrigin;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalBlameRequest {
    conversation_id: String,
    rel_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalFileHistoryRequest {
    conversation_id: String,
    rel_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalVersionContentRequest {
    version_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalBlameKind {
    Conversation,
    Inferred,
    External,
    Preexisting,
}

impl From<BlameKind> for JournalBlameKind {
    fn from(value: BlameKind) -> Self {
        match value {
            BlameKind::Conversation => Self::Conversation,
            BlameKind::Inferred => Self::Inferred,
            BlameKind::External => Self::External,
            BlameKind::Preexisting => Self::Preexisting,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct JournalBlameSpanInfoResponse {
    pub start_line: u32,
    pub end_line: u32,
    pub kind: JournalBlameKind,
    pub conversation_id: Option<String>,
    pub turn_id: Option<String>,
    pub origin: Option<TurnOrigin>,
    pub model_id: Option<String>,
    pub tool_name: Option<String>,
    pub timestamp: Option<i64>,
}

impl From<BlameSpan> for JournalBlameSpanInfoResponse {
    fn from(value: BlameSpan) -> Self {
        Self {
            start_line: value.start_line,
            end_line: value.end_line,
            kind: value.kind.into(),
            conversation_id: value.conversation_id,
            turn_id: value.turn_id,
            origin: value.origin,
            model_id: value.model_id,
            tool_name: value.tool_name,
            timestamp: value.timestamp,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct JournalBlameResponse {
    pub current_sha: String,
    pub head_sha: Option<String>,
    pub truncated: bool,
    pub spans: Vec<JournalBlameSpanInfoResponse>,
}

impl From<BlameResult> for JournalBlameResponse {
    fn from(value: BlameResult) -> Self {
        Self {
            current_sha: value.current_sha,
            head_sha: value.head_sha,
            truncated: value.truncated,
            spans: value.spans.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct JournalVersionContentResponse {
    pub content: String,
}

/// Nothing past the journal's own snapshot cap has a chain to blame — the
/// capture side skipped it — so reading more than this buys memory pressure
/// on a remote-reachable command and no answer.
const MAX_BLAME_BYTES: u64 = meridian_core::journal::capture::MAX_SNAPSHOT_BYTES as u64;

/// Per-line attribution for one file, computed against what is on disk now.
///
/// The disk is read through the same verified machinery the panel's viewer
/// uses; the blame walk itself never touches the working tree. `current_sha`
/// in the result is the staleness handle: re-fetch and compare.
///
/// No cross-request cancellation. The work is bounded (short chains, the byte
/// cap above), and a slot keyed by path — the obvious design — turns out to
/// cancel exactly the wrong thing: a viewer flipping through files asks about
/// *different* paths, which never collide, while two windows showing one file
/// collide and error each other for no reason. The frontend discards stale
/// answers by request order instead.
#[tauri::command]
pub async fn journal_blame(
    app: tauri::AppHandle,
    request: JournalBlameRequest,
) -> Result<JournalBlameResponse, String> {
    let JournalBlameRequest {
        conversation_id,
        rel_path,
    } = request;
    let root = super::workspace::require_root(&app, conversation_id).await?;
    let services = app.services();
    let pool = services.db.clone();
    let blob_root = meridian_core::journal::journal_root(&services.paths.data_dir);

    tokio::task::spawn_blocking(move || {
        // Opened on the checked handle, and the *canonical* path from that
        // handle is what keys the journal — the requested spelling is not
        // what was opened, and it is not what the capture side recorded.
        let verified =
            meridian_core::tools::verified::open_read(&root.join(&rel_path), Some(&root)).map_err(|e| e.message())?;
        let (mut file, real) = verified.into_parts();
        if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BLAME_BYTES {
            return Err(format!(
                "'{rel_path}' is larger than the journal snapshots, so it has no blame"
            ));
        }
        let mut disk = String::new();
        // The cap again on the handle itself: the metadata answered about a
        // moment ago, the take answers about this read.
        std::io::Read::take(&mut file, MAX_BLAME_BYTES + 1)
            .read_to_string(&mut disk)
            .map_err(|e| format!("cannot read '{rel_path}': {e} (binary files have no blame)"))?;
        if disk.len() as u64 > MAX_BLAME_BYTES {
            return Err(format!(
                "'{rel_path}' is larger than the journal snapshots, so it has no blame"
            ));
        }

        let norm = meridian_core::journal::norm_path(&real).ok_or("non-utf8 path: not journalled")?;
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let cancel = tokio_util::sync::CancellationToken::new();
        meridian_core::journal::blame::blame(&mut conn, &blob_root, &norm, &disk, &cancel)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(Into::into)
}

/// Every journalled version of one file, oldest first.
#[tauri::command]
pub async fn journal_file_history(
    app: tauri::AppHandle,
    request: JournalFileHistoryRequest,
) -> Result<JournalVersionListResponse, String> {
    let JournalFileHistoryRequest {
        conversation_id,
        rel_path,
    } = request;
    let root = super::workspace::require_root(&app, conversation_id).await?;
    let services = app.services();
    let pool = services.db.clone();

    tokio::task::spawn_blocking(move || {
        let resolved =
            meridian_core::tools::verified::verify_path(&root.join(&rel_path), Some(&root)).map_err(|e| e.message())?;
        let norm = meridian_core::journal::norm_path(&resolved).ok_or("non-utf8 path: not journalled")?;
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let Some(file) = db::ops::journal::file_by_path(&mut conn, &norm).map_err(|e| e.to_string())? else {
            return Ok(Vec::new());
        };
        db::ops::journal::chain(&mut conn, &file.id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(TryInto::try_into)
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The full content a version left behind. `404`-shaped errors rather than
/// empty strings: a deleted version has no content and a lost blob is a lost
/// blob, and the viewer says different things for the two.
#[tauri::command]
pub async fn journal_version_content(
    app: tauri::AppHandle,
    request: JournalVersionContentRequest,
) -> Result<JournalVersionContentResponse, String> {
    let version_id = request.version_id;
    let services = app.services();
    let pool = services.db.clone();
    let blob_root: PathBuf = meridian_core::journal::journal_root(&services.paths.data_dir);

    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let version = db::ops::journal::version_by_id(&mut conn, &version_id)
            .map_err(|e| e.to_string())?
            .ok_or("no such version")?;
        let sha = version
            .new_sha
            .ok_or("this version is a deletion; it left no content")?;
        meridian_core::journal::blobs::load(&blob_root, &sha)
            .map(|content| JournalVersionContentResponse { content })
            .map_err(|e| format!("snapshot unavailable: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_blame_request_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<JournalBlameRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "relPath": "src/main.rs",
                "future": true
            }))
            .is_err()
        );
    }

    #[test]
    fn journal_blame_maps_the_core_result_explicitly() {
        let response = JournalBlameResponse::from(BlameResult {
            current_sha: "current".into(),
            head_sha: Some("head".into()),
            truncated: true,
            spans: vec![BlameSpan {
                start_line: 1,
                end_line: 2,
                kind: BlameKind::Inferred,
                conversation_id: Some("conversation-1".into()),
                turn_id: None,
                origin: None,
                model_id: None,
                tool_name: Some("run_command".into()),
                timestamp: Some(42),
            }],
        });

        assert_eq!(response.spans[0].kind, JournalBlameKind::Inferred);
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["spans"][0]["kind"], "inferred");
        assert_eq!(value["spans"][0]["tool_name"], "run_command");
    }
}
