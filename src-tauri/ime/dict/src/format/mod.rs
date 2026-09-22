//! The `.mdict` container: a dictionary as one memory-mapped file.
//!
//! [`DictWriter`] builds one from `(code, text, frequency)` triples;
//! [`DictFile`] opens one and answers the three questions the engine asks —
//! exact code, code prefix, and initials abbreviation. See [`layout`] for the
//! bytes and [`Metadata`] for the provenance that travels with them.

pub mod layout;
mod metadata;
mod reader;
mod writer;

pub use metadata::Metadata;
pub use reader::{DictFile, Entry};
pub use writer::{DictWriter, WriterStats};

use std::sync::Arc;

/// Everything that can go wrong opening or writing a dictionary file.
#[derive(Debug, thiserror::Error)]
pub enum DictError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a Meridian dictionary (bad magic)")]
    BadMagic,
    #[error("unsupported dictionary format version {0} (this build reads {expected})", expected = layout::FORMAT_VERSION)]
    UnsupportedVersion(u16),
    #[error("unsupported container kind {0}")]
    UnsupportedKind(u16),
    #[error("section {0} is missing")]
    MissingSection(String),
    #[error("section {0} lies outside the file")]
    SectionOutOfBounds(String),
    #[error("metadata: {0}")]
    Metadata(String),
    #[error("index: {0}")]
    Fst(#[from] fst::Error),
    #[error("a dictionary may hold at most {max} entries; {given} were added")]
    TooManyEntries { max: u64, given: u64 },
    #[error("a code may be at most {max} bytes long; {given:?} is {len}")]
    CodeTooLong { max: usize, given: String, len: usize },
    #[error("a text may be at most {max} bytes long; {given:?} is {len}")]
    TextTooLong { max: usize, given: String, len: usize },
}

/// A window onto the mapped file, handed to `fst::Map` so the index is read in
/// place rather than copied out.
#[derive(Clone)]
pub(crate) struct Section {
    map: Arc<memmap2::Mmap>,
    start: usize,
    end: usize,
}

impl Section {
    pub(crate) fn new(map: Arc<memmap2::Mmap>, start: usize, end: usize) -> Self {
        Self { map, start, end }
    }
}

impl AsRef<[u8]> for Section {
    fn as_ref(&self) -> &[u8] {
        &self.map[self.start..self.end]
    }
}
