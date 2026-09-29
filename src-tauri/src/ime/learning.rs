//! What the input method has learned, as the settings page lists it, and the
//! page's way of having some of it forgotten.
//!
//! The tables belong to the process that types (the Windows host, the Android
//! keyboard), which holds them in memory and writes them out every minute, so
//! nothing here writes them: forgetting is a request that process carries out
//! (`meridian_ime_config::forget`). Reading goes through `FileLearner::read`,
//! which never writes either, and the requests still waiting are applied to
//! what was read — in memory, never saved — so a word just forgotten is not
//! listed again before the keyboard has got round to it.

use std::collections::BTreeMap;

use meridian_ime_config::{ForgetRequest, ImeDirs, pending_forgets, request_forget};
use meridian_ime_engine::{FileLearner, Learner};

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
    /// Requests to forget the keyboard has not carried out yet.
    pub pending: usize,
}

pub fn list(dirs: &ImeDirs) -> Result<Learned, String> {
    let mut tables =
        FileLearner::read(&dirs.learn()).map_err(|e| format!("cannot read {}: {e}", dirs.learn().display()))?;
    let pending = pending_forgets(dirs).map_err(|e| format!("cannot read the requests to forget: {e}"))?;
    for p in &pending {
        match &p.request {
            Ok(ForgetRequest::Word { text }) => tables.erase(text),
            Ok(ForgetRequest::Everything) => tables.erase_all(),
            // Set aside by the keyboard when it next looks; nothing to apply.
            Err(_) => {}
        }
    }
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
    Ok(Learned {
        words,
        transitions: tables.ngram().len(),
        pending: pending.iter().filter(|p| p.request.is_ok()).count(),
    })
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
}
