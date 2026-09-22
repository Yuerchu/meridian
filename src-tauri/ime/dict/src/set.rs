//! Several dictionaries answering as one.
//!
//! A user has a base dictionary and, usually, a few domain ones, plus the words
//! they taught the engine themselves. Their frequencies are not comparable —
//! rime-ice counts corpus occurrences, some tables write `100` on every row —
//! so every frequency is turned into a log-probability against the total of
//! *all* files together and the sources are merged by text, keeping the best
//! score. One shared denominator rather than one per file: normalised against
//! its own total, a two-hundred-word domain table makes each of its words look
//! commoner than 你好, and the sentence composer then prefers them everywhere.
//! Against the shared total a flat `100` table simply reads as a list of
//! uncommon words, which is the honest reading of a table that says nothing
//! about frequency. A user word is scored as if it had a frequency of
//! [`USER_WEIGHT_SCALE`] per learned count, so one lesson makes it a fairly
//! common word rather than a negligible one.
//!
//! The three lookups mirror `DictFile`'s, and [`DictSet::lookup_pattern`] is
//! the one the engine's lattice calls: a span of syllables each of which is
//! either complete or a prefix still being typed.

use std::collections::HashMap;

use crate::format::{DictFile, Entry};
use crate::syllable::SyllableTable;

/// Which source a hit came from; index into the set's sources.
pub type SourceId = u16;

/// Frequency one learned count of a user word stands for.
pub const USER_WEIGHT_SCALE: f64 = 2000.0;

/// One text with its merged score.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub text: String,
    /// Canonical spaced code the text was found under.
    pub code: String,
    pub syllables: u8,
    /// `ln((freq + 1) / shared_total)`; higher is more common, and comparable
    /// across sources because the denominator is shared.
    pub log_prob: f64,
    pub source: SourceId,
    /// `true` when the hit came from the user's own words rather than a file.
    pub user: bool,
}

/// One syllable slot of a span: the letters typed for it, and whether they are
/// a whole syllable or the start of one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyllablePattern<'a> {
    pub text: &'a str,
    pub complete: bool,
}

/// Caps on how much a pattern lookup may expand, so a two-letter span cannot
/// pull a whole dictionary through the lattice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LookupLimits {
    /// Codes visited in a prefix range scan.
    pub max_prefix_keys: usize,
    /// Hits returned per pattern, after merging.
    pub max_hits: usize,
}

impl Default for LookupLimits {
    fn default() -> Self {
        Self {
            max_prefix_keys: 256,
            max_hits: 64,
        }
    }
}

/// A word the user taught the engine, kept in memory beside the files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserWord {
    pub code: String,
    pub text: String,
    pub weight: u32,
}

enum Source {
    File(Box<DictFile>),
    User(UserDict),
}

/// In-memory dictionary of user words with the same three lookups.
#[derive(Debug, Default)]
pub struct UserDict {
    by_code: HashMap<String, Vec<(String, u32)>>,
    by_abbr: HashMap<String, Vec<(String, String, u32)>>,
    codes_sorted: Vec<String>,
}

impl UserDict {
    pub fn new(words: &[UserWord], table: &SyllableTable) -> Self {
        let mut d = Self::default();
        for w in words {
            d.by_code
                .entry(w.code.clone())
                .or_default()
                .push((w.text.clone(), w.weight));
            if let Some(key) = table.abbr_key(&w.code) {
                d.by_abbr
                    .entry(key)
                    .or_default()
                    .push((w.code.clone(), w.text.clone(), w.weight));
            }
        }
        for v in d.by_code.values_mut() {
            v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        }
        d.codes_sorted = d.by_code.keys().cloned().collect();
        d.codes_sorted.sort();
        d
    }

    pub fn is_empty(&self) -> bool {
        self.by_code.is_empty()
    }

    pub fn len(&self) -> usize {
        self.by_code.values().map(Vec::len).sum()
    }
}

/// The engine's view of every dictionary it has.
pub struct DictSet {
    sources: Vec<Source>,
    table: SyllableTable,
    /// Σ (total frequency + code count) over every file; the shared
    /// denominator. At least 1.
    denominator: f64,
}

impl std::fmt::Debug for DictSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DictSet").field("sources", &self.sources.len()).finish()
    }
}

impl Default for DictSet {
    fn default() -> Self {
        Self::new()
    }
}

impl DictSet {
    pub fn new() -> Self {
        Self {
            sources: Vec::new(),
            table: SyllableTable::new(),
            denominator: 1.0,
        }
    }

    pub fn table(&self) -> &SyllableTable {
        &self.table
    }

    /// Adds a file; earlier sources are consulted first but every source
    /// contributes. Returns the id the hits will carry.
    pub fn add_file(&mut self, file: DictFile) -> SourceId {
        self.denominator += (file.total_frequency() + file.code_count()) as f64;
        self.sources.push(Source::File(Box::new(file)));
        (self.sources.len() - 1) as SourceId
    }

    /// Adds (or replaces, if one exists) the user's own words.
    pub fn set_user_words(&mut self, words: &[UserWord]) -> SourceId {
        let dict = UserDict::new(words, &self.table);
        if let Some(i) = self.sources.iter().position(|s| matches!(s, Source::User(_))) {
            self.sources[i] = Source::User(dict);
            return i as SourceId;
        }
        self.sources.push(Source::User(dict));
        (self.sources.len() - 1) as SourceId
    }

    /// `true` when there is nothing to look anything up in.
    pub fn is_empty(&self) -> bool {
        self.sources.iter().all(|s| match s {
            Source::File(f) => f.entry_count() == 0,
            Source::User(u) => u.is_empty(),
        })
    }

    pub fn source_count(&self) -> usize {
        self.sources.len()
    }

    /// Hits for exactly this spaced code, best first.
    pub fn lookup(&self, code: &str) -> Vec<Hit> {
        let mut acc = Merger::default();
        let norm = self.denominator;
        for (i, s) in self.sources.iter().enumerate() {
            match s {
                Source::File(f) => {
                    for e in f.lookup(code) {
                        acc.push(hit_of(&e, i as SourceId, norm));
                    }
                }
                Source::User(u) => {
                    if let Some(v) = u.by_code.get(code) {
                        for (text, w) in v {
                            acc.push(user_hit(code, text, *w, norm, i as SourceId));
                        }
                    }
                }
            }
        }
        acc.finish(usize::MAX)
    }

    /// Hits for a span of syllable slots. Every slot complete → exact lookup.
    /// Only the last slot incomplete → prefix range scan. Any other slot
    /// incomplete (an abbreviation in the middle) → abbreviation table, then
    /// each hit's code checked slot by slot against the pattern.
    pub fn lookup_pattern(&self, pattern: &[SyllablePattern<'_>], limits: &LookupLimits) -> Vec<Hit> {
        if pattern.is_empty() {
            return Vec::new();
        }
        let all_complete = pattern.iter().all(|p| p.complete);
        if all_complete {
            let code = join(pattern);
            let mut hits = self.lookup(&code);
            hits.truncate(limits.max_hits);
            return hits;
        }
        let only_last_incomplete = pattern[..pattern.len() - 1].iter().all(|p| p.complete);
        let mut acc = Merger::default();
        let norm = self.denominator;
        if only_last_incomplete {
            let prefix = join(pattern);
            for (i, s) in self.sources.iter().enumerate() {
                match s {
                    Source::File(f) => {
                        for e in f.lookup_prefix(&prefix, pattern.len(), limits.max_prefix_keys) {
                            acc.push(hit_of(&e, i as SourceId, norm));
                        }
                    }
                    Source::User(u) => {
                        let start = u.codes_sorted.partition_point(|c| c.as_str() < prefix.as_str());
                        for code in u.codes_sorted[start..].iter().take_while(|c| c.starts_with(&prefix)) {
                            if code.split(' ').count() != pattern.len() {
                                continue;
                            }
                            for (text, w) in &u.by_code[code] {
                                acc.push(user_hit(code, text, *w, norm, i as SourceId));
                            }
                        }
                    }
                }
            }
        } else {
            let abbr_key = abbr_key_of(pattern, &self.table);
            for (i, s) in self.sources.iter().enumerate() {
                match s {
                    Source::File(f) => {
                        for e in f.lookup_abbr(&abbr_key) {
                            if matches_pattern(e.code, pattern) {
                                acc.push(hit_of(&e, i as SourceId, norm));
                            }
                        }
                    }
                    Source::User(u) => {
                        if let Some(v) = u.by_abbr.get(&abbr_key) {
                            for (code, text, w) in v {
                                if matches_pattern(code, pattern) {
                                    acc.push(user_hit(code, text, *w, norm, i as SourceId));
                                }
                            }
                        }
                    }
                }
            }
        }
        acc.finish(limits.max_hits)
    }
}

fn join(pattern: &[SyllablePattern<'_>]) -> String {
    let mut s = String::new();
    for (i, p) in pattern.iter().enumerate() {
        if i > 0 {
            s.push(' ');
        }
        s.push_str(p.text);
    }
    s
}

/// The abbreviation key a pattern selects: the initial of each slot, whether
/// the slot is a whole syllable, a bare initial or a longer prefix.
fn abbr_key_of(pattern: &[SyllablePattern<'_>], table: &SyllableTable) -> String {
    let mut key = String::new();
    for (i, p) in pattern.iter().enumerate() {
        if i > 0 {
            key.push(' ');
        }
        key.push_str(table.initial_of(p.text));
    }
    key
}

/// Slot by slot: a complete slot must equal the syllable, an incomplete one
/// must be its prefix.
fn matches_pattern(code: &str, pattern: &[SyllablePattern<'_>]) -> bool {
    let mut syllables = code.split(' ');
    for p in pattern {
        let Some(s) = syllables.next() else { return false };
        if p.complete {
            if s != p.text {
                return false;
            }
        } else if !s.starts_with(p.text) {
            return false;
        }
    }
    syllables.next().is_none()
}

fn hit_of(e: &Entry<'_>, source: SourceId, denominator: f64) -> Hit {
    Hit {
        text: e.text.to_string(),
        code: e.code.to_string(),
        syllables: e.syllables,
        log_prob: ((e.freq as f64 + 1.0) / denominator).ln(),
        source,
        user: false,
    }
}

fn user_hit(code: &str, text: &str, weight: u32, denominator: f64, source: SourceId) -> Hit {
    Hit {
        text: text.to_string(),
        code: code.to_string(),
        syllables: code.split(' ').count().min(u8::MAX as usize) as u8,
        log_prob: ((weight as f64 * USER_WEIGHT_SCALE + 1.0) / denominator).ln(),
        source,
        user: true,
    }
}

/// Merges hits by text keeping the best score, then orders best first.
#[derive(Default)]
struct Merger {
    by_text: HashMap<String, usize>,
    hits: Vec<Hit>,
}

impl Merger {
    fn push(&mut self, hit: Hit) {
        match self.by_text.get(&hit.text) {
            Some(&i) => {
                let cur = &mut self.hits[i];
                if hit.log_prob > cur.log_prob || (hit.user && !cur.user) {
                    let user = cur.user || hit.user;
                    *cur = hit;
                    cur.user = user;
                }
            }
            None => {
                self.by_text.insert(hit.text.clone(), self.hits.len());
                self.hits.push(hit);
            }
        }
    }

    fn finish(mut self, max: usize) -> Vec<Hit> {
        self.hits
            .sort_by(|a, b| b.log_prob.partial_cmp(&a.log_prob).unwrap_or(std::cmp::Ordering::Equal));
        self.hits.truncate(max);
        self.hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::{DictWriter, Metadata};

    fn meta(name: &str) -> Metadata {
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

    fn file(dir: &std::path::Path, name: &str, rows: &[(&str, &str, u32)]) -> DictFile {
        let mut w = DictWriter::new();
        for (c, t, f) in rows {
            w.add(c, t, *f);
        }
        let path = dir.join(format!("{name}.mdict"));
        w.write(&path, &meta(name), &SyllableTable::new()).unwrap();
        DictFile::open(&path).unwrap()
    }

    fn texts(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.text.as_str()).collect()
    }

    #[test]
    fn set_merges_by_text_keeping_max_log_prob() {
        let dir = tempfile::tempdir().unwrap();
        let base = file(
            dir.path(),
            "base",
            &[("ni hao", "你好", 900), ("ni hao", "拟好", 10), ("ni", "你", 1000)],
        );
        let domain = file(dir.path(), "domain", &[("ni hao", "你好", 1), ("ni hao", "泥嚎", 100)]);
        let mut set = DictSet::new();
        set.add_file(base);
        set.add_file(domain);
        let hits = set.lookup("ni hao");
        assert_eq!(texts(&hits), vec!["你好", "泥嚎", "拟好"]);
        assert_eq!(hits[0].source, 0, "the better score's source wins");
        assert!(set.lookup("hao ni").is_empty());
        // A small table does not out-rank the base dictionary merely by being small.
        let ni = set.lookup("ni");
        assert!(
            ni[0].log_prob > hits[1].log_prob,
            "你 (1000 of the shared total) beats 泥嚎 (100)"
        );
    }

    #[test]
    fn pattern_lookups() {
        let dir = tempfile::tempdir().unwrap();
        let base = file(
            dir.path(),
            "base",
            &[
                ("ni hao", "你好", 900),
                ("ni hen", "你很", 100),
                ("ni hao ma", "你好吗", 50),
                ("nu hao", "怒号", 5),
                ("ni", "你", 1000),
                ("na", "那", 800),
                ("zhong guo", "中国", 2000),
                ("zhi guo", "智果", 1),
            ],
        );
        let mut set = DictSet::new();
        set.add_file(base);
        let limits = LookupLimits::default();
        let p = |text, complete| SyllablePattern { text, complete };

        assert_eq!(
            texts(&set.lookup_pattern(&[p("ni", true), p("hao", true)], &limits)),
            vec!["你好"]
        );
        assert_eq!(
            texts(&set.lookup_pattern(&[p("ni", true), p("h", false)], &limits)),
            vec!["你好", "你很"]
        );
        assert_eq!(texts(&set.lookup_pattern(&[p("n", false)], &limits)), vec!["你", "那"]);
        assert_eq!(
            texts(&set.lookup_pattern(&[p("n", false), p("h", false)], &limits)),
            vec!["你好", "你很", "怒号"]
        );
        assert_eq!(
            texts(&set.lookup_pattern(&[p("n", false), p("hao", true)], &limits)),
            vec!["你好", "怒号"]
        );
        assert_eq!(
            texts(&set.lookup_pattern(&[p("zh", false), p("g", false)], &limits)),
            vec!["中国", "智果"]
        );
        assert_eq!(
            texts(&set.lookup_pattern(&[p("zh", false), p("guo", true)], &limits)),
            vec!["中国", "智果"]
        );
        assert!(set.lookup_pattern(&[p("ni", true), p("x", false)], &limits).is_empty());
        let capped = set.lookup_pattern(
            &[p("n", false)],
            &LookupLimits {
                max_prefix_keys: 256,
                max_hits: 1,
            },
        );
        assert_eq!(capped.len(), 1);
    }

    #[test]
    fn user_words_join_the_set() {
        let dir = tempfile::tempdir().unwrap();
        let base = file(dir.path(), "base", &[("ni hao", "你好", 900)]);
        let mut set = DictSet::new();
        set.add_file(base);
        assert!(!set.is_empty());
        set.set_user_words(&[UserWord {
            code: "ni hao".into(),
            text: "妮好".into(),
            weight: 3,
        }]);
        let hits = set.lookup("ni hao");
        assert_eq!(
            texts(&hits),
            vec!["妮好", "你好"],
            "a learned word outranks the dictionary"
        );
        assert!(hits[0].user);
        let p = |text, complete| SyllablePattern { text, complete };
        assert_eq!(
            texts(&set.lookup_pattern(&[p("n", false), p("h", false)], &LookupLimits::default())),
            vec!["妮好", "你好"]
        );
        assert_eq!(
            texts(&set.lookup_pattern(&[p("ni", true), p("h", false)], &LookupLimits::default())).len(),
            2
        );
        set.set_user_words(&[]);
        assert_eq!(set.lookup("ni hao").len(), 1, "replacing user words drops the old ones");
        let empty = DictSet::new();
        assert!(empty.is_empty());
        assert!(empty.lookup("ni").is_empty());
    }
}
