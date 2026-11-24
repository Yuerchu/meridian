//! What the input method has learned, as the settings page lists it, and the
//! page's way of having some of it forgotten or merged.
//!
//! The tables belong to the process that types (the Windows host, the Android
//! keyboard), which holds them in memory and writes them out every minute, so
//! nothing here writes them: forgetting and merging are requests that process
//! carries out. Reading goes through `FileLearner::read`, which never writes
//! either, and the requests still waiting are applied to what was read — in
//! memory, never saved — so a word just forgotten is not listed again before
//! the keyboard has got round to it, and a just-imported replace already shows
//! only the incoming rows.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use meridian_ime_config::{
    ForgetRequest, ImeDirs, MergeKind, pending_forgets, pending_merges, request_forget, request_merge,
};
use meridian_ime_engine::{FileLearner, Learner, MemoryLearner};

use super::archive;
use super::learn_zip;

/// One word, as often as it was committed; `user_word` when the person also
/// composed it into their own dictionary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LearnedWord {
    pub text: String,
    pub count: u32,
    pub user_word: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Learned {
    /// Most committed first.
    pub words: Vec<LearnedWord>,
    /// Which-word-followed-which rows; what makes the next word easier.
    pub transitions: usize,
    /// Requests to forget or merge the keyboard has not carried out yet.
    pub pending: usize,
}

fn overlay(dirs: &ImeDirs) -> Result<(MemoryLearner, usize), String> {
    let mut tables =
        FileLearner::read(&dirs.learn()).map_err(|e| format!("cannot read {}: {e}", dirs.learn().display()))?;
    let forgets = pending_forgets(dirs).map_err(|e| format!("cannot read the requests to forget: {e}"))?;
    let mut pending = 0usize;
    for p in &forgets {
        match &p.request {
            Ok(ForgetRequest::Word { text }) => tables.erase(text),
            Ok(ForgetRequest::Everything) => tables.erase_all(),
            Err(_) => {}
        }
        if p.request.is_ok() {
            pending += 1;
        }
    }
    let merges = pending_merges(dirs).map_err(|e| format!("cannot read the requests to merge: {e}"))?;
    for p in &merges {
        match &p.request {
            Ok(req) => {
                pending += 1;
                let incoming = match FileLearner::read(&p.path) {
                    Ok(t) => t,
                    Err(e) => {
                        tracing::warn!(error = %e, path = %p.path.display(), "pending merge unreadable; listed without it");
                        continue;
                    }
                };
                match req.kind {
                    MergeKind::Add => tables.absorb(&incoming),
                    MergeKind::Replace => {
                        tables.erase_all();
                        tables.absorb(&incoming);
                    }
                }
            }
            Err(_) => {}
        }
    }
    Ok((tables, pending))
}

fn learned_from(tables: &MemoryLearner, pending: usize) -> Learned {
    let mut words: BTreeMap<String, LearnedWord> = BTreeMap::new();
    for (text, count) in tables.weights() {
        words.insert(
            text.clone(),
            LearnedWord {
                text: text.clone(),
                count: *count,
                user_word: false,
            },
        );
    }
    for (text, _code) in tables.words().keys() {
        words
            .entry(text.clone())
            .or_insert_with(|| LearnedWord {
                text: text.clone(),
                count: 0,
                user_word: true,
            })
            .user_word = true;
    }
    let mut words: Vec<LearnedWord> = words.into_values().collect();
    words.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.text.cmp(&b.text)));
    Learned {
        words,
        transitions: tables.ngram().len(),
        pending,
    }
}

pub fn list(dirs: &ImeDirs) -> Result<Learned, String> {
    let (tables, pending) = overlay(dirs)?;
    Ok(learned_from(&tables, pending))
}

/// Asks for every trace of `text` to be forgotten.
pub fn forget(dirs: &ImeDirs, text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("nothing to forget".into());
    }
    request_forget(dirs, &ForgetRequest::Word { text: text.to_string() })
        .map_err(|e| format!("cannot file the request: {e}"))
}

/// Asks for everything learned to be forgotten.
pub fn forget_all(dirs: &ImeDirs) -> Result<(), String> {
    request_forget(dirs, &ForgetRequest::Everything).map_err(|e| format!("cannot file the request: {e}"))
}

/// Writes a zip of the learned tables, with pending forgets and merges already
/// applied in memory, to `dest`.
pub fn export(dirs: &ImeDirs, dest: &Path) -> Result<PathBuf, String> {
    let (tables, _) = overlay(dirs)?;
    let parent = dest.parent().unwrap_or(dest);
    let staging = parent.join(format!(
        ".{}.tables-{}",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("learn"),
        std::process::id()
    ));
    let written = (|| {
        FileLearner::write_tables(&staging, &tables).map_err(|e| e.to_string())?;
        learn_zip::write_zip(&staging, dest)
    })();
    let _ = std::fs::remove_dir_all(&staging);
    written?;
    Ok(dest.to_path_buf())
}

/// Stages `path` (a zip or a directory of the four TSVs) as a merge request.
/// Does not write the live tables.
pub fn import(dirs: &ImeDirs, path: &Path, kind: MergeKind) -> Result<(), String> {
    if path.is_dir() {
        FileLearner::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        request_merge(dirs, kind, path).map_err(|e| format!("cannot file the request: {e}"))?;
        return Ok(());
    }
    let is_zip = archive::is_zip(path).map_err(|e| e.to_string())?;
    if !is_zip {
        return Err(format!("{} is not a zip or a learn directory", path.display()));
    }
    let staging = learn_zip::staging_root(dirs).join(format!("import-{}", std::process::id()));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    let result = (|| {
        learn_zip::unpack_zip(path, &staging)?;
        request_merge(dirs, kind, &staging).map_err(|e| format!("cannot file the request: {e}"))
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result
}

#[cfg(test)]
mod tests {
    use meridian_ime_engine::Context;

    use super::*;

    fn learned(dir: &std::path::Path) -> ImeDirs {
        let dirs = ImeDirs::new(dir);
        let mut f = FileLearner::open(&dirs.learn()).unwrap();
        f.record("你好");
        f.record("你好");
        f.record("香港");
        f.learn_word("香港", "xiang gang");
        f.learn_word("中国队", "zhong guo dui");
        f.record_transition(Context::after("去"), "香港", 1);
        f.flush();
        dirs
    }

    #[test]
    fn words_are_listed_most_committed_first_with_user_words_marked() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = learned(tmp.path());
        let l = list(&dirs).unwrap();
        let texts: Vec<_> = l
            .words
            .iter()
            .map(|w| (w.text.as_str(), w.count, w.user_word))
            .collect();
        assert_eq!(texts, vec![("你好", 2, false), ("香港", 1, true), ("中国队", 0, true)]);
        assert_eq!(l.transitions, 1);
        assert_eq!(l.pending, 0);
    }

    /// Asked for and not yet done: the list already leaves it out, and the
    /// files are still as they were — only the keyboard writes them.
    #[test]
    fn a_word_asked_to_be_forgotten_is_not_listed_while_it_waits() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = learned(tmp.path());
        let before = std::fs::read_to_string(dirs.learn().join("user.tsv")).unwrap();
        forget(&dirs, "香港").unwrap();
        let l = list(&dirs).unwrap();
        assert!(l.words.iter().all(|w| w.text != "香港"));
        assert_eq!(l.transitions, 0, "its transition went with it");
        assert_eq!(l.pending, 1);
        assert_eq!(std::fs::read_to_string(dirs.learn().join("user.tsv")).unwrap(), before);

        forget_all(&dirs).unwrap();
        assert!(list(&dirs).unwrap().words.is_empty());
    }

    #[test]
    fn nothing_learned_is_an_empty_list_not_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let l = list(&ImeDirs::new(tmp.path())).unwrap();
        assert!(l.words.is_empty() && l.transitions == 0);
        assert!(forget(&ImeDirs::new(tmp.path()), "  ").is_err());
    }

    #[test]
    fn export_omits_a_word_waiting_to_be_forgotten() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = learned(tmp.path());
        forget(&dirs, "香港").unwrap();
        let zip = tmp.path().join("out.zip");
        export(&dirs, &zip).unwrap();
        let unpacked = tmp.path().join("unpacked");
        learn_zip::unpack_zip(&zip, &unpacked).unwrap();
        let loaded = FileLearner::read(&unpacked).unwrap();
        assert_eq!(loaded.weight("香港"), 0);
        assert_eq!(loaded.weight("你好"), 2);
        assert!(
            std::fs::read_to_string(dirs.learn().join("user.tsv"))
                .unwrap()
                .contains("香港\t1"),
            "live tables untouched"
        );
    }

    #[test]
    fn import_add_from_a_directory_is_a_request_not_a_write() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = learned(tmp.path());
        let incoming = tmp.path().join("incoming");
        let mut extra = MemoryLearner::new();
        extra.record("香港");
        extra.record("香港");
        FileLearner::write_tables(&incoming, &extra).unwrap();
        let before = std::fs::read_to_string(dirs.learn().join("user.tsv")).unwrap();
        import(&dirs, &incoming, MergeKind::Add).unwrap();
        assert_eq!(std::fs::read_to_string(dirs.learn().join("user.tsv")).unwrap(), before);
        let l = list(&dirs).unwrap();
        assert_eq!(l.words.iter().find(|w| w.text == "香港").unwrap().count, 3);
        assert_eq!(l.pending, 1);
    }

    #[test]
    fn import_replace_from_a_zip_shows_only_incoming_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = learned(tmp.path());
        let incoming = tmp.path().join("incoming");
        let mut extra = MemoryLearner::new();
        extra.record("北京");
        FileLearner::write_tables(&incoming, &extra).unwrap();
        let zip = tmp.path().join("in.zip");
        learn_zip::write_zip(&incoming, &zip).unwrap();
        import(&dirs, &zip, MergeKind::Replace).unwrap();
        let l = list(&dirs).unwrap();
        let texts: Vec<_> = l.words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["北京"]);
        assert_eq!(l.pending, 1);
        assert!(
            std::fs::read_to_string(dirs.learn().join("user.tsv"))
                .unwrap()
                .contains("你好"),
            "live tables still the old ones"
        );
    }

    #[test]
    fn a_zip_that_is_not_a_learn_export_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let zip = tmp.path().join("nope.zip");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&zip).unwrap());
        archive
            .start_file("secret.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        use std::io::Write;
        archive.write_all(b"no").unwrap();
        archive.finish().unwrap();
        assert!(import(&dirs, &zip, MergeKind::Add).is_err());
        assert!(pending_merges(&dirs).unwrap().is_empty());
    }
}
