//! Zip of the four learned tables, for carrying them between devices.
//!
//! Dictionary `unpack` only extracts `*.dict.yaml`; this allowlist is the
//! four TSV names plus a manifest. Unknown entries are refused rather than
//! skipped, so a zip that is not a learn export cannot be staged as one.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use meridian_ime_engine::{FileLearner, TABLE_FILES};
use serde::{Deserialize, Serialize};
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

pub const MANIFEST_FILE: &str = "manifest.json";
pub const EXPORT_FILE: &str = "meridian-ime-learn.zip";
pub const STAGING_DIR: &str = "learn-staging";
pub const FORMAT: u32 = 1;
pub const KIND: &str = "ime-learn";
/// Unpacked, at most. The four tables plus a tiny manifest.
pub const MAX_UNPACKED_BYTES: u64 = 64 << 20;
const MAX_ENTRIES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LearnManifest {
    pub format: u32,
    pub kind: String,
}

impl LearnManifest {
    pub fn current() -> Self {
        Self {
            format: FORMAT,
            kind: KIND.into(),
        }
    }

    pub fn check(&self) -> Result<(), String> {
        if self.format > FORMAT {
            return Err(format!(
                "learn export format {} is newer than {FORMAT}, which this build reads",
                self.format
            ));
        }
        if self.kind != KIND {
            return Err(format!("not a learn export (kind {:?})", self.kind));
        }
        Ok(())
    }
}

pub fn staging_root(dirs: &meridian_ime_config::ImeDirs) -> PathBuf {
    dirs.root.join(STAGING_DIR)
}

pub fn default_export_path(dirs: &meridian_ime_config::ImeDirs) -> PathBuf {
    dirs.root.join("exports").join(EXPORT_FILE)
}

pub fn sweep_staging(dirs: &meridian_ime_config::ImeDirs) {
    let root = staging_root(dirs);
    if root.exists()
        && let Err(e) = std::fs::remove_dir_all(&root)
    {
        tracing::warn!(error = %e, dir = %root.display(), "cannot clear the learn staging area");
    }
}

fn allowed(name: &str) -> bool {
    name == MANIFEST_FILE || TABLE_FILES.contains(&name)
}

/// Packs `tables` (a directory of the four TSVs) plus a manifest into `dest`.
pub fn write_zip(tables: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let manifest = serde_json::to_vec(&LearnManifest::current()).expect("LearnManifest serialises");
    zip.start_file(MANIFEST_FILE, opts).map_err(|e| e.to_string())?;
    zip.write_all(&manifest).map_err(|e| e.to_string())?;
    for name in TABLE_FILES {
        let path = tables.join(name);
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Unpacks an allowlisted learn zip into `dest`. Unknown names and nested
/// paths are refused.
pub fn unpack_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("not a readable zip: {e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "the archive has {} entries; at most {MAX_ENTRIES}",
            archive.len()
        ));
    }
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut written = 0u64;
    let mut saw_manifest = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!(
                "{} would be written outside the archive's directory",
                entry.name()
            ));
        };
        if rel.parent().is_some_and(|p| p.as_os_str().len() > 0) {
            return Err(format!("{} is not a file at the archive root", entry.name()));
        }
        let Some(name) = rel.file_name().and_then(|n| n.to_str()) else {
            return Err(format!("{} is not a file name", entry.name()));
        };
        if !allowed(name) {
            return Err(format!("{name} is not a learn-export file"));
        }
        if name == MANIFEST_FILE {
            saw_manifest = true;
        }
        let out = dest.join(name);
        let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        let budget = MAX_UNPACKED_BYTES.saturating_sub(written);
        let copied = std::io::copy(&mut (&mut entry).take(budget + 1), &mut f).map_err(|e| e.to_string())?;
        if copied > budget {
            return Err(format!("the archive unpacks to more than {MAX_UNPACKED_BYTES} bytes"));
        }
        written += copied;
    }
    if !saw_manifest {
        return Err("the archive has no manifest.json".into());
    }
    let text = std::fs::read_to_string(dest.join(MANIFEST_FILE)).map_err(|e| e.to_string())?;
    let manifest: LearnManifest = serde_json::from_str(&text).map_err(|e| format!("manifest.json: {e}"))?;
    manifest.check()?;
    // Prove the tables load; a corrupt line is skipped by the reader.
    FileLearner::read(dest).map_err(|e| format!("cannot read the learned tables: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_ime_engine::{Learner, MemoryLearner};

    #[test]
    fn zip_round_trips_and_refuses_a_stranger() {
        let tmp = tempfile::tempdir().unwrap();
        let tables = tmp.path().join("tables");
        let mut m = MemoryLearner::new();
        m.record("香港");
        FileLearner::write_tables(&tables, &m).unwrap();
        let zip = tmp.path().join("learn.zip");
        write_zip(&tables, &zip).unwrap();
        let out = tmp.path().join("out");
        unpack_zip(&zip, &out).unwrap();
        let loaded = FileLearner::read(&out).unwrap();
        assert_eq!(loaded.weight("香港"), 1);
        assert!(out.join(MANIFEST_FILE).is_file());

        let mut archive = zip::ZipWriter::new(std::fs::File::create(tmp.path().join("bad.zip")).unwrap());
        let opts = SimpleFileOptions::default();
        archive.start_file("secret.txt", opts).unwrap();
        archive.write_all(b"no").unwrap();
        archive.finish().unwrap();
        let err = unpack_zip(&tmp.path().join("bad.zip"), &tmp.path().join("bad-out")).unwrap_err();
        assert!(err.contains("not a learn-export") || err.contains("manifest"), "{err}");
    }
}
