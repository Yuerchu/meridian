//! The shadow file journal: who changed which file, recorded outside git.
//!
//! Modelled on Claude Code's file-history — a local sidecar store the
//! repository never sees — and grown into an attribution record: every capture
//! path appends `(observed old, new, who)` to a per-file version chain, and
//! blame walks the chain to say which conversation wrote which line. The two
//! disciplines everything here serves:
//!
//! - **Never misattribute.** A change the journal did not see becomes an
//!   `external` version with no conversation on it, inserted by the append
//!   itself whenever the observed old content does not match the chain head.
//!   Every failure direction is "attribute less", never "attribute wrong".
//! - **The repository stays clean.** No trailers, no notes, nothing on disk
//!   inside the project. The journal lives under `{app_data_dir}/file-journal/`
//!   and outlives conversations — deleting a chat must not unwrite who made a
//!   change, so cleanup is its own, explicit operation.
//!
//! Blob storage copies the voice corpus shape (content-addressed, bytes before
//! rows, staging + atomic rename) minus the fencing — see `blobs.rs` for why
//! content addressing makes fencing unnecessary here.

pub mod blobs;

use std::path::Path;

/// The journal's spelling of a path, shared with `find_project_by_path` so
/// "the same file" means the same thing everywhere.
pub fn norm_path(path: &Path) -> String {
    crate::db::ops::project::normalize_path(&path.to_string_lossy())
}

/// Where the journal keeps its blobs, under the app's data directory.
///
/// Deliberately not under `files/<conversation_id>/`: deleting a conversation
/// `remove_dir_all`s that tree, and the journal is exactly the record that
/// must survive it.
pub fn journal_root(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("file-journal")
}
