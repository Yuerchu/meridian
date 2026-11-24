//! Asking the input method to merge another device's learned tables.
//!
//! Same reason as [`forget`]: the tables belong to the process that types, so
//! Meridian stages the incoming files under `learn/merge/` and that process
//! absorbs them. A directory per request, named so they sort in the order they
//! were made. Dot-named directories are the in-progress write; a directory
//! whose name ends `.rejected` was unreadable and is kept for somebody to look
//! at.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ImeDirs;
use crate::forget::REJECTED_SUFFIX;

pub const MERGE_DIR_NAME: &str = "merge";
pub const REQUEST_FILE: &str = "request.json";

/// The four tables a merge directory may hold. Missing is an empty table.
pub const TABLE_FILES: [&str; 4] = ["user.tsv", "user-choices.tsv", "user-words.tsv", "user-ngram.tsv"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeKind {
    /// Saturating-add the incoming counts onto what this device already learned.
    Add,
    /// Drop this device's tables, then add the incoming ones.
    Replace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MergeRequest {
    pub kind: MergeKind,
}

/// A merge directory found on disk; `request` is the parse error when it is not one.
#[derive(Debug)]
pub struct PendingMerge {
    pub path: PathBuf,
    pub request: Result<MergeRequest, String>,
}

/// Stages `tables` (a directory of the four TSVs) for the owner to carry out.
pub fn request_merge(dirs: &ImeDirs, kind: MergeKind, tables: &Path) -> io::Result<()> {
    let inbox = dirs.merge();
    std::fs::create_dir_all(&inbox)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let name = format!("{stamp:024}-{}", std::process::id());
    let tmp = inbox.join(format!(".{name}.tmp"));
    let dest = inbox.join(&name);
    let written = (|| {
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp)?;
        }
        std::fs::create_dir_all(&tmp)?;
        for file in TABLE_FILES {
            let src = tables.join(file);
            match std::fs::copy(&src, tmp.join(file)) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        let text = serde_json::to_string(&MergeRequest { kind }).expect("MergeRequest serialises");
        let req = tmp.join(REQUEST_FILE);
        {
            let mut f = std::fs::File::create(&req)?;
            f.write_all(text.as_bytes())?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &dest)
    })();
    if written.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    written
}

/// Merge directories not yet carried out, oldest first.
pub fn pending_merges(dirs: &ImeDirs) -> io::Result<Vec<PendingMerge>> {
    let dir = dirs.merge();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| is_request(p))
        .collect();
    paths.sort();
    Ok(paths
        .into_iter()
        .map(|path| {
            let request = std::fs::read_to_string(path.join(REQUEST_FILE))
                .map_err(|e| e.to_string())
                .and_then(|text| serde_json::from_str(&text).map_err(|e| e.to_string()));
            PendingMerge { path, request }
        })
        .collect())
}

/// Sets a merge directory aside so it is not read again every second.
pub fn reject_merge(path: &Path) -> io::Result<()> {
    let mut rejected = path.as_os_str().to_os_string();
    rejected.push(REJECTED_SUFFIX);
    std::fs::rename(path, rejected)
}

fn is_request(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    path.is_dir() && !name.starts_with('.') && !name.ends_with(REJECTED_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(dir: &Path, word: &str) -> PathBuf {
        let t = dir.join("tables");
        std::fs::create_dir_all(&t).unwrap();
        std::fs::write(t.join("user.tsv"), format!("# text\tcount\n{word}\t1\n")).unwrap();
        t
    }

    #[test]
    fn requests_come_back_in_the_order_they_were_made() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        assert!(pending_merges(&dirs).unwrap().is_empty(), "no directory is no request");
        let a = tables(tmp.path(), "香港");
        request_merge(&dirs, MergeKind::Add, &a).unwrap();
        request_merge(&dirs, MergeKind::Replace, &a).unwrap();
        let pending = pending_merges(&dirs).unwrap();
        let kinds: Vec<_> = pending.iter().map(|p| p.request.as_ref().unwrap().kind).collect();
        assert_eq!(kinds, vec![MergeKind::Add, MergeKind::Replace]);
        assert!(pending[0].path.join("user.tsv").is_file());
        assert!(pending[0].path.join(REQUEST_FILE).is_file());
    }

    #[test]
    fn a_request_is_its_shape_and_nothing_else() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        std::fs::create_dir_all(dirs.merge()).unwrap();
        let bad = dirs.merge().join("1-1");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join(REQUEST_FILE), r#"{"kind":"add","also":1}"#).unwrap();
        std::fs::create_dir_all(dirs.merge().join(".2-1.tmp")).unwrap();
        std::fs::create_dir_all(dirs.merge().join("0-1.rejected")).unwrap();
        let pending = pending_merges(&dirs).unwrap();
        assert_eq!(
            pending.len(),
            1,
            "half-written and rejected directories are not requests"
        );
        assert!(pending[0].request.is_err(), "an unknown field is refused");
    }

    #[test]
    fn a_missing_table_is_still_a_request() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let empty = tmp.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        request_merge(&dirs, MergeKind::Add, &empty).unwrap();
        let pending = pending_merges(&dirs).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request.as_ref().unwrap().kind, MergeKind::Add);
    }
}
