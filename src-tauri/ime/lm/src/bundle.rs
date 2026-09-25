//! A model bundle: one directory under `<ime>/models/`, everything the scorer
//! needs and a manifest that says what it is.
//!
//! ```text
//! <ime>/models/<id>/
//!   manifest.json   what follows, checked on load
//!   score.onnx      the graph (see `backend` for its inputs and output)
//!   vocab.json      token ids for characters and each scheme's keys
//!   readings.tsv    character readings (the tone filter; not read yet)
//!   fuzzy.json      the layout's merges the model was trained with
//!   LICENSES/       what the weights and data are under
//! ```
//!
//! The manifest is refused rather than tolerated whenever it disagrees with
//! this build: an unknown field, a newer format, a file whose hash has
//! changed, or a spelling table that is not the one the engine uses. A model
//! trained on a different grid table would score the wrong keys with
//! confidence, and nothing downstream could tell.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use meridian_ime_dict::SyllableTable;
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const MODEL_FILE: &str = "score.onnx";
pub const VOCAB_FILE: &str = "vocab.json";
/// The manifest format this build reads.
pub const BUNDLE_FORMAT: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    #[error("cannot read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{path} is not a manifest this build understands: {source}")]
    Manifest {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("manifest format {found} is newer than {BUNDLE_FORMAT}, which this build reads")]
    NewerFormat { found: u32 },
    #[error("the manifest does not list {0}")]
    Missing(&'static str),
    #[error("{file} does not match the manifest ({reason})")]
    Mismatch { file: String, reason: String },
    #[error("the model was trained on another {what} table (manifest {manifest}, engine {engine})")]
    WrongTable {
        what: &'static str,
        manifest: String,
        engine: String,
    },
    #[error("{0}")]
    Invalid(String),
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FileEntry {
    pub sha256: String,
    pub bytes: u64,
}

/// How long a query may wait for the model, per platform class.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Budget {
    pub desktop: u64,
    pub mobile: u64,
}

/// Per-segment caps of the context the model was trained with.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub max_hints: usize,
    pub max_left: usize,
    pub max_right: usize,
    pub max_keys: usize,
    pub max_text: usize,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: u32,
    pub id: String,
    pub version: String,
    /// SPDX. The public model is AGPL-3.0-or-later.
    pub license: String,
    /// Trained on this person's own typing. Preferred when present, and never
    /// published.
    pub personal: bool,
    /// For a personal model, the public one it was trained from.
    pub base_id: Option<String>,
    pub opset: u32,
    /// Oldest ONNX Runtime the graph runs on.
    pub ort_min: String,
    /// Converts the model's summed log-probabilities onto the dictionary's
    /// scale; fitted on the evaluation set.
    pub scale: f64,
    pub budget_ms: Budget,
    pub limits: Limits,
    /// `pinyin`, `zhuyin`, `grid`: the key vocabularies it was trained on.
    pub schemes: Vec<String>,
    pub grid_table_sha256: String,
    pub syllable_table_sha256: String,
    pub files: BTreeMap<String, FileEntry>,
}

/// A bundle that passed every check.
#[derive(Debug, Clone)]
pub struct Bundle {
    pub dir: PathBuf,
    pub manifest: Manifest,
}

impl Bundle {
    pub fn path(&self, file: &str) -> PathBuf {
        self.dir.join(file)
    }

    /// Reads and checks `dir`: the manifest, every file it lists, and the two
    /// spelling tables against this engine's.
    pub fn open(dir: &Path, table: &SyllableTable) -> Result<Bundle, BundleError> {
        let manifest = read_manifest(dir)?;
        if manifest.format > BUNDLE_FORMAT {
            return Err(BundleError::NewerFormat { found: manifest.format });
        }
        if !manifest.scale.is_finite() || manifest.scale <= 0.0 {
            return Err(BundleError::Invalid(format!(
                "scale {} is not a positive number",
                manifest.scale
            )));
        }
        if manifest.limits.max_text == 0 {
            return Err(BundleError::Invalid("max_text is zero".into()));
        }
        for required in [MODEL_FILE, VOCAB_FILE] {
            if !manifest.files.contains_key(required) {
                return Err(BundleError::Missing(required));
            }
        }
        let grid = meridian_ime_engine::grid_table_sha256();
        if manifest.grid_table_sha256 != grid {
            return Err(BundleError::WrongTable {
                what: "grid",
                manifest: manifest.grid_table_sha256.clone(),
                engine: grid,
            });
        }
        if manifest.syllable_table_sha256 != table.sha256() {
            return Err(BundleError::WrongTable {
                what: "syllable",
                manifest: manifest.syllable_table_sha256.clone(),
                engine: table.sha256().to_string(),
            });
        }
        for (name, entry) in &manifest.files {
            check_file(dir, name, entry)?;
        }
        Ok(Bundle {
            dir: dir.to_path_buf(),
            manifest,
        })
    }
}

fn read_manifest(dir: &Path) -> Result<Manifest, BundleError> {
    let path = dir.join(MANIFEST_FILE);
    let text = std::fs::read_to_string(&path).map_err(|source| BundleError::Io {
        path: path.clone(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| BundleError::Manifest { path, source })
}

fn check_file(dir: &Path, name: &str, entry: &FileEntry) -> Result<(), BundleError> {
    // A name is a file in this directory, never a path out of it.
    if name.contains(['/', '\\']) || name == "." || name == ".." || name.is_empty() {
        return Err(BundleError::Invalid(format!("{name:?} is not a file name")));
    }
    let path = dir.join(name);
    let mismatch = |reason: String| BundleError::Mismatch {
        file: name.to_string(),
        reason,
    };
    let mut file = std::fs::File::open(&path).map_err(|source| BundleError::Io {
        path: path.clone(),
        source,
    })?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    let mut bytes = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|source| BundleError::Io {
            path: path.clone(),
            source,
        })?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        hasher.update(&buf[..n]);
    }
    if bytes != entry.bytes {
        return Err(mismatch(format!("{bytes} bytes, manifest says {}", entry.bytes)));
    }
    let sha = format!("{:x}", hasher.finalize());
    if sha != entry.sha256 {
        return Err(mismatch(format!("sha256 {sha}")));
    }
    Ok(())
}

/// The bundle to load from `models_dir`: a personal one if any, else the
/// public one with the highest version. Only the manifests are read; `None`
/// when there is nothing that looks like a bundle.
pub fn choose(models_dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(models_dir).ok()?;
    let mut found: Vec<(bool, String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        match read_manifest(&dir) {
            Ok(m) => found.push((m.personal, m.version, dir)),
            Err(e) => tracing::warn!(dir = %dir.display(), error = %e, "not a model bundle"),
        }
    }
    found.sort();
    found.pop().map(|(_, _, dir)| dir)
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;

    pub fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Writes a bundle with the given files and a manifest describing them,
    /// then applies `edit` to the manifest JSON before it is written.
    pub fn write_bundle(dir: &Path, files: &[(&str, &[u8])], edit: impl FnOnce(&mut serde_json::Value)) {
        std::fs::create_dir_all(dir).unwrap();
        let mut listed = serde_json::Map::new();
        for (name, bytes) in files {
            std::fs::write(dir.join(name), bytes).unwrap();
            listed.insert(
                name.to_string(),
                serde_json::json!({ "sha256": sha(bytes), "bytes": bytes.len() }),
            );
        }
        let mut manifest = serde_json::json!({
            "format": 1,
            "id": "test-lm",
            "version": "2026.10.0",
            "license": "AGPL-3.0-or-later",
            "personal": false,
            "base_id": null,
            "opset": 17,
            "ort_min": "1.17",
            "scale": 0.5,
            "budget_ms": { "desktop": 25, "mobile": 40 },
            "limits": { "max_hints": 16, "max_left": 8, "max_right": 4, "max_keys": 12, "max_text": 6 },
            "schemes": ["pinyin", "zhuyin", "grid"],
            "grid_table_sha256": meridian_ime_engine::grid_table_sha256(),
            "syllable_table_sha256": SyllableTable::new().sha256(),
            "files": listed,
        });
        edit(&mut manifest);
        std::fs::write(dir.join(MANIFEST_FILE), serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::write_bundle;
    use super::*;

    const FILES: &[(&str, &[u8])] = &[(MODEL_FILE, b"graph"), (VOCAB_FILE, b"{}")];

    #[test]
    fn a_good_bundle_opens() {
        let dir = tempfile::tempdir().unwrap();
        write_bundle(dir.path(), FILES, |_| {});
        let b = Bundle::open(dir.path(), &SyllableTable::new()).unwrap();
        assert_eq!(b.manifest.id, "test-lm");
        assert_eq!(b.manifest.limits.max_text, 6);
        assert_eq!(b.path(MODEL_FILE), dir.path().join(MODEL_FILE));
    }

    #[test]
    fn a_changed_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        write_bundle(dir.path(), FILES, |_| {});
        std::fs::write(dir.path().join(MODEL_FILE), b"grapH").unwrap();
        let err = Bundle::open(dir.path(), &SyllableTable::new()).unwrap_err();
        assert!(matches!(err, BundleError::Mismatch { .. }), "{err}");
    }

    #[test]
    fn another_grid_table_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        write_bundle(dir.path(), FILES, |m| m["grid_table_sha256"] = "0".repeat(64).into());
        let err = Bundle::open(dir.path(), &SyllableTable::new()).unwrap_err();
        assert!(matches!(err, BundleError::WrongTable { what: "grid", .. }), "{err}");
    }

    #[test]
    fn unknown_fields_newer_formats_and_escapes_are_refused() {
        let t = SyllableTable::new();
        let dir = tempfile::tempdir().unwrap();
        write_bundle(dir.path(), FILES, |m| m["extra"] = true.into());
        assert!(matches!(
            Bundle::open(dir.path(), &t),
            Err(BundleError::Manifest { .. })
        ));
        write_bundle(dir.path(), FILES, |m| m["format"] = 2.into());
        assert!(matches!(
            Bundle::open(dir.path(), &t),
            Err(BundleError::NewerFormat { found: 2 })
        ));
        write_bundle(dir.path(), FILES, |m| {
            m["files"]["../escape"] = serde_json::json!({ "sha256": "x", "bytes": 0 })
        });
        assert!(matches!(Bundle::open(dir.path(), &t), Err(BundleError::Invalid(_))));
        write_bundle(dir.path(), &[(VOCAB_FILE, b"{}")], |_| {});
        assert!(matches!(
            Bundle::open(dir.path(), &t),
            Err(BundleError::Missing(MODEL_FILE))
        ));
        write_bundle(dir.path(), FILES, |m| m["scale"] = 0.0.into());
        assert!(matches!(Bundle::open(dir.path(), &t), Err(BundleError::Invalid(_))));
    }

    #[test]
    fn a_personal_bundle_is_chosen_first_then_the_newest() {
        let models = tempfile::tempdir().unwrap();
        assert_eq!(choose(models.path()), None);
        write_bundle(&models.path().join("a"), FILES, |m| m["version"] = "2026.10.0".into());
        write_bundle(&models.path().join("b"), FILES, |m| m["version"] = "2026.11.0".into());
        assert_eq!(choose(models.path()), Some(models.path().join("b")));
        write_bundle(&models.path().join("mine"), FILES, |m| {
            m["personal"] = true.into();
            m["version"] = "2026.01.0".into();
        });
        assert_eq!(choose(models.path()), Some(models.path().join("mine")));
        std::fs::create_dir_all(models.path().join("junk")).unwrap();
        assert_eq!(
            choose(models.path()),
            Some(models.path().join("mine")),
            "a stray directory is skipped"
        );
    }
}
