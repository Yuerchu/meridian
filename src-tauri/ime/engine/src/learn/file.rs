//! The learner's files: four TSVs under the learn directory, one per table,
//! human-readable so a person can open, fix or trim what the engine learned.
//!
//! A `MemoryLearner` holds the live tables; this wrapper only knows where they
//! came from and which ones changed. Loading is forgiving line by line — a row
//! that does not parse is skipped with a warning and dropped at the next
//! flush, so one bad edit does not cost the whole table — but a file that
//! cannot be *read* is an error returned to the host, which then falls back
//! to memory rather than silently starting from nothing and overwriting the
//! store at the next flush. Writing goes through `storage::write_atomic`, so
//! a crash mid-flush leaves the previous file whole; a failed write keeps the
//! table dirty and is retried at the next flush.
//!
//! `user-ngram.tsv` carries bigram rows (three columns) and trigram rows
//! (four). Recording a trigram also bumps its bigram, so the bigram rows
//! written are each bigram's count *minus* the trigram counts that share it;
//! loading records both kinds and arrives at the same counts.

use std::collections::{BTreeMap, HashMap};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use meridian_ime_dict::UserWord;
use tracing::warn;

use super::memory::{DirtyFlags, MemoryLearner};
use super::{Context, Learner, UserNgram};
use crate::storage::write_atomic;

const WEIGHTS_FILE: &str = "user.tsv";
const CHOICES_FILE: &str = "user-choices.tsv";
const WORDS_FILE: &str = "user-words.tsv";
const NGRAM_FILE: &str = "user-ngram.tsv";

#[derive(Debug)]
pub struct FileLearner {
    dir: PathBuf,
    inner: MemoryLearner,
    last_flush: Instant,
}

impl FileLearner {
    /// How often `flush_if_due` is meant to write what changed.
    pub const FLUSH_INTERVAL: Duration = Duration::from_secs(60);

    /// Reads the four tables under `dir`; a missing file is an empty table,
    /// and a directory that does not exist yet is created at the first flush.
    pub fn open(dir: &Path) -> io::Result<FileLearner> {
        match std::fs::metadata(dir) {
            Ok(m) if !m.is_dir() => {
                let msg = format!("{} is not a directory", dir.display());
                return Err(io::Error::new(io::ErrorKind::NotADirectory, msg));
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }

        let mut dirty = DirtyFlags::default();

        let mut weights = HashMap::new();
        dirty.weights = load_table(&dir.join(WEIGHTS_FILE), |cols| {
            let [text, count] = cols else { return false };
            let Some(count) = parse_count(count) else { return false };
            if text.is_empty() {
                return false;
            }
            add(weights.entry(text.to_string()).or_default(), count);
            true
        })?;

        let mut choices = HashMap::new();
        dirty.choices = load_table(&dir.join(CHOICES_FILE), |cols| {
            let [keys, text, count] = cols else { return false };
            let Some(count) = parse_count(count) else { return false };
            if keys.is_empty() || text.is_empty() {
                return false;
            }
            add(choices.entry((keys.to_string(), text.to_string())).or_default(), count);
            true
        })?;

        let mut words = BTreeMap::new();
        dirty.words = load_table(&dir.join(WORDS_FILE), |cols| {
            let [text, code, weight] = cols else { return false };
            let Some(weight) = parse_count(weight) else {
                return false;
            };
            if text.is_empty() || code.is_empty() {
                return false;
            }
            add(words.entry((text.to_string(), code.to_string())).or_default(), weight);
            true
        })?;

        let mut ngram = UserNgram::new();
        dirty.ngram = load_table(&dir.join(NGRAM_FILE), |cols| match cols {
            [prev, word, count] => {
                let Some(count) = parse_count(count) else { return false };
                if prev.is_empty() || word.is_empty() {
                    return false;
                }
                ngram.record(Context::after(prev), word, count);
                true
            }
            [prev2, prev, word, count] => {
                let Some(count) = parse_count(count) else { return false };
                if prev2.is_empty() || prev.is_empty() || word.is_empty() {
                    return false;
                }
                ngram.record(Context::of(Some(prev2), prev), word, count);
                true
            }
            _ => false,
        })?;

        let mut inner = MemoryLearner::from_parts(weights, choices, words, ngram);
        inner.mark_dirty(dirty);
        Ok(Self {
            dir: dir.to_path_buf(),
            inner,
            last_flush: Instant::now(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Flushes when at least `interval` has passed since the last flush.
    pub fn flush_if_due(&mut self, interval: Duration) {
        if self.last_flush.elapsed() >= interval {
            Learner::flush(self);
        }
    }

    fn write_dirty(&mut self) {
        let dirty = self.inner.dirty();
        if !dirty.any() {
            return;
        }
        if let Err(e) = std::fs::create_dir_all(&self.dir) {
            warn!(dir = %self.dir.display(), error = %e, "cannot create the learn directory; will retry");
            return;
        }
        let mut written = DirtyFlags::default();
        if dirty.weights {
            written.weights = self.write(WEIGHTS_FILE, |w| write_weights(w, self.inner.weights()));
        }
        if dirty.choices {
            written.choices = self.write(CHOICES_FILE, |w| write_choices(w, self.inner.choices()));
        }
        if dirty.words {
            written.words = self.write(WORDS_FILE, |w| write_words(w, self.inner.words()));
        }
        if dirty.ngram {
            written.ngram = self.write(NGRAM_FILE, |w| write_ngram(w, self.inner.ngram()));
        }
        self.inner.clear_dirty(written);
    }

    fn write(&self, name: &str, body: impl FnOnce(&mut dyn Write) -> io::Result<()>) -> bool {
        let path = self.dir.join(name);
        match write_atomic(&path, body) {
            Ok(()) => true,
            Err(e) => {
                warn!(path = %path.display(), error = %e, "cannot write the learn store; will retry");
                false
            }
        }
    }
}

impl Drop for FileLearner {
    fn drop(&mut self) {
        self.write_dirty();
    }
}

impl Learner for FileLearner {
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
        self.inner.record_choice(keys, text)
    }
    fn choice_weight(&self, keys: &str, text: &str) -> u32 {
        self.inner.choice_weight(keys, text)
    }
    fn unrecord_choice(&mut self, keys: &str, text: &str) {
        self.inner.unrecord_choice(keys, text)
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
        self.write_dirty();
        self.last_flush = Instant::now();
    }
}

/// Reads `path` line by line, handing each data row's columns to `row`, which
/// answers whether it was usable. Returns whether any line was not — the
/// table is then dirty, so the next flush writes it without them. A missing
/// file is an empty table; any other read error is the caller's.
fn load_table(path: &Path, mut row: impl FnMut(&[&str]) -> bool) -> io::Result<bool> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let mut corrupt = false;
    for (i, raw) in bytes.split(|b| *b == b'\n').enumerate() {
        let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
        if raw.is_empty() || raw[0] == b'#' {
            continue;
        }
        let usable = std::str::from_utf8(raw).is_ok_and(|line| row(&line.split('\t').collect::<Vec<_>>()));
        if !usable {
            corrupt = true;
            warn!(path = %path.display(), line = i + 1, "skipping a corrupt line in the learn store");
        }
    }
    Ok(corrupt)
}

/// A count column: a positive integer. Zero is not a row worth keeping.
fn parse_count(s: &str) -> Option<u32> {
    s.parse::<u32>().ok().filter(|c| *c > 0)
}

fn add(slot: &mut u32, by: u32) {
    *slot = slot.saturating_add(by);
}

/// Whether a value can sit in a column without breaking the row.
fn plain(s: &str) -> bool {
    !s.is_empty() && !s.contains(['\t', '\n', '\r'])
}

fn write_weights(w: &mut dyn Write, weights: &HashMap<String, u32>) -> io::Result<()> {
    writeln!(w, "# text\tcount")?;
    let mut rows: Vec<_> = weights.iter().filter(|(t, _)| plain(t)).collect();
    rows.sort();
    for (text, count) in rows {
        writeln!(w, "{text}\t{count}")?;
    }
    Ok(())
}

fn write_choices(w: &mut dyn Write, choices: &HashMap<(String, String), u32>) -> io::Result<()> {
    writeln!(w, "# keys\ttext\tcount")?;
    let mut rows: Vec<_> = choices.iter().filter(|((k, t), _)| plain(k) && plain(t)).collect();
    rows.sort();
    for ((keys, text), count) in rows {
        writeln!(w, "{keys}\t{text}\t{count}")?;
    }
    Ok(())
}

fn write_words(w: &mut dyn Write, words: &BTreeMap<(String, String), u32>) -> io::Result<()> {
    writeln!(w, "# text\tcode\tweight")?;
    for ((text, code), weight) in words {
        if plain(text) && plain(code) {
            writeln!(w, "{text}\t{code}\t{weight}")?;
        }
    }
    Ok(())
}

fn write_ngram(w: &mut dyn Write, ngram: &UserNgram) -> io::Result<()> {
    writeln!(w, "# prev\tword\tcount  |  prev2\tprev\tword\tcount")?;
    let mut trigrams: Vec<_> = ngram
        .trigrams()
        .filter(|(p2, p, wd, _)| plain(p2) && plain(p) && plain(wd))
        .collect();
    trigrams.sort();
    // Loading a trigram row records its bigram too, so the bigram rows carry
    // only what the trigram rows will not put back.
    let mut share: HashMap<(&str, &str), u32> = HashMap::new();
    for (_, p, wd, c) in &trigrams {
        add(share.entry((p, wd)).or_default(), *c);
    }
    let mut bigrams: Vec<_> = ngram
        .bigrams()
        .filter(|(p, wd, _)| plain(p) && plain(wd))
        .filter_map(|(p, wd, c)| {
            let rest = c.saturating_sub(share.get(&(p, wd)).copied().unwrap_or(0));
            (rest > 0).then_some((p, wd, rest))
        })
        .collect();
    bigrams.sort();
    for (prev, word, count) in bigrams {
        writeln!(w, "{prev}\t{word}\t{count}")?;
    }
    for (prev2, prev, word, count) in trigrams {
        writeln!(w, "{prev2}\t{prev}\t{word}\t{count}")?;
    }
    Ok(())
}
