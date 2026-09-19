//! Reading an `.mdict` in place.

use std::fs::File;
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;

use fst::{IntoStreamer, Streamer};

use super::layout::*;
use super::{DictError, Metadata, Section};

/// One entry as read back: borrows the mapped file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry<'a> {
    pub text: &'a str,
    pub code: &'a str,
    /// Syllables in `code`.
    pub syllables: u8,
    pub freq: u32,
    /// Position in the `ENTR` section; stable for the file's lifetime.
    pub id: u32,
}

/// An open dictionary. Cheap to clone the handle's data out of; the map itself
/// is shared.
pub struct DictFile {
    map: Arc<memmap2::Mmap>,
    meta: Metadata,
    fst: fst::Map<Section>,
    abbr: fst::Map<Section>,
    post: Range<usize>,
    entr: Range<usize>,
    strs: Range<usize>,
    abpo: Range<usize>,
    abid: Range<usize>,
}

impl std::fmt::Debug for DictFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DictFile")
            .field("name", &self.meta.name)
            .field("entries", &self.meta.entries)
            .finish()
    }
}

impl DictFile {
    /// Maps and validates the file: magic, version, kind, every section inside
    /// the file, metadata parseable. A file failing any of these is refused
    /// rather than read partially.
    pub fn open(path: &Path) -> Result<Self, DictError> {
        let file = File::open(path)?;
        // SAFETY: the file is opened read-only and the map is private; the
        // only hazard with a memory map is another process truncating the file
        // under us, which for a dictionary written by rename-into-place means
        // deleting it — and every read below is bounds-checked against the
        // length recorded at open time, so a shrunk file surfaces as an
        // access fault only in the case the OS itself cannot make safe.
        let map = unsafe { memmap2::Mmap::map(&file)? };
        let map = Arc::new(map);
        let bytes: &[u8] = &map;
        if bytes.len() < HEADER_SIZE || &bytes[0..8] != MAGIC {
            return Err(DictError::BadMagic);
        }
        let version = u16::from_le_bytes([bytes[8], bytes[9]]);
        if version != FORMAT_VERSION {
            return Err(DictError::UnsupportedVersion(version));
        }
        let kind = u16::from_le_bytes([bytes[10], bytes[11]]);
        if kind != KIND_DICTIONARY {
            return Err(DictError::UnsupportedKind(kind));
        }
        let count = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
        let table_end = HEADER_SIZE + count * SECTION_ENTRY_SIZE;
        if bytes.len() < table_end {
            return Err(DictError::SectionOutOfBounds("table".into()));
        }
        let mut sections = Vec::with_capacity(count);
        for i in 0..count {
            let at = HEADER_SIZE + i * SECTION_ENTRY_SIZE;
            sections.push(SectionEntry::from_bytes(&bytes[at..at + SECTION_ENTRY_SIZE]));
        }
        let find = |tag: &[u8; 4]| -> Result<Range<usize>, DictError> {
            let name = || String::from_utf8_lossy(tag).into_owned();
            let s = sections
                .iter()
                .find(|s| &s.tag == tag)
                .ok_or_else(|| DictError::MissingSection(name()))?;
            let start = usize::try_from(s.offset).map_err(|_| DictError::SectionOutOfBounds(name()))?;
            let len = usize::try_from(s.length).map_err(|_| DictError::SectionOutOfBounds(name()))?;
            let end = start
                .checked_add(len)
                .ok_or_else(|| DictError::SectionOutOfBounds(name()))?;
            if end > bytes.len() {
                return Err(DictError::SectionOutOfBounds(name()));
            }
            Ok(start..end)
        };
        let meta_range = find(TAG_META)?;
        let meta = std::str::from_utf8(&bytes[meta_range]).map_err(|e| DictError::Metadata(e.to_string()))?;
        let meta = Metadata::from_toml(meta).map_err(|e| DictError::Metadata(e.to_string()))?;
        let fst_range = find(TAG_FST)?;
        let abbr_range = find(TAG_ABBR)?;
        let fst = fst::Map::new(Section::new(map.clone(), fst_range.start, fst_range.end))?;
        let abbr = fst::Map::new(Section::new(map.clone(), abbr_range.start, abbr_range.end))?;
        Ok(Self {
            post: find(TAG_POST)?,
            entr: find(TAG_ENTR)?,
            strs: find(TAG_STRS)?,
            abpo: find(TAG_ABPO)?,
            abid: find(TAG_ABID)?,
            map,
            meta,
            fst,
            abbr,
        })
    }

    pub fn meta(&self) -> &Metadata {
        &self.meta
    }

    pub fn entry_count(&self) -> u64 {
        (self.entr.len() / EntryRec::SIZE) as u64
    }

    pub fn code_count(&self) -> u64 {
        (self.post.len() / CodeRec::SIZE) as u64
    }

    /// Sum of every entry's frequency, from the metadata.
    pub fn total_frequency(&self) -> u64 {
        self.meta.total_frequency
    }

    /// Entries for exactly this code, frequency descending.
    pub fn lookup(&self, code: &str) -> Vec<Entry<'_>> {
        match self.fst.get(code.as_bytes()) {
            Some(code_id) => self.entries_of_code(code_id as u32),
            None => Vec::new(),
        }
    }

    /// Entries for every code that starts with `prefix` and has exactly
    /// `syllables` syllables, over at most `max_keys` codes in key order.
    /// `prefix` is a raw byte prefix: `"ni h"` matches `ni hao`, `ni hen`, …
    /// and not `ni`.
    pub fn lookup_prefix(&self, prefix: &str, syllables: usize, max_keys: usize) -> Vec<Entry<'_>> {
        let mut out = Vec::new();
        let mut stream = self.fst.range().ge(prefix.as_bytes()).into_stream();
        let mut keys = 0;
        while let Some((key, code_id)) = stream.next() {
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            keys += 1;
            if keys > max_keys {
                break;
            }
            let rec = self.code_rec(code_id as u32);
            if rec.syllables as usize == syllables {
                out.extend(self.entries_of_rec(&rec, code_id as u32));
            }
        }
        out
    }

    /// Entries under an abbreviation key (`"n h"`), frequency descending,
    /// capped at [`ABBR_CAP`] when the file was written.
    pub fn lookup_abbr(&self, abbr_key: &str) -> Vec<Entry<'_>> {
        let Some(abbr_id) = self.abbr.get(abbr_key.as_bytes()) else {
            return Vec::new();
        };
        let at = self.abpo.start + abbr_id as usize * AbbrRec::SIZE;
        let rec = AbbrRec::from_bytes(&self.map[at..at + AbbrRec::SIZE]);
        (0..rec.count)
            .map(|i| {
                let at = self.abid.start + (rec.start + i) as usize * 4;
                let b = &self.map[at..at + 4];
                u32::from_le_bytes([b[0], b[1], b[2], b[3]])
            })
            .filter_map(|id| self.entry(id))
            .collect()
    }

    /// The entry with this id, if the id is in range.
    pub fn entry(&self, id: u32) -> Option<Entry<'_>> {
        let at = self.entr.start + id as usize * EntryRec::SIZE;
        if at + EntryRec::SIZE > self.entr.end {
            return None;
        }
        let rec = EntryRec::from_bytes(&self.map[at..at + EntryRec::SIZE]);
        let code_rec = self.code_rec(rec.code_id);
        Some(Entry {
            text: self.string(rec.text_off, rec.text_len as usize),
            code: self.string(code_rec.code_off, code_rec.code_len as usize),
            syllables: code_rec.syllables,
            freq: rec.freq,
            id,
        })
    }

    /// Every entry in file order. For tests, exports and statistics.
    pub fn entries(&self) -> impl Iterator<Item = Entry<'_>> + '_ {
        (0..self.entry_count() as u32).filter_map(|id| self.entry(id))
    }

    fn code_rec(&self, code_id: u32) -> CodeRec {
        let at = self.post.start + code_id as usize * CodeRec::SIZE;
        CodeRec::from_bytes(&self.map[at..at + CodeRec::SIZE])
    }

    fn entries_of_code(&self, code_id: u32) -> Vec<Entry<'_>> {
        let rec = self.code_rec(code_id);
        self.entries_of_rec(&rec, code_id)
    }

    fn entries_of_rec(&self, rec: &CodeRec, _code_id: u32) -> Vec<Entry<'_>> {
        let code = self.string(rec.code_off, rec.code_len as usize);
        (rec.entry_start..rec.entry_start.saturating_add(rec.entry_count))
            .filter_map(|id| {
                let at = self.entr.start + id as usize * EntryRec::SIZE;
                if at + EntryRec::SIZE > self.entr.end {
                    return None;
                }
                let e = EntryRec::from_bytes(&self.map[at..at + EntryRec::SIZE]);
                Some(Entry {
                    text: self.string(e.text_off, e.text_len as usize),
                    code,
                    syllables: rec.syllables,
                    freq: e.freq,
                    id,
                })
            })
            .collect()
    }

    fn string(&self, off: u32, len: usize) -> &str {
        let start = self.strs.start + off as usize;
        let end = (start + len).min(self.strs.end);
        std::str::from_utf8(&self.map[start..end]).unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::super::{DictWriter, Metadata};
    use super::*;
    use crate::syllable::SyllableTable;

    fn meta() -> Metadata {
        Metadata {
            name: "test".into(),
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
        }
    }

    #[test]
    fn roundtrip_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.mdict");
        let table = SyllableTable::new();
        let mut w = DictWriter::new();
        assert!(w.add("ni", "你", 100));
        assert!(w.add("ni", "尼", 50));
        assert!(!w.add("ni", "你", 1), "duplicate keeps the first");
        w.add("ni hao", "你好", 300);
        w.add("ni hen", "你很", 30);
        w.add("ni hao ma", "你好吗", 3);
        w.add("nu hao", "怒号", 5);
        let stats = w.write(&path, &meta(), &table).unwrap();
        assert_eq!(stats.codes, 5);
        assert_eq!(stats.entries, 6);
        assert_eq!(w.duplicates(), 1);
        assert!(!dir.path().join(".t.mdict.tmp-0").exists());
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no temp file left behind"
        );

        let d = DictFile::open(&path).unwrap();
        assert_eq!(d.meta().entries, 6);
        assert_eq!(d.meta().codes, 5);
        assert_eq!(d.meta().total_frequency, 488);
        assert_eq!(d.meta().format_version, FORMAT_VERSION);
        let ni: Vec<_> = d.lookup("ni").iter().map(|e| (e.text, e.freq)).collect();
        assert_eq!(ni, vec![("你", 100), ("尼", 50)]);
        assert_eq!(d.lookup("ni")[0].code, "ni");
        assert_eq!(d.lookup("ni")[0].syllables, 1);
        assert!(d.lookup("nihao").is_empty());

        let prefix: Vec<_> = d.lookup_prefix("ni h", 2, 100).iter().map(|e| e.text).collect();
        assert_eq!(prefix, vec!["你好", "你很"], "three-syllable code is filtered out");
        assert!(d.lookup_prefix("ni h", 2, 1).len() <= 2);
        let abbr: Vec<_> = d.lookup_abbr("n h").iter().map(|e| e.text).collect();
        assert_eq!(abbr, vec!["你好", "你很", "怒号"], "frequency descending across codes");
        assert_eq!(d.lookup_abbr("n h m")[0].text, "你好吗");
        assert!(d.lookup_abbr("x").is_empty());
        assert_eq!(d.entries().count(), 6);
    }

    #[test]
    fn a_code_with_more_than_65535_entries_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.mdict");
        let mut w = DictWriter::new();
        const N: u32 = 70_000;
        for i in 0..N {
            w.add("a", &format!("字{i}"), N - i);
        }
        w.add("b", "乙", 1);
        w.write(&path, &meta(), &SyllableTable::new()).unwrap();
        let d = DictFile::open(&path).unwrap();
        let a = d.lookup("a");
        assert_eq!(a.len(), N as usize);
        assert_eq!(a[0].text, "字0");
        assert_eq!(a[N as usize - 1].text, &format!("字{}", N - 1));
        assert_eq!(d.lookup("b")[0].text, "乙");
    }

    #[test]
    fn corrupt_magic_or_version_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.mdict");
        let mut w = DictWriter::new();
        w.add("a", "啊", 1);
        w.write(&path, &meta(), &SyllableTable::new()).unwrap();
        let good = std::fs::read(&path).unwrap();

        let mut bad = good.clone();
        bad[0] = b'X';
        std::fs::write(&path, &bad).unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::BadMagic)));

        let mut bad = good.clone();
        bad[8] = 99;
        std::fs::write(&path, &bad).unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::UnsupportedVersion(99))));

        std::fs::write(&path, &good[..64]).unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::SectionOutOfBounds(_))));

        std::fs::write(&path, b"short").unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::BadMagic)));
    }
}
