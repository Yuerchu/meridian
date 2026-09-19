//! The TSV body: one row at a time, judged against the syllable table.

use crate::syllable::{SyllableTable, normalize_code};

/// Where text, code and weight sit in a row, from the header's `columns`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Columns {
    pub text: usize,
    pub code: usize,
    /// `None` when the table declares no weight column; every row then weighs 1.
    pub weight: Option<usize>,
}

impl Columns {
    /// `None` when there is no code or no text column: nothing in such a
    /// file can be keyed, so the file is skipped whole.
    pub fn resolve(columns: &[String]) -> Option<Self> {
        let find = |name: &str| columns.iter().position(|c| c == name);
        Some(Self {
            text: find("text")?,
            code: find("code")?,
            weight: find("weight"),
        })
    }
}

/// Why one row was dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    Malformed,
    EmptyText,
    /// The text is nothing but ASCII: rime-ice carries `A A` rows (text A, code A) for typing
    /// capitals, which under a lowercased code would file "A" under `a`.
    AsciiText,
    InvalidSyllable,
    UnspacedCode,
}

/// One data row, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Row<'a> {
    Entry {
        text: &'a str,
        /// Normalised, space-separated, every token a syllable.
        code: String,
        weight: u32,
        /// The weight column was present and unparsable; `weight` is 0.
        bad_weight: bool,
    },
    Skip(Skip),
}

/// `true` for a line the body parser does not count: blank, or a `#` comment
/// (rime-ice's `# +_+` markers and commented-out rows).
pub fn is_comment(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#')
}

/// Reads one data row. Callers skip [`is_comment`] lines first.
pub fn parse_row<'a>(line: &'a str, cols: &Columns, table: &SyllableTable) -> Row<'a> {
    let fields: Vec<&str> = line.split('\t').collect();
    let (Some(text), Some(code)) = (fields.get(cols.text), fields.get(cols.code)) else {
        return Row::Skip(Skip::Malformed);
    };
    let text = text.trim();
    if text.is_empty() {
        return Row::Skip(Skip::EmptyText);
    }
    if text.is_ascii() {
        return Row::Skip(Skip::AsciiText);
    }
    let code = normalize_code(code);
    if code.is_empty() {
        return Row::Skip(Skip::Malformed);
    }
    if !table.is_valid_code(&code) {
        let single = !code.contains(' ');
        return Row::Skip(if single && table.is_fully_segmentable(&code) {
            Skip::UnspacedCode
        } else {
            Skip::InvalidSyllable
        });
    }
    let (weight, bad_weight) = match cols.weight.and_then(|i| fields.get(i)) {
        None => (1, false),
        Some(raw) => match parse_weight(raw.trim()) {
            Some(w) => (w, false),
            None => (0, true),
        },
    };
    Row::Entry {
        text,
        code,
        weight,
        bad_weight,
    }
}

/// A weight as Rime writes it: an integer usually, occasionally a float.
/// Rounded and clamped into `u32`. An empty field weighs 1, like a missing one.
fn parse_weight(raw: &str) -> Option<u32> {
    if raw.is_empty() {
        return Some(1);
    }
    let w: f64 = raw.parse().ok()?;
    if w.is_nan() {
        return None;
    }
    Some(w.round().clamp(0.0, u32::MAX as f64) as u32)
}
