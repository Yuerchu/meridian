//! The journal's read side: who wrote which line, what a file's history is,
//! what a version contained. All read-only and none `local` — in remote mode
//! the phone is asking about the host's attribution record, same as the
//! workspace commands beside these.

use std::io::Read;
use std::path::PathBuf;

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::journal::blame::BlameResult;

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
    conversation_id: String,
    rel_path: String,
) -> Result<BlameResult, String> {
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
