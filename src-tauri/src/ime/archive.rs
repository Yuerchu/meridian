//! Getting a dictionary in: a file, an archive, or a download.
//!
//! A Rime dictionary is usually several files — rime-ice's root imports
//! `cn_dicts/8105` and the rest relative to itself — so importing one needs
//! its directory. On Windows the picker hands over a path and the directory is
//! beside it. On Android it hands over one `content://` document and nothing
//! around it, so a dictionary arrives there as a zip (downloaded in a browser,
//! or fetched by [`download`]) and is unpacked here first.
//!
//! Importing is therefore two steps. [`stage`] looks at what was picked and
//! finds the *root* dictionaries in it — the ones no other file imports; an
//! archive such as rime-ice's holds several (the Chinese root, an English
//! table, a radical table) and only the person knows which they want. Then
//! the caller imports the roots they chose from the staged directory.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use meridian_ime_dict::rime::split_header;

const SUFFIX: &str = ".dict.yaml";
/// Unpacked, at most. rime-ice unpacks its tables to about 60 MB.
pub const MAX_UNPACKED_BYTES: u64 = 1 << 30;
pub const MAX_ENTRIES: usize = 20_000;
/// Downloaded, at most. The rime-ice repository archive is about 50 MB.
pub const MAX_DOWNLOAD_BYTES: u64 = 512 << 20;
/// A header is at the top; this is far more than any has.
const HEADER_BYTES: u64 = 64 * 1024;

/// rime-ice, the dictionary to start with, and its root in that archive.
pub const RIME_ICE_URL: &str = "https://github.com/iDvel/rime-ice/archive/refs/heads/main.zip";
pub const RIME_ICE_ROOT: &str = "rime-ice-main/rime_ice.dict.yaml";
pub const RIME_ICE_LICENSE: &str = "GPL-3.0-only";

/// A dictionary nothing else in the staged files imports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    /// Relative to the staged directory, with `/` separators.
    pub path: String,
    /// The header's `name`, if it has one.
    pub name: Option<String>,
    /// How many tables it imports; the one a person wants is usually the one
    /// that imports the most.
    pub imports: usize,
}

/// What was picked, ready to import from.
#[derive(Debug, Clone)]
pub struct Staged {
    pub id: String,
    pub base: PathBuf,
    /// A directory of our own to delete afterwards; `None` when `base` is the
    /// person's own directory (a file picked on Windows).
    pub scratch: Option<PathBuf>,
    pub roots: Vec<Root>,
}

impl Staged {
    pub fn cleanup(&self) {
        if let Some(dir) = &self.scratch {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

/// `true` when `path` starts like a zip archive, whatever it is called: a
/// `content://` copy has no name to go by.
pub fn is_zip(path: &Path) -> std::io::Result<bool> {
    let mut magic = [0u8; 4];
    let mut f = std::fs::File::open(path)?;
    let n = f.read(&mut magic)?;
    Ok(n == 4 && magic == *b"PK\x03\x04")
}

/// Unpacks the `.dict.yaml` files of `zip` into `dest` and nothing else.
/// Entry names that would leave `dest` are refused, and so is an archive past
/// [`MAX_ENTRIES`] or [`MAX_UNPACKED_BYTES`] — measured on what was actually
/// written, not on what the archive claims.
pub fn unpack(zip: &Path, dest: &Path) -> Result<usize, String> {
    let file = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("not a readable zip: {e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "the archive has {} entries; at most {MAX_ENTRIES}",
            archive.len()
        ));
    }
    let mut written = 0u64;
    let mut count = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || !entry.name().ends_with(SUFFIX) {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!(
                "{} would be written outside the archive's directory",
                entry.name()
            ));
        };
        let out = dest.join(rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        let budget = MAX_UNPACKED_BYTES - written;
        let copied = std::io::copy(&mut (&mut entry).take(budget + 1), &mut f).map_err(|e| e.to_string())?;
        if copied > budget {
            return Err(format!("the archive unpacks to more than {MAX_UNPACKED_BYTES} bytes"));
        }
        written += copied;
        count += 1;
    }
    Ok(count)
}

fn header_of(path: &Path) -> Option<meridian_ime_dict::rime::Header> {
    let mut buf = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(HEADER_BYTES)
        .read_to_end(&mut buf)
        .ok()?;
    split_header(&String::from_utf8_lossy(&buf)).0
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            walk(&path, out)?;
        } else if path.to_string_lossy().ends_with(SUFFIX) {
            out.push(path);
        }
    }
    Ok(())
}

fn relative(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The root dictionaries under `base`: every `.dict.yaml` that no other one
/// imports. An import is resolved the way the importer resolves it, relative
/// to the importing file's directory. Most imports first.
pub fn find_roots(base: &Path) -> Result<Vec<Root>, String> {
    let mut files = Vec::new();
    walk(base, &mut files).map_err(|e| e.to_string())?;
    let headers: Vec<_> = files.iter().map(|f| header_of(f)).collect();
    let mut imported = HashSet::new();
    for (file, header) in files.iter().zip(&headers) {
        let dir = file.parent().unwrap_or(base);
        for table in header.iter().flat_map(|h| &h.import_tables) {
            imported.insert(dir.join(format!("{table}{SUFFIX}")));
        }
    }
    let mut roots: Vec<Root> = files
        .iter()
        .zip(&headers)
        .filter(|(file, _)| !imported.contains(*file))
        .map(|(file, header)| Root {
            path: relative(base, file),
            name: header.as_ref().and_then(|h| h.name.clone()),
            imports: header.as_ref().map_or(0, |h| h.import_tables.len()),
        })
        .collect();
    roots.sort_by(|a, b| b.imports.cmp(&a.imports).then_with(|| a.path.cmp(&b.path)));
    Ok(roots)
}

/// Looks at `picked` — a `.dict.yaml`, or a zip of them — and says what can
/// be imported from it. A zip is unpacked under `scratch_root/<id>`; a single
/// file is imported where it is, so the tables beside it are found.
pub fn stage(picked: &Path, scratch_root: &Path, id: String) -> Result<Staged, String> {
    if is_zip(picked).map_err(|e| e.to_string())? {
        let dir = scratch_root.join(&id);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let staged = (|| {
            if unpack(picked, &dir)? == 0 {
                return Err("the archive holds no .dict.yaml file".to_string());
            }
            find_roots(&dir)
        })();
        match staged {
            Ok(roots) => Ok(Staged {
                id,
                base: dir.clone(),
                scratch: Some(dir),
                roots,
            }),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                Err(e)
            }
        }
    } else {
        let base = picked.parent().map(Path::to_path_buf).unwrap_or_default();
        let header = header_of(picked).ok_or("not a Rime dictionary (no header)")?;
        Ok(Staged {
            id,
            base: base.clone(),
            scratch: None,
            roots: vec![Root {
                path: relative(&base, picked),
                name: header.name,
                imports: header.import_tables.len(),
            }],
        })
    }
}

/// Resolves a root the caller chose against a staging, refusing anything
/// that is not one of its roots — the path came back over IPC.
pub fn root_path(staged: &Staged, chosen: &str) -> Result<PathBuf, String> {
    if !staged.roots.iter().any(|r| r.path == chosen) {
        return Err(format!("{chosen} is not a dictionary in what was picked"));
    }
    Ok(staged.base.join(chosen))
}

/// Downloads `url` to `dest`, refusing more than [`MAX_DOWNLOAD_BYTES`].
pub async fn download(url: &str, dest: &Path) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut total = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download failed: {e}"))?;
        total += chunk.len() as u64;
        if total > MAX_DOWNLOAD_BYTES {
            return Err(format!("the download is larger than {MAX_DOWNLOAD_BYTES} bytes"));
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    const ROOT: &str =
        "---\nname: rime_ice\nversion: \"1\"\nimport_tables:\n  - cn_dicts/8105\n  - cn_dicts/base\n...\n";
    const TABLE: &str = "---\nname: 8105\n...\n你\tni\t100\n";
    const ENGLISH: &str = "---\nname: melt_eng\n...\nhello\thello\t1\n";

    fn zip_of(path: &Path, files: &[(&str, &str)]) {
        let mut w = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        for (name, body) in files {
            w.start_file(*name, opts).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap();
    }

    fn rime_like(path: &Path) {
        zip_of(
            path,
            &[
                ("rime-ice-main/rime_ice.dict.yaml", ROOT),
                ("rime-ice-main/cn_dicts/8105.dict.yaml", TABLE),
                ("rime-ice-main/cn_dicts/base.dict.yaml", TABLE),
                ("rime-ice-main/en_dicts/melt_eng.dict.yaml", ENGLISH),
                ("rime-ice-main/README.md", "not a dictionary"),
            ],
        );
    }

    #[test]
    fn an_archive_is_unpacked_and_its_roots_found() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("download.bin");
        rime_like(&zip);
        let staged = stage(&zip, &tmp.path().join("scratch"), "a".into()).unwrap();
        let paths: Vec<&str> = staged.roots.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "rime-ice-main/rime_ice.dict.yaml",
                "rime-ice-main/en_dicts/melt_eng.dict.yaml"
            ],
            "imported tables are not roots; the one importing most comes first"
        );
        assert_eq!(staged.roots[0].name.as_deref(), Some("rime_ice"));
        assert_eq!(staged.roots[0].imports, 2);
        assert!(
            !staged.base.join("rime-ice-main/README.md").exists(),
            "only dictionaries are unpacked"
        );
        assert_eq!(staged.roots[0].path, RIME_ICE_ROOT);
        staged.cleanup();
        assert!(!tmp.path().join("scratch/a").exists());
    }

    #[test]
    fn a_single_file_is_imported_where_it_is() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("cn_dicts")).unwrap();
        std::fs::write(tmp.path().join("rime_ice.dict.yaml"), ROOT).unwrap();
        std::fs::write(tmp.path().join("cn_dicts/8105.dict.yaml"), TABLE).unwrap();
        let staged = stage(
            &tmp.path().join("rime_ice.dict.yaml"),
            &tmp.path().join("scratch"),
            "b".into(),
        )
        .unwrap();
        assert_eq!(staged.base, tmp.path());
        assert!(staged.scratch.is_none(), "the person's own directory is never deleted");
        assert_eq!(
            root_path(&staged, "rime_ice.dict.yaml").unwrap(),
            tmp.path().join("rime_ice.dict.yaml")
        );
    }

    #[test]
    fn a_chosen_root_must_be_one_that_was_offered() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("d.zip");
        rime_like(&zip);
        let staged = stage(&zip, &tmp.path().join("scratch"), "c".into()).unwrap();
        assert!(root_path(&staged, "rime-ice-main/cn_dicts/8105.dict.yaml").is_err());
        assert!(root_path(&staged, "../../etc/passwd").is_err());
    }

    #[test]
    fn an_entry_leaving_the_directory_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("evil.zip");
        zip_of(&zip, &[("../escape.dict.yaml", TABLE)]);
        let err = stage(&zip, &tmp.path().join("scratch"), "d".into()).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        assert!(!tmp.path().join("escape.dict.yaml").exists());
        assert!(
            !tmp.path().join("scratch/d").exists(),
            "a failed staging leaves nothing behind"
        );
    }

    #[test]
    fn an_archive_without_dictionaries_or_a_file_without_a_header_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("empty.zip");
        zip_of(&zip, &[("README.md", "hi")]);
        assert!(stage(&zip, &tmp.path().join("scratch"), "e".into()).is_err());
        let plain = tmp.path().join("notes.txt");
        std::fs::write(&plain, "just text").unwrap();
        assert!(stage(&plain, &tmp.path().join("scratch"), "f".into()).is_err());
    }
}
