//! Bringing a dictionary written by an older build up to this one's format.
//!
//! Not a chain of migrations: a `.mdict` holds every `(code, text, frequency)`
//! it was built from, and everything else in it is derived. So an upgrade is
//! the old format's reader (`legacy`) handing its rows to the current
//! writer, whatever the distance between the two versions. No source file is
//! needed — on Android there is none left, since a dictionary is imported
//! from a download or an archive unpacked into a scratch directory.
//!
//! The file keeps its name and its metadata, so the catalog does not change
//! and a host watching the directory sees one file rewritten. Written to a
//! sibling first, read back and counted, and only then renamed over the
//! original: every failure leaves the old file exactly as it was.
//!
//! One thing does not carry over. `cache_key` hashes the format version, and
//! the upgraded file keeps the key it was imported under — importing the same
//! source again computes a different key and so a second file. That is what
//! any importer or format change has always done, and deciding "the same
//! dictionary" by anything else is a separate change.

use std::path::{Path, PathBuf};

use super::layout::FORMAT_VERSION;
use super::legacy::{self, Row};
use super::reader::{container, map_file};
use super::{DictError, DictFile, DictWriter};
use crate::syllable::SyllableTable;

/// What `upgrade_in_place` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upgrade {
    /// Already readable by this build; untouched.
    Current { version: u16 },
    /// Rebuilt from format `from`.
    Upgraded { from: u16, entries: u64 },
}

/// Upgrades `path` in place if it is older than this build's format. A file
/// newer than this build is left alone: readable (`min_reader` allows it) is
/// `Current`, unreadable is `TooNew` — nothing here writes an older format.
pub fn upgrade_in_place(path: &Path, table: &SyllableTable) -> Result<Upgrade, DictError> {
    let version = {
        let map = map_file(path)?;
        let header = container(&map)?;
        match header.readable() {
            Ok(()) => {
                return Ok(Upgrade::Current {
                    version: header.version,
                });
            }
            Err(DictError::NeedsUpgrade(v)) => v,
            Err(e) => return Err(e),
        }
        // The map is dropped here: on Windows a mapped file cannot be
        // replaced, and the rename below replaces this one.
    };
    let (meta, rows) = match version {
        legacy::v1::VERSION => legacy::v1::entries(path)?,
        v => {
            return Err(DictError::UpgradeCheck(format!(
                "no reader for format version {v}; import the dictionary again"
            )));
        }
    };

    let staging = staging_path(path);
    if staging.is_file() {
        let _ = std::fs::remove_file(&staging);
    }
    let result = rebuild(&staging, &meta, &rows, table).and_then(|entries| {
        replace(&staging, path)?;
        Ok(entries)
    });
    match result {
        Ok(entries) => Ok(Upgrade::Upgraded { from: version, entries }),
        Err(e) => {
            if staging.is_file() {
                let _ = std::fs::remove_file(&staging);
            }
            Err(e)
        }
    }
}

/// Writes `rows` to `staging` in the current format and reads it back.
fn rebuild(staging: &Path, meta: &super::Metadata, rows: &[Row], table: &SyllableTable) -> Result<u64, DictError> {
    let mut writer = DictWriter::new();
    for (code, text, freq) in rows {
        writer.add(code, text, *freq);
    }
    if writer.duplicates() > 0 {
        return Err(DictError::UpgradeCheck(format!(
            "{} entries repeat a (code, text) pair; the file is damaged",
            writer.duplicates()
        )));
    }
    writer.write(staging, meta, table)?;
    check_written(&DictFile::open(staging)?, rows)
}

/// The file just written holds as many entries as were read, with the same
/// total frequency. The writer is trusted to lay them out; this catches it
/// dropping or merging some, which would pass for a smaller dictionary.
fn check_written(written: &DictFile, rows: &[Row]) -> Result<u64, DictError> {
    let expected = rows.len() as u64;
    let frequency: u64 = rows.iter().map(|(_, _, f)| *f as u64).sum();
    if written.entry_count() != expected || written.total_frequency() != frequency {
        return Err(DictError::UpgradeCheck(format!(
            "wrote {} entries totalling {}, expected {expected} totalling {frequency}",
            written.entry_count(),
            written.total_frequency()
        )));
    }
    debug_assert_eq!(written.meta().format_version, FORMAT_VERSION);
    Ok(expected)
}

/// Renames `from` over `to`, retrying for a moment: on Windows a file some
/// other process has mapped cannot be replaced, and a host reloading the
/// directory maps every listed file — this one included, briefly, even though
/// it refuses it.
fn replace(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = Ok(());
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        last = std::fs::rename(from, to);
        match &last {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => continue,
            _ => break,
        }
    }
    last
}

fn staging_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.upgrade-{}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::format::layout::{HEADER_SIZE, MIN_READER_VERSION};

    /// Written by the version 1 writer (commit a2c3501) from
    /// `tests/fixtures/v1.dict.yaml`; real old bytes, not a patched header.
    const V1: &[u8] = include_bytes!("../../tests/fixtures/v1.mdict");
    const V1_SOURCE: &str = include_str!("../../tests/fixtures/v1.dict.yaml");

    /// What the fixture was imported from, read without any of this crate:
    /// the rows after the header, `text<TAB>code<TAB>weight`. The expectation
    /// has to come from somewhere the v1 reader is not, or a reader that
    /// misread a field would agree with itself.
    fn source_rows() -> BTreeSet<(String, String, u32)> {
        V1_SOURCE
            .split("\n...\n")
            .nth(1)
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| {
                let mut f = l.split('\t');
                let text = f.next().unwrap().to_string();
                let code = f.next().unwrap().to_string();
                (code, text, f.next().unwrap().trim().parse().unwrap())
            })
            .collect()
    }

    fn v1_copy(dir: &Path) -> PathBuf {
        let path = dir.join("fixture-3324241c75656cac.mdict");
        std::fs::write(&path, V1).unwrap();
        path
    }

    fn rows_of(file: &DictFile) -> BTreeSet<(String, String, u32)> {
        file.entries()
            .map(|e| (e.code.to_string(), e.text.to_string(), e.freq))
            .collect()
    }

    #[test]
    fn the_fixture_is_version_one() {
        assert_eq!(u16::from_le_bytes([V1[8], V1[9]]), 1);
        assert_eq!(&V1[16..HEADER_SIZE], &[0u8; 16], "reserved bytes were zero");
    }

    #[test]
    fn a_version_one_file_is_rebuilt_with_every_entry_and_its_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = v1_copy(dir.path());
        assert!(matches!(DictFile::open(&path), Err(DictError::NeedsUpgrade(1))));
        let (old_meta, old_rows) = legacy::v1::entries(&path).unwrap();
        assert_eq!(old_rows.len(), 18);

        let outcome = upgrade_in_place(&path, &SyllableTable::new()).unwrap();
        assert_eq!(outcome, Upgrade::Upgraded { from: 1, entries: 18 });

        let d = DictFile::open(&path).unwrap();
        let read: BTreeSet<_> = old_rows.into_iter().collect();
        assert_eq!(read, source_rows(), "the v1 reader reads what was imported");
        assert_eq!(
            rows_of(&d),
            source_rows(),
            "every (code, text, frequency), nothing else"
        );
        let meta = d.meta();
        assert_eq!(meta.format_version, FORMAT_VERSION);
        assert_eq!(meta.name, old_meta.name);
        assert_eq!(meta.license, "CC0-1.0");
        assert_eq!(meta.source, old_meta.source);
        assert_eq!(meta.cache_key, old_meta.cache_key);
        assert_eq!(meta.created_unix, old_meta.created_unix);
        assert_eq!(meta.total_frequency, old_meta.total_frequency);

        let conts: Vec<_> = d.lookup_continuations("中国").iter().map(|e| e.text).collect();
        assert_eq!(conts, vec!["中国人", "中国队", "中国行"], "and it now predicts");
        assert_eq!(
            d.lookup_continuations("中国")[2].freq,
            40,
            "a polyphone at its commoner reading"
        );
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(u16::from_le_bytes([bytes[16], bytes[17]]), MIN_READER_VERSION);
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no staging file left behind"
        );
    }

    #[test]
    fn a_current_file_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = v1_copy(dir.path());
        upgrade_in_place(&path, &SyllableTable::new()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(
            upgrade_in_place(&path, &SyllableTable::new()).unwrap(),
            Upgrade::Current {
                version: FORMAT_VERSION
            }
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), modified);
    }

    #[test]
    fn a_failed_upgrade_leaves_the_old_file_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let path = v1_copy(dir.path());
        // Something already standing where the new file is written.
        std::fs::create_dir(staging_path(&path)).unwrap();
        assert!(upgrade_in_place(&path, &SyllableTable::new()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), V1);
    }

    #[test]
    fn a_written_file_that_lost_or_changed_entries_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = v1_copy(dir.path());
        let (_, rows) = legacy::v1::entries(&path).unwrap();
        upgrade_in_place(&path, &SyllableTable::new()).unwrap();
        let written = DictFile::open(&path).unwrap();
        assert_eq!(check_written(&written, &rows).unwrap(), rows.len() as u64);
        assert!(
            check_written(&written, &rows[1..]).is_err(),
            "one entry more than expected"
        );
        let mut heavier = rows.clone();
        heavier[0].2 += 1;
        assert!(check_written(&written, &heavier).is_err(), "a frequency changed");
    }
}
