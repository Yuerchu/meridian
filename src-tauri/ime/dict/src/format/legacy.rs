//! Readers for formats this build no longer opens, kept only to upgrade them.
//!
//! Each version gets its own module, with its own copy of the constants and
//! record decoding it needs. Nothing here may use `layout`'s current record
//! types: those describe the format being *written*, and the day one of them
//! changes, a reader borrowing it would quietly start misreading the old
//! files it exists for. The header and section table have kept their shape
//! across versions, which is why `reader::container` is shared.

use std::path::Path;

use super::reader::{container, map_file, metadata, section};
use super::{DictError, Metadata};

/// One entry as stored: `(code, text, frequency)`.
pub type Row = (String, String, u32);

/// Version 1, the format before prediction: `META`, `FST_`, `POST`, `ENTR`,
/// `STRS` and the abbreviation index. Only `POST`, `ENTR` and `STRS` are
/// needed to recover every entry; the rest is derived and rebuilt.
pub mod v1 {
    use super::*;

    pub const VERSION: u16 = 1;
    const TAG_POST: &[u8; 4] = b"POST";
    const TAG_ENTR: &[u8; 4] = b"ENTR";
    const TAG_STRS: &[u8; 4] = b"STRS";
    /// `code_off u32 | code_len u16 | syllables u8 | pad u8 | entry_start u32 | entry_count u32`
    const CODE_REC: usize = 16;
    /// `text_off u32 | text_len u16 | pad u16 | freq u32 | code_id u32`
    const ENTRY_REC: usize = 16;

    fn u16_at(b: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([b[at], b[at + 1]])
    }

    fn u32_at(b: &[u8], at: usize) -> u32 {
        u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
    }

    /// Every entry of a version 1 file, code by code, with its metadata.
    /// Anything out of bounds or not UTF-8 is an error: an upgrade that
    /// dropped the rows it could not read would hand back a smaller
    /// dictionary and call it the same one.
    pub fn entries(path: &Path) -> Result<(Metadata, Vec<Row>), DictError> {
        let map = map_file(path)?;
        let bytes: &[u8] = &map;
        let header = container(bytes)?;
        if header.version != VERSION {
            return Err(DictError::UpgradeCheck(format!(
                "expected format version {VERSION}, found {}",
                header.version
            )));
        }
        let meta = metadata(bytes, &header.sections)?;
        let post = &bytes[section(bytes, &header.sections, TAG_POST)?];
        let entr = &bytes[section(bytes, &header.sections, TAG_ENTR)?];
        let strs = &bytes[section(bytes, &header.sections, TAG_STRS)?];
        let string = |off: u32, len: u16, what: &str| -> Result<String, DictError> {
            let start = off as usize;
            let slice = strs
                .get(start..start + len as usize)
                .ok_or_else(|| DictError::SectionOutOfBounds(format!("STRS ({what})")))?;
            std::str::from_utf8(slice)
                .map(str::to_string)
                .map_err(|e| DictError::UpgradeCheck(format!("{what} is not UTF-8: {e}")))
        };

        let mut rows = Vec::with_capacity(entr.len() / ENTRY_REC);
        for rec in post.as_chunks::<CODE_REC>().0 {
            let code = string(u32_at(rec, 0), u16_at(rec, 4), "code")?;
            let start = u32_at(rec, 8) as usize;
            let count = u32_at(rec, 12) as usize;
            for id in start..start + count {
                let at = id * ENTRY_REC;
                let e = entr
                    .get(at..at + ENTRY_REC)
                    .ok_or_else(|| DictError::SectionOutOfBounds("ENTR".into()))?;
                let text = string(u32_at(e, 0), u16_at(e, 4), "text")?;
                rows.push((code.clone(), text, u32_at(e, 8)));
            }
        }
        if rows.len() as u64 != meta.entries {
            return Err(DictError::UpgradeCheck(format!(
                "read {} entries, the file says {}",
                rows.len(),
                meta.entries
            )));
        }
        Ok((meta, rows))
    }
}
