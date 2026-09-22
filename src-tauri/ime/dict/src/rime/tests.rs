use std::path::{Path, PathBuf};

use super::header::split;
use super::*;
use crate::format::DictFile;
use crate::syllable::SyllableTable;

fn write(dir: &Path, rel: &str, content: &str) -> PathBuf {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&path, content).unwrap();
    path
}

fn run(source: &Path, dicts: &Path) -> Result<ImportReport, ImportError> {
    import(source, dicts, &ImportOptions::default(), &SyllableTable::new())
}

fn header(name: &str, imports: &[&str]) -> String {
    let mut s = format!("# Rime dictionary\n---\nname: {name}\nversion: \"1\"\nsort: by_weight\n");
    if !imports.is_empty() {
        s.push_str("import_tables:\n");
        for i in imports {
            s.push_str(&format!("  - {i}   # 说明\n"));
        }
    }
    s.push_str("...\n");
    s
}

#[test]
fn header_parses_columns_import_tables_with_inline_comments() {
    let text = "# Rime dictionary\n# encoding: utf-8\n\n---\nname: rime_ice\nversion: \"2026-01-26\"\nsort: by_weight\n\
columns:\n  - text\n  - code     # 拼音\n  - weight\n\
import_tables:\n  - cn_dicts/8105     # 字表\n  # - cn_dicts/41448  # 大字表（按需启用）\n  - cn_dicts/base     # 基础词库\n\n\
  # - mydict1\n...\n\n# +_+\n你好\tni hao\t100\r\n";
    let (h, body) = split(text);
    let h = h.expect("has a header");
    assert_eq!(h.name.as_deref(), Some("rime_ice"));
    assert_eq!(h.version.as_deref(), Some("2026-01-26"));
    assert_eq!(h.sort.as_deref(), Some("by_weight"));
    assert_eq!(h.columns, vec!["text", "code", "weight"]);
    assert_eq!(h.import_tables, vec!["cn_dicts/8105", "cn_dicts/base"]);
    assert_eq!(body, "\n# +_+\n你好\tni hao\t100\r\n");

    let (h, body) = split("---\nname: tencent\ncolumns: [text, weight]\n...\n三个字\t100\n");
    let h = h.unwrap();
    assert_eq!(h.columns, vec!["text", "weight"]);
    assert!(h.import_tables.is_empty());
    assert_eq!(body, "三个字\t100\n");

    let (h, body) = split("\u{feff}# no header at all\n你好\tni hao\n");
    assert!(h.is_none());
    assert_eq!(body, "# no header at all\n你好\tni hao\n");
    assert_eq!(
        Header::default().columns_or_default(),
        DEFAULT_COLUMNS.map(String::from).to_vec()
    );

    // A version that is not quoted, and a key whose nested map must be stepped over.
    let (h, _) = split("---\nname: moegirl\nencoder:\n  rules:\n    - xform/a/b/\nversion: 0.0.1\n...\n");
    let h = h.unwrap();
    assert_eq!(h.version.as_deref(), Some("0.0.1"));
    assert!(h.import_tables.is_empty());
}

#[test]
fn tencent_style_text_weight_table_is_skipped_with_no_code_column() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(
        dir.path(),
        "root.dict.yaml",
        &(header("root", &["cn_dicts/tencent"]) + "你好\tni hao\t100\n"),
    );
    write(
        dir.path(),
        "cn_dicts/tencent.dict.yaml",
        "---\nname: tencent\ncolumns:\n  - text\n  - weight\n...\n# +_+\n三个字\t100\n四个字啊\t100\n",
    );
    let r = run(&root, &dir.path().join("out")).unwrap();
    assert_eq!(r.files.len(), 2);
    assert_eq!(r.files[1].reason, Some(FileSkip::NoCodeColumn));
    assert_eq!(
        r.files[1].rows, 2,
        "what a skipped file would have contributed is counted"
    );
    assert_eq!(r.files[1].skipped.no_code, 2);
    assert_eq!(r.files[1].accepted, 0);
    assert_eq!(r.accepted, 1);
    assert_eq!(r.skipped.no_code, 2);
    assert_eq!(r.skipped.total(), 2);
}

#[test]
fn two_column_text_code_rows_get_default_weight() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(
        dir.path(),
        "others.dict.yaml",
        &(header("others", &[])
            + "空落落\tkong luo luo\n阿房宫\te pang gong\t5000\n伯伯\tbo bo\tabc\n你好\tni hao\t\n"),
    );
    let r = run(&root, &dir.path().join("out")).unwrap();
    assert_eq!(r.accepted, 4);
    assert_eq!(r.skipped.bad_weight, 1);
    assert_eq!(r.skipped.total(), 0, "a bad weight keeps the row");
    let d = DictFile::open(&r.output).unwrap();
    assert_eq!(d.lookup("kong luo luo")[0].freq, 1);
    assert_eq!(d.lookup("e pang gong")[0].freq, 5000);
    assert_eq!(d.lookup("bo bo")[0].freq, 0);
    assert_eq!(d.lookup("ni hao")[0].freq, 1, "an empty weight field is a missing one");
    assert_eq!(d.meta().name, "others");
    assert_eq!(d.meta().version, "1");
    assert_eq!(d.meta().license, "UNKNOWN");
    assert_eq!(d.meta().importer_version, IMPORTER_VERSION);
    assert_eq!(d.meta().cache_key, r.cache_key);
    assert_eq!(d.meta().syllable_table_sha256, SyllableTable::new().sha256());
    assert!(d.meta().created_unix > 0);
    assert!(d.meta().generator.starts_with("meridian-ime-dict "));
}

#[test]
fn invalid_syllables_and_unspaced_codes_are_counted_not_imported() {
    let dir = tempfile::tempdir().unwrap();
    // `A\tA` would lowercase to the syllable `a`, so the uppercase letter case
    // uses one that is no syllable at all.
    let root = write(
        dir.path(),
        "root.dict.yaml",
        &(header("root", &[]) + "B\tB\nhello\thello\n你好\tnihao\n略\tlue\n\tni\nM1\nNÜ\tNÜ\n你好\tni  hao\n"),
    );
    let r = run(&root, &dir.path().join("out")).unwrap();
    let f = &r.files[0];
    assert_eq!(f.rows, 8);
    assert_eq!(f.skipped.invalid_syllable, 0);
    assert_eq!(f.skipped.ascii_text, 2, "B and hello are ASCII texts");
    assert_eq!(f.skipped.unspaced_code, 1, "nihao is refused, not segmented");
    assert_eq!(f.skipped.empty_text, 1);
    assert_eq!(f.skipped.malformed, 1);
    assert_eq!(f.accepted, 3);
    assert_eq!(r.accepted, 3);
    let d = DictFile::open(&r.output).unwrap();
    assert_eq!(d.lookup("lve")[0].text, "略");
    assert_eq!(d.lookup("nv")[0].text, "NÜ", "ü folds to v and the case is lowered");
    assert_eq!(d.lookup("ni hao")[0].text, "你好", "runs of spaces collapse");
    assert!(d.lookup("nihao").is_empty());
    assert!(d.lookup("lue").is_empty());
}

#[test]
fn import_tables_cycle_is_reported_once() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(dir.path(), "a.dict.yaml", &(header("a", &["a"]) + "你\tni\t1\n"));
    let r = run(&root, &dir.path().join("out")).unwrap();
    assert_eq!(r.files.len(), 2);
    assert_eq!(r.files[1].reason, Some(FileSkip::Cycle));
    assert_eq!(r.files.iter().filter(|f| f.reason == Some(FileSkip::Cycle)).count(), 1);
    assert_eq!(r.accepted, 1);

    let dir = tempfile::tempdir().unwrap();
    let a = write(dir.path(), "a.dict.yaml", &(header("a", &["b"]) + "你\tni\t1\n"));
    write(dir.path(), "b.dict.yaml", &(header("b", &["a"]) + "好\thao\t1\n"));
    let r = run(&a, &dir.path().join("out")).unwrap();
    assert_eq!(r.files.len(), 3);
    assert_eq!(r.files[0].reason, None);
    assert_eq!(r.files[1].reason, None);
    assert_eq!(r.files[2].reason, Some(FileSkip::Cycle));
    assert_eq!(r.files[2].path, a);
    assert_eq!(r.accepted, 2);
}

#[test]
fn missing_import_is_reported_and_the_rest_imported() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(
        dir.path(),
        "root.dict.yaml",
        &(header("root", &["cn_dicts/missing", "cn_dicts/b"]) + "你\tni\t1\n"),
    );
    write(
        dir.path(),
        "cn_dicts/b.dict.yaml",
        &(header("b", &[]) + "好\thao\t1\n你\tni\t9\n"),
    );
    let r = run(&root, &dir.path().join("out")).unwrap();
    assert_eq!(r.files.len(), 3);
    assert_eq!(r.files[1].reason, Some(FileSkip::MissingImport));
    assert_eq!(r.files[1].path, dir.path().join("cn_dicts").join("missing.dict.yaml"));
    assert_eq!(r.files[2].reason, None);
    assert_eq!(r.files[2].accepted, 1);
    assert_eq!(r.accepted, 2);
    assert_eq!(r.duplicates, 1);
    let d = DictFile::open(&r.output).unwrap();
    assert_eq!(d.lookup("ni")[0].freq, 1, "the root's row came first and wins");

    let missing_root = run(&dir.path().join("nope.dict.yaml"), &dir.path().join("out"));
    assert!(matches!(missing_root, Err(ImportError::NotFound(_))));
}

#[test]
fn cache_key_changes_with_any_imported_file() {
    let table = SyllableTable::new();
    let a = ("a.dict.yaml".to_string(), [1u8; 32]);
    let b = ("b.dict.yaml".to_string(), [2u8; 32]);
    let k1 = cache_key(&[a.clone(), b.clone()], &table);
    assert_eq!(k1.len(), 64);
    assert_ne!(
        k1,
        cache_key(&[b.clone(), a.clone()], &table),
        "order is part of the key"
    );
    assert_ne!(k1, cache_key(std::slice::from_ref(&a), &table));
    assert_ne!(
        k1,
        cache_key(&[a.clone(), ("b.dict.yaml".to_string(), [3u8; 32])], &table)
    );
    assert_ne!(
        k1,
        cache_key(&[a.clone(), ("c.dict.yaml".to_string(), [2u8; 32])], &table)
    );
    assert_eq!(k1, cache_key(&[a, b], &table));

    let dir = tempfile::tempdir().unwrap();
    let root = write(dir.path(), "root.dict.yaml", &(header("root", &["b"]) + "你\tni\t1\n"));
    write(dir.path(), "b.dict.yaml", &(header("b", &[]) + "好\thao\t1\n"));
    let out = dir.path().join("out");
    let first = run(&root, &out).unwrap();
    write(dir.path(), "b.dict.yaml", &(header("b", &[]) + "好\thao\t2\n"));
    let second = run(&root, &out).unwrap();
    assert_ne!(first.cache_key, second.cache_key);
    assert_ne!(first.output, second.output);
    assert!(!second.cache_hit);
    assert!(first.output.is_file() && second.output.is_file());
}

#[test]
fn cache_hit_reuses_existing_mdict() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(
        dir.path(),
        "root.dict.yaml",
        &(header("root", &[]) + "你\tni\t1\n好\thao\t1\nhello\thello\n"),
    );
    let out = dir.path().join("out");
    let first = run(&root, &out).unwrap();
    assert!(!first.cache_hit);
    assert_eq!(first.accepted, 2);
    let written = std::fs::metadata(&first.output).unwrap().modified().unwrap();

    let second = run(&root, &out).unwrap();
    assert!(second.cache_hit);
    assert_eq!(second.output, first.output);
    assert_eq!(second.cache_key, first.cache_key);
    assert_eq!(second.name, "root");
    assert_eq!(second.accepted, 2, "counts come from the existing file's metadata");
    assert!(second.files.is_empty());
    assert_eq!(second.skipped.total(), 0);
    assert_eq!(
        std::fs::metadata(&second.output).unwrap().modified().unwrap(),
        written,
        "not rewritten"
    );
    assert_eq!(std::fs::read_dir(&out).unwrap().count(), 1);
    assert!(first.output.file_name().unwrap().to_str().unwrap().starts_with("root-"));

    // A file of the right name that is not a dictionary is rebuilt, not trusted.
    std::fs::write(&first.output, b"garbage").unwrap();
    let third = run(&root, &out).unwrap();
    assert!(!third.cache_hit);
    assert!(DictFile::open(&third.output).is_ok());
}

#[test]
fn no_usable_entries_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let root = write(
        dir.path(),
        "en.dict.yaml",
        &(header("en", &[]) + "hello\thello\t100\nworld\tworld\t50\n"),
    );
    let out = dir.path().join("out");
    match run(&root, &out) {
        Err(ImportError::NoUsableEntries(r)) => {
            assert_eq!(r.accepted, 0);
            assert_eq!(r.skipped.ascii_text, 2);
            assert_eq!(r.files.len(), 1);
            assert!(!r.output.exists(), "nothing written");
        }
        other => panic!("expected NoUsableEntries, got {other:?}"),
    }
    assert!(!out.exists() || std::fs::read_dir(&out).unwrap().count() == 0);
}

#[test]
fn name_comes_from_option_then_header_then_stem() {
    let dir = tempfile::tempdir().unwrap();
    let table = SyllableTable::new();
    let out = dir.path().join("out");
    let named = write(dir.path(), "x y.dict.yaml", &(header("雾凇 拼音", &[]) + "你\tni\t1\n"));
    let r = import(&named, &out, &ImportOptions::default(), &table).unwrap();
    assert_eq!(
        r.name, "_____",
        "non-ASCII is replaced, never dropped into the file name"
    );
    let r = import(
        &named,
        &out,
        &ImportOptions {
            name: Some("Mine-1".into()),
            ..Default::default()
        },
        &table,
    )
    .unwrap();
    assert_eq!(r.name, "Mine-1");
    let bare = write(dir.path(), "plain.dict.yaml", "你\tni\t1\n");
    let r = import(&bare, &out, &ImportOptions::default(), &table).unwrap();
    assert_eq!(r.name, "plain");
    let d = DictFile::open(&r.output).unwrap();
    assert_eq!(d.meta().version, "");
}
