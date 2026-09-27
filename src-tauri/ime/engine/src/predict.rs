//! `Engine::predict`: what may follow a commit, before any key is typed.
//!
//! Two sources, in this order. The person's own: every word the personal
//! n-gram has seen after the last one, ranked by the same trigram-backed
//! probability the sentence scorer blends in. Then the dictionary's: the
//! longer words that start with the last one — after 中国, 中国人 and 中国队 —
//! offered as what they add (人, 队). The personal list goes first because it
//! is the one that says what *this* person writes next; the dictionary only
//! says which words exist.
//!
//! A private document gets the dictionary alone, without the person's own
//! words in it either: a prediction is drawn on screen, and a list of what
//! somebody usually types next is exactly what a password field or an
//! incognito tab must not show.

use crate::learn::{Context, Learner, SENTENCE_START};
use crate::query::Engine;

/// A personal follower has to have been seen this often to be offered: one
/// explicit choice counts twice (`EXPLICIT_TRANSITION_WEIGHT` in the
/// session), so this is one chosen word or two composed ones — not a single
/// accident of the sentence composer.
pub const MIN_PERSONAL_COUNT: u32 = 2;

/// Continuations read from the dictionaries per prediction; more than are
/// shown, so that dropping those the personal list already has still leaves
/// enough.
const DICT_CANDIDATES: usize = 16;

/// Where a prediction came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictionSource {
    /// A word the person has typed after this one.
    Personal,
    /// The rest of a dictionary word this one begins.
    Dict,
}

/// One thing that may follow.
#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    /// What goes into the document.
    pub text: String,
    /// What the commit chain continues with once it is chosen: `text` for a
    /// word that follows, the whole word for a continuation — after 中国 and
    /// 人, what was written is the word 中国人, and that is what the next
    /// prediction should start from.
    pub word: String,
    pub source: PredictionSource,
}

impl Engine {
    /// Up to `max` predictions after the words in `ctx`. `personal: false`
    /// leaves out everything the person taught — their n-gram and their
    /// user words — for a private document.
    pub fn predict(&self, ctx: Context<'_>, learner: &dyn Learner, personal: bool, max: usize) -> Vec<Prediction> {
        let mut out: Vec<Prediction> = Vec::new();
        if max == 0 || ctx.prev == SENTENCE_START || ctx.prev.is_empty() {
            return out;
        }
        let push = |out: &mut Vec<Prediction>, p: Prediction| {
            if out.len() < max && !out.iter().any(|q| q.text == p.text) {
                out.push(p);
            }
        };

        if personal {
            let ngram = learner.ngram();
            let mut followers: Vec<(&str, f64)> = ngram
                .followers(ctx.prev)
                .into_iter()
                .filter(|&(w, c)| c >= MIN_PERSONAL_COUNT && w != SENTENCE_START)
                .map(|(w, _)| (w, ngram.probability(ctx, w).unwrap_or(0.0)))
                .collect();
            // Ties by text, so the order does not depend on a hash map's.
            followers.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
            for (w, _) in followers {
                push(
                    &mut out,
                    Prediction {
                        text: w.to_string(),
                        word: w.to_string(),
                        source: PredictionSource::Personal,
                    },
                );
            }
        }

        for hit in self.dicts().continuations(ctx.prev, DICT_CANDIDATES, personal) {
            let Some(rest) = hit.text.strip_prefix(ctx.prev) else {
                continue;
            };
            push(
                &mut out,
                Prediction {
                    text: rest.to_string(),
                    word: hit.text.clone(),
                    source: PredictionSource::Dict,
                },
            );
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use meridian_ime_dict::{DictFile, DictSet, DictWriter, Metadata, SyllableTable, UserWord};

    use super::*;
    use crate::learn::MemoryLearner;

    fn meta() -> Metadata {
        Metadata {
            name: "t".into(),
            license: "UNKNOWN".into(),
            attribution: String::new(),
            source: String::new(),
            cache_key: String::new(),
            version: String::new(),
            entries: 0,
            codes: 0,
            total_frequency: 0,
            created_unix: 0,
            generator: "test".into(),
            format_version: 0,
            importer_version: 1,
            syllable_table_sha256: String::new(),
        }
    }

    fn engine(dir: &std::path::Path, user: &[UserWord]) -> Engine {
        let mut w = DictWriter::new();
        for (c, t, f) in [
            ("wo", "我", 1000),
            ("wo men", "我们", 800),
            ("wo de", "我的", 600),
            ("zhong guo", "中国", 900),
            ("zhong guo ren", "中国人", 300),
            ("zhong guo dui", "中国队", 100),
        ] {
            w.add(c, t, f);
        }
        let path = dir.join("t.mdict");
        w.write(&path, &meta(), &SyllableTable::new()).unwrap();
        let mut set = DictSet::new();
        set.add_file(DictFile::open(&path).unwrap());
        if !user.is_empty() {
            set.set_user_words(user);
        }
        Engine::new(Arc::new(set))
    }

    fn texts(p: &[Prediction]) -> Vec<&str> {
        p.iter().map(|p| p.text.as_str()).collect()
    }

    #[test]
    fn a_word_is_followed_by_what_it_begins() {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path(), &[]);
        let l = MemoryLearner::new();
        let p = e.predict(Context::after("中国"), &l, true, 5);
        assert_eq!(texts(&p), vec!["人", "队"]);
        assert_eq!(p[0].word, "中国人", "the chain continues from the whole word");
        assert_eq!(p[0].source, PredictionSource::Dict);
        assert!(e.predict(Context::after("中国人"), &l, true, 5).is_empty());
        assert!(e.predict(Context::start(), &l, true, 5).is_empty(), "nothing before");
        assert_eq!(e.predict(Context::after("中国"), &l, true, 1).len(), 1, "capped");
    }

    #[test]
    fn what_the_person_types_next_comes_first() {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path(), &[]);
        let mut l = MemoryLearner::new();
        l.record_transition(Context::after("我"), "想", 2);
        l.record_transition(Context::after("我"), "要", 4);
        // Seen once, by the composer: not yet something the person writes.
        l.record_transition(Context::after("我"), "相", 1);
        let p = e.predict(Context::after("我"), &l, true, 5);
        assert_eq!(texts(&p), vec!["要", "想", "们", "的"]);
        assert_eq!(p[0].source, PredictionSource::Personal);
        assert_eq!(p[0].word, "要");
    }

    #[test]
    fn a_private_document_sees_the_dictionary_only() {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(
            dir.path(),
            &[UserWord {
                code: "wo ai".into(),
                text: "我爱".into(),
                weight: 9,
            }],
        );
        let mut l = MemoryLearner::new();
        l.record_transition(Context::after("我"), "要", 4);
        assert_eq!(
            texts(&e.predict(Context::after("我"), &l, true, 5)),
            vec!["要", "爱", "们", "的"]
        );
        assert_eq!(
            texts(&e.predict(Context::after("我"), &l, false, 5)),
            vec!["们", "的"],
            "neither the n-gram nor the user's words"
        );
    }

    #[test]
    fn a_follower_the_dictionary_also_offers_is_listed_once() {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path(), &[]);
        let mut l = MemoryLearner::new();
        l.record_transition(Context::after("我"), "的", 2);
        let p = e.predict(Context::after("我"), &l, true, 5);
        assert_eq!(texts(&p), vec!["的", "们"]);
        assert_eq!(p[0].source, PredictionSource::Personal);
    }
}
