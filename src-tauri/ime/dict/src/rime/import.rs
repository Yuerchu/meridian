//! Walking the import tree and writing the result.
//!
//! Three phases. The walk reads every file whole — root first, then each
//! `import_tables` entry depth-first in written order — hashing it and
//! reading its header for further imports; a file seen twice is a cycle and a
//! file not on disk is a missing import, each reported in place and neither
//! stopping the rest. The key is computed over what the walk found, which is
//! what decides the output name and whether it already exists. Only then are
//! the bodies parsed, so a cache hit costs one read of the sources and no
//! parsing — the ordering of the phases is the whole of the cache.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::body::{self, Columns, Row, Skip};
use super::header::{self, Header};
use super::{FileReport, FileSkip, IMPORTER_VERSION, ImportError, ImportOptions, ImportReport, SkipCounts};
use crate::format::layout::FORMAT_VERSION;
use crate::format::{DictFile, DictWriter, Metadata};
use crate::syllable::SyllableTable;

/// Hex digits of the cache key that go into the output file's name.
const KEY_PREFIX_LEN: usize = 16;

struct Loaded {
    path: PathBuf,
    rel: String,
    text: String,
    sha: [u8; 32],
    header: Option<Header>,
}

enum Node {
    Loaded(Loaded),
    Skipped(FileReport),
}

/// Imports `source` and everything it imports into `<dicts_dir>/<name>-<key>.mdict`.
pub fn import(
    source: &Path,
    dicts_dir: &Path,
    opts: &ImportOptions,
    table: &SyllableTable,
) -> Result<ImportReport, ImportError> {
    if !source.is_file() {
        return Err(ImportError::NotFound(source.to_path_buf()));
    }
    let root_dir = source
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let root_rel = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut nodes = Vec::new();
    let mut visited = HashSet::new();
    walk(source, root_rel, &root_dir, &mut visited, &mut nodes, true)?;

    let loaded: Vec<&Loaded> = nodes
        .iter()
        .filter_map(|n| if let Node::Loaded(l) = n { Some(l) } else { None })
        .collect();
    let hashed: Vec<(String, [u8; 32])> = loaded.iter().map(|l| (l.rel.clone(), l.sha)).collect();
    let key = cache_key(&hashed, table);

    let root_header = loaded.first().and_then(|l| l.header.as_ref());
    let name = sanitize_name(
        opts.name
            .as_deref()
            .or(root_header.and_then(|h| h.name.as_deref()))
            .unwrap_or(&file_stem(source)),
    );
    let output = dicts_dir.join(format!("{name}-{}.mdict", &key[..KEY_PREFIX_LEN]));

    if output.is_file()
        && let Ok(existing) = DictFile::open(&output)
        && existing.meta().cache_key == key
    {
        return Ok(ImportReport {
            files: Vec::new(),
            accepted: existing.meta().entries,
            duplicates: 0,
            skipped: SkipCounts::default(),
            output,
            cache_hit: true,
            cache_key: key,
            name,
        });
    }

    let mut writer = DictWriter::new();
    let mut files = Vec::with_capacity(nodes.len());
    let mut skipped = SkipCounts::default();
    for node in &nodes {
        let report = match node {
            Node::Skipped(r) => r.clone(),
            Node::Loaded(l) => parse_file(l, table, &mut writer),
        };
        skipped.add(&report.skipped);
        files.push(report);
    }

    let mut report = ImportReport {
        files,
        accepted: writer.entries(),
        duplicates: writer.duplicates(),
        skipped,
        output,
        cache_hit: false,
        cache_key: key,
        name,
    };
    if report.accepted == 0 {
        return Err(ImportError::NoUsableEntries(Box::new(report)));
    }

    std::fs::create_dir_all(dicts_dir)?;
    let meta = Metadata {
        name: report.name.clone(),
        license: opts.license.clone().unwrap_or_else(|| "UNKNOWN".to_string()),
        attribution: opts.attribution.clone().unwrap_or_default(),
        source: source.display().to_string(),
        cache_key: report.cache_key.clone(),
        version: root_header.and_then(|h| h.version.clone()).unwrap_or_default(),
        entries: 0,
        codes: 0,
        total_frequency: 0,
        created_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        generator: concat!("meridian-ime-dict ", env!("CARGO_PKG_VERSION")).to_string(),
        format_version: FORMAT_VERSION,
        importer_version: IMPORTER_VERSION,
        syllable_table_sha256: table.sha256().to_string(),
    };
    let stats = writer.write(&report.output, &meta, table)?;
    report.accepted = stats.entries;
    Ok(report)
}

/// SHA-256 hex over `FORMAT_VERSION ‖ IMPORTER_VERSION ‖ table sha ‖ each (rel path ‖ NUL ‖ sha)`.
/// Any file's bytes, its position, the importer or the syllable table changing
/// changes the key.
pub fn cache_key(files_in_order: &[(String, [u8; 32])], table: &SyllableTable) -> String {
    let mut h = Sha256::new();
    h.update(FORMAT_VERSION.to_le_bytes());
    h.update(IMPORTER_VERSION.to_le_bytes());
    h.update(table.sha256().as_bytes());
    for (rel, sha) in files_in_order {
        h.update(rel.as_bytes());
        h.update([0u8]);
        h.update(sha);
    }
    hex(&h.finalize())
}

fn walk(
    path: &Path,
    rel: String,
    root_dir: &Path,
    visited: &mut HashSet<PathBuf>,
    nodes: &mut Vec<Node>,
    is_root: bool,
) -> Result<(), ImportError> {
    let skip = |reason: FileSkip| {
        Node::Skipped(FileReport {
            path: path.to_path_buf(),
            rows: 0,
            accepted: 0,
            skipped: SkipCounts::default(),
            reason: Some(reason),
        })
    };
    let canon = match std::fs::canonicalize(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if is_root {
                return Err(ImportError::NotFound(path.to_path_buf()));
            }
            nodes.push(skip(FileSkip::MissingImport));
            return Ok(());
        }
        Err(e) => {
            if is_root {
                return Err(e.into());
            }
            nodes.push(skip(FileSkip::Io(e.to_string())));
            return Ok(());
        }
    };
    if !visited.insert(canon) {
        nodes.push(skip(FileSkip::Cycle));
        return Ok(());
    }
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            if is_root {
                return Err(e.into());
            }
            nodes.push(skip(FileSkip::Io(e.to_string())));
            return Ok(());
        }
    };
    let sha: [u8; 32] = Sha256::digest(&bytes).into();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let (header, _) = header::split(&text);
    let imports = header.as_ref().map(|h| h.import_tables.clone()).unwrap_or_default();
    nodes.push(Node::Loaded(Loaded {
        path: path.to_path_buf(),
        rel,
        text,
        sha,
        header,
    }));
    for name in imports {
        let rel = format!("{name}.dict.yaml");
        let child = root_dir.join(&rel);
        walk(&child, rel, root_dir, visited, nodes, false)?;
    }
    Ok(())
}

fn parse_file(file: &Loaded, table: &SyllableTable, writer: &mut DictWriter) -> FileReport {
    let mut report = FileReport {
        path: file.path.clone(),
        rows: 0,
        accepted: 0,
        skipped: SkipCounts::default(),
        reason: None,
    };
    let (header, body) = header::split(&file.text);
    let columns = header
        .as_ref()
        .map(Header::columns_or_default)
        .unwrap_or_else(|| Header::default().columns_or_default());
    let Some(cols) = Columns::resolve(&columns) else {
        report.rows = body.lines().filter(|l| !body::is_comment(l)).count() as u64;
        report.skipped.no_code = report.rows;
        report.reason = Some(FileSkip::NoCodeColumn);
        return report;
    };
    for line in body.lines() {
        if body::is_comment(line) {
            continue;
        }
        report.rows += 1;
        match body::parse_row(line, &cols, table) {
            Row::Entry {
                text,
                code,
                weight,
                bad_weight,
            } => {
                if bad_weight {
                    report.skipped.bad_weight += 1;
                }
                if writer.add(&code, text, weight) {
                    report.accepted += 1;
                }
            }
            Row::Skip(Skip::Malformed) => report.skipped.malformed += 1,
            Row::Skip(Skip::EmptyText) => report.skipped.empty_text += 1,
            Row::Skip(Skip::AsciiText) => report.skipped.ascii_text += 1,
            Row::Skip(Skip::InvalidSyllable) => report.skipped.invalid_syllable += 1,
            Row::Skip(Skip::UnspacedCode) => report.skipped.unspaced_code += 1,
        }
    }
    report
}

/// `rime_ice.dict.yaml` → `rime_ice`.
fn file_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    stem.strip_suffix(".dict").map(str::to_string).unwrap_or(stem)
}

/// Keeps `[A-Za-z0-9_-]`, replaces the rest, and never returns an empty name.
fn sanitize_name(name: &str) -> String {
    let out: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() { "dict".to_string() } else { out }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0xf) as usize] as char);
    }
    s
}
