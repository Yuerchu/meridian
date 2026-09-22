//! From lattice to candidates: beam search for whole readings, then the list.
//!
//! The search walks key positions left to right keeping [`BEAM_WIDTH`] states
//! per position. A state is a path of chosen hits; extending it by one span
//! costs the hit's static log-probability blended with the personal n-gram
//! ([`crate::learn::UserNgram::blend`], with the two previous words as
//! context), plus a bonus for how often the person has committed the word,
//! minus [`WORD_COUNT_PENALTY`]. The penalty is what makes 你好 beat 你 + 好
//! when the character frequencies add up higher than the word's: a reading
//! with fewer words is a reading the dictionary vouches for more.
//!
//! The candidate list is then assembled in a fixed order — words covering the
//! whole input, the best sentence readings, then words for a prefix of the
//! input — deduplicated by text, and finally anything the person chose for
//! exactly these keys before is moved to the front. A syllable no dictionary
//! knows simply has no span, so an input can have no full-coverage candidate
//! at all; there is no placeholder for it in the MVP.

use std::collections::HashSet;

use meridian_ime_dict::Hit;

use crate::lattice::{Lattice, MAX_HITS_PER_INCOMPLETE_SPAN, MAX_HITS_PER_SPAN, SpanCache, build_lattice};
use crate::learn::{Context, Learner, SENTENCE_START};
use crate::query::{Candidate, CandidateSource, Engine, Query};
use crate::scheme::InputScheme;

/// Subtracted from a reading's score for every word in it.
pub const WORD_COUNT_PENALTY: f64 = 2.0;
/// States kept per key position.
pub const BEAM_WIDTH: usize = 8;
/// Scale of the personal weight bonus: `WEIGHT_BONUS · ln(1 + min(weight, MAX_COUNTED_WEIGHT))`.
pub const WEIGHT_BONUS: f64 = 0.35;
/// Commits of one word past which the bonus stops growing.
pub const MAX_COUNTED_WEIGHT: u32 = 50;
/// Whole readings offered as sentence candidates.
pub const SENTENCE_READINGS: usize = 3;
/// How much of a reranker's opinion is mixed in.
pub const RERANK_MIX: f64 = 0.5;
/// Cap on the candidate list.
pub const MAX_CANDIDATES: usize = 200;

/// One whole reading of the input.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Reading {
    pub score: f64,
    /// Σ of the raw `hit.log_prob` along the path, what a reranker replaces.
    pub static_sum: f64,
    /// `(text, code)` per word.
    pub words: Vec<(String, String)>,
}

impl Reading {
    fn text(&self) -> String {
        self.words.iter().map(|(t, _)| t.as_str()).collect()
    }
}

pub fn query(engine: &Engine, keys: &str, scheme: InputScheme, learner: &dyn Learner, cache: &mut SpanCache) -> Query {
    if keys.is_empty() {
        return Query::default();
    }
    let parser = scheme.parser(engine.table());
    let dag = parser.build_dag(keys);
    let segmentation = parser.segment(keys);
    let preedit = parser.preedit(keys, &segmentation);
    let lattice = build_lattice(&dag, engine.dicts(), engine.limits(), cache);
    let readings = rerank(engine, search(&lattice, learner, WORD_COUNT_PENALTY));
    let candidates = assemble(keys, &lattice, &readings, learner);
    Query {
        keys: keys.to_string(),
        segmentation,
        preedit,
        candidates,
    }
}

fn weight_bonus(learner: &dyn Learner, text: &str) -> f64 {
    WEIGHT_BONUS * (1.0 + f64::from(learner.weight(text).min(MAX_COUNTED_WEIGHT))).ln()
}

/// Beam search over the lattice. Returns the readings that reach the end of
/// the input, best first; empty when none does.
pub(crate) fn search(lattice: &Lattice, learner: &dyn Learner, penalty: f64) -> Vec<Reading> {
    let n = lattice.len;
    let mut beams: Vec<Vec<Reading>> = (0..=n).map(|_| Vec::new()).collect();
    beams[0].push(Reading {
        score: 0.0,
        static_sum: 0.0,
        words: Vec::new(),
    });
    for pos in 0..n {
        prune(&mut beams[pos]);
        let states = std::mem::take(&mut beams[pos]);
        if states.is_empty() {
            continue;
        }
        for span in &lattice.spans[pos] {
            let cap = if span.incomplete() {
                MAX_HITS_PER_INCOMPLETE_SPAN
            } else {
                MAX_HITS_PER_SPAN
            };
            for hit in span.hits.iter().take(cap) {
                let bonus = weight_bonus(learner, &hit.text);
                for state in &states {
                    let (prev2, prev) = context_of(&state.words);
                    let step =
                        learner.ngram().blend(Context::of(prev2, prev), &hit.text, hit.log_prob) + bonus - penalty;
                    let mut words = state.words.clone();
                    words.push((hit.text.clone(), hit.code.clone()));
                    beams[span.end].push(Reading {
                        score: state.score + step,
                        static_sum: state.static_sum + hit.log_prob,
                        words,
                    });
                }
            }
        }
    }
    prune(&mut beams[n]);
    beams.pop().unwrap_or_default()
}

/// The n-gram context after `words`: the last word (or the sentence start)
/// and the one before it.
fn context_of(words: &[(String, String)]) -> (Option<&str>, &str) {
    match words {
        [] => (None, SENTENCE_START),
        [(last, _)] => (Some(SENTENCE_START), last),
        [.., (prev, _), (last, _)] => (Some(prev.as_str()), last),
    }
}

/// Best first, one state per (last word, previous word), at most `BEAM_WIDTH`.
fn prune(states: &mut Vec<Reading>) {
    states.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    let mut keep = Vec::with_capacity(BEAM_WIDTH.min(states.len()));
    for (i, s) in states.iter().enumerate() {
        let (prev2, prev) = context_of(&s.words);
        if seen.insert((prev, prev2.unwrap_or(""))) {
            keep.push(i);
            if keep.len() == BEAM_WIDTH {
                break;
            }
        }
    }
    let mut i = 0;
    states.retain(|_| {
        let kept = keep.contains(&i);
        i += 1;
        kept
    });
}

/// Mixes the engine's scorer into the readings, when it answers.
fn rerank(engine: &Engine, mut readings: Vec<Reading>) -> Vec<Reading> {
    if readings.is_empty() {
        return readings;
    }
    let texts: Vec<String> = readings.iter().map(Reading::text).collect();
    let borrowed: Vec<&str> = texts.iter().map(String::as_str).collect();
    let scores = engine.scorer().score("", &borrowed);
    if scores.len() != readings.len() {
        return readings;
    }
    for (r, s) in readings.iter_mut().zip(scores) {
        r.score += RERANK_MIX * (s - r.static_sum);
    }
    readings.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    readings
}

fn word_candidate(hit: &Hit, score: f64, consumed: usize) -> Candidate {
    Candidate {
        text: hit.text.clone(),
        score,
        source: if hit.user {
            CandidateSource::User
        } else {
            CandidateSource::Dict
        },
        words: vec![(hit.text.clone(), hit.code.clone())],
        consumed,
    }
}

fn push_unique(out: &mut Vec<Candidate>, seen: &mut HashSet<String>, candidate: Candidate) {
    if seen.insert(candidate.text.clone()) {
        out.push(candidate);
    }
}

fn by_score_desc(a: f64, b: f64) -> std::cmp::Ordering {
    b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal)
}

fn assemble(keys: &str, lattice: &Lattice, readings: &[Reading], learner: &dyn Learner) -> Vec<Candidate> {
    let len = lattice.len;
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    // a. Words covering the whole input.
    let mut full: Vec<(f64, &Hit)> = lattice
        .full_spans()
        .flat_map(|span| {
            span.hits
                .iter()
                .map(|h| (h.log_prob + weight_bonus(learner, &h.text), h))
        })
        .collect();
    full.sort_by(|a, b| by_score_desc(a.0, b.0));
    for (score, hit) in full {
        push_unique(&mut out, &mut seen, word_candidate(hit, score, len));
    }

    // b. Sentence readings; a one-word reading is that word, already above.
    for r in readings.iter().filter(|r| r.words.len() >= 2).take(SENTENCE_READINGS) {
        let candidate = Candidate {
            text: r.text(),
            score: r.score,
            source: CandidateSource::Sentence,
            words: r.words.clone(),
            consumed: len,
        };
        push_unique(&mut out, &mut seen, candidate);
    }

    // c. Words for a prefix of the input, longest first.
    let mut prefix: Vec<(usize, f64, &Hit)> = lattice
        .prefix_spans()
        .flat_map(|span| {
            span.hits
                .iter()
                .map(move |h| (span.end, h.log_prob + weight_bonus(learner, &h.text), h))
        })
        .collect();
    prefix.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| by_score_desc(a.1, b.1)));
    for (end, score, hit) in prefix {
        push_unique(&mut out, &mut seen, word_candidate(hit, score, end));
    }

    // d. What the person chose for exactly these keys goes first.
    let mut ranked: Vec<(u32, Candidate)> = out
        .into_iter()
        .map(|c| (learner.choice_weight(keys, &c.text), c))
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked.truncate(MAX_CANDIDATES);
    ranked.into_iter().map(|(_, c)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lattice::testutil::{NIHAO_ROWS, engine};
    use crate::learn::{MemoryLearner, UserNgram};
    use crate::scheme::{PinyinScheme, SchemeParser};
    use meridian_ime_dict::UserWord;
    use std::collections::HashMap;

    fn texts(q: &Query) -> Vec<&str> {
        q.candidates.iter().map(|c| c.text.as_str()).collect()
    }

    fn ask(engine: &Engine, keys: &str, learner: &dyn Learner) -> Query {
        engine.query(keys, InputScheme::Pinyin, learner, &mut SpanCache::new())
    }

    #[test]
    fn picks_common_words_over_characters() {
        let (_dir, engine) = engine(NIHAO_ROWS);
        let q = ask(&engine, "nihao", &MemoryLearner::new());
        assert_eq!(texts(&q)[0], "你好");
        assert_eq!(q.candidates[0].source, CandidateSource::Dict);
        assert_eq!(q.candidates[0].consumed, 5);
        assert_eq!(q.candidates[0].words, vec![("你好".to_string(), "ni hao".to_string())]);
        // The prefix word follows, consuming only its own keys.
        let ni = q
            .candidates
            .iter()
            .find(|c| c.text == "你")
            .expect("你 offered as a prefix");
        assert_eq!(ni.consumed, 2);
        assert_eq!(q.preedit.iter().map(|s| s.text.as_str()).collect::<String>(), "ni hao");
    }

    /// Mutation note: with `WORD_COUNT_PENALTY = 0` the three-character
    /// reading wins on raw frequency, so the second half of this test is the
    /// mutant's failure — the same search with the penalty removed.
    #[test]
    fn word_count_penalty_prefers_fewer_words() {
        let rows = &[
            ("ni hao", "你好", 1000),
            ("ni", "你", 5000),
            ("hao", "号", 5000),
            ("ma", "吗", 5000),
        ];
        let (_dir, engine) = engine(rows);
        let learner = MemoryLearner::new();
        let q = ask(&engine, "nihaoma", &learner);
        assert_eq!(texts(&q)[0], "你好吗", "{:?}", texts(&q));
        assert_eq!(q.candidates[0].source, CandidateSource::Sentence);
        assert!(texts(&q).contains(&"你号吗"));

        let dag = PinyinScheme::new(engine.table()).build_dag("nihaoma");
        let lattice = build_lattice(&dag, engine.dicts(), engine.limits(), &mut SpanCache::new());
        let with = search(&lattice, &learner, WORD_COUNT_PENALTY);
        assert_eq!(with[0].text(), "你好吗");
        let without = search(&lattice, &learner, 0.0);
        assert_eq!(
            without[0].text(),
            "你号吗",
            "without the penalty the characters add up higher"
        );
    }

    #[test]
    fn personal_bigram_flips_near_tie() {
        let rows = &[("wo", "我", 5000), ("xiang", "想", 1000), ("xiang", "相", 1001)];
        let (_dir, engine) = engine(rows);
        let mut learner = MemoryLearner::new();
        let q = ask(&engine, "woxiang", &learner);
        assert_eq!(texts(&q)[0], "我相", "the static tie-break, before any history");
        for _ in 0..4 {
            learner.record_transition(Context::after("我"), "想", 1);
        }
        let q = ask(&engine, "woxiang", &learner);
        assert_eq!(texts(&q)[0], "我想");
        assert_eq!(q.candidates[0].words.len(), 2);
    }

    /// A learner with a choice table; the placeholder `MemoryLearner` has none.
    struct Choosy {
        inner: MemoryLearner,
        choices: HashMap<(String, String), u32>,
    }

    impl Learner for Choosy {
        fn record(&mut self, text: &str) {
            self.inner.record(text)
        }
        fn weight(&self, text: &str) -> u32 {
            self.inner.weight(text)
        }
        fn unrecord(&mut self, text: &str) {
            self.inner.unrecord(text)
        }
        fn record_choice(&mut self, keys: &str, text: &str) {
            *self.choices.entry((keys.into(), text.into())).or_default() += 1;
        }
        fn choice_weight(&self, keys: &str, text: &str) -> u32 {
            self.choices.get(&(keys.into(), text.into())).copied().unwrap_or(0)
        }
        fn unrecord_choice(&mut self, keys: &str, text: &str) {
            self.choices.remove(&(keys.into(), text.into()));
        }
        fn record_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
            self.inner.record_transition(ctx, word, times)
        }
        fn unrecord_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
            self.inner.unrecord_transition(ctx, word, times)
        }
        fn learn_word(&mut self, text: &str, code: &str) {
            self.inner.learn_word(text, code)
        }
        fn forget_word(&mut self, text: &str, code: &str) {
            self.inner.forget_word(text, code)
        }
        fn user_words(&self) -> Vec<UserWord> {
            self.inner.user_words()
        }
        fn user_words_generation(&self) -> u64 {
            self.inner.user_words_generation()
        }
        fn ngram(&self) -> &UserNgram {
            self.inner.ngram()
        }
        fn flush(&mut self) {
            self.inner.flush()
        }
    }

    #[test]
    fn choice_promotes_previous_selection() {
        let (_dir, engine) = engine(NIHAO_ROWS);
        let mut learner = Choosy {
            inner: MemoryLearner::new(),
            choices: HashMap::new(),
        };
        let q = ask(&engine, "nh", &learner);
        assert_eq!(&texts(&q)[..2], ["你好", "你很"]);
        learner.record_choice("nh", "你很");
        let q = ask(&engine, "nh", &learner);
        assert_eq!(&texts(&q)[..2], ["你很", "你好"]);
        // Another key string is not affected.
        let q = ask(&engine, "nihao", &learner);
        assert_eq!(texts(&q)[0], "你好");
    }

    #[test]
    fn prefix_candidates_when_end_unreachable() {
        let (_dir, engine) = engine(NIHAO_ROWS);
        for keys in ["nihaox", "nihao1"] {
            let q = ask(&engine, keys, &MemoryLearner::new());
            let first = &q.candidates[0];
            assert_eq!(first.text, "你好", "{keys}: {:?}", texts(&q));
            assert_eq!(first.consumed, 5);
        }
        let q = ask(&engine, "nihao1", &MemoryLearner::new());
        assert!(q.segmentation.is_empty());
        assert_eq!(q.preedit.len(), 1);
        assert_eq!(q.preedit[0].text, "nihao1");
        let q = ask(&engine, "hello", &MemoryLearner::new());
        assert!(q.candidates.iter().all(|c| c.consumed < 5));
        assert!(ask(&engine, "", &MemoryLearner::new()).candidates.is_empty());
    }

    #[test]
    fn sentence_candidates_have_words() {
        let (_dir, engine) = engine(NIHAO_ROWS);
        let q = ask(&engine, "nihaozhongguo", &MemoryLearner::new());
        let sentence = &q.candidates[0];
        assert_eq!(sentence.text, "你好中国");
        assert_eq!(sentence.source, CandidateSource::Sentence);
        assert_eq!(sentence.consumed, 13);
        assert_eq!(
            sentence.words,
            vec![
                ("你好".to_string(), "ni hao".to_string()),
                ("中国".to_string(), "zhong guo".to_string())
            ]
        );
        assert_eq!(sentence.code(), "ni hao zhong guo");
    }

    #[test]
    fn zhuyin_query_matches_pinyin_query() {
        let (_dir, engine) = engine(NIHAO_ROWS);
        let learner = MemoryLearner::new();
        let zhuyin = engine.query("su3cl3", InputScheme::Zhuyin, &learner, &mut SpanCache::new());
        let pinyin = ask(&engine, "nihao", &learner);
        assert_eq!(texts(&zhuyin)[0], "你好");
        // Pinyin also reads `nih` + `ao` (你很 for a prefix); the tones make
        // zhuyin unambiguous, so compare what covers the whole input.
        let full = |q: &Query| -> Vec<String> {
            q.candidates
                .iter()
                .filter(|c| c.consumed == q.keys.chars().count())
                .map(|c| c.text.clone())
                .collect()
        };
        assert_eq!(full(&zhuyin), full(&pinyin));
        assert_eq!(
            zhuyin.preedit.iter().map(|s| s.text.as_str()).collect::<String>(),
            "ㄋㄧˇ ㄏㄠˇ"
        );
        assert_eq!(zhuyin.candidates[0].consumed, 6);
    }
}
