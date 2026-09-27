//! One text field's state machine.
//!
//! Every key comes through [`Session::handle_key`], which decides three
//! things — whether the key is eaten, what text if any reaches the document,
//! and what the candidate window shows next — and records what the person
//! chose. The scheme (pinyin, zhuyin or grid) changes which printable keys spell
//! syllables and what Space and Enter mean while composing; everything else
//! is shared.
//!
//! Selecting a candidate that covers only the first syllables keeps the rest
//! composing: the chosen text moves into a "fixed" prefix shown in the preedit
//! and the remaining keys are queried again, so 你好吗 can be typed as 你好 then
//! 吗 without anything reaching the document in between. The whole thing
//! commits when the last keys are chosen, and the buffer as a whole is what
//! the learner is told about.
//!
//! After a word is committed the session offers what may follow it — the
//! prediction list, [`Engine::predict`] plus ，and 。. It is a list on
//! the side, not a mode: Up and Down move through it, Tab (or a tap) takes
//! the highlighted one, Esc closes it, and every other key closes it and
//! then does exactly what it would have done with no list there. That is
//! what keeps letters and digits untouched, so nobody typing on is ever
//! caught by it.

use std::sync::Arc;

use meridian_ime_engine::learn::Muted;
use meridian_ime_engine::{
    Candidate, CandidateSource, Engine, GridRole, InputScheme, Learner, Prediction, PredictionSource, Query,
    QueryContext, SpanCache, grid_token,
};
use meridian_ime_proto::{CandidateItem, Frame, KeyEvent, Mode, PreeditKind, PreeditSegment};

use crate::chain::{
    AUTO_WORD_MAX_CHARS, AUTO_WORD_THRESHOLD, AUTO_WORD_THRESHOLD_SAME_BUFFER, CommitChain, CommitRecord,
    EXPLICIT_TRANSITION_WEIGHT, Recent,
};
use crate::keys::*;
use crate::punct::PunctState;

/// Shown in the frame while the person types with nothing to look things up in.
pub const NO_DICTIONARY_NOTICE: &str = "尚未导入词库：在 Meridian 设置里导入一本 Rime 词库后即可打字";
/// Shown instead when there are dictionaries, all in an older format.
pub const DICTIONARY_UPGRADE_NOTICE: &str = "词库需要升级：打开一次 Meridian 即可自动完成";

/// What a frame says about the dictionaries, if anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DictionaryNotice {
    None,
    /// Nothing to look anything up in.
    Missing,
    /// Nothing usable, because what is listed waits for Meridian to upgrade it.
    NeedsUpgrade,
}

impl DictionaryNotice {
    pub fn of(engine: &Engine) -> Self {
        if !engine.is_empty() {
            Self::None
        } else if engine.outdated_dictionaries() > 0 {
            Self::NeedsUpgrade
        } else {
            Self::Missing
        }
    }
}

/// Characters of text before the cursor kept for the scorer.
pub const LEFT_CONTEXT_CHARS: usize = 64;
/// Characters of text after the cursor kept for the scorer.
pub const RIGHT_CONTEXT_CHARS: usize = 32;

/// The last `n` characters of `s`.
fn tail_chars(s: &str, n: usize) -> String {
    let count = s.chars().count();
    s.chars().skip(count.saturating_sub(n)).collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionConfig {
    pub scheme: InputScheme,
    pub page_size: usize,
    pub full_width_punctuation: bool,
    /// Master switch; a private document mutes learning regardless.
    pub learning: bool,
    /// Offer what may follow a commit.
    pub prediction: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            scheme: InputScheme::Pinyin,
            page_size: 5,
            full_width_punctuation: true,
            learning: true,
            prediction: true,
        }
    }
}

/// What one key did. Serialisable because the Android keyboard receives it
/// across JNI as JSON.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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
    /// Text before the cursor, nearest last: what the application reported,
    /// with every commit since appended. At most [`LEFT_CONTEXT_CHARS`].
    left: String,
    /// Text after the cursor, as the application reported it.
    right: String,
    /// Memory hints, where the host decided they are allowed.
    hints: Arc<[String]>,
    /// What may follow the last commit, while the list is on screen. Empty
    /// is "no list": the marks are shown only beside at least one word.
    predictions: Vec<Prediction>,
    /// Index into the list as drawn: the predictions, then the marks.
    prediction_highlight: usize,
}

/// Offered after the words of a prediction list, in Chinese punctuation
/// only: a half-width comma after Chinese text is not something to suggest.
const PREDICTION_MARKS: [&str; 2] = ["，", "。"];

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
            left: String::new(),
            right: String::new(),
            hints: Arc::from(Vec::new()),
            predictions: Vec::new(),
            prediction_highlight: 0,
        }
    }

    pub fn config(&self) -> &SessionConfig {
        &self.config
    }

    /// Applies new settings. The scheme changing drops the composition.
    pub fn set_config(&mut self, config: SessionConfig) {
        self.dismiss_predictions();
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
        if private {
            self.dismiss_predictions();
            self.left.clear();
            self.right.clear();
        }
    }

    pub fn is_composing(&self) -> bool {
        !self.keys.is_empty() || !self.fixed.is_empty()
    }

    /// A prediction list is on screen.
    pub fn is_predicting(&self) -> bool {
        !self.predictions.is_empty()
    }

    /// The list was passed over — a key went to the application without
    /// reaching the session, or the caret moved. Either way what comes next
    /// is not written straight after the last word, so the chain ends too:
    /// kept, the next commit would be learned as following a word it may be
    /// nowhere near. Returns the frame left.
    pub fn dismiss(&mut self) -> Frame {
        self.dismiss_predictions();
        self.chain.r#break();
        self.frame(DictionaryNotice::None)
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
    /// stay; what surrounded the cursor goes, since it belonged to that field.
    pub fn reset(&mut self) -> Frame {
        self.clear_composition();
        self.dismiss_predictions();
        self.left.clear();
        self.right.clear();
        self.chain.r#break();
        self.frame(DictionaryNotice::None)
    }

    /// A candidate on the current page was tapped. On a touch keyboard this is
    /// the only way to pick one: under zhuyin and grid the digits are not
    /// selection keys, so a tap cannot be sent as a digit. Learning is muted
    /// exactly as it is for a key, since a tap in a password field is still a
    /// choice made in a password field.
    pub fn choose(&mut self, engine: &Engine, learner: &mut dyn Learner, index_on_page: usize) -> KeyOutcome {
        let muted = self.private || !self.config.learning;
        let mut learner = Muted::new(learner, muted);
        if self.is_predicting() && !self.is_composing() {
            let out = self.accept_prediction(engine, &mut learner, index_on_page);
            self.note_commit(&out);
            return out;
        }
        if !self.is_composing() {
            return KeyOutcome {
                consumed: false,
                commit: None,
                frame: self.frame(DictionaryNotice::None),
            };
        }
        let idx = self.page * self.config.page_size.max(1) + index_on_page;
        let mut out = self.select(engine, &mut learner, idx);
        self.after_commit(engine, &learner, &mut out);
        self.note_commit(&out);
        out
    }

    /// Text chosen from a long-press menu or typed on the number layer, to go
    /// into the document exactly as given: the highlighted candidate is
    /// committed first, as any punctuation would, and then `text` with no
    /// width mapping. Sent as a key instead, the half-width `,` a person
    /// picked from the menu would come out as `，` in Chinese mode, and a digit
    /// would select a candidate.
    pub fn insert(&mut self, engine: &Engine, learner: &mut dyn Learner, text: &str) -> KeyOutcome {
        let muted = self.private || !self.config.learning;
        let mut learner = Muted::new(learner, muted);
        self.dismiss_predictions();
        let mut out = if self.is_composing() {
            self.commit_highlighted_or_raw(engine, &mut learner)
        } else {
            KeyOutcome {
                consumed: true,
                commit: None,
                frame: self.frame(DictionaryNotice::None),
            }
        };
        out.commit = Some(out.commit.unwrap_or_default() + text);
        out.consumed = true;
        self.chain.r#break();
        self.punct.note_commit();
        if let Some(last) = text.chars().last() {
            self.punct.note_passthrough(last);
        }
        self.note_commit(&out);
        out
    }

    /// What surrounds the cursor, from the application: replaces what the
    /// session had inferred. Called on a cursor move or before a key.
    pub fn set_surrounding(&mut self, left: &str, right: &str) {
        if self.private {
            return;
        }
        self.left = tail_chars(left, LEFT_CONTEXT_CHARS);
        self.right = right.chars().take(RIGHT_CONTEXT_CHARS).collect();
    }

    /// Memory hints for this session, or none. The caller decides whether the
    /// application is one they may be used in.
    pub fn set_hints(&mut self, hints: Arc<[String]>) {
        self.hints = hints;
    }

    /// A private document's text is not kept at all, not merely withheld.
    fn note_commit(&mut self, out: &KeyOutcome) {
        if self.private {
            return;
        }
        if let Some(text) = &out.commit {
            self.left.push_str(text);
            self.left = tail_chars(&self.left, LEFT_CONTEXT_CHARS);
        }
    }

    /// The current frame.
    pub fn frame(&self, notice: DictionaryNotice) -> Frame {
        let mut frame = Frame {
            mode: self.mode,
            ..Default::default()
        };
        if !self.is_composing() {
            if self.is_predicting() {
                frame.candidates = self.offers();
                frame.page_count = 1;
                frame.highlight = self.prediction_highlight.min(frame.candidates.len() - 1);
                frame.predicting = true;
            }
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
        frame.notice = match notice {
            DictionaryNotice::None => None,
            DictionaryNotice::Missing => Some(NO_DICTIONARY_NOTICE.to_string()),
            DictionaryNotice::NeedsUpgrade => Some(DICTIONARY_UPGRADE_NOTICE.to_string()),
        };
        frame
    }

    /// One key. Whatever it commits becomes left context for the next query.
    pub fn handle_key(&mut self, engine: &Engine, learner: &mut dyn Learner, ev: KeyEvent) -> KeyOutcome {
        let mut out = self.handle_key_inner(engine, learner, ev);
        {
            let muted = self.private || !self.config.learning;
            let learner = Muted::new(learner, muted);
            self.after_commit(engine, &learner, &mut out);
        }
        self.note_commit(&out);
        out
    }

    /// The whole state machine.
    fn handle_key_inner(&mut self, engine: &Engine, learner: &mut dyn Learner, ev: KeyEvent) -> KeyOutcome {
        let muted = self.private || !self.config.learning;
        let mut learner = Muted::new(learner, muted);
        let learner: &mut dyn Learner = &mut learner;

        // A list on screen answers four bare keys; anything else closes it
        // and carries on as if it had never been there.
        if self.is_predicting() {
            let bare = !(ev.mods.ctrl || ev.mods.alt || ev.mods.win || ev.mods.shift);
            match ev.vk {
                VK_UP if bare => return self.move_prediction(-1),
                VK_DOWN if bare => return self.move_prediction(1),
                VK_TAB if bare => return self.accept_prediction(engine, learner, self.prediction_highlight),
                VK_ESCAPE if bare => {
                    self.dismiss_predictions();
                    return KeyOutcome {
                        consumed: true,
                        commit: None,
                        frame: self.frame(DictionaryNotice::None),
                    };
                }
                _ => self.dismiss_predictions(),
            }
        }

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
                frame: self.frame(DictionaryNotice::None),
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
                // A tone key closes a syllable; with nothing composing there is
                // no syllable for it to close.
                InputScheme::Grid => grid_token(ch).is_some_and(|t| t.role != GridRole::Tone),
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
                    frame: self.frame(DictionaryNotice::None),
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
                        frame: self.frame(DictionaryNotice::None),
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
                                frame: self.frame(DictionaryNotice::None),
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
                    frame: self.frame(DictionaryNotice::of(engine)),
                }
            }
            VK_ESCAPE => {
                self.clear_composition();
                KeyOutcome {
                    consumed: true,
                    commit: None,
                    frame: self.frame(DictionaryNotice::None),
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
                        frame: self.frame(DictionaryNotice::None),
                    }
                }
                InputScheme::Zhuyin | InputScheme::Grid => self.commit_highlighted_or_raw(engine, learner),
            },
            VK_SPACE => match self.config.scheme {
                // Grid has a first-tone key of its own, so Space only commits.
                InputScheme::Pinyin | InputScheme::Grid => self.commit_highlighted_or_raw(engine, learner),
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
                frame: self.frame(DictionaryNotice::of(engine)),
            },
            _ => match ev.ch {
                Some(d @ '1'..='9') if matches!(self.config.scheme, InputScheme::Pinyin | InputScheme::Grid) => {
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
                    frame: self.frame(DictionaryNotice::of(engine)),
                },
            },
        }
    }

    // ── prediction ─────────────────────────────────────────────────────

    /// A commit of Chinese words just happened: offer what may follow. The
    /// chain says whether it was one — punctuation, raw keys, English and
    /// menu text all break it, and a broken chain predicts nothing — so this
    /// runs after every key rather than being threaded through each path
    /// that commits.
    fn after_commit(&mut self, engine: &Engine, learner: &dyn Learner, out: &mut KeyOutcome) {
        if out.commit.is_none() || self.is_composing() || self.is_predicting() {
            return;
        }
        if !self.config.prediction || self.mode != Mode::Chinese {
            return;
        }
        let max = self.config.page_size.max(1);
        self.predictions = engine.predict(self.chain.context(), learner, !self.private, max);
        self.prediction_highlight = 0;
        out.frame = self.frame(DictionaryNotice::None);
    }

    fn dismiss_predictions(&mut self) {
        self.predictions.clear();
        self.prediction_highlight = 0;
    }

    fn marks(&self) -> &'static [&'static str] {
        if self.config.full_width_punctuation {
            &PREDICTION_MARKS
        } else {
            &[]
        }
    }

    /// The list as drawn: the predictions, then the marks.
    fn offers(&self) -> Vec<CandidateItem> {
        let words = self.predictions.iter().map(|p| CandidateItem {
            text: p.text.clone(),
            source: match p.source {
                PredictionSource::Personal => meridian_ime_proto::CandidateSource::User,
                PredictionSource::Dict => meridian_ime_proto::CandidateSource::Dict,
            },
        });
        let marks = self.marks().iter().map(|m| CandidateItem {
            text: (*m).to_string(),
            source: meridian_ime_proto::CandidateSource::Dict,
        });
        words.chain(marks).collect()
    }

    fn move_prediction(&mut self, delta: isize) -> KeyOutcome {
        let len = (self.predictions.len() + self.marks().len()) as isize;
        self.prediction_highlight = (self.prediction_highlight as isize + delta).clamp(0, len - 1) as usize;
        KeyOutcome {
            consumed: true,
            commit: None,
            frame: self.frame(DictionaryNotice::None),
        }
    }

    /// Takes item `idx` of the list. A word is learned as having followed the
    /// last one — which is also what puts it at the top of the list next
    /// time — and the list is offered again from it; a mark ends the chain
    /// the way typing it would.
    fn accept_prediction(&mut self, engine: &Engine, learner: &mut dyn Learner, idx: usize) -> KeyOutcome {
        let marks = self.marks();
        let Some(p) = self.predictions.get(idx).cloned() else {
            let mark = idx
                .checked_sub(self.predictions.len())
                .and_then(|i| marks.get(i).copied());
            self.dismiss_predictions();
            let Some(mark) = mark else {
                return KeyOutcome {
                    consumed: true,
                    commit: None,
                    frame: self.frame(DictionaryNotice::None),
                };
            };
            self.chain.r#break();
            self.recent.note_other();
            self.punct.note_commit();
            return KeyOutcome {
                consumed: true,
                commit: Some(mark.to_string()),
                frame: self.frame(DictionaryNotice::None),
            };
        };
        self.dismiss_predictions();
        self.recent.resolve_retype("", &p.text, learner);
        let ctx = self.chain.context();
        learner.record_transition(ctx, &p.text, EXPLICIT_TRANSITION_WEIGHT);
        self.recent.push(CommitRecord {
            text: p.text.clone(),
            chars: p.text.chars().count(),
            keys: String::new(),
            chosen: Some(p.text.clone()),
            recorded: Vec::new(),
            choices: Vec::new(),
            transitions: vec![(ctx.into(), p.text.clone(), EXPLICIT_TRANSITION_WEIGHT)],
            learned_word: None,
            erased: 0,
        });
        if p.word == p.text {
            self.chain.advance(&[(p.word, String::new())]);
        } else {
            self.chain.replace_last(&p.word);
        }
        self.punct.note_commit();
        let mut out = KeyOutcome {
            consumed: true,
            commit: Some(p.text),
            frame: self.frame(DictionaryNotice::None),
        };
        self.after_commit(engine, learner, &mut out);
        out
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
            frame: self.frame(DictionaryNotice::None),
        }
    }

    fn push_key(&mut self, engine: &Engine, learner: &mut dyn Learner, ch: char) -> KeyOutcome {
        self.keys.push(ch);
        self.requery(engine, learner);
        KeyOutcome {
            consumed: true,
            commit: None,
            frame: self.frame(DictionaryNotice::of(engine)),
        }
    }

    fn requery(&mut self, engine: &Engine, learner: &mut dyn Learner) {
        // A private document tells the scorer nothing about itself.
        let context = if self.private {
            QueryContext::EMPTY
        } else {
            QueryContext {
                left: &self.left,
                right: &self.right,
                hints: &self.hints,
            }
        };
        self.query = Some(engine.query_with(&self.keys, self.config.scheme, learner, &mut self.cache, &context));
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
            // Both show the person something other than the key string: the
            // symbols, or the grid's labels in place of private-use keys.
            InputScheme::Zhuyin | InputScheme::Grid => {
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
                    frame: self.frame(DictionaryNotice::None),
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
            frame: self.frame(DictionaryNotice::of(engine)),
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
            frame: self.frame(DictionaryNotice::of(engine)),
        }
    }

    /// Chooses candidate `idx`. A candidate for part of the keys becomes a
    /// fixed piece; one for all of them commits the whole buffer.
    fn select(&mut self, engine: &Engine, learner: &mut dyn Learner, idx: usize) -> KeyOutcome {
        let Some(cand) = self.query.as_ref().and_then(|q| q.candidates.get(idx)).cloned() else {
            return KeyOutcome {
                consumed: true,
                commit: None,
                frame: self.frame(DictionaryNotice::of(engine)),
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
                frame: self.frame(DictionaryNotice::of(engine)),
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
            frame: self.frame(DictionaryNotice::None),
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
