//! Rime `.dict.yaml` importer: a tree of tables into one `.mdict`.
//!
//! A Rime dictionary is a YAML header between `---` and `...` followed by a
//! TSV body, and its `import_tables` pull in more of the same relative to the
//! *root* file's directory (rime-ice's root imports `cn_dicts/8105`, so the
//! name carries the subdirectory). The header is read by a hand-rolled parser
//! for exactly the subset those files use — scalars, block lists with inline
//! comments, flow lists — rather than a YAML crate that would accept a great
//! deal more and pull in far more code than the four keys warrant.
//!
//! Every code is normalised (`normalize_code`) and then checked syllable by
//! syllable against the [`SyllableTable`]; a row that fails is *counted* under
//! the reason and dropped, never guessed at. In particular an unspaced code
//! that could be cut into syllables (`nihao`) is refused rather than segmented:
//! a wrong cut would file a word under a code nobody types, silently.
//!
//! The output name carries the first sixteen hex digits of a [`cache_key`]
//! over every file that went in, so an unchanged source is a cache hit and
//! a changed one — or a changed syllable table, or a changed importer — is a
//! new file beside it.

mod body;
mod header;
mod import;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

pub use header::{DEFAULT_COLUMNS, Header};
pub use import::{cache_key, import};

use crate::format::DictError;

/// Bumped whenever the importer's output for the same input would differ;
/// part of the cache key.
pub const IMPORTER_VERSION: u16 = 1;

/// What the caller knows that the file does not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportOptions {
    /// SPDX identifier; `UNKNOWN` when absent.
    pub license: Option<String>,
    pub attribution: Option<String>,
    /// Overrides the header's `name` (and the file stem after that).
    pub name: Option<String>,
}

/// What an import did, file by file and in total.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    /// Every file visited, root first then imports in order; empty on a cache hit.
    pub files: Vec<FileReport>,
    pub accepted: u64,
    /// `(code, text)` pairs seen again after the first; the first wins.
    pub duplicates: u64,
    pub skipped: SkipCounts,
    pub output: PathBuf,
    /// `true` when `output` already held this exact import and nothing was rebuilt.
    pub cache_hit: bool,
    pub cache_key: String,
    /// The sanitised dictionary name the output file is named after.
    pub name: String,
}

/// One file's share of the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileReport {
    pub path: PathBuf,
    /// Data rows seen (comments and blank lines excluded).
    pub rows: u64,
    pub accepted: u64,
    pub skipped: SkipCounts,
    /// Set when the whole file was skipped; `rows` then counts what was lost.
    pub reason: Option<FileSkip>,
}

/// Rows dropped, by reason.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SkipCounts {
    /// Rows in a file whose `columns` declare no code (the file is skipped whole).
    pub no_code: u64,
    /// A token of the code is not a syllable.
    pub invalid_syllable: u64,
    /// A single token that is not a syllable but could be cut into several.
    pub unspaced_code: u64,
    /// Weight present but unparsable; the row is kept with weight 0.
    pub bad_weight: u64,
    pub empty_text: u64,
    /// The text is ASCII only (the `A A` rows), never a Chinese word.
    pub ascii_text: u64,
    /// Fewer columns than the text or the code needs.
    pub malformed: u64,
}

impl SkipCounts {
    /// Rows lost to every reason together. `bad_weight` is not among them:
    /// those rows are imported, at weight 0.
    pub fn total(&self) -> u64 {
        self.no_code + self.invalid_syllable + self.unspaced_code + self.empty_text + self.ascii_text + self.malformed
    }

    pub fn add(&mut self, other: &SkipCounts) {
        self.no_code += other.no_code;
        self.invalid_syllable += other.invalid_syllable;
        self.unspaced_code += other.unspaced_code;
        self.bad_weight += other.bad_weight;
        self.empty_text += other.empty_text;
        self.ascii_text += other.ascii_text;
        self.malformed += other.malformed;
    }
}

/// Why a whole file contributed nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSkip {
    /// `columns` names no `code` (or no `text`): nothing here can be keyed.
    NoCodeColumn,
    /// Named in `import_tables` but not on disk.
    MissingImport,
    /// Already visited on this import — a self-import or a loop.
    Cycle,
    Io(String),
}

impl std::fmt::Display for FileSkip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileSkip::NoCodeColumn => f.write_str("no code column"),
            FileSkip::MissingImport => f.write_str("missing import"),
            FileSkip::Cycle => f.write_str("import cycle"),
            FileSkip::Io(e) => write!(f, "io: {e}"),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// Every row of every file was refused; the report says why.
    #[error("no usable entries ({} rows skipped over {} files)", .0.skipped.total(), .0.files.len())]
    NoUsableEntries(Box<ImportReport>),
    #[error("dictionary: {0}")]
    Dict(#[from] DictError),
    #[error("{} not found", .0.display())]
    NotFound(PathBuf),
}
