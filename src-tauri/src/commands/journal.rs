//! The journal's read side: who wrote which line, what a file's history is,
//! what a version contained. All read-only and none `local` — in remote mode
//! the phone is asking about the host's attribution record, same as the
//! workspace commands beside these.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::journal::blame::BlameResult;

/// The newest blame request per file wins; the ones a viewer has already
/// flipped past are cancelled between hops. Keyed on the normalised path —
/// two windows asking about one file share a slot, and the later asker
/// cancelling the earlier is correct for both: the earlier answer would be
/// discarded by its own staleness check anyway.
fn latest() -> &'static Mutex<HashMap<String, tokio_util::sync::CancellationToken>> {
    static LATEST: OnceLock<Mutex<HashMap<String, tokio_util::sync::CancellationToken>>> = OnceLock::new();
    LATEST.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Per-line attribution for one file, computed against what is on disk now.
///
/// The disk is read through the same verified machinery the panel's viewer
/// uses; the blame walk itself never touches the working tree. `current_sha`
/// in the result is the staleness handle: re-fetch and compare.
#[tauri::command]
pub async fn journal_blame(
    app: tauri::AppHandle,
    conversation_id: String,
    rel_path: String,
) -> Result<BlameResult, String> {
    let root = super::workspace::require_root(&app, conversation_id).await?;
    let services = app.services();
    let pool = services.db.clone();
    let blob_root = meridian_core::journal::journal_root(&services.paths.data_dir);

    let cancel = tokio_util::sync::CancellationToken::new();

    tokio::task::spawn_blocking(move || {
        // Opened on the checked handle, and the *canonical* path from that
        // handle is what keys the journal — the requested spelling is not
        // what was opened, and it is not what the capture side recorded.
        let verified =
            meridian_core::tools::verified::open_read(&root.join(&rel_path), Some(&root)).map_err(|e| e.message())?;
        let (mut file, real) = verified.into_parts();
        let mut disk = String::new();
        file.read_to_string(&mut disk)
            .map_err(|e| format!("cannot read '{rel_path}': {e} (binary files have no blame)"))?;

        let norm = meridian_core::journal::norm_path(&real).ok_or("non-utf8 path: not journalled")?;

        // Register as the newest request for this file, cancelling the one it
        // supersedes. Registered *after* the file read: the read is fast and
        // a slot taken before it would hold a token for a request that may
        // yet fail its open.
        {
            let mut map = latest().lock().expect("blame token table poisoned");
            if let Some(old) = map.insert(norm.clone(), cancel.clone()) {
                old.cancel();
            }
        }

        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let result = meridian_core::journal::blame::blame(&mut conn, &blob_root, &norm, &disk, &cancel);

        // Only the current occupant clears the slot. Under the same lock the
        // insert path takes, "this token is not cancelled" proves no newer
        // request has displaced it — displacement always cancels — so the
        // entry being removed is necessarily our own.
        {
            let mut map = latest().lock().expect("blame token table poisoned");
            if !cancel.is_cancelled() {
                map.remove(&norm);
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every journalled version of one file, oldest first.
#[tauri::command]
pub async fn journal_file_history(
    app: tauri::AppHandle,
    conversation_id: String,
    rel_path: String,
) -> Result<Vec<db::models::journal::JournalVersion>, String> {
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
        db::ops::journal::chain(&mut conn, &file.id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The full content a version left behind. `404`-shaped errors rather than
/// empty strings: a deleted version has no content and a lost blob is a lost
/// blob, and the viewer says different things for the two.
#[tauri::command]
pub async fn journal_version_content(app: tauri::AppHandle, version_id: String) -> Result<String, String> {
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
        meridian_core::journal::blobs::load(&blob_root, &sha).map_err(|e| format!("snapshot unavailable: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
