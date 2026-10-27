//! Installed font families for the settings picker.
//!
//! The WebView paints with whatever the OS will rasterise; this command only
//! names the families so the picker can list them. Windows goes through
//! DirectWrite so the names match what CSS `font-family` resolves. Everywhere
//! else walks the usual font directories and reads the OpenType name table.

use std::collections::HashSet;
#[cfg(any(not(windows), test))]
use std::io::{Read, Seek, SeekFrom};
#[cfg(any(not(windows), test))]
use std::path::Path;
#[cfg(not(windows))]
use std::path::PathBuf;

#[cfg(not(windows))]
const MAX_FILES: usize = 4000;
#[cfg(not(windows))]
const MAX_WALK_DEPTH: u8 = 8;
#[cfg(any(not(windows), test))]
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
#[cfg(any(not(windows), test))]
const MAX_NAME_TABLE: usize = 256 * 1024;
#[cfg(any(not(windows), test))]
const MAX_TABLES: usize = 64;
#[cfg(any(not(windows), test))]
const MAX_TTC_FONTS: usize = 32;
#[cfg(any(not(windows), test))]
const MAX_NAME_RECORDS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyListResponse {
    pub families: Vec<String>,
}

#[tauri::command]
pub fn list_system_fonts() -> Result<FontFamilyListResponse, String> {
    Ok(FontFamilyListResponse {
        families: list_families()?,
    })
}

fn list_families() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        list_windows_families()
    }
    #[cfg(not(windows))]
    {
        Ok(list_walked_families())
    }
}

#[cfg(windows)]
fn list_windows_families() -> Result<Vec<String>, String> {
    use windows::Win32::Graphics::DirectWrite::{DWRITE_FACTORY_TYPE_SHARED, DWriteCreateFactory, IDWriteFactory};

    // SAFETY: DirectWrite factory/collection calls; every handle is checked before use.
    // DirectWrite does not require CoInitialize.
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).map_err(|e| e.to_string())?;
        let mut collection = None;
        factory
            .GetSystemFontCollection(&mut collection, false)
            .map_err(|e| e.to_string())?;
        let collection = collection.ok_or_else(|| "DirectWrite returned no font collection".to_string())?;
        let count = collection.GetFontFamilyCount();
        let mut names = Vec::with_capacity(count as usize);
        for i in 0..count {
            let Ok(family) = collection.GetFontFamily(i) else {
                continue;
            };
            let Ok(strings) = family.GetFamilyNames() else { continue };
            if strings.GetCount() == 0 {
                continue;
            }
            let Ok(name) = localized_name(&strings) else { continue };
            if !name.is_empty() {
                names.push(name);
            }
        }
        Ok(finalize_families(names))
    }
}

#[cfg(windows)]
fn localized_name(
    strings: &windows::Win32::Graphics::DirectWrite::IDWriteLocalizedStrings,
) -> windows::core::Result<String> {
    use windows::core::{BOOL, w};

    // SAFETY: `strings` is a live IDWriteLocalizedStrings from GetFamilyNames.
    // DirectWrite string getters write into a caller-owned buffer of length+1.
    unsafe {
        let mut index = 0u32;
        let mut exists = BOOL::default();
        let _ = strings.FindLocaleName(w!("en-us"), &mut index, &mut exists);
        if !exists.as_bool() {
            index = 0;
        }
        let len = strings.GetStringLength(index)?;
        let mut buf = vec![0u16; len as usize + 1];
        strings.GetString(index, &mut buf)?;
        while buf.last() == Some(&0) {
            buf.pop();
        }
        Ok(String::from_utf16_lossy(&buf))
    }
}

#[cfg(not(windows))]
fn list_walked_families() -> Vec<String> {
    let mut names = Vec::new();
    let mut files = 0usize;
    for root in font_roots() {
        walk(&root, 0, &mut files, &mut names);
        if files >= MAX_FILES {
            break;
        }
    }
    finalize_families(names)
}

#[cfg(not(windows))]
fn font_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/usr/share/fonts"),
        PathBuf::from("/usr/local/share/fonts"),
        PathBuf::from("/System/Library/Fonts"),
        PathBuf::from("/Library/Fonts"),
        PathBuf::from("/system/fonts"),
        PathBuf::from("/system/product/fonts"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join(".local/share/fonts"));
        roots.push(home.join(".fonts"));
        roots.push(home.join("Library/Fonts"));
    }
    roots
}

#[cfg(not(windows))]
fn walk(dir: &Path, depth: u8, files: &mut usize, names: &mut Vec<String>) {
    if depth > MAX_WALK_DEPTH || *files >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *files >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_dir() {
            walk(&path, depth + 1, files, names);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("ttf" | "otf" | "ttc")) {
            continue;
        }
        *files += 1;
        if let Some(name) = family_from_path(&path) {
            names.push(name);
        }
    }
}

#[cfg(any(not(windows), test))]
fn family_from_path(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] == b"ttcf" {
        let num = u32::from_be_bytes(header[8..12].try_into().ok()?) as usize;
        let n = num.min(MAX_TTC_FONTS);
        if n == 0 {
            return None;
        }
        let mut offsets = vec![0u8; n * 4];
        file.read_exact(&mut offsets).ok()?;
        let off = u32::from_be_bytes(offsets[0..4].try_into().ok()?) as u64;
        family_from_sfnt_in_file(&mut file, off)
    } else {
        family_from_sfnt_in_file(&mut file, 0)
    }
}

#[cfg(any(not(windows), test))]
fn family_from_sfnt_in_file(file: &mut std::fs::File, sfnt_offset: u64) -> Option<String> {
    file.seek(SeekFrom::Start(sfnt_offset)).ok()?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header).ok()?;
    let tag = &header[0..4];
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" && tag != b"typ1" {
        return None;
    }
    let num_tables = u16::from_be_bytes(header[4..6].try_into().ok()?) as usize;
    if num_tables == 0 || num_tables > MAX_TABLES {
        return None;
    }
    let mut dir = vec![0u8; num_tables * 16];
    file.read_exact(&mut dir).ok()?;
    for i in 0..num_tables {
        let rec = &dir[i * 16..];
        if &rec[0..4] != b"name" {
            continue;
        }
        let offset = u32::from_be_bytes(rec[8..12].try_into().ok()?) as u64;
        let length = u32::from_be_bytes(rec[12..16].try_into().ok()?) as usize;
        if length == 0 || length > MAX_NAME_TABLE {
            return None;
        }
        // Table offsets in a TTC are from the start of the collection file.
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut table = vec![0u8; length];
        file.read_exact(&mut table).ok()?;
        return parse_name_table(&table);
    }
    None
}

/// Family name from a complete sfnt / TTC buffer. Used by tests.
#[cfg(any(not(windows), test))]
pub(crate) fn family_from_sfnt(data: &[u8]) -> Option<String> {
    if data.len() < 12 {
        return None;
    }
    if &data[0..4] == b"ttcf" {
        let num = read_u32(data, 8)? as usize;
        if num == 0 {
            return None;
        }
        let off = read_u32(data, 12)? as usize;
        return family_from_sfnt_at_slice(data, off);
    }
    family_from_sfnt_at_slice(data, 0)
}

#[cfg(any(not(windows), test))]
fn family_from_sfnt_at_slice(data: &[u8], sfnt_offset: usize) -> Option<String> {
    let header = data.get(sfnt_offset..sfnt_offset + 12)?;
    let tag = &header[0..4];
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" && tag != b"typ1" {
        return None;
    }
    let num_tables = u16::from_be_bytes(header[4..6].try_into().ok()?) as usize;
    if num_tables == 0 || num_tables > MAX_TABLES {
        return None;
    }
    let dir_start = sfnt_offset + 12;
    let dir = data.get(dir_start..dir_start + num_tables * 16)?;
    for i in 0..num_tables {
        let rec = &dir[i * 16..];
        if &rec[0..4] != b"name" {
            continue;
        }
        let offset = u32::from_be_bytes(rec[8..12].try_into().ok()?) as usize;
        let length = u32::from_be_bytes(rec[12..16].try_into().ok()?) as usize;
        if length == 0 || length > MAX_NAME_TABLE {
            return None;
        }
        let table = data.get(offset..offset + length)?;
        return parse_name_table(table);
    }
    None
}

#[cfg(any(not(windows), test))]
fn parse_name_table(data: &[u8]) -> Option<String> {
    if data.len() < 6 {
        return None;
    }
    let count = read_u16(data, 2)? as usize;
    let string_offset = read_u16(data, 4)? as usize;
    if count == 0 || count > MAX_NAME_RECORDS {
        return None;
    }
    let mut best_score = -1i32;
    let mut best: Option<String> = None;
    for i in 0..count {
        let rec = 6 + i * 12;
        let platform = read_u16(data, rec)?;
        let encoding = read_u16(data, rec + 2)?;
        let language = read_u16(data, rec + 4)?;
        let name_id = read_u16(data, rec + 6)?;
        let length = read_u16(data, rec + 8)? as usize;
        let offset = read_u16(data, rec + 10)? as usize;
        let score = name_score(name_id, platform, encoding, language);
        if score <= best_score {
            continue;
        }
        let start = string_offset.checked_add(offset)?;
        let end = start.checked_add(length)?;
        let raw = data.get(start..end)?;
        let Some(decoded) = decode_name(platform, encoding, raw) else {
            continue;
        };
        if decoded.is_empty() {
            continue;
        }
        best_score = score;
        best = Some(decoded);
    }
    best
}

#[cfg(any(not(windows), test))]
fn name_score(name_id: u16, platform: u16, encoding: u16, language: u16) -> i32 {
    let id_score = match name_id {
        16 => 100,
        1 => 50,
        _ => return -1,
    };
    let plat_score = match (platform, encoding, language) {
        (3, 1, 0x0409) => 30,
        (3, 1, _) => 20,
        (3, 10, _) => 18,
        (0, _, _) => 10,
        (1, 0, _) => 5,
        _ => 0,
    };
    id_score + plat_score
}

#[cfg(any(not(windows), test))]
fn decode_name(platform: u16, encoding: u16, raw: &[u8]) -> Option<String> {
    match (platform, encoding) {
        (3, 1) | (3, 10) | (0, _) => decode_utf16be(raw),
        (1, 0) => Some(raw.iter().map(|&b| b as char).collect()),
        _ => None,
    }
}

#[cfg(any(not(windows), test))]
fn decode_utf16be(raw: &[u8]) -> Option<String> {
    if !raw.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = raw
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[a, b]| u16::from_be_bytes([a, b]))
        .collect();
    let decoded = String::from_utf16_lossy(&units);
    let trimmed = decoded.trim_end_matches('\0');
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(any(not(windows), test))]
fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

#[cfg(any(not(windows), test))]
fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn is_safe_family_name(name: &str) -> bool {
    if name.is_empty() || name.chars().count() > 120 {
        return false;
    }
    if name != name.trim() {
        return false;
    }
    if name.starts_with('@') {
        return false;
    }
    !name
        .bytes()
        .any(|b| matches!(b, b'"' | b'\'' | b';' | b'{' | b'}' | b'\\' | b'\n' | b'\r'))
}

pub(crate) fn finalize_families(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for name in names {
        if !is_safe_family_name(&name) {
            continue;
        }
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(name);
    }
    out.sort_by_key(|a| a.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16be(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(|u| u.to_be_bytes()).collect()
    }

    fn put_u16(buf: &mut Vec<u8>, v: u16) {
        buf.extend_from_slice(&v.to_be_bytes());
    }

    fn put_u32(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_be_bytes());
    }

    /// Minimal sfnt whose name table carries the given (text, nameID) records,
    /// all Windows Unicode BMP English.
    fn synthetic_ttf(records: &[(&str, u16)]) -> Vec<u8> {
        let strings: Vec<Vec<u8>> = records.iter().map(|(text, _)| utf16be(text)).collect();
        let string_store: Vec<u8> = strings.iter().flatten().copied().collect();
        let string_offset = 6 + 12 * records.len();
        let mut name = Vec::new();
        put_u16(&mut name, 0);
        put_u16(&mut name, records.len() as u16);
        put_u16(&mut name, string_offset as u16);
        let mut running = 0u16;
        for (i, (_, name_id)) in records.iter().enumerate() {
            put_u16(&mut name, 3);
            put_u16(&mut name, 1);
            put_u16(&mut name, 0x0409);
            put_u16(&mut name, *name_id);
            put_u16(&mut name, strings[i].len() as u16);
            put_u16(&mut name, running);
            running += strings[i].len() as u16;
        }
        name.extend_from_slice(&string_store);

        let mut out = Vec::new();
        put_u32(&mut out, 0x00010000);
        put_u16(&mut out, 1);
        put_u16(&mut out, 0);
        put_u16(&mut out, 0);
        put_u16(&mut out, 0);
        out.extend_from_slice(b"name");
        put_u32(&mut out, 0);
        put_u32(&mut out, 28);
        put_u32(&mut out, name.len() as u32);
        out.extend_from_slice(&name);
        out
    }

    #[test]
    fn name_id_16_wins_over_family() {
        let bytes = synthetic_ttf(&[("Family", 1), ("Typographic", 16)]);
        assert_eq!(family_from_sfnt(&bytes).as_deref(), Some("Typographic"));
    }

    #[test]
    fn name_id_1_is_used_when_16_is_absent() {
        let bytes = synthetic_ttf(&[("Family", 1)]);
        assert_eq!(family_from_sfnt(&bytes).as_deref(), Some("Family"));
    }

    #[test]
    fn finalize_drops_quotes_at_prefix_and_case_insensitive_dups() {
        let out = finalize_families([
            r#"Comic "Sans""#.to_string(),
            "@SimSun".to_string(),
            " Segoe".to_string(),
            "Arial".to_string(),
            "arial".to_string(),
            "Segoe UI".to_string(),
        ]);
        assert_eq!(out, vec!["Arial".to_string(), "Segoe UI".to_string()]);
    }

    #[test]
    fn reads_family_from_a_ttf_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("x.ttf");
        std::fs::write(&path, synthetic_ttf(&[("Displayed", 1)])).unwrap();
        assert_eq!(family_from_path(&path).as_deref(), Some("Displayed"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_lists_a_common_family() {
        let list = list_families().expect("DirectWrite");
        assert!(
            list.iter().any(|s| {
                let lower = s.to_lowercase();
                lower.contains("segoe") || lower.contains("yahei") || lower == "arial"
            }),
            "expected Segoe UI, Microsoft YaHei or Arial in {list:?}"
        );
    }
}
