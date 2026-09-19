//! The word lattice: runs of DAG edges that the dictionaries know a word for.
//!
//! A *span* is a path of consecutive syllable edges from one key position to
//! another, and it exists only if `DictSet::lookup_pattern` answers it. Spans
//! are enumerated by depth-first walk over the DAG, bounded by syllable count
//! — eight when every edge is complete, four once any is not, because an
//! abbreviation lookup fans out far wider than an exact one — and pruned by
//! reachability in both directions: an edge that cannot be reached from the
//! start of the input, or from which the end cannot be reached, is not worth a
//! lookup. When the end is unreachable at all (`kai1`, `nihao1`), the furthest
//! reachable position stands in for it, so the words for the longest parseable
//! prefix still come through and the person sees something for what they typed.
//!
//! Every lookup goes through the session's [`SpanCache`]. A keystroke changes
//! the tail of the input and nothing else, so the spans of the earlier keys are
//! asked again with the same pattern and answered from the map. The cache is
//! keyed by the pattern alone: it must be cleared when the user dictionary
//! changes (`DictSet::set_user_words`), which is the session's job.

use std::collections::HashMap;
use std::sync::Arc;

use meridian_ime_dict::{DictSet, Hit, LookupLimits, SyllablePattern};

use crate::scheme::{SyllableDag, SyllableEdge};

/// Most syllables in a span when every edge is complete.
pub const MAX_SPAN_SYLLABLES: usize = 8;
/// Most syllables in a span once any edge is incomplete.
pub const MAX_INCOMPLETE_SPAN_SYLLABLES: usize = 4;
/// Hits kept per span when every edge is complete.
pub const MAX_HITS_PER_SPAN: usize = 6;
/// Hits kept per span with an incomplete edge, where the pattern is broad and
/// the right word is more often further down.
pub const MAX_HITS_PER_INCOMPLETE_SPAN: usize = 20;
/// Entries the cache holds before it is emptied.
pub const CACHE_CAPACITY: usize = 8192;

/// A run of syllable edges the dictionaries know at least one word for.
#[derive(Debug, Clone)]
pub struct Span {
    /// Key index the first edge starts at.
    pub start: usize,
    /// Key index the last edge ends at.
    pub end: usize,
    pub syllables: Vec<SyllableEdge>,
    /// Best first, at most [`MAX_HITS_PER_SPAN`] / [`MAX_HITS_PER_INCOMPLETE_SPAN`].
    pub hits: Arc<Vec<Hit>>,
}

impl Span {
    /// `true` when any edge is a syllable still being typed.
    pub fn incomplete(&self) -> bool {
        self.syllables.iter().any(|e| !e.complete)
    }
}

/// Every span of one key string, indexed by start position.
#[derive(Debug, Clone, Default)]
pub struct Lattice {
    /// Key count.
    pub len: usize,
    /// `spans[i]` holds the spans starting at key index `i`; `len` entries.
    pub spans: Vec<Vec<Span>>,
    /// `false` when no path of DAG edges reaches the end of the input.
    pub end_reachable: bool,
}

impl Lattice {
    /// Spans covering the whole input.
    pub fn full_spans(&self) -> impl Iterator<Item = &Span> {
        self.spans.first().into_iter().flatten().filter(|s| s.end == self.len)
    }

    /// Spans starting at the first key and ending before the last.
    pub fn prefix_spans(&self) -> impl Iterator<Item = &Span> {
        self.spans.first().into_iter().flatten().filter(|s| s.end < self.len)
    }
}

/// Counters for tests and diagnostics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub entries: usize,
}

/// Memoises span lookups across keystrokes within one session.
#[derive(Debug, Default)]
pub struct SpanCache {
    entries: HashMap<String, Arc<Vec<Hit>>>,
    hits: u64,
    misses: u64,
}

impl SpanCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forgets every entry. Call after the user dictionary changed.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits,
            misses: self.misses,
            entries: self.entries.len(),
        }
    }

    /// The hits for a pattern, from the map or from the dictionaries.
    pub fn lookup(&mut self, dicts: &DictSet, limits: &LookupLimits, pattern: &[SyllableEdge]) -> Arc<Vec<Hit>> {
        let key = pattern_key(pattern);
        if let Some(hits) = self.entries.get(&key) {
            self.hits += 1;
            return Arc::clone(hits);
        }
        self.misses += 1;
        let slots: Vec<SyllablePattern<'_>> = pattern
            .iter()
            .map(|e| SyllablePattern {
                text: &e.text,
                complete: e.complete,
            })
            .collect();
        let incomplete = pattern.iter().any(|e| !e.complete);
        let mut hits = dicts.lookup_pattern(&slots, limits);
        hits.truncate(if incomplete {
            MAX_HITS_PER_INCOMPLETE_SPAN
        } else {
            MAX_HITS_PER_SPAN
        });
        let hits = Arc::new(hits);
        if self.entries.len() >= CACHE_CAPACITY {
            self.entries.clear();
        }
        self.entries.insert(key, Arc::clone(&hits));
        hits
    }
}

/// The cache key of a pattern: texts joined by spaces, an incomplete slot
/// marked with a trailing `~` so `n~` (a prefix) and `n` never collide.
pub(crate) fn pattern_key(pattern: &[SyllableEdge]) -> String {
    let mut key = String::with_capacity(pattern.len() * 6);
    for (i, e) in pattern.iter().enumerate() {
        if i > 0 {
            key.push(' ');
        }
        key.push_str(&e.text);
        if !e.complete {
            key.push('~');
        }
    }
    key
}

/// Which positions a path from the start reaches, which positions a path to
/// the end leaves from, and whether the end is reachable at all. When it is
/// not, the furthest reachable position stands in for the end.
fn reachability(dag: &SyllableDag) -> (Vec<bool>, Vec<bool>, bool) {
    let n = dag.len();
    let mut from_start = vec![false; n + 1];
    from_start[0] = true;
    for pos in 0..n {
        if !from_start[pos] {
            continue;
        }
        for e in &dag[pos] {
            from_start[e.end] = true;
        }
    }
    let mut to_end = vec![false; n + 1];
    to_end[n] = true;
    for pos in (0..n).rev() {
        to_end[pos] = dag[pos].iter().any(|e| to_end[e.end]);
    }
    let end_reachable = from_start[n];
    if !end_reachable {
        // The longest parseable prefix stands in for the end, so a dead `n~`
        // before `i` is still pruned while 你好 for `nihao1` survives.
        let far = (0..=n).rev().find(|&p| from_start[p]).unwrap_or(0);
        to_end.iter_mut().for_each(|b| *b = false);
        to_end[far] = true;
        for pos in (0..far).rev() {
            to_end[pos] = dag[pos].iter().any(|e| to_end[e.end]);
        }
    }
    (from_start, to_end, end_reachable)
}

/// Every span of `dag` the dictionaries answer, looked up through `cache`.
pub fn build_lattice(dag: &SyllableDag, dicts: &DictSet, limits: &LookupLimits, cache: &mut SpanCache) -> Lattice {
    let n = dag.len();
    let (from_start, to_end, end_reachable) = reachability(dag);
    let mut spans: Vec<Vec<Span>> = vec![Vec::new(); n];
    for start in 0..n {
        if !from_start[start] {
            continue;
        }
        let mut stack: Vec<(usize, Vec<SyllableEdge>)> = dag[start]
            .iter()
            .filter(|e| to_end[e.end])
            .map(|e| (e.end, vec![e.clone()]))
            .collect();
        while let Some((pos, path)) = stack.pop() {
            let hits = cache.lookup(dicts, limits, &path);
            if !hits.is_empty() {
                spans[start].push(Span {
                    start,
                    end: pos,
                    syllables: path.clone(),
                    hits,
                });
            }
            if pos >= n {
                continue;
            }
            let incomplete = path.iter().any(|e| !e.complete);
            for e in &dag[pos] {
                if !to_end[e.end] {
                    continue;
                }
                let bound = if incomplete || !e.complete {
                    MAX_INCOMPLETE_SPAN_SYLLABLES
                } else {
                    MAX_SPAN_SYLLABLES
                };
                if path.len() + 1 > bound {
                    continue;
                }
                let mut next = path.clone();
                next.push(e.clone());
                stack.push((e.end, next));
            }
        }
        spans[start].sort_by_key(|s| (s.end, s.syllables.len()));
    }
    Lattice {
        len: n,
        spans,
        end_reachable,
    }
}

/// A dictionary built from rows, for tests in this crate. Kept in a temporary
/// directory that must outlive the `DictSet` (the file is memory-mapped).
#[cfg(test)]
pub(crate) mod testutil {
    use std::sync::Arc;

    use meridian_ime_dict::{DictFile, DictSet, DictWriter, Metadata, SyllableTable};

    use crate::query::Engine;

    pub fn metadata(name: &str) -> Metadata {
        Metadata {
            name: name.into(),
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

    /// `rows` are `(code, text, frequency)`.
    pub fn dict_set(rows: &[(&str, &str, u32)]) -> (tempfile::TempDir, DictSet) {
        let dir = tempfile::tempdir().unwrap();
        let mut w = DictWriter::new();
        for (code, text, freq) in rows {
            w.add(code, text, *freq);
        }
        let path = dir.path().join("test.mdict");
        w.write(&path, &metadata("test"), &SyllableTable::new()).unwrap();
        let mut set = DictSet::new();
        set.add_file(DictFile::open(&path).unwrap());
        (dir, set)
    }

    pub fn engine(rows: &[(&str, &str, u32)]) -> (tempfile::TempDir, Engine) {
        let (dir, set) = dict_set(rows);
        (dir, Engine::new(Arc::new(set)))
    }

    /// The rows most tests share: a few words around 你好.
    pub const NIHAO_ROWS: &[(&str, &str, u32)] = &[
        ("ni hao", "你好", 900),
        ("ni hen", "你很", 100),
        ("ni hao ma", "你好吗", 50),
        ("nu hao", "怒号", 5),
        ("ni", "你", 1000),
        ("na", "那", 800),
        ("hao", "好", 700),
        ("ma", "吗", 600),
        ("zhong guo", "中国", 2000),
    ];
}

#[cfg(test)]
mod tests {
    use super::testutil::{NIHAO_ROWS, dict_set};
    use super::*;
    use crate::scheme::{PinyinScheme, SchemeParser};

    fn texts(span: &Span) -> Vec<&str> {
        span.hits.iter().map(|h| h.text.as_str()).collect()
    }

    fn lattice_for(set: &DictSet, keys: &str, cache: &mut SpanCache) -> Lattice {
        let dag = PinyinScheme::new(set.table()).build_dag(keys);
        build_lattice(&dag, set, &LookupLimits::default(), cache)
    }

    #[test]
    fn first_keystroke_yields_candidates() {
        let (_dir, set) = dict_set(NIHAO_ROWS);
        let l = lattice_for(&set, "n", &mut SpanCache::new());
        assert!(l.end_reachable);
        let full: Vec<&Span> = l.full_spans().collect();
        assert_eq!(full.len(), 1);
        assert!(full[0].incomplete());
        assert_eq!(texts(full[0]), vec!["你", "那"]);
    }

    #[test]
    fn prefix_span_uses_fst_range() {
        let (_dir, set) = dict_set(NIHAO_ROWS);
        let l = lattice_for(&set, "nih", &mut SpanCache::new());
        let full: Vec<&Span> = l.full_spans().collect();
        assert_eq!(full.len(), 1, "{full:?}");
        assert_eq!(
            texts(full[0]),
            vec!["你好", "你很"],
            "three-syllable 你好吗 is not a two-slot match"
        );
        // The prefix 你 is there for a partial pick; the dead `n` edge before
        // `i` is pruned by reachability and costs no lookup.
        let prefix: Vec<(usize, Vec<&str>)> = l.prefix_spans().map(|s| (s.end, texts(s))).collect();
        assert_eq!(prefix, vec![(2, vec!["你"])]);
    }

    #[test]
    fn unreachable_end_keeps_prefix_spans() {
        let (_dir, set) = dict_set(NIHAO_ROWS);
        let l = lattice_for(&set, "nihao1", &mut SpanCache::new());
        assert!(!l.end_reachable);
        assert!(l.full_spans().next().is_none());
        let ends: Vec<usize> = l.prefix_spans().map(|s| s.end).collect();
        // `ni` and `ni hao`, plus the 简拼 reading `ni h~` that `ao` continues;
        // the dead `n~` before `i` is pruned as it would be with a reachable end.
        assert_eq!(ends, vec![2, 3, 5]);
    }

    #[test]
    fn span_cache_reuses_entries() {
        let (_dir, set) = dict_set(NIHAO_ROWS);
        let mut cache = SpanCache::new();
        lattice_for(&set, "ni", &mut cache);
        let first = cache.stats();
        assert_eq!(first.hits, 0);
        assert!(first.misses > 0);
        lattice_for(&set, "nih", &mut cache);
        let second = cache.stats();
        assert!(second.hits >= 1, "`ni` was answered from the map: {second:?}");
        // Only the patterns that end in the new key are new.
        assert_eq!(second.misses - first.misses, 2, "`ni h~` and `n~ h~`: {second:?}");
        cache.clear();
        assert_eq!(cache.stats().entries, 0);
    }

    #[test]
    fn cache_keys_tell_a_prefix_from_a_syllable() {
        let e = |text: &str, complete| SyllableEdge {
            end: 0,
            text: text.into(),
            complete,
        };
        assert_eq!(pattern_key(&[e("n", false), e("hao", true)]), "n~ hao");
        assert_ne!(pattern_key(&[e("a", false)]), pattern_key(&[e("a", true)]));
    }

    #[test]
    fn expansion_bounds_respected() {
        let mut rows: Vec<(String, String, u32)> = Vec::new();
        for n in 1..=10 {
            rows.push((vec!["a"; n].join(" "), "啊".repeat(n), 10));
            rows.push((
                format!("{} ba", vec!["a"; n].join(" ")),
                format!("{}吧", "啊".repeat(n)),
                10,
            ));
        }
        let borrowed: Vec<(&str, &str, u32)> = rows.iter().map(|(c, t, f)| (c.as_str(), t.as_str(), *f)).collect();
        let (_dir, set) = dict_set(&borrowed);
        let l = lattice_for(&set, "aaaaaaaaaab", &mut SpanCache::new());
        assert!(l.end_reachable);
        for span in l.spans.iter().flatten() {
            let bound = if span.incomplete() {
                MAX_INCOMPLETE_SPAN_SYLLABLES
            } else {
                MAX_SPAN_SYLLABLES
            };
            assert!(span.syllables.len() <= bound, "{span:?}");
        }
        let longest_complete = l.spans[0].iter().filter(|s| !s.incomplete()).map(|s| s.end).max();
        assert_eq!(longest_complete, Some(MAX_SPAN_SYLLABLES));
        let longest_incomplete = l
            .spans
            .iter()
            .flatten()
            .filter(|s| s.incomplete())
            .map(|s| s.syllables.len())
            .max();
        assert_eq!(longest_incomplete, Some(MAX_INCOMPLETE_SPAN_SYLLABLES));
        for span in l.spans.iter().flatten() {
            assert!(span.hits.len() <= MAX_HITS_PER_INCOMPLETE_SPAN);
        }
    }
}
