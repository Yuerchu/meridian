//! Asking the input method to forget what it learned.
//!
//! The learned tables belong to whichever process types — the Windows host,
//! the Android keyboard — which holds them in memory and writes them out every
//! minute. Meridian's settings page editing the files would be undone by the
//! next of those writes, so it files a request instead, and the process that
//! owns the tables carries it out and writes them at once: while it runs, at
//! its next poll; otherwise when it next opens them, before anything is
//! typed. One file per request, named so they sort in the order they were
//! made, because two requests appending to one file can lose the first to a
//! reader removing it in between.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ImeDirs;

pub const FORGET_DIR_NAME: &str = "forget";
/// Given to a request that did not parse, so it is kept for somebody to look
/// at and not read again every second.
pub const REJECTED_SUFFIX: &str = ".rejected";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ForgetRequest {
    /// Every trace of one word.
    Word { text: String },
    /// Everything learned.
    Everything,
}

/// A request found on disk; `request` is the parse error when it is not one.
#[derive(Debug)]
pub struct PendingForget {
    pub path: PathBuf,
    pub request: Result<ForgetRequest, String>,
}

/// Files `request` for the owner of the tables to carry out.
pub fn request_forget(dirs: &ImeDirs, request: &ForgetRequest) -> io::Result<()> {
    let dir = dirs.forget();
    std::fs::create_dir_all(&dir)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let name = format!("{stamp:024}-{}.json", std::process::id());
    let tmp = dir.join(format!(".{name}.tmp"));
    let text = serde_json::to_string(request).expect("ForgetRequest serialises");
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, dir.join(&name))
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// Requests not yet carried out, oldest first. A directory that does not exist
/// is none; half-written and rejected files are not requests.
pub fn pending_forgets(dirs: &ImeDirs) -> io::Result<Vec<PendingForget>> {
    let dir = dirs.forget();
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
            let request = std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|text| serde_json::from_str(&text).map_err(|e| e.to_string()));
            PendingForget { path, request }
        })
        .collect())
}

fn is_request(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    !name.starts_with('.') && name.ends_with(".json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_come_back_in_the_order_they_were_made() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        assert!(pending_forgets(&dirs).unwrap().is_empty(), "no directory is no request");
        let first = ForgetRequest::Word { text: "香港".into() };
        request_forget(&dirs, &first).unwrap();
        request_forget(&dirs, &ForgetRequest::Everything).unwrap();
        let pending = pending_forgets(&dirs).unwrap();
        let requests: Vec<_> = pending.into_iter().map(|p| p.request.unwrap()).collect();
        assert_eq!(requests, vec![first, ForgetRequest::Everything]);
    }

    #[test]
    fn a_request_is_its_shape_and_nothing_else() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        std::fs::create_dir_all(dirs.forget()).unwrap();
        std::fs::write(dirs.forget().join("1-1.json"), r#"{"kind":"word","text":"a","also":1}"#).unwrap();
        std::fs::write(dirs.forget().join(".2-1.json.tmp"), "{").unwrap();
        std::fs::write(dirs.forget().join("0-1.json.rejected"), "{").unwrap();
        let pending = pending_forgets(&dirs).unwrap();
        assert_eq!(pending.len(), 1, "half-written and rejected files are not requests");
        assert!(pending[0].request.is_err(), "an unknown field is refused");
    }
}
