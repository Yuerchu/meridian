//! Byte layout of the `.mdict` container, version 2.
//!
//! The file is mapped whole and read in place: every record is a fixed-width
//! little-endian struct addressed by offset, and nothing is deserialised into
//! an owned structure except the small `META` section. That is what makes
//! opening a 700k-entry dictionary a matter of milliseconds.
//!
//! ```text
//! Header       32 B   magic "MERIDIME" | version u16 | kind u16 | section_count u32 | min_reader u16 | reserved [u8; 14]
//! SectionEntry 24 B   tag [u8; 4] | reserved u32 | offset u64 | length u64      × section_count
//! sections …          each 8-byte aligned
//! ```
//!
//! | tag    | contents |
//! |--------|----------|
//! | `META` | TOML, see [`super::Metadata`] |
//! | `FST_` | `fst::Map`: spaced pinyin code → code id |
//! | `POST` | [`CodeRec`] per code id: where its entries are (count is **u32**) |
//! | `ENTR` | [`EntryRec`] per entry, grouped by code, frequency descending |
//! | `STRS` | UTF-8 string pool for texts and codes |
//! | `ABBR` | `fst::Map`: abbreviation key (`"n h"`) → abbreviation id |
//! | `ABPO` | [`AbbrRec`] per abbreviation id: a slice of `ABID` |
//! | `ABID` | `u32` entry ids, frequency descending, at most [`ABBR_CAP`] per key |
//! | `PRFX` | `fst::Map`: word text → continuation id |
//! | `PRPO` | [`AbbrRec`] per continuation id: a slice of `PRID` |
//! | `PRID` | `u32` entry ids of the longer words starting with that text, frequency descending, at most [`CONTINUATION_CAP`] |
//!
//! Version 2 added the last three, which is what prediction reads: after 中国
//! is committed, the words that start with 中国 say what may come next. They
//! are keyed by a text that is itself a word of the dictionary, since what is
//! looked up is what was just committed, and a prefix nobody can commit is
//! never asked about. A version 1 file is refused rather than read without
//! them: a dictionary that silently never predicts looks like a broken
//! keyboard. It is not imported again either — `upgrade_in_place` rebuilds
//! it from its own entries, which are all there is to a dictionary.
//!
//! ## Two versions in the header
//!
//! `version` is what wrote the file; `min_reader` is the oldest reader that
//! can still read it, and is what lets an older build open a newer file. A
//! reader finds sections by tag and skips the ones it does not know, so a
//! change that only *adds* sections — as version 2 did — leaves a file an
//! older reader could use, minus the new feature. Such a change raises
//! `version` and leaves `min_reader` alone. A change to an existing
//! section's layout, or a new `META` field (`Metadata` refuses unknown
//! keys), raises both.
//!
//! The field sits in bytes that were reserved and zero, so `0` means "the
//! same as `version`": a version 1 file, and the first version 2 files
//! written before the field existed. Builds that shipped reading only
//! `version == 1` never look at it and refuse anything newer — the
//! guarantee starts with the builds that do.

pub const MAGIC: &[u8; 8] = b"MERIDIME";
pub const FORMAT_VERSION: u16 = 2;
/// Written into every file as its `min_reader`: version 2 is the first
/// reader that checks the field, so nothing older can be named.
pub const MIN_READER_VERSION: u16 = 2;
/// `kind` distinguishes future containers (a language model, say) sharing the
/// header; a dictionary is 1.
pub const KIND_DICTIONARY: u16 = 1;
pub const HEADER_SIZE: usize = 32;
pub const SECTION_ENTRY_SIZE: usize = 24;
pub const ALIGN: usize = 8;

pub const TAG_META: &[u8; 4] = b"META";
pub const TAG_FST: &[u8; 4] = b"FST_";
pub const TAG_POST: &[u8; 4] = b"POST";
pub const TAG_ENTR: &[u8; 4] = b"ENTR";
pub const TAG_STRS: &[u8; 4] = b"STRS";
pub const TAG_ABBR: &[u8; 4] = b"ABBR";
pub const TAG_ABPO: &[u8; 4] = b"ABPO";
pub const TAG_ABID: &[u8; 4] = b"ABID";

/// How many entries an abbreviation key keeps. `"n h"` matches thousands of
/// two-syllable words; a typist abbreviating wants the common ones.
pub const ABBR_CAP: usize = 200;

pub const TAG_PRFX: &[u8; 4] = b"PRFX";
pub const TAG_PRPO: &[u8; 4] = b"PRPO";
pub const TAG_PRID: &[u8; 4] = b"PRID";

/// How many longer words a word keeps as its continuations. A prediction
/// shows a handful; the rest only cost space.
pub const CONTINUATION_CAP: usize = 16;
/// Longest word, in characters, that gets continuations. 中华人民共和 is a
/// prefix worth indexing; a nine-character one is a phrase nobody commits
/// on its own.
pub const CONTINUATION_MAX_PREFIX_CHARS: usize = 6;

/// One code's entries. `entry_count` is 32 bits wide on purpose: the sunime
/// prototype packed a 16-bit count into the FST value and overflowed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodeRec {
    pub code_off: u32,
    pub code_len: u16,
    pub syllables: u8,
    pub entry_start: u32,
    pub entry_count: u32,
}

impl CodeRec {
    pub const SIZE: usize = 16;

    pub fn to_bytes(self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0..4].copy_from_slice(&self.code_off.to_le_bytes());
        b[4..6].copy_from_slice(&self.code_len.to_le_bytes());
        b[6] = self.syllables;
        b[8..12].copy_from_slice(&self.entry_start.to_le_bytes());
        b[12..16].copy_from_slice(&self.entry_count.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Self {
        Self {
            code_off: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            code_len: u16::from_le_bytes([b[4], b[5]]),
            syllables: b[6],
            entry_start: u32::from_le_bytes([b[8], b[9], b[10], b[11]]),
            entry_count: u32::from_le_bytes([b[12], b[13], b[14], b[15]]),
        }
    }
}

/// One dictionary entry: a text, its frequency, and the code it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryRec {
    pub text_off: u32,
    pub text_len: u16,
    pub freq: u32,
    pub code_id: u32,
}

impl EntryRec {
    pub const SIZE: usize = 16;

    pub fn to_bytes(self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0..4].copy_from_slice(&self.text_off.to_le_bytes());
        b[4..6].copy_from_slice(&self.text_len.to_le_bytes());
        b[8..12].copy_from_slice(&self.freq.to_le_bytes());
        b[12..16].copy_from_slice(&self.code_id.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Self {
        Self {
            text_off: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            text_len: u16::from_le_bytes([b[4], b[5]]),
            freq: u32::from_le_bytes([b[8], b[9], b[10], b[11]]),
            code_id: u32::from_le_bytes([b[12], b[13], b[14], b[15]]),
        }
    }
}

/// One abbreviation key's slice of `ABID`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbbrRec {
    pub start: u32,
    pub count: u32,
}

impl AbbrRec {
    pub const SIZE: usize = 8;

    pub fn to_bytes(self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0..4].copy_from_slice(&self.start.to_le_bytes());
        b[4..8].copy_from_slice(&self.count.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Self {
        Self {
            start: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            count: u32::from_le_bytes([b[4], b[5], b[6], b[7]]),
        }
    }
}

/// A section's place in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionEntry {
    pub tag: [u8; 4],
    pub offset: u64,
    pub length: u64,
}

impl SectionEntry {
    pub fn to_bytes(self) -> [u8; SECTION_ENTRY_SIZE] {
        let mut b = [0u8; SECTION_ENTRY_SIZE];
        b[0..4].copy_from_slice(&self.tag);
        b[8..16].copy_from_slice(&self.offset.to_le_bytes());
        b[16..24].copy_from_slice(&self.length.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Self {
        Self {
            tag: [b[0], b[1], b[2], b[3]],
            offset: u64::from_le_bytes([b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]]),
            length: u64::from_le_bytes([b[16], b[17], b[18], b[19], b[20], b[21], b[22], b[23]]),
        }
    }
}

pub fn align_up(n: usize) -> usize {
    n.div_ceil(ALIGN) * ALIGN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_round_trip() {
        let c = CodeRec {
            code_off: 1,
            code_len: 2,
            syllables: 3,
            entry_start: 4,
            entry_count: 70_000,
        };
        assert_eq!(CodeRec::from_bytes(&c.to_bytes()), c);
        let e = EntryRec {
            text_off: 9,
            text_len: 6,
            freq: u32::MAX,
            code_id: 7,
        };
        assert_eq!(EntryRec::from_bytes(&e.to_bytes()), e);
        let a = AbbrRec { start: 5, count: 200 };
        assert_eq!(AbbrRec::from_bytes(&a.to_bytes()), a);
        let s = SectionEntry {
            tag: *TAG_FST,
            offset: 32,
            length: 1 << 40,
        };
        assert_eq!(SectionEntry::from_bytes(&s.to_bytes()), s);
        assert_eq!(align_up(0), 0);
        assert_eq!(align_up(1), 8);
        assert_eq!(align_up(8), 8);
        assert_eq!(align_up(9), 16);
    }
}
