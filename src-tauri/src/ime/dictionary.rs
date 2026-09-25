//! Importing and listing dictionaries from the settings page.
//!
//! The same importer the CLI runs, into the same catalog the host reads. The
//! host notices the catalog changing on its own (it polls the directory);
//! the nudge over the pipe just makes it immediate.

use std::path::Path;

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::catalog::{Catalog, CatalogEntry};
use meridian_ime_dict::rime::{ImportOptions, ImportReport};
use meridian_ime_dict::{DictFile, SyllableTable};

/// One catalog row plus what the file says about itself.
#[derive(Debug, Clone)]
pub struct DictionarySummary {
    pub file: String,
    pub name: String,
    pub entries: u64,
    /// `None` when the file cannot be read: a catalog row whose file went
    /// missing is still listed (so it can be removed), and 0 bytes would be a
    /// size nobody measured.
    pub size_bytes: Option<u64>,
    pub enabled: bool,
    pub license: String,
    pub source: String,
}

pub fn list(dirs: &ImeDirs) -> Result<Vec<DictionarySummary>, String> {
    let dicts = dirs.dicts();
    let catalog = Catalog::load(&dicts).map_err(|e| e.to_string())?;
    Ok(catalog
        .entries
        .iter()
        .map(|e| {
            let path = dicts.join(&e.file);
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).ok();
            let source = DictFile::open(&path)
                .map(|d| d.meta().source.clone())
                .unwrap_or_default();
            DictionarySummary {
                file: e.file.clone(),
                name: e.name.clone(),
                entries: e.entries,
                size_bytes,
                enabled: e.enabled,
                license: e.license.clone(),
                source,
            }
        })
        .collect())
}

/// Imports `source` and adds it to the catalog, enabled. Blocking (seconds
/// for a large dictionary); call from `spawn_blocking`.
pub fn import(
    dirs: &ImeDirs,
    source: &Path,
    license: Option<String>,
    name: Option<String>,
) -> Result<ImportReport, String> {
    dirs.ensure().map_err(|e| e.to_string())?;
    let dicts = dirs.dicts();
    let table = SyllableTable::new();
    let opts = ImportOptions {
        license,
        attribution: None,
        name,
    };
    let report = meridian_ime_dict::rime::import(source, &dicts, &opts, &table).map_err(|e| e.to_string())?;
    let file = DictFile::open(&report.output).map_err(|e| e.to_string())?;
    let mut catalog = Catalog::load(&dicts).map_err(|e| e.to_string())?;
    let priority = catalog.next_priority();
    let mut entry = CatalogEntry::from_report(&report, file.meta());
    if let Some(existing) = catalog.get(&entry.file) {
        entry.enabled = existing.enabled;
        entry.priority = existing.priority;
    } else {
        entry.priority = priority;
    }
    catalog.upsert(entry);
    catalog.save(&dicts).map_err(|e| e.to_string())?;
    super::probe::reload_dictionaries();
    Ok(report)
}

pub fn set_enabled(dirs: &ImeDirs, file: &str, enabled: bool) -> Result<(), String> {
    let dicts = dirs.dicts();
    let mut catalog = Catalog::load(&dicts).map_err(|e| e.to_string())?;
    if !catalog.set_enabled(file, enabled) {
        return Err(format!("no dictionary named {file}"));
    }
    catalog.save(&dicts).map_err(|e| e.to_string())?;
    super::probe::reload_dictionaries();
    Ok(())
}

/// Removes the catalog row and deletes the file.
pub fn remove(dirs: &ImeDirs, file: &str) -> Result<(), String> {
    let dicts = dirs.dicts();
    let mut catalog = Catalog::load(&dicts).map_err(|e| e.to_string())?;
    if !catalog.remove(file) {
        return Err(format!("no dictionary named {file}"));
    }
    catalog.save(&dicts).map_err(|e| e.to_string())?;
    // The host may still have it mapped; a delete of a mapped file fails on
    // Windows, so tell the host first and retry briefly.
    super::probe::reload_dictionaries();
    let path = dicts.join(file);
    let mut last = Ok(());
    for _ in 0..10 {
        last = std::fs::remove_file(&path);
        if last.is_ok() || !path.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    last.map_err(|e| format!("catalog updated but the file could not be deleted: {e}"))
}
