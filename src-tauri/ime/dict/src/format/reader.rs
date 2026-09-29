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
    prfx: fst::Map<Section>,
    post: Range<usize>,
    entr: Range<usize>,
    strs: Range<usize>,
    abpo: Range<usize>,
    abid: Range<usize>,
    prpo: Range<usize>,
    prid: Range<usize>,
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
        let map = Arc::new(map_file(path)?);
        let bytes: &[u8] = &map;
        let header = container(bytes)?;
        header.readable()?;
        let sections = &header.sections;
        let find = |tag: &[u8; 4]| section(bytes, sections, tag);
        let meta = metadata(bytes, sections)?;
        let fst_range = find(TAG_FST)?;
        let abbr_range = find(TAG_ABBR)?;
        let fst = fst::Map::new(Section::new(map.clone(), fst_range.start, fst_range.end))?;
        let abbr = fst::Map::new(Section::new(map.clone(), abbr_range.start, abbr_range.end))?;
        let prfx_range = find(TAG_PRFX)?;
        let prfx = fst::Map::new(Section::new(map.clone(), prfx_range.start, prfx_range.end))?;
        Ok(Self {
            post: find(TAG_POST)?,
            entr: find(TAG_ENTR)?,
            strs: find(TAG_STRS)?,
            abpo: find(TAG_ABPO)?,
            abid: find(TAG_ABID)?,
            prpo: find(TAG_PRPO)?,
            prid: find(TAG_PRID)?,
            map,
            meta,
            fst,
            abbr,
            prfx,
        })
    }

    pub fn meta(&self) -> &Metadata {
        &self.meta
    }

    /// The format version a file was written in and its `META` section, for
    /// any version this build knows the header of. Only for saying what a
    /// file is and whether it needs upgrading — nothing is looked up in a file
    /// `open` refuses.
    pub fn metadata_of(path: &Path) -> Result<(u16, Metadata), DictError> {
        let map = map_file(path)?;
        let header = container(&map)?;
        let meta = metadata(&map, &header.sections)?;
        Ok((header.version, meta))
    }

    /// Whether this build can open a file, from its header alone.
    pub fn check_version(path: &Path) -> Result<u16, DictError> {
        let map = map_file(path)?;
        let header = container(&map)?;
        header.readable()?;
        Ok(header.version)
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
        self.id_slice(&self.abpo, &self.abid, abbr_id)
    }

    /// The longer words that start with the word `text`, frequency
    /// descending, capped at [`CONTINUATION_CAP`] when the file was written.
    /// Empty for a text that is not itself a word here.
    pub fn lookup_continuations(&self, text: &str) -> Vec<Entry<'_>> {
        match self.prfx.get(text.as_bytes()) {
            Some(id) => self.id_slice(&self.prpo, &self.prid, id),
            None => Vec::new(),
        }
    }

    /// Entry `n` of a `(start, count)` table over a `u32` id list, resolved.
    /// Out-of-range records resolve to nothing rather than panic.
    fn id_slice(&self, po: &Range<usize>, ids: &Range<usize>, n: u64) -> Vec<Entry<'_>> {
        let at = po.start + n as usize * AbbrRec::SIZE;
        if at + AbbrRec::SIZE > po.end {
            return Vec::new();
        }
        let rec = AbbrRec::from_bytes(&self.map[at..at + AbbrRec::SIZE]);
        (0..rec.count)
            .filter_map(|i| {
                let at = ids.start + (rec.start + i) as usize * 4;
                let b = self.map.get(at..at + 4).filter(|_| at + 4 <= ids.end)?;
                self.entry(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            })
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

pub(crate) fn map_file(path: &Path) -> Result<memmap2::Mmap, DictError> {
    let file = File::open(path)?;
    // SAFETY: the file is opened read-only and the map is private; the only
    // hazard with a memory map is another process truncating the file under
    // us, which for a dictionary written by rename-into-place means deleting
    // it — and every read is bounds-checked against the length recorded at
    // open time, so a shrunk file surfaces as an access fault only in the
    // case the OS itself cannot make safe.
    Ok(unsafe { memmap2::Mmap::map(&file)? })
}

/// What the header says: the two versions and the section table.
pub(crate) struct Header {
    pub version: u16,
    /// Already resolved: a zero in the file reads as `version`.
    pub min_reader: u16,
    pub sections: Vec<SectionEntry>,
}

impl Header {
    /// The rule `layout` describes: this build reads its own version, and a
    /// newer one whose writer said this build is enough; an older one is
    /// upgraded rather than read.
    pub fn readable(&self) -> Result<(), DictError> {
        if self.version < FORMAT_VERSION {
            return Err(DictError::NeedsUpgrade(self.version));
        }
        if self.min_reader > FORMAT_VERSION {
            return Err(DictError::TooNew {
                version: self.version,
                min_reader: self.min_reader,
            });
        }
        Ok(())
    }
}

/// Magic, kind, the two versions and the section table — everything the
/// header has kept in the same place across versions. Versions are returned,
/// not judged.
pub(crate) fn container(bytes: &[u8]) -> Result<Header, DictError> {
    if bytes.len() < HEADER_SIZE || &bytes[0..8] != MAGIC {
        return Err(DictError::BadMagic);
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    let kind = u16::from_le_bytes([bytes[10], bytes[11]]);
    if kind != KIND_DICTIONARY {
        return Err(DictError::UnsupportedKind(kind));
    }
    let count = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
    let min_reader = match u16::from_le_bytes([bytes[16], bytes[17]]) {
        0 => version,
        n => n,
    };
    let table_end = HEADER_SIZE + count * SECTION_ENTRY_SIZE;
    if bytes.len() < table_end {
        return Err(DictError::SectionOutOfBounds("table".into()));
    }
    let sections = (0..count)
        .map(|i| {
            let at = HEADER_SIZE + i * SECTION_ENTRY_SIZE;
            SectionEntry::from_bytes(&bytes[at..at + SECTION_ENTRY_SIZE])
        })
        .collect();
    Ok(Header {
        version,
        min_reader,
        sections,
    })
}

pub(crate) fn section(bytes: &[u8], sections: &[SectionEntry], tag: &[u8; 4]) -> Result<Range<usize>, DictError> {
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
}

pub(crate) fn metadata(bytes: &[u8], sections: &[SectionEntry]) -> Result<Metadata, DictError> {
    let range = section(bytes, sections, TAG_META)?;
    let text = std::str::from_utf8(&bytes[range]).map_err(|e| DictError::Metadata(e.to_string()))?;
    Metadata::from_toml(text).map_err(|e| DictError::Metadata(e.to_string()))
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
    fn continuations_are_the_longer_words_a_word_begins() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.mdict");
        let mut w = DictWriter::new();
        w.add("zhong", "中", 900);
        w.add("zhong guo", "中国", 800);
        w.add("zhong guo ren", "中国人", 300);
        w.add("zhong guo dui", "中国队", 100);
        w.add("zhong guo ren min", "中国人民", 200);
        // A polyphone is one word to predict, at its commoner reading.
        w.add("zhong guo xing", "中国行", 20);
        w.add("zhong guo hang", "中国行", 40);
        // 中华 is not a word here, so 中华人民 is nobody's continuation of it.
        w.add("zhong hua ren min", "中华人民", 50);
        w.write(&path, &meta(), &SyllableTable::new()).unwrap();
        let d = DictFile::open(&path).unwrap();

        let of = |t: &str| d.lookup_continuations(t).iter().map(|e| e.text).collect::<Vec<_>>();
        assert_eq!(of("中国"), vec!["中国人", "中国人民", "中国队", "中国行"]);
        assert_eq!(d.lookup_continuations("中国")[3].freq, 40);
        assert_eq!(of("中国人"), vec!["中国人民"]);
        assert_eq!(of("中")[0], "中国", "a one-character word has continuations too");
        assert!(of("中华").is_empty(), "not a word, so not a key");
        assert!(of("中国人民").is_empty(), "nothing longer");
        assert!(of("国").is_empty(), "a word's middle is not its start");
    }

    #[test]
    fn continuations_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cap.mdict");
        let mut w = DictWriter::new();
        w.add("wo", "我", 1);
        for i in 0..(CONTINUATION_CAP as u32 + 5) {
            w.add("wo men", &format!("我{i}"), i);
        }
        w.write(&path, &meta(), &SyllableTable::new()).unwrap();
        let d = DictFile::open(&path).unwrap();
        let conts = d.lookup_continuations("我");
        assert_eq!(conts.len(), CONTINUATION_CAP);
        assert_eq!(
            conts[0].text,
            format!("我{}", CONTINUATION_CAP + 4),
            "the commonest kept"
        );
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

    /// A file as some later build might write it: every section this one
    /// knows, one it does not, and the two versions as given.
    fn future_file(dir: &Path, version: u16, min_reader: u16) -> std::path::PathBuf {
        let current = dir.join("current.mdict");
        let mut w = DictWriter::new();
        w.add("ni", "你", 100);
        w.add("ni hao", "你好", 300);
        w.write(&current, &meta(), &SyllableTable::new()).unwrap();
        let bytes = std::fs::read(&current).unwrap();
        let header = container(&bytes).unwrap();
        let mut sections: Vec<([u8; 4], Vec<u8>)> = header
            .sections
            .iter()
            .map(|s| (s.tag, bytes[s.offset as usize..(s.offset + s.length) as usize].to_vec()))
            .collect();
        sections.push((*b"ZZZZ", b"something new".to_vec()));
        let refs: Vec<(&[u8; 4], &[u8])> = sections.iter().map(|(t, d)| (t, d.as_slice())).collect();
        let path = dir.join(format!("future-{version}-{min_reader}.mdict"));
        super::super::writer::write_sections(&path, &refs).unwrap();
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[8..10].copy_from_slice(&version.to_le_bytes());
        bytes[16..18].copy_from_slice(&min_reader.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn a_newer_file_opens_when_its_writer_said_this_reader_is_enough() {
        let dir = tempfile::tempdir().unwrap();
        let d = DictFile::open(&future_file(dir.path(), FORMAT_VERSION + 1, FORMAT_VERSION)).unwrap();
        assert_eq!(d.lookup("ni hao")[0].text, "你好", "the unknown section is skipped");
        assert_eq!(d.lookup_continuations("你")[0].text, "你好");
        assert!(matches!(
            DictFile::open(&future_file(dir.path(), FORMAT_VERSION + 1, FORMAT_VERSION + 1)),
            Err(DictError::TooNew { version, min_reader }) if version == FORMAT_VERSION + 1 && min_reader == FORMAT_VERSION + 1
        ));
        assert!(
            matches!(
                DictFile::open(&future_file(dir.path(), FORMAT_VERSION + 1, 0)),
                Err(DictError::TooNew { .. })
            ),
            "a zero min_reader is the version itself"
        );
        assert!(DictFile::open(&future_file(dir.path(), FORMAT_VERSION, 0)).is_ok());
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
        bad[8] = 1;
        bad[16] = 0;
        std::fs::write(&path, &bad).unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::NeedsUpgrade(1))));
        // Refused for typing, still able to say what it is.
        let (version, meta) = DictFile::metadata_of(&path).unwrap();
        assert_eq!(version, 1);
        assert_eq!(meta.name, "test");

        std::fs::write(&path, &good[..64]).unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::SectionOutOfBounds(_))));

        std::fs::write(&path, b"short").unwrap();
        assert!(matches!(DictFile::open(&path), Err(DictError::BadMagic)));
    }
}
