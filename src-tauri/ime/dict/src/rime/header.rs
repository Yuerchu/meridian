//! The YAML header, read by hand.
//!
//! The subset is exactly what Rime dictionaries use: top-level `key: value`
//! scalars (quoted or not), block lists (`key:` then `  - item`), flow lists
//! (`key: [a, b]`), and `#` comments anywhere outside quotes — rime-ice puts
//! one after every `import_tables` item and comments whole items out. Nested
//! maps (`encoder:` and friends in other schemes) are ignored line by line,
//! which is all the importer needs of them.

/// What a header carries; every field optional because every one is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Header {
    pub name: Option<String>,
    pub version: Option<String>,
    pub sort: Option<String>,
    /// `columns` in order; empty when the header did not say, in which case
    /// [`DEFAULT_COLUMNS`] apply.
    pub columns: Vec<String>,
    /// `import_tables` as written, without the `.dict.yaml` suffix.
    pub import_tables: Vec<String>,
}

/// Rime's default column order.
pub const DEFAULT_COLUMNS: [&str; 3] = ["text", "code", "weight"];

impl Header {
    /// The column names in force: the header's, else the default.
    pub fn columns_or_default(&self) -> Vec<String> {
        if self.columns.is_empty() {
            DEFAULT_COLUMNS.iter().map(|c| c.to_string()).collect()
        } else {
            self.columns.clone()
        }
    }
}

/// Splits a file into header and body. The header is the lines between the
/// first significant line, which must be `---`, and the next `...` line; a
/// file that does not open that way has no header and is all body. A BOM is
/// dropped first.
pub fn split(text: &str) -> (Option<Header>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut pos = 0;
    let mut lines = text.split_inclusive('\n');
    let mut opened = false;
    for line in lines.by_ref() {
        pos += line.len();
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        opened = t == "---";
        break;
    }
    if !opened {
        return (None, text);
    }
    let mut header_lines = Vec::new();
    let mut body_start = text.len();
    for line in lines {
        pos += line.len();
        let t = line.trim_end_matches(['\n', '\r']);
        if t.trim() == "..." {
            body_start = pos;
            break;
        }
        header_lines.push(t);
    }
    (Some(parse_lines(&header_lines)), &text[body_start..])
}

fn parse_lines(lines: &[&str]) -> Header {
    let mut header = Header::default();
    let mut lists: Vec<(String, Vec<String>)> = Vec::new();
    let mut scalars: Vec<(String, String)> = Vec::new();
    // The block list the next `- item` lines belong to, if any.
    let mut current: Option<usize> = None;
    for raw in lines {
        let line = strip_comment(raw);
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        if let Some(item) = list_item(t) {
            if let Some(i) = current {
                let item = unquote(item.trim());
                if !item.is_empty() {
                    lists[i].1.push(item);
                }
            }
            continue;
        }
        if indented {
            // A nested map under a key we do not read.
            continue;
        }
        current = None;
        let Some((key, value)) = t.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        let value = value.trim();
        if value.is_empty() {
            lists.push((key, Vec::new()));
            current = Some(lists.len() - 1);
        } else if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            let items = inner
                .split(',')
                .map(|s| unquote(s.trim()))
                .filter(|s| !s.is_empty())
                .collect();
            lists.push((key, items));
        } else {
            scalars.push((key, unquote(value)));
        }
    }
    for (key, value) in scalars {
        match key.as_str() {
            "name" => header.name = Some(value),
            "version" => header.version = Some(value),
            "sort" => header.sort = Some(value),
            _ => {}
        }
    }
    for (key, items) in lists {
        match key.as_str() {
            "columns" => header.columns = items,
            "import_tables" => header.import_tables = items,
            _ => {}
        }
    }
    header
}

fn list_item(t: &str) -> Option<&str> {
    if t == "-" {
        return Some("");
    }
    t.strip_prefix("- ").or_else(|| t.strip_prefix("-\t"))
}

/// Cuts a `#` comment: one at the start of the line or after whitespace,
/// outside quotes.
fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut quote: Option<u8> = None;
    for (i, &b) in bytes.iter().enumerate() {
        match quote {
            Some(q) => {
                if b == q {
                    quote = None;
                }
            }
            None => match b {
                b'"' | b'\'' => quote = Some(b),
                b'#' if i == 0 || matches!(bytes[i - 1], b' ' | b'\t') => return &line[..i],
                _ => {}
            },
        }
    }
    line
}

fn unquote(s: &str) -> String {
    let stripped = s
        .strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .or_else(|| s.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')));
    stripped.unwrap_or(s).to_string()
}
