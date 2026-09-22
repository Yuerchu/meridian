//! What the session remembers about recent commits: enough to learn from the
//! next one, and enough to take a lesson back.
//!
//! A `CommitChain` is the run of Chinese words committed without anything
//! else in between — punctuation, English, a mode switch or a reset ends it.
//! It supplies the context the next word's transitions are recorded against,
//! and it is where two lessons are taught: a pair of words committed in a row
//! often enough becomes a word of its own, and a key string selected in
//! several pieces is remembered whole.
//!
//! A [`CommitRecord`] is one commit with everything that was recorded for it.
//! The last few are kept so that deleting a commit with Backspace and typing
//! the same keys again with a different choice can undo the mistaken
//! records: the log said this happens a dozen times a day, and every one of
//! them used to push the wrong word further up.

use std::collections::VecDeque;

use meridian_ime_engine::learn::{Learner, OwnedContext};
use meridian_ime_engine::{Context, learn::SENTENCE_START};

/// How many commits back an undo can reach.
pub const RECENT_COMMITS: usize = 4;
/// Times a whole-buffer selection must recur before it becomes a user word.
pub const AUTO_WORD_THRESHOLD_SAME_BUFFER: u32 = 2;
/// Times two consecutive words must follow each other before they merge.
pub const AUTO_WORD_THRESHOLD: u32 = 3;
/// Longest word auto-creation will produce, in characters.
pub const AUTO_WORD_MAX_CHARS: usize = 4;
/// A transition the person chose explicitly counts this many times; one the
/// sentence composer produced counts once, so the model's own output does
/// not echo back into it at full weight.
pub const EXPLICIT_TRANSITION_WEIGHT: u32 = 2;

/// One committed candidate and what was recorded for it.
#[derive(Debug, Clone, PartialEq)]
pub struct CommitRecord {
    /// The text that reached the document.
    pub text: String,
    /// Characters in `text`.
    pub chars: usize,
    /// The keys it was chosen for (the whole buffer at the time).
    pub keys: String,
    /// The candidate chosen, when one was (Enter on raw keys records nothing).
    pub chosen: Option<String>,
    /// `record` calls made, to be undone.
    pub recorded: Vec<String>,
    /// `record_choice` calls made.
    pub choices: Vec<(String, String)>,
    /// `record_transition` calls made.
    pub transitions: Vec<(OwnedContext, String, u32)>,
    /// A user word this commit created, `(text, code)`.
    pub learned_word: Option<(String, String)>,
    /// Characters deleted by Backspace since, while nothing was composed.
    pub erased: usize,
}

impl CommitRecord {
    pub fn is_erased(&self) -> bool {
        self.chars > 0 && self.erased >= self.chars
    }

    /// Takes every record back.
    pub fn undo(&self, learner: &mut dyn Learner) {
        for t in &self.recorded {
            learner.unrecord(t);
        }
        for (k, t) in &self.choices {
            learner.unrecord_choice(k, t);
        }
        for (ctx, w, n) in &self.transitions {
            learner.unrecord_transition(ctx.as_context(), w, *n);
        }
        if let Some((t, c)) = &self.learned_word {
            learner.forget_word(t, c);
        }
    }
}

/// The run of words committed in a row.
#[derive(Debug, Default, Clone)]
pub struct CommitChain {
    /// Last two words, most recent last.
    words: Vec<String>,
    /// The key string of the buffer being selected in pieces, and the pieces.
    buffer_keys: String,
    buffer_pieces: Vec<(String, String)>,
}

impl CommitChain {
    /// The context the next word is scored and recorded against.
    pub fn context(&self) -> Context<'_> {
        match self.words.len() {
            0 => Context::start(),
            1 => Context::after(&self.words[0]),
            _ => Context::of(
                Some(&self.words[self.words.len() - 2]),
                &self.words[self.words.len() - 1],
            ),
        }
    }

    /// A word was committed. `words` are the parts a sentence candidate is
    /// made of (one for a plain word), each `(text, code)`.
    pub fn advance(&mut self, words: &[(String, String)]) {
        for (t, _) in words {
            self.words.push(t.clone());
        }
        let keep = self.words.len().saturating_sub(2);
        self.words.drain(..keep);
    }

    /// The pair `(previous, latest)` if there are two, for auto word creation.
    pub fn last_pair(&self) -> Option<(&str, &str)> {
        match self.words.as_slice() {
            [.., a, b] if a != SENTENCE_START => Some((a.as_str(), b.as_str())),
            _ => None,
        }
    }

    /// Something other than a Chinese word went through: the chain ends.
    pub fn r#break(&mut self) {
        self.words.clear();
        self.buffer_keys.clear();
        self.buffer_pieces.clear();
    }

    /// A piece of the buffer was selected: `keys` consumed, `text` chosen.
    pub fn piece_selected(&mut self, keys: &str, text: &str, code: &str) {
        self.buffer_keys.push_str(keys);
        self.buffer_pieces.push((text.to_string(), code.to_string()));
    }

    /// The buffer is finished. Returns the whole key string and the joined
    /// text and code when it was selected in more than one piece.
    pub fn finish_buffer(&mut self) -> Option<(String, String, String)> {
        let out = if self.buffer_pieces.len() >= 2 {
            let text: String = self.buffer_pieces.iter().map(|(t, _)| t.as_str()).collect();
            let code = self
                .buffer_pieces
                .iter()
                .map(|(_, c)| c.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            Some((std::mem::take(&mut self.buffer_keys), text, code))
        } else {
            None
        };
        self.buffer_keys.clear();
        self.buffer_pieces.clear();
        out
    }
}

/// The ring of recent commits.
#[derive(Debug, Default, Clone)]
pub struct Recent {
    records: VecDeque<CommitRecord>,
}

impl Recent {
    pub fn push(&mut self, record: CommitRecord) {
        self.records.push_back(record);
        while self.records.len() > RECENT_COMMITS {
            self.records.pop_front();
        }
    }

    /// Backspace with nothing composed: the newest not-yet-erased record
    /// loses one character. Erasure walks backwards through the ring.
    pub fn note_erase(&mut self) {
        if let Some(r) = self.records.iter_mut().rev().find(|r| !r.is_erased()) {
            r.erased += 1;
        }
    }

    /// Anything else reaching the document means the erased text is not
    /// being retyped over; forget the erased records.
    pub fn note_other(&mut self) {
        self.records.retain(|r| r.erased == 0);
    }

    /// A commit for `keys` choosing `text` is about to be recorded. If an
    /// erased record was for keys this one starts with and chose something
    /// else, its lessons are taken back; a record that chose the same thing is
    /// just dropped. Erased records that do not match are dropped too: the
    /// person is typing something new.
    pub fn resolve_retype(&mut self, keys: &str, text: &str, learner: &mut dyn Learner) {
        let erased: Vec<CommitRecord> = self.records.iter().filter(|r| r.is_erased()).cloned().collect();
        self.records.retain(|r| !r.is_erased());
        for r in erased {
            let same_keys = r.keys.starts_with(keys) || keys.starts_with(&r.keys);
            if same_keys && r.chosen.as_deref() != Some(text) {
                r.undo(learner);
            }
        }
    }
}
