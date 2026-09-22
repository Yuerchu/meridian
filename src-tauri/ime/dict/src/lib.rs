//! Meridian 输入法的词典层：`.mdict` 文件格式、多词典合并查询、Rime 词库导入器，
//! 以及词典与引擎共用的音节表。
//!
//! Nothing here depends on a platform. The engine reads through [`DictSet`];
//! the importer writes through [`format::DictWriter`]; `catalog` is the list of
//! what has been imported into a data directory.

pub mod catalog;
pub mod format;
pub mod rime;
pub mod set;
pub mod syllable;

pub use catalog::{Catalog, CatalogEntry, CatalogError, DictId};
pub use format::{DictError, DictFile, DictWriter, Entry, Metadata, WriterStats};
pub use rime::{FileReport, FileSkip, ImportError, ImportOptions, ImportReport, SkipCounts};
pub use set::{DictSet, Hit, LookupLimits, SourceId, SyllablePattern, UserWord};
pub use syllable::{SyllableTable, normalize_code, normalize_syllable};
