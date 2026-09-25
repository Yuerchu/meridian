//! Language model bundles from the settings page: which are installed, which
//! the host will use, installing one from a directory, removing one.
//!
//! The host watches `<ime>/models` and reloads on its own when a manifest
//! appears, changes or goes; nothing here talks to it. Every bundle is
//! checked with the same code the host loads it with, so a bundle this page
//! accepts is one the host will not refuse for its contents.

use std::path::{Path, PathBuf};

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::SyllableTable;
use meridian_ime_lm::bundle::{self, Bundle, MANIFEST_FILE};

/// One directory under `models`.
#[derive(Debug, Clone, PartialEq)]
pub struct InstalledBundle {
    pub dir_name: String,
    pub id: Option<String>,
    pub version: Option<String>,
    pub personal: bool,
    pub license: Option<String>,
    /// Why the host would refuse it; `None` when it checks out.
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelsStatus {
    pub dir: PathBuf,
    /// The bundle the host picks, by directory name.
    pub active: Option<String>,
    pub bundles: Vec<InstalledBundle>,
}

pub fn status(dirs: &ImeDirs) -> ModelsStatus {
    let models = dirs.models();
    let table = SyllableTable::new();
    let mut bundles = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&models) {
        for entry in rd.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if !path.is_dir() || name.starts_with('.') {
                continue;
            }
            bundles.push(match Bundle::open(&path, &table) {
                Ok(b) => InstalledBundle {
                    dir_name: name,
                    id: Some(b.manifest.id),
                    version: Some(b.manifest.version),
                    personal: b.manifest.personal,
                    license: Some(b.manifest.license),
                    error: None,
                },
                Err(e) => InstalledBundle {
                    dir_name: name,
                    id: None,
                    version: None,
                    personal: false,
                    license: None,
                    error: Some(e.to_string()),
                },
            });
        }
    }
    bundles.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    let active = bundle::choose(&models).and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
    ModelsStatus {
        dir: models,
        active,
        bundles,
    }
}

/// Whether the host will find ONNX Runtime: `$MERIDIAN_ORT_LIB`, or the copy
/// beside the host or one directory up — where the installer puts
/// sherpa-onnx's. The same order the host looks in.
#[cfg(windows)]
pub fn runtime_found(host_exe: Option<&Path>) -> bool {
    if let Some(p) = std::env::var_os(meridian_ime_lm::RUNTIME_ENV).filter(|p| !p.is_empty()) {
        return Path::new(&p).exists();
    }
    let Some(dir) = host_exe.and_then(Path::parent) else {
        return false;
    };
    dir.join("onnxruntime.dll").exists() || dir.parent().is_some_and(|d| d.join("onnxruntime.dll").exists())
}

/// Where a bundle with this manifest lives: its id, and `-personal` for a
/// personal one so it never replaces the public model it was trained from.
fn dir_name_for(m: &bundle::Manifest) -> Result<String, String> {
    let id = m.id.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        || id.starts_with('.')
    {
        return Err(format!("{:?} is not a usable bundle id", m.id));
    }
    Ok(if m.personal {
        format!("{id}-personal")
    } else {
        id.to_string()
    })
}

fn remove_dir_retrying(path: &Path) -> std::io::Result<()> {
    let mut last = Ok(());
    for _ in 0..10 {
        last = std::fs::remove_dir_all(path);
        if last.is_ok() || !path.exists() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    last
}

/// Checks the bundle in `source`, then copies it into `models`: the files the
/// manifest lists, the manifest, and `LICENSES/`. A bundle with the same
/// directory name is replaced. Returns the directory name.
pub fn import(dirs: &ImeDirs, source: &Path) -> Result<String, String> {
    let table = SyllableTable::new();
    let checked = Bundle::open(source, &table).map_err(|e| e.to_string())?;
    let name = dir_name_for(&checked.manifest)?;
    let models = dirs.models();
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    let target = models.join(&name);
    if source.canonicalize().ok() == target.canonicalize().ok() && target.exists() {
        return Ok(name);
    }
    let tmp = models.join(format!(".{name}.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let copy = || -> std::io::Result<()> {
        std::fs::create_dir_all(&tmp)?;
        for file in checked.manifest.files.keys() {
            std::fs::copy(source.join(file), tmp.join(file))?;
        }
        let licenses = source.join("LICENSES");
        if licenses.is_dir() {
            std::fs::create_dir_all(tmp.join("LICENSES"))?;
            for entry in std::fs::read_dir(&licenses)?.flatten() {
                if entry.path().is_file() {
                    std::fs::copy(entry.path(), tmp.join("LICENSES").join(entry.file_name()))?;
                }
            }
        }
        // The manifest last, so a half-copied directory never looks like a
        // bundle to anyone reading it.
        std::fs::copy(source.join(MANIFEST_FILE), tmp.join(MANIFEST_FILE))?;
        Ok(())
    };
    if let Err(e) = copy() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("copying the bundle failed: {e}"));
    }
    // What was copied is checked again: a source that changed underneath the
    // copy must not become an installed bundle.
    if let Err(e) = Bundle::open(&tmp, &table) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("the copy does not check out: {e}"));
    }
    if target.exists() {
        remove(dirs, &name)?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_dir_all(&tmp);
        format!("installing the bundle failed: {e}")
    })?;
    Ok(name)
}

/// Removes a bundle directory. The manifest goes first, so the host lets go
/// of the model before the rest is deleted.
pub fn remove(dirs: &ImeDirs, dir_name: &str) -> Result<(), String> {
    if dir_name.is_empty() || dir_name.contains(['/', '\\']) || dir_name.starts_with('.') {
        return Err(format!("{dir_name:?} is not a bundle directory"));
    }
    let path = dirs.models().join(dir_name);
    if !path.is_dir() {
        return Err(format!("no bundle named {dir_name}"));
    }
    let manifest = path.join(MANIFEST_FILE);
    if manifest.exists() {
        std::fs::remove_file(&manifest).map_err(|e| format!("cannot remove {}: {e}", manifest.display()))?;
    }
    remove_dir_retrying(&path).map_err(|e| format!("the manifest is gone but the files could not be deleted: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest;

    /// A bundle whose files check out; the scorer never runs in these tests.
    fn write_source(dir: &Path, id: &str, personal: bool) {
        std::fs::create_dir_all(dir.join("LICENSES")).unwrap();
        std::fs::write(dir.join("LICENSES").join("AGPL.txt"), b"licence").unwrap();
        let files: [(&str, &[u8]); 2] = [("score.onnx", b"graph"), ("vocab.json", b"{}")];
        let mut listed = serde_json::Map::new();
        for (name, bytes) in files {
            std::fs::write(dir.join(name), bytes).unwrap();
            listed.insert(
                name.into(),
                serde_json::json!({ "sha256": format!("{:x}", sha2::Sha256::digest(bytes)), "bytes": bytes.len() }),
            );
        }
        let manifest = serde_json::json!({
            "format": 1, "id": id, "version": "2026.10.0", "license": "AGPL-3.0-or-later",
            "personal": personal, "base_id": null, "opset": 17, "ort_min": "1.17", "scale": 1.0,
            "budget_ms": { "desktop": 25, "mobile": 40 },
            "limits": { "max_hints": 8, "max_left": 8, "max_right": 8, "max_keys": 8, "max_text": 8 },
            "schemes": ["grid"],
            "grid_table_sha256": meridian_ime_engine::grid_table_sha256(),
            "syllable_table_sha256": SyllableTable::new().sha256(),
            "files": listed,
        });
        std::fs::write(dir.join(MANIFEST_FILE), serde_json::to_vec(&manifest).unwrap()).unwrap();
    }

    #[test]
    fn import_status_and_remove() {
        let data = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(data.path());
        let src = tempfile::tempdir().unwrap();
        write_source(src.path(), "meridian-ime-lm-zh", false);
        assert!(status(&dirs).bundles.is_empty());

        let name = import(&dirs, src.path()).unwrap();
        assert_eq!(name, "meridian-ime-lm-zh");
        assert!(dirs.models().join(&name).join("LICENSES").join("AGPL.txt").exists());
        let s = status(&dirs);
        assert_eq!(s.active.as_deref(), Some("meridian-ime-lm-zh"));
        assert_eq!(s.bundles.len(), 1);
        assert!(s.bundles[0].error.is_none());

        // A personal bundle sits beside the public one and is preferred.
        let mine = tempfile::tempdir().unwrap();
        write_source(mine.path(), "meridian-ime-lm-zh", true);
        assert_eq!(import(&dirs, mine.path()).unwrap(), "meridian-ime-lm-zh-personal");
        assert_eq!(status(&dirs).active.as_deref(), Some("meridian-ime-lm-zh-personal"));

        remove(&dirs, "meridian-ime-lm-zh-personal").unwrap();
        assert_eq!(status(&dirs).active.as_deref(), Some("meridian-ime-lm-zh"));
        assert!(remove(&dirs, "../escape").is_err());
    }

    #[test]
    fn a_bad_bundle_is_refused_and_leaves_nothing_behind() {
        let data = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(data.path());
        let src = tempfile::tempdir().unwrap();
        write_source(src.path(), "meridian-ime-lm-zh", false);
        std::fs::write(src.path().join("score.onnx"), b"tampered").unwrap();
        assert!(import(&dirs, src.path()).is_err());
        assert!(std::fs::read_dir(dirs.models()).map(|rd| rd.count()).unwrap_or(0) == 0);

        let odd = tempfile::tempdir().unwrap();
        write_source(odd.path(), "../../x", false);
        assert!(
            import(&dirs, odd.path())
                .unwrap_err()
                .contains("not a usable bundle id")
        );
    }

    #[test]
    fn a_broken_installed_bundle_is_listed_with_its_reason() {
        let data = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(data.path());
        let src = tempfile::tempdir().unwrap();
        write_source(src.path(), "m", false);
        import(&dirs, src.path()).unwrap();
        std::fs::write(dirs.models().join("m").join("vocab.json"), b"{ }").unwrap();
        let s = status(&dirs);
        assert!(s.bundles[0].error.as_deref().is_some_and(|e| e.contains("vocab.json")));
    }
}
