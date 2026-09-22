//! The in-memory learner: every table the engine learns from, held in plain
//! maps. It is the whole of what `FileLearner` keeps between flushes and the
//! fallback when the store cannot be opened, so it also carries the dirty
//! flags — a write is marked here, where it happens, rather than in a wrapper
//! that has to remember to.

use std::collections::{BTreeMap, HashMap};

use meridian_ime_dict::UserWord;

use super::{Context, Learner, UserNgram};

/// Ceiling on distinct `(keys, text)` choices; past it every count is halved
/// and the rows that reach zero are dropped.
pub const MAX_CHOICE_ENTRIES: usize = 50_000;

/// Which tables changed since they were last written.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DirtyFlags {
    pub weights: bool,
    pub choices: bool,
    pub ngram: bool,
    pub words: bool,
}

impl DirtyFlags {
    pub fn any(self) -> bool {
        self.weights || self.choices || self.ngram || self.words
    }
}

#[derive(Debug, Default)]
pub struct MemoryLearner {
    /// text → times committed
    weights: HashMap<String, u32>,
    /// (keys, text) → times chosen
    choices: HashMap<(String, String), u32>,
    ngram: UserNgram,
    /// (text, code) → weight; ordered so `user_words()` is stable
    words: BTreeMap<(String, String), u32>,
    generation: u64,
    dirty: DirtyFlags,
}

impl MemoryLearner {
    pub fn new() -> Self {
        Self::default()
    }

    /// A learner over tables read from somewhere else. Nothing is dirty; the
    /// generation is non-zero when there are words, so a reader that starts
    /// from zero sees them as a change.
    pub fn from_parts(
        weights: HashMap<String, u32>,
        choices: HashMap<(String, String), u32>,
        words: BTreeMap<(String, String), u32>,
        ngram: UserNgram,
    ) -> Self {
        let generation = u64::from(!words.is_empty());
        Self {
            weights,
            choices,
            ngram,
            words,
            generation,
            dirty: DirtyFlags::default(),
        }
    }

    pub fn weights(&self) -> &HashMap<String, u32> {
        &self.weights
    }

    pub fn choices(&self) -> &HashMap<(String, String), u32> {
        &self.choices
    }

    pub fn words(&self) -> &BTreeMap<(String, String), u32> {
        &self.words
    }

    pub fn dirty(&self) -> DirtyFlags {
        self.dirty
    }

    /// Marks the tables set in `flags` as needing a write.
    pub fn mark_dirty(&mut self, flags: DirtyFlags) {
        self.dirty.weights |= flags.weights;
        self.dirty.choices |= flags.choices;
        self.dirty.ngram |= flags.ngram;
        self.dirty.words |= flags.words;
    }

    /// Clears the tables set in `flags`, after they were written.
    pub fn clear_dirty(&mut self, flags: DirtyFlags) {
        self.dirty.weights &= !flags.weights;
        self.dirty.choices &= !flags.choices;
        self.dirty.ngram &= !flags.ngram;
        self.dirty.words &= !flags.words;
    }

    fn cap_choices(&mut self) {
        // Every pass drops the rows that reach zero, so the loop ends.
        while self.choices.len() > MAX_CHOICE_ENTRIES {
            self.choices.retain(|_, c| {
                *c /= 2;
                *c > 0
            });
        }
    }
}

impl Learner for MemoryLearner {
    fn record(&mut self, text: &str) {
        let c = self.weights.entry(text.to_string()).or_default();
        *c = c.saturating_add(1);
        self.dirty.weights = true;
    }

    fn weight(&self, text: &str) -> u32 {
        self.weights.get(text).copied().unwrap_or(0)
    }

    fn unrecord(&mut self, text: &str) {
        let Some(c) = self.weights.get_mut(text) else { return };
        *c = c.saturating_sub(1);
        if *c == 0 {
            self.weights.remove(text);
        }
        self.dirty.weights = true;
    }

    fn record_choice(&mut self, keys: &str, text: &str) {
        let c = self.choices.entry((keys.to_string(), text.to_string())).or_default();
        *c = c.saturating_add(1);
        self.cap_choices();
        self.dirty.choices = true;
    }

    fn choice_weight(&self, keys: &str, text: &str) -> u32 {
        self.choices
            .get(&(keys.to_string(), text.to_string()))
            .copied()
            .unwrap_or(0)
    }

    fn unrecord_choice(&mut self, keys: &str, text: &str) {
        let key = (keys.to_string(), text.to_string());
        let Some(c) = self.choices.get_mut(&key) else { return };
        *c = c.saturating_sub(1);
        if *c == 0 {
            self.choices.remove(&key);
        }
        self.dirty.choices = true;
    }

    fn record_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        if times == 0 {
            return;
        }
        self.ngram.record(ctx, word, times);
        self.dirty.ngram = true;
    }

    fn unrecord_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        if times == 0 {
            return;
        }
        self.ngram.unrecord(ctx, word, times);
        self.dirty.ngram = true;
    }

    fn learn_word(&mut self, text: &str, code: &str) {
        let w = self.words.entry((text.to_string(), code.to_string())).or_default();
        *w = w.saturating_add(1);
        self.generation += 1;
        self.dirty.words = true;
    }

    fn forget_word(&mut self, text: &str, code: &str) {
        if self.words.remove(&(text.to_string(), code.to_string())).is_some() {
            self.generation += 1;
            self.dirty.words = true;
        }
    }

    fn user_words(&self) -> Vec<UserWord> {
        self.words
            .iter()
            .map(|((text, code), weight)| UserWord {
                code: code.clone(),
                text: text.clone(),
                weight: *weight,
            })
            .collect()
    }

    fn user_words_generation(&self) -> u64 {
        self.generation
    }

    fn ngram(&self) -> &UserNgram {
        &self.ngram
    }

    fn flush(&mut self) {}
}
