//! What the engine learns from the person typing, and the one place it is
//! allowed to forget.
//!
//! Four things are learned, each with an undo: how often a word was chosen
//! (`record`), which word was chosen for a given key string (`record_choice`,
//! what makes `mgs` produce 美国式 after it was picked once), which word
//! followed which (`record_transition`, the personal n-gram the sentence
//! scorer blends in), and new words the person composed themselves
//! (`learn_word`). All of it is read at scoring time through this trait and
//! written by the session after a commit.
//!
//! [`Muted`] is private mode: every read goes through, every write is
//! swallowed. It wraps a learner rather than switching one off, so the code
//! that writes cannot forget to check a flag — there is no flag.
//!
//! Implementations: [`MemoryLearner`] (tests, and the fallback when the store
//! cannot be opened) and `FileLearner` (human-readable TSV under the learn
//! directory, flushed on a timer and at exit).

mod file;
mod memory;
mod ngram;

pub use file::FileLearner;
pub use memory::MemoryLearner;
pub use ngram::UserNgram;

use meridian_ime_dict::UserWord;

/// Sentence-start marker used as the previous word at the beginning of a
/// commit chain.
pub const SENTENCE_START: &str = "<s>";

/// The words before the one being scored: at most two, most recent last.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Context<'a> {
    pub prev2: Option<&'a str>,
    pub prev: &'a str,
}

impl<'a> Context<'a> {
    pub fn start() -> Self {
        Self {
            prev2: None,
            prev: SENTENCE_START,
        }
    }

    pub fn after(prev: &'a str) -> Self {
        Self { prev2: None, prev }
    }

    pub fn of(prev2: Option<&'a str>, prev: &'a str) -> Self {
        Self { prev2, prev }
    }
}

/// An owned context, for records the session keeps for undo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedContext {
    pub prev2: Option<String>,
    pub prev: String,
}

impl OwnedContext {
    pub fn as_context(&self) -> Context<'_> {
        Context {
            prev2: self.prev2.as_deref(),
            prev: &self.prev,
        }
    }
}

impl From<Context<'_>> for OwnedContext {
    fn from(c: Context<'_>) -> Self {
        Self {
            prev2: c.prev2.map(str::to_string),
            prev: c.prev.to_string(),
        }
    }
}

/// The learning store. Every write has an inverse so a backspace-and-retype
/// can take a mistaken lesson back.
pub trait Learner: Send {
    /// A word was committed.
    fn record(&mut self, text: &str);
    /// How many times `text` was committed.
    fn weight(&self, text: &str) -> u32;
    fn unrecord(&mut self, text: &str);

    /// `text` was chosen for the key string `keys`.
    fn record_choice(&mut self, keys: &str, text: &str);
    fn choice_weight(&self, keys: &str, text: &str) -> u32;
    fn unrecord_choice(&mut self, keys: &str, text: &str);

    /// `word` followed `ctx`, `times` times' worth.
    fn record_transition(&mut self, ctx: Context<'_>, word: &str, times: u32);
    fn unrecord_transition(&mut self, ctx: Context<'_>, word: &str, times: u32);

    /// A word the person composed; enters the user dictionary.
    fn learn_word(&mut self, text: &str, code: &str);
    fn forget_word(&mut self, text: &str, code: &str);

    /// The user dictionary, for `DictSet::set_user_words`.
    fn user_words(&self) -> Vec<UserWord>;
    /// Monotonic; changes whenever `user_words()` would. Lets the engine
    /// reload the user dictionary only when it changed.
    fn user_words_generation(&self) -> u64;

    /// The personal n-gram the sentence scorer reads.
    fn ngram(&self) -> &UserNgram;

    /// Writes out whatever changed. Errors are logged, never returned: a
    /// learner that cannot write keeps learning in memory.
    fn flush(&mut self);
}

/// Private mode: reads pass through, writes are dropped.
pub struct Muted<'a> {
    inner: &'a mut dyn Learner,
    muted: bool,
}

impl<'a> Muted<'a> {
    pub fn new(inner: &'a mut dyn Learner, muted: bool) -> Self {
        Self { inner, muted }
    }

    pub fn is_muted(&self) -> bool {
        self.muted
    }
}

impl Learner for Muted<'_> {
    fn record(&mut self, text: &str) {
        if !self.muted {
            self.inner.record(text)
        }
    }
    fn weight(&self, text: &str) -> u32 {
        self.inner.weight(text)
    }
    fn unrecord(&mut self, text: &str) {
        if !self.muted {
            self.inner.unrecord(text)
        }
    }
    fn record_choice(&mut self, keys: &str, text: &str) {
        if !self.muted {
            self.inner.record_choice(keys, text)
        }
    }
    fn choice_weight(&self, keys: &str, text: &str) -> u32 {
        self.inner.choice_weight(keys, text)
    }
    fn unrecord_choice(&mut self, keys: &str, text: &str) {
        if !self.muted {
            self.inner.unrecord_choice(keys, text)
        }
    }
    fn record_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        if !self.muted {
            self.inner.record_transition(ctx, word, times)
        }
    }
    fn unrecord_transition(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        if !self.muted {
            self.inner.unrecord_transition(ctx, word, times)
        }
    }
    fn learn_word(&mut self, text: &str, code: &str) {
        if !self.muted {
            self.inner.learn_word(text, code)
        }
    }
    fn forget_word(&mut self, text: &str, code: &str) {
        if !self.muted {
            self.inner.forget_word(text, code)
        }
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

#[cfg(test)]
mod tests;
