//! One text field's state machine.
//!
//! Every key comes through [`Session::handle_key`], which decides three
//! things — whether the key is eaten, what text if any reaches the document,
//! and what the candidate window shows next — and records what the person
//! chose. The scheme (pinyin or zhuyin) changes which printable keys spell
//! syllables and what Space and Enter mean while composing; everything else
//! is shared.
//!
//! Selecting a candidate that covers only the first syllables keeps the rest
//! composing: the chosen text moves into a "fixed" prefix shown in the preedit
//! and the remaining keys are queried again, so 你好吗 can be typed as 你好 then
//! 吗 without anything reaching the document in between. The whole thing
//! commits when the last keys are chosen, and the buffer as a whole is what
//! the learner is told about.

use meridian_ime_engine::learn::Muted;
use meridian_ime_engine::{Candidate, CandidateSource, Engine, InputScheme, Learner, Query, SpanCache};
use meridian_ime_proto::{CandidateItem, Frame, KeyEvent, Mode, PreeditKind, PreeditSegment};

use crate::chain::{
    AUTO_WORD_MAX_CHARS, AUTO_WORD_THRESHOLD, AUTO_WORD_THRESHOLD_SAME_BUFFER, CommitChain, CommitRecord,
    EXPLICIT_TRANSITION_WEIGHT, Recent,
};
use crate::keys::*;
use crate::punct::PunctState;

/// Shown in the frame while the person types with nothing to look things up in.
pub const NO_DICTIONARY_NOTICE: &str = "尚未导入词库：在 Meridian 设置里导入一本 Rime 词库后即可打字";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionConfig {
    pub scheme: InputScheme,
    pub page_size: usize,
    pub full_width_punctuation: bool,
    /// Master switch; a private document mutes learning regardless.
    pub learning: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            scheme: InputScheme::Pinyin,
            page_size: 5,
            full_width_punctuation: true,
            learning: true,
        }
    }
}

/// What one key did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyOutcome {
    /// `true`: the key is eaten. `false`: the application gets it.
    pub consumed: bool,
    /// Text to insert into the document, before the frame is shown.
    pub commit: Option<String>,
    pub frame: Frame,
}

/// A piece of the buffer already chosen but not yet committed.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FixedPiece {
    text: String,
    code: String,
    keys: String,
    words: Vec<(String, String)>,
    source: CandidateSource,
}

#[derive(Debug)]
pub struct Session {
    config: SessionConfig,
    /// Keys not yet chosen.
    keys: String,
    fixed: Vec<FixedPiece>,
    query: Option<Query>,
    page: usize,
    highlight: usize,
    mode: Mode,
    private: bool,
    punct: PunctState,
    chain: CommitChain,
    recent: Recent,
    cache: SpanCache,
}

impl Session {
    pub fn new(config: SessionConfig) -> Self {
        Self {
            config,
            keys: String::new(),
            fixed: Vec::new(),
            query: None,
            page: 0,
            highlight: 0,
            mode: Mode::Chinese,
            private: false,
            punct: PunctState::default(),
            chain: CommitChain::default(),
            recent: Recent::default(),
            cache: SpanCache::new(),
        }
    }

    pub fn config(&self) -> &SessionConfig {
        &self.config
    }

    /// Applies new settings. The scheme changing drops the composition.
    pub fn set_config(&mut self, config: SessionConfig) {
        if config.scheme != self.config.scheme {
            self.clear_composition();
            self.cache.clear();
        }
        self.config = config;
        self.page = 0;
        self.highlight = 0;
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn is_private(&self) -> bool {
        self.private
    }

    pub fn set_private(&mut self, private: bool) {
        self.private = private;
    }

    pub fn is_composing(&self) -> bool {
        !self.keys.is_empty() || !self.fixed.is_empty()
    }

    /// The raw keys of the current buffer (fixed pieces first).
    pub fn buffer_keys(&self) -> String {
        let mut s: String = self.fixed.iter().map(|p| p.keys.as_str()).collect();
        s.push_str(&self.keys);
        s
    }

    /// Dictionaries changed: forget memoised spans.
    pub fn invalidate_cache(&mut self) {
        self.cache.clear();
    }

    /// Focus lost or the composition was terminated by the application: the
    /// buffer is dropped without learning. Mode, privacy and recent commits
    /// stay.
    pub fn reset(&mut self) -> Frame {
        self.clear_composition();
        self.chain.r#break();
        self.frame(false)
    }

    /// The current frame.
    pub fn frame(&self, no_dictionary: bool) -> Frame {
        let mut frame = Frame {
            mode: self.mode,
            ..Default::default()
        };
        if !self.is_composing() {
            return frame;
        }
        for p in &self.fixed {
            frame.preedit.push(PreeditSegment {
                text: p.text.clone(),
                kind: PreeditKind::Fixed,
            });
        }
        if let Some(q) = &self.query {
            frame.preedit.extend(q.preedit.iter().cloned());
            let page_size = self.config.page_size.max(1);
            let total = q.candidates.len();
            frame.page_count = total.div_ceil(page_size);
            frame.page = self.page.min(frame.page_count.saturating_sub(1));
            let start = frame.page * page_size;
            frame.candidates = q.candidates[start.min(total)..(start + page_size).min(total)]
                .iter()
                .map(|c| CandidateItem {
                    text: c.text.clone(),
                    source: c.source.into(),
                })
                .collect();
            frame.highlight = self.highlight.min(frame.candidates.len().saturating_sub(1));
        }
        if no_dictionary {
            frame.notice = Some(NO_DICTIONARY_NOTICE.to_string());
        }
        frame
    }

    /// The whole state machine.
    pub fn handle_key(&mut self, engine: &Engine, learner: &mut dyn Learner, ev: KeyEvent) -> KeyOutcome {
        let muted = self.private || !self.config.learning;
        let mut learner = Muted::new(learner, muted);
        let learner: &mut dyn Learner = &mut learner;

        if ev.mods.ctrl || ev.mods.alt || ev.mods.win {
            return self.passthrough(engine, None);
        }

        // A bare Shift tap toggles Chinese/English; anything half-typed goes
        // out as it stands.
        if ev.vk == VK_SHIFT && ev.ch.is_none() {
            let commit = if self.is_composing() {
                Some(self.take_raw())
            } else {
                None
            };
            self.mode = match self.mode {
                Mode::Chinese => Mode::English,
                Mode::English => Mode::Chinese,
            };
            self.chain.r#break();
            return KeyOutcome {
                consumed: true,
                commit,
                frame: self.frame(false),
            };
        }

        if self.mode == Mode::English || ev.caps_lock {
            return self.passthrough(engine, ev.ch);
        }

        let composing = self.is_composing();
        let parser = self.config.scheme.parser(engine.table());
        let is_scheme_key = |ch: char| parser.accepts_key(ch);

        // Keys that spell syllables come first, because in zhuyin they include
        // digits, `-` and `;`, which mean other things below.
        if let Some(ch) = ev.ch {
            let starts = match self.config.scheme {
                InputScheme::Pinyin => ch.is_ascii_lowercase(),
                InputScheme::Zhuyin => ch != ' ' && is_scheme_key(ch),
            };
            let extends = composing && ch != ' ' && is_scheme_key(ch);
            if (starts || extends) && !ev.mods.shift {
                return self.push_key(engine, learner, ch);
            }
            if ch.is_ascii_uppercase() && composing {
                // Shift+letter while composing: the raw keys go out, then the letter.
                let mut text = self.take_raw();
                text.push(ch);
                self.chain.r#break();
                self.punct.note_passthrough(ch);
                return KeyOutcome {
                    consumed: true,
                    commit: Some(text),
                    frame: self.frame(false),
                };
            }
        }

        if !composing {
            return match ev.vk {
                VK_BACK => {
                    self.recent.note_erase();
                    self.chain.r#break();
                    KeyOutcome {
                        consumed: false,
                        commit: None,
                        frame: self.frame(false),
                    }
                }
                _ => match ev.ch {
                    Some(ch) if ch != ' ' && self.config.full_width_punctuation => match self.punct.map(ch) {
                        Some(full) => {
                            self.chain.r#break();
                            self.recent.note_other();
                            KeyOutcome {
                                consumed: true,
                                commit: Some(full.to_string()),
                                frame: self.frame(false),
                            }
                        }
                        None => self.passthrough(engine, Some(ch)),
                    },
                    ch => self.passthrough(engine, ch),
                },
            };
        }

        drop(parser);
        match ev.vk {
            VK_BACK => {
                if self.keys.pop().is_none() {
                    // Nothing unchosen left: the last chosen piece reopens.
                    if let Some(piece) = self.fixed.pop() {
                        self.keys = piece.keys;
                    }
                }
                if self.is_composing() {
                    self.requery(engine, learner);
                } else {
                    self.query = None;
                }
                KeyOutcome {
                    consumed: true,
                    commit: None,
                    frame: self.frame(engine.is_empty()),
                }
            }
            VK_ESCAPE => {
                self.clear_composition();
                KeyOutcome {
                    consumed: true,
                    commit: None,
                    frame: self.frame(false),
                }
            }
            VK_RETURN => match self.config.scheme {
                InputScheme::Pinyin => {
                    let text = self.take_raw();
                    self.chain.r#break();
                    self.punct.note_commit();
                    KeyOutcome {
                        consumed: true,
                        commit: Some(text),
                        frame: self.frame(false),
                    }
                }
                InputScheme::Zhuyin => self.commit_highlighted_or_raw(engine, learner),
            },
            VK_SPACE => match self.config.scheme {
                InputScheme::Pinyin => self.commit_highlighted_or_raw(engine, learner),
                InputScheme::Zhuyin => {
                    if self.space_is_tone() {
                        self.push_key(engine, learner, ' ')
                    } else {
                        self.commit_highlighted_or_raw(engine, learner)
                    }
                }
            },
            VK_PRIOR => self.page_by(engine, -1),
            VK_NEXT => self.page_by(engine, 1),
            VK_UP => self.highlight_by(engine, -1),
            VK_DOWN => self.highlight_by(engine, 1),
            VK_LEFT | VK_RIGHT | VK_HOME | VK_END | VK_DELETE | VK_TAB => KeyOutcome {
                consumed: true,
                commit: None,
                frame: self.frame(engine.is_empty()),
            },
            _ => match ev.ch {
                Some(d @ '1'..='9') if self.config.scheme == InputScheme::Pinyin => {
                    let idx = self.page * self.config.page_size.max(1) + (d as usize - '1' as usize);
                    self.select(engine, learner, idx)
                }
                Some('-') => self.page_by(engine, -1),
                Some('=') => self.page_by(engine, 1),
                Some(ch) if self.config.full_width_punctuation => {
                    // Punctuation ends the composition: the highlighted
                    // candidate goes out, then the mark.
                    let mut out = self.commit_highlighted_or_raw(engine, learner);
                    let mark = self.punct.map(ch).map(str::to_string).unwrap_or_else(|| ch.to_string());
                    out.commit = Some(out.commit.unwrap_or_default() + &mark);
                    self.chain.r#break();
                    out
                }
                Some(ch) => {
                    let mut out = self.commit_highlighted_or_raw(engine, learner);
                    out.commit = Some(out.commit.unwrap_or_default() + &ch.to_string());
                    self.chain.r#break();
                    self.punct.note_passthrough(ch);
                    out
                }
                None => KeyOutcome {
                    consumed: true,
                    commit: None,
                    frame: self.frame(engine.is_empty()),
                },
            },
        }
    }

    // ── helpers ────────────────────────────────────────────────────────

    fn passthrough(&mut self, _engine: &Engine, ch: Option<char>) -> KeyOutcome {
        if let Some(ch) = ch {
            self.punct.note_passthrough(ch);
            self.recent.note_other();
        }
        self.chain.r#break();
        KeyOutcome {
            consumed: false,
            commit: None,
            frame: self.frame(false),
        }
    }

    fn push_key(&mut self, engine: &Engine, learner: &mut dyn Learner, ch: char) -> KeyOutcome {
        self.keys.push(ch);
        self.requery(engine, learner);
        KeyOutcome {
            consumed: true,
            commit: None,
            frame: self.frame(engine.is_empty()),
        }
    }

    fn requery(&mut self, engine: &Engine, learner: &mut dyn Learner) {
        self.query = Some(engine.query(&self.keys, self.config.scheme, learner, &mut self.cache));
        self.page = 0;
        self.highlight = 0;
    }

    /// In zhuyin, Space after a syllable with no tone yet is the first tone.
    fn space_is_tone(&self) -> bool {
        if self.keys.is_empty() {
            return false;
        }
        let last = self.keys.chars().last().unwrap_or(' ');
        let last_is_tone = matches!(last, '3' | '4' | '6' | '7' | ' ');
        if last_is_tone {
            return false;
        }
        self.query
            .as_ref()
            .is_some_and(|q| q.segmentation.edges.last().is_some_and(|e| e.complete))
    }

    fn clear_composition(&mut self) {
        self.keys.clear();
        self.fixed.clear();
        self.query = None;
        self.page = 0;
        self.highlight = 0;
    }

    /// Everything composed, as the person typed it, and the composition ends.
    fn take_raw(&mut self) -> String {
        let mut text: String = self.fixed.iter().map(|p| p.text.as_str()).collect();
        match self.config.scheme {
            InputScheme::Pinyin => text.push_str(&self.keys),
            InputScheme::Zhuyin => {
                if let Some(q) = &self.query {
                    text.push_str(&q.preedit.iter().map(|s| s.text.as_str()).collect::<String>());
                } else {
                    text.push_str(&self.keys);
                }
            }
        }
        self.clear_composition();
        text
    }

    fn highlighted_index(&self) -> Option<usize> {
        let q = self.query.as_ref()?;
        let idx = self.page * self.config.page_size.max(1) + self.highlight;
        (idx < q.candidates.len()).then_some(idx)
    }

    fn commit_highlighted_or_raw(&mut self, engine: &Engine, learner: &mut dyn Learner) -> KeyOutcome {
        match self.highlighted_index() {
            Some(idx) => self.select(engine, learner, idx),
            None => {
                let text = self.take_raw();
                self.chain.r#break();
                self.punct.note_commit();
                KeyOutcome {
                    consumed: true,
                    commit: Some(text),
                    frame: self.frame(false),
                }
            }
        }
    }

    fn page_by(&mut self, engine: &Engine, delta: isize) -> KeyOutcome {
        if let Some(q) = &self.query {
            let page_size = self.config.page_size.max(1);
            let pages = q.candidates.len().div_ceil(page_size);
            let target = self.page as isize + delta;
            if target >= 0 && (target as usize) < pages {
                self.page = target as usize;
                self.highlight = 0;
            }
        }
        KeyOutcome {
            consumed: true,
            commit: None,
            frame: self.frame(engine.is_empty()),
        }
    }

    fn highlight_by(&mut self, engine: &Engine, delta: isize) -> KeyOutcome {
        if let Some(q) = &self.query {
            let page_size = self.config.page_size.max(1);
            let total = q.candidates.len();
            if total > 0 {
                let current = (self.page * page_size + self.highlight).min(total - 1) as isize;
                let next = (current + delta).clamp(0, total as isize - 1) as usize;
                self.page = next / page_size;
                self.highlight = next % page_size;
            }
        }
        KeyOutcome {
            consumed: true,
            commit: None,
            frame: self.frame(engine.is_empty()),
        }
    }

    /// Chooses candidate `idx`. A candidate for part of the keys becomes a
    /// fixed piece; one for all of them commits the whole buffer.
    fn select(&mut self, engine: &Engine, learner: &mut dyn Learner, idx: usize) -> KeyOutcome {
        let Some(cand) = self.query.as_ref().and_then(|q| q.candidates.get(idx)).cloned() else {
            return KeyOutcome {
                consumed: true,
                commit: None,
                frame: self.frame(engine.is_empty()),
            };
        };
        let key_count = self.keys.chars().count();
        let consumed = cand.consumed.min(key_count).max(1);
        let piece_keys: String = self.keys.chars().take(consumed).collect();
        let rest: String = self.keys.chars().skip(consumed).collect();
        let piece = FixedPiece {
            text: cand.text.clone(),
            code: cand.code(),
            keys: piece_keys,
            words: cand.words.clone(),
            source: cand.source,
        };
        if !rest.is_empty() {
            self.chain.piece_selected(&piece.keys, &piece.text, &piece.code);
            learner.record_choice(&piece.keys, &piece.text);
            self.fixed.push(piece);
            self.keys = rest;
            self.requery(engine, learner);
            return KeyOutcome {
                consumed: true,
                commit: None,
                frame: self.frame(engine.is_empty()),
            };
        }
        self.chain.piece_selected(&piece.keys, &piece.text, &piece.code);
        let mut pieces = std::mem::take(&mut self.fixed);
        pieces.push(piece);
        self.keys.clear();
        self.query = None;
        self.page = 0;
        self.highlight = 0;
        let text = self.commit_pieces(engine, learner, pieces, &cand);
        self.punct.note_commit();
        KeyOutcome {
            consumed: true,
            commit: Some(text),
            frame: self.frame(false),
        }
    }

    /// Records everything the commit teaches and returns the text.
    fn commit_pieces(
        &mut self,
        engine: &Engine,
        learner: &mut dyn Learner,
        pieces: Vec<FixedPiece>,
        last: &Candidate,
    ) -> String {
        let whole_keys: String = pieces.iter().map(|p| p.keys.as_str()).collect();
        let whole_text: String = pieces.iter().map(|p| p.text.as_str()).collect();
        self.recent.resolve_retype(&whole_keys, &whole_text, learner);

        let mut record = CommitRecord {
            text: whole_text.clone(),
            chars: whole_text.chars().count(),
            keys: whole_keys.clone(),
            chosen: Some(last.text.clone()),
            recorded: Vec::new(),
            choices: Vec::new(),
            transitions: Vec::new(),
            learned_word: None,
            erased: 0,
        };

        // The last piece is chosen now; earlier pieces were recorded when
        // chosen, and are listed here so an undo reaches them too.
        for p in &pieces[..pieces.len() - 1] {
            record.choices.push((p.keys.clone(), p.text.clone()));
        }
        let last_piece = pieces.last().expect("at least one piece");
        learner.record_choice(&last_piece.keys, &last_piece.text);
        record.choices.push((last_piece.keys.clone(), last_piece.text.clone()));

        for p in &pieces {
            let explicit = p.source != CandidateSource::Sentence;
            if explicit {
                learner.record(&p.text);
                record.recorded.push(p.text.clone());
            }
            let weight = if explicit { EXPLICIT_TRANSITION_WEIGHT } else { 1 };
            for (word, _) in &p.words {
                let ctx = self.chain.context();
                learner.record_transition(ctx, word, weight);
                record.transitions.push((ctx.into(), word.clone(), weight));
                self.chain.advance(std::slice::from_ref(&(word.clone(), String::new())));
            }
        }

        // A buffer chosen in several pieces is remembered whole, and after
        // enough repetitions becomes a word of its own.
        if let Some((keys, text, code)) = self.chain.finish_buffer() {
            learner.record_choice(&keys, &text);
            record.choices.push((keys.clone(), text.clone()));
            if learner.choice_weight(&keys, &text) >= AUTO_WORD_THRESHOLD_SAME_BUFFER
                && text.chars().count() <= AUTO_WORD_MAX_CHARS * 2
                && !in_dictionary(engine, &code, &text)
            {
                learner.learn_word(&text, &code);
                record.learned_word = Some((text, code));
            }
        }

        // Two words that keep following each other merge.
        if record.learned_word.is_none()
            && let Some((a, b)) = self.chain.last_pair()
            && a.chars().count() + b.chars().count() <= AUTO_WORD_MAX_CHARS
            && learner.ngram().bigram_count(a, b) >= AUTO_WORD_THRESHOLD
        {
            let merged = format!("{a}{b}");
            let code = pieces_code_for(&pieces, a, b);
            if let Some(code) = code
                && !in_dictionary(engine, &code, &merged)
            {
                learner.learn_word(&merged, &code);
                record.learned_word = Some((merged, code));
            }
        }

        self.recent.push(record);
        whole_text
    }
}

fn in_dictionary(engine: &Engine, code: &str, text: &str) -> bool {
    engine.dicts().lookup(code).iter().any(|h| h.text == text)
}

/// The spaced code of `a` followed by `b`, when both are words of the pieces
/// just committed (the only place their codes are known).
fn pieces_code_for(pieces: &[FixedPiece], a: &str, b: &str) -> Option<String> {
    let words: Vec<&(String, String)> = pieces.iter().flat_map(|p| p.words.iter()).collect();
    let n = words.len();
    if n >= 2 && words[n - 2].0 == a && words[n - 1].0 == b {
        return Some(format!("{} {}", words[n - 2].1, words[n - 1].1));
    }
    None
}
