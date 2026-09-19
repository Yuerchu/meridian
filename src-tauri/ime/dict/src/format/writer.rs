//! Building an `.mdict` from triples.
//!
//! The whole dictionary sits in memory while it is built — a `BTreeMap` of
//! codes to their texts — which is fine for the sizes involved (rime-ice is
//! ~700k entries and builds in a few seconds) and gives the FST the sorted
//! keys it needs for free. The file is written to a sibling temporary path and
//! renamed into place, so a crash mid-write leaves no half dictionary that
//! `DictFile::open` would then have to distrust.

use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use super::layout::*;
use super::{DictError, Metadata};
use crate::syllable::SyllableTable;

/// What `write` produced, for the import report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WriterStats {
    pub codes: u64,
    pub entries: u64,
    pub abbreviations: u64,
    pub bytes: u64,
}

/// Accumulates `(code, text, frequency)` and writes them out.
///
/// The same `(code, text)` added twice keeps the first frequency — the Rime
/// convention that the topmost row wins — and counts the repeat in
/// [`DictWriter::duplicates`]. Codes are not validated here; the importer does
/// that against the syllable table before adding, and a test dictionary may
/// want a code no syllable table would accept.
#[derive(Debug, Default)]
pub struct DictWriter {
    codes: BTreeMap<String, BTreeMap<String, u32>>,
    entries: u64,
    duplicates: u64,
}

impl DictWriter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds one triple. Returns `false` when `(code, text)` was already present.
    pub fn add(&mut self, code: &str, text: &str, freq: u32) -> bool {
        let texts = self.codes.entry(code.to_string()).or_default();
        if texts.contains_key(text) {
            self.duplicates += 1;
            return false;
        }
        texts.insert(text.to_string(), freq);
        self.entries += 1;
        true
    }

    pub fn entries(&self) -> u64 {
        self.entries
    }

    pub fn duplicates(&self) -> u64 {
        self.duplicates
    }

    pub fn codes(&self) -> u64 {
        self.codes.len() as u64
    }

    pub fn total_frequency(&self) -> u64 {
        self.codes.values().flat_map(|t| t.values()).map(|&f| f as u64).sum()
    }

    /// Writes the dictionary to `path`. `meta` is stored as given except for
    /// `entries`, `codes`, `total_frequency` and `format_version`, which are
    /// filled in from what was added. `table` supplies the abbreviation keys;
    /// codes it does not recognise get no abbreviation and are otherwise kept.
    pub fn write(&self, path: &Path, meta: &Metadata, table: &SyllableTable) -> Result<WriterStats, DictError> {
        const MAX_ENTRIES: u64 = u32::MAX as u64;
        if self.entries > MAX_ENTRIES {
            return Err(DictError::TooManyEntries {
                max: MAX_ENTRIES,
                given: self.entries,
            });
        }

        let mut strings = StringPool::default();
        let mut post = Vec::with_capacity(self.codes.len() * CodeRec::SIZE);
        let mut entr = Vec::with_capacity(self.entries as usize * EntryRec::SIZE);
        let mut fst_builder = fst::MapBuilder::memory();
        // abbreviation key → (freq, entry id), gathered then capped.
        let mut abbr: BTreeMap<String, Vec<(u32, u32)>> = BTreeMap::new();

        let mut entry_id: u32 = 0;
        for (code_id, (code, texts)) in self.codes.iter().enumerate() {
            let code_id = code_id as u32;
            if code.len() > u16::MAX as usize {
                return Err(DictError::CodeTooLong {
                    max: u16::MAX as usize,
                    given: code.clone(),
                    len: code.len(),
                });
            }
            let code_off = strings.intern(code);
            let mut sorted: Vec<(&String, &u32)> = texts.iter().collect();
            // Frequency descending, then text for a stable order between builds.
            sorted.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            let syllables = code.split(' ').count().min(u8::MAX as usize) as u8;
            post.extend_from_slice(
                &CodeRec {
                    code_off,
                    code_len: code.len() as u16,
                    syllables,
                    entry_start: entry_id,
                    entry_count: sorted.len() as u32,
                }
                .to_bytes(),
            );
            fst_builder.insert(code.as_bytes(), code_id as u64)?;
            let abbr_key = table.abbr_key(code);
            for (text, &freq) in sorted {
                if text.len() > u16::MAX as usize {
                    return Err(DictError::TextTooLong {
                        max: u16::MAX as usize,
                        given: text.clone(),
                        len: text.len(),
                    });
                }
                let text_off = strings.intern(text);
                entr.extend_from_slice(
                    &EntryRec {
                        text_off,
                        text_len: text.len() as u16,
                        freq,
                        code_id,
                    }
                    .to_bytes(),
                );
                if let Some(key) = &abbr_key {
                    abbr.entry(key.clone()).or_default().push((freq, entry_id));
                }
                entry_id += 1;
            }
        }
        let fst_bytes = fst_builder.into_inner()?;

        let mut abpo = Vec::with_capacity(abbr.len() * AbbrRec::SIZE);
        let mut abid = Vec::new();
        let mut abbr_builder = fst::MapBuilder::memory();
        for (abbr_id, (key, mut ids)) in abbr.into_iter().enumerate() {
            ids.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            ids.truncate(ABBR_CAP);
            abpo.extend_from_slice(
                &AbbrRec {
                    start: (abid.len() / 4) as u32,
                    count: ids.len() as u32,
                }
                .to_bytes(),
            );
            for (_, id) in ids {
                abid.extend_from_slice(&id.to_le_bytes());
            }
            abbr_builder.insert(key.as_bytes(), abbr_id as u64)?;
        }
        let abbr_bytes = abbr_builder.into_inner()?;

        let meta = Metadata {
            entries: self.entries,
            codes: self.codes.len() as u64,
            total_frequency: self.total_frequency(),
            format_version: FORMAT_VERSION,
            ..meta.clone()
        };
        let meta_bytes = meta
            .to_toml()
            .map_err(|e| DictError::Metadata(e.to_string()))?
            .into_bytes();

        let sections: [(&[u8; 4], &[u8]); 8] = [
            (TAG_META, &meta_bytes),
            (TAG_FST, &fst_bytes),
            (TAG_POST, &post),
            (TAG_ENTR, &entr),
            (TAG_STRS, strings.bytes()),
            (TAG_ABBR, &abbr_bytes),
            (TAG_ABPO, &abpo),
            (TAG_ABID, &abid),
        ];

        let tmp = temp_path(path);
        let bytes = match write_sections(&tmp, &sections) {
            Ok(b) => b,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        };
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(WriterStats {
            codes: self.codes.len() as u64,
            entries: self.entries,
            abbreviations: (abpo.len() / AbbrRec::SIZE) as u64,
            bytes,
        })
    }
}

fn temp_path(path: &Path) -> std::path::PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.tmp-{}", std::process::id()))
}

fn write_sections(path: &Path, sections: &[(&[u8; 4], &[u8])]) -> Result<u64, DictError> {
    let mut file = BufWriter::new(File::create(path)?);
    let table_end = HEADER_SIZE + sections.len() * SECTION_ENTRY_SIZE;
    let mut offset = align_up(table_end);
    let mut entries = Vec::with_capacity(sections.len());
    for (tag, data) in sections {
        entries.push(SectionEntry {
            tag: **tag,
            offset: offset as u64,
            length: data.len() as u64,
        });
        offset = align_up(offset + data.len());
    }

    let mut header = [0u8; HEADER_SIZE];
    header[0..8].copy_from_slice(MAGIC);
    header[8..10].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
    header[10..12].copy_from_slice(&KIND_DICTIONARY.to_le_bytes());
    header[12..16].copy_from_slice(&(sections.len() as u32).to_le_bytes());
    file.write_all(&header)?;
    for entry in &entries {
        file.write_all(&entry.to_bytes())?;
    }
    let mut written = table_end;
    for ((_, data), entry) in sections.iter().zip(&entries) {
        let pad = entry.offset as usize - written;
        file.write_all(&[0u8; ALIGN][..pad])?;
        file.write_all(data)?;
        written = entry.offset as usize + data.len();
    }
    let pad = align_up(written) - written;
    file.write_all(&[0u8; ALIGN][..pad])?;
    written += pad;
    file.flush()?;
    file.get_ref().sync_all()?;
    Ok(written as u64)
}

/// A string pool that stores each distinct string once.
#[derive(Default)]
struct StringPool {
    bytes: Vec<u8>,
    seen: HashMap<String, u32>,
}

impl StringPool {
    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&off) = self.seen.get(s) {
            return off;
        }
        let off = self.bytes.len() as u32;
        self.bytes.extend_from_slice(s.as_bytes());
        self.seen.insert(s.to_string(), off);
        off
    }

    fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}
