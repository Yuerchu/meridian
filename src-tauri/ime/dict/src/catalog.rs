//! What has been imported into a data directory: `<dicts_dir>/catalog.toml`.
//!
//! The catalog is the list the engine opens at startup and the settings page
//! edits — which dictionaries exist, in what order, and whether each is on.
//! The `.mdict` files are the truth about *content*; the catalog only points
//! at them, so a row whose file has gone is dropped on load rather than kept
//! as a promise the engine cannot honour. The importer never writes here:
//! it produces a file and a report, and the caller decides whether to list it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::format::{DictError, DictFile, Metadata};
use crate::rime::ImportReport;
use crate::set::DictSet;

pub const CATALOG_FILE_NAME: &str = "catalog.toml";

/// Position of a dictionary in the catalog; what a lookup hit's source id refers to.
pub type DictId = u16;

/// One listed dictionary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntry {
    /// File name inside the dictionaries directory.
    pub file: String,
    pub name: String,
    pub enabled: bool,
    /// Lower is consulted first.
    pub priority: i32,
    pub entries: u64,
    pub license: String,
    pub imported_unix: u64,
}

impl CatalogEntry {
    /// The row an import produces: enabled, at priority 0. The caller sets the
    /// priority it wants before upserting.
    pub fn from_report(report: &ImportReport, meta: &Metadata) -> Self {
        Self {
            file: report
                .output
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            name: report.name.clone(),
            enabled: true,
            priority: 0,
            entries: meta.entries,
            license: meta.license.clone(),
            imported_unix: meta.created_unix,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
}

/// The on-disk shape: an array of `[[dict]]` tables.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogFile {
    #[serde(default, rename = "dict")]
    entries: Vec<CatalogEntry>,
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{path}: {source}")]
    Parse {
        path: PathBuf,
        source: Box<toml::de::Error>,
    },
}

impl Catalog {
    /// Reads the catalog; a missing file is an empty catalog, an unparseable
    /// one is an error. Rows whose file is no longer in `dicts_dir` are dropped.
    pub fn load(dicts_dir: &Path) -> Result<Self, CatalogError> {
        let path = dicts_dir.join(CATALOG_FILE_NAME);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e.into()),
        };
        let file: CatalogFile = toml::from_str(&text).map_err(|source| CatalogError::Parse {
            path,
            source: Box::new(source),
        })?;
        let mut catalog = Self { entries: file.entries };
        catalog.entries.retain(|e| dicts_dir.join(&e.file).is_file());
        Ok(catalog)
    }

    /// Writes the catalog atomically: a sibling temporary file, then a rename.
    pub fn save(&self, dicts_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dicts_dir)?;
        let path = dicts_dir.join(CATALOG_FILE_NAME);
        let tmp = dicts_dir.join(format!(".{CATALOG_FILE_NAME}.tmp-{}", std::process::id()));
        let file = CatalogFile {
            entries: self.entries.clone(),
        };
        let text = toml::to_string(&file).map_err(std::io::Error::other)?;
        let result = (|| {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(text.as_bytes())?;
            f.sync_all()?;
            std::fs::rename(&tmp, &path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result
    }

    pub fn get(&self, file: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|e| e.file == file)
    }

    /// Replaces the row with the same `file`, or appends.
    pub fn upsert(&mut self, entry: CatalogEntry) {
        match self.entries.iter_mut().find(|e| e.file == entry.file) {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
    }

    /// `true` when a row was removed. The file itself is left alone.
    pub fn remove(&mut self, file: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.file != file);
        self.entries.len() != before
    }

    /// `true` when the row exists.
    pub fn set_enabled(&mut self, file: &str, enabled: bool) -> bool {
        match self.entries.iter_mut().find(|e| e.file == file) {
            Some(e) => {
                e.enabled = enabled;
                true
            }
            None => false,
        }
    }

    /// One past the highest priority listed, so a new row goes last.
    pub fn next_priority(&self) -> i32 {
        self.entries.iter().map(|e| e.priority + 1).max().unwrap_or(0)
    }

    /// The enabled rows in the order they are consulted: priority, then name.
    pub fn enabled(&self) -> Vec<&CatalogEntry> {
        let mut rows: Vec<&CatalogEntry> = self.entries.iter().filter(|e| e.enabled).collect();
        rows.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.name.cmp(&b.name)));
        rows
    }

    /// Opens every enabled dictionary. One that fails to open is skipped with
    /// a warning rather than taking the rest down with it.
    pub fn open_all(&self, dicts_dir: &Path) -> DictSet {
        let (set, failures) = self.open_all_report(dicts_dir);
        for (file, error) in &failures {
            tracing::warn!(file, error = %error, "dictionary skipped");
        }
        set
    }

    /// [`Catalog::open_all`] with the failures returned instead of logged.
    pub fn open_all_report(&self, dicts_dir: &Path) -> (DictSet, Vec<(String, DictError)>) {
        let mut set = DictSet::new();
        let mut failures = Vec::new();
        for entry in self.enabled() {
            match DictFile::open(&dicts_dir.join(&entry.file)) {
                Ok(file) => {
                    set.add_file(file);
                }
                Err(e) => failures.push((entry.file.clone(), e)),
            }
        }
        (set, failures)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::DictWriter;
    use crate::syllable::SyllableTable;

    fn entry(file: &str, priority: i32) -> CatalogEntry {
        CatalogEntry {
            file: file.into(),
            name: file.trim_end_matches(".mdict").into(),
            enabled: true,
            priority,
            entries: 1,
            license: "UNKNOWN".into(),
            imported_unix: 1,
        }
    }

    fn dict(dir: &Path, file: &str, rows: &[(&str, &str, u32)]) {
        let mut w = DictWriter::new();
        for (c, t, f) in rows {
            w.add(c, t, *f);
        }
        let meta = Metadata {
            name: file.into(),
            license: "UNKNOWN".into(),
            attribution: String::new(),
            source: String::new(),
            cache_key: String::new(),
            version: String::new(),
            entries: 0,
            codes: 0,
            total_frequency: 0,
            created_unix: 0,
            generator: "test".into(),
            format_version: 0,
            importer_version: 1,
            syllable_table_sha256: String::new(),
        };
        w.write(&dir.join(file), &meta, &SyllableTable::new()).unwrap();
    }

    #[test]
    fn load_save_upsert_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let dicts = dir.path().join("dicts");
        assert_eq!(
            Catalog::load(&dicts).unwrap(),
            Catalog::default(),
            "missing file is empty"
        );

        std::fs::create_dir_all(&dicts).unwrap();
        dict(&dicts, "a.mdict", &[("ni", "你", 1)]);
        dict(&dicts, "b.mdict", &[("hao", "好", 1)]);
        let mut c = Catalog::default();
        c.upsert(entry("a.mdict", 0));
        assert_eq!(c.next_priority(), 1);
        c.upsert(entry("b.mdict", 1));
        c.upsert(CatalogEntry {
            entries: 7,
            ..entry("a.mdict", 0)
        });
        assert_eq!(c.entries.len(), 2, "upsert replaces by file");
        assert_eq!(c.get("a.mdict").unwrap().entries, 7);
        c.save(&dicts).unwrap();
        assert!(dicts.join(CATALOG_FILE_NAME).is_file());
        assert_eq!(std::fs::read_dir(&dicts).unwrap().count(), 3, "no temp file left");
        assert_eq!(Catalog::load(&dicts).unwrap(), c);

        assert!(c.set_enabled("b.mdict", false));
        assert!(!c.set_enabled("zzz.mdict", false));
        assert_eq!(c.enabled().len(), 1);
        assert!(c.remove("b.mdict"));
        assert!(!c.remove("b.mdict"));
        c.save(&dicts).unwrap();
        assert_eq!(Catalog::load(&dicts).unwrap().entries.len(), 1);

        std::fs::write(dicts.join(CATALOG_FILE_NAME), "[[dict]]\nfile = 1\n").unwrap();
        assert!(matches!(Catalog::load(&dicts), Err(CatalogError::Parse { .. })));
    }

    #[test]
    fn load_drops_rows_whose_file_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let dicts = dir.path().to_path_buf();
        dict(&dicts, "a.mdict", &[("ni", "你", 1)]);
        let mut c = Catalog::default();
        c.upsert(entry("a.mdict", 0));
        c.upsert(entry("gone.mdict", 1));
        c.save(&dicts).unwrap();
        let loaded = Catalog::load(&dicts).unwrap();
        assert_eq!(
            loaded.entries.iter().map(|e| e.file.as_str()).collect::<Vec<_>>(),
            vec!["a.mdict"]
        );
    }

    #[test]
    fn open_all_skips_a_broken_file_and_orders_by_priority() {
        let dir = tempfile::tempdir().unwrap();
        let dicts = dir.path().to_path_buf();
        dict(&dicts, "second.mdict", &[("ni", "你", 1)]);
        dict(&dicts, "first.mdict", &[("ni", "妮", 1)]);
        std::fs::write(dicts.join("broken.mdict"), b"not a dictionary").unwrap();
        let mut c = Catalog::default();
        c.upsert(entry("second.mdict", 5));
        c.upsert(entry("broken.mdict", 1));
        c.upsert(entry("first.mdict", 0));
        c.upsert(CatalogEntry {
            enabled: false,
            ..entry("off.mdict", -1)
        });
        let (set, failures) = c.open_all_report(&dicts);
        assert_eq!(set.source_count(), 2);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].0, "broken.mdict");
        assert!(matches!(failures[0].1, DictError::BadMagic));
        let hits = set.lookup("ni");
        assert_eq!(
            hits.iter().find(|h| h.text == "妮").unwrap().source,
            0,
            "priority 0 is source 0"
        );
        assert_eq!(hits.iter().find(|h| h.text == "你").unwrap().source, 1);
        assert_eq!(c.open_all(&dicts).source_count(), 2);
    }
}
