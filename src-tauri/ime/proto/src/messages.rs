//! Message shapes. Tagged `type` in `snake_case` on the wire.

use serde::{Deserialize, Serialize};

/// Who is connecting: a text service that will send keys, or Meridian asking
/// after the host's health.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    Ime,
    Control,
}

/// The TSF language profile a session was activated under. The host picks the
/// input scheme from it: the zh-CN profile types pinyin, the zh-TW one zhuyin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Profile {
    #[default]
    PinyinSimplified,
    ZhuyinTraditional,
}

/// Modifier state at the key event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub win: bool,
}

/// One key press. `vk` is the Windows virtual-key code, which is what function
/// keys are matched on; `ch` is the character the key produces under the
/// current layout and modifiers, which is what printable keys are matched on.
/// A bare Shift *tap* (press and release with nothing in between) arrives as
/// `vk = 0x10` with `ch = None` — the text service decides that on key-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyEvent {
    pub vk: u32,
    pub ch: Option<char>,
    pub mods: Modifiers,
    pub caps_lock: bool,
}

/// A rectangle in screen pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Text on either side of the cursor, as the application holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Surrounding {
    /// Before the cursor, nearest last.
    pub left: String,
    /// After the cursor, nearest first.
    pub right: String,
}

/// Which input scheme a session is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Scheme {
    #[default]
    Pinyin,
    Zhuyin,
    /// The phone keyboard's nine-column layout. Typed by the Android keyboard;
    /// a physical keyboard cannot produce its private-use keys.
    Grid,
}

/// Chinese or English (pass-through) mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Chinese,
    English,
}

/// Settings the text service must know before the first key arrives, sent
/// with `Welcome` because the DLL cannot read a file from inside a store app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputSettings {
    pub scheme: Scheme,
    pub page_size: u8,
    pub full_width_punctuation: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        version: u32,
        kind: ClientKind,
        /// The text service's own id for this session (its TSF client id);
        /// unique per connection, not globally.
        session_id: u64,
        profile: Profile,
        app_name: Option<String>,
        pid: u32,
    },
    Key {
        session_id: u64,
        event: KeyEvent,
        /// Text around the cursor, when the client can read it. Absent means
        /// "not known", not "empty": the session keeps what it had.
        #[serde(default)]
        surrounding: Option<Surrounding>,
    },
    /// The document changed or its sensitivity was learned: `private` means
    /// reads carry on and learning is switched off for this session.
    Focus { session_id: u64, private: bool },
    /// Where the composition sits on screen, measured after an edit session.
    Layout { session_id: u64, rect: Rect },
    /// Drop any composition in progress (focus lost, composition terminated).
    Reset { session_id: u64 },
    /// A dictionary was imported or removed; reload the set.
    ReloadDictionaries,
    /// Control clients only: exit cleanly after flushing.
    Shutdown,
    /// The session is going away.
    Bye { session_id: u64 },
}

/// What a preedit segment is, so the candidate window can draw the syllable
/// still being typed in a weaker colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreeditKind {
    Syllable,
    Partial,
    Separator,
    /// Text already chosen but not yet committed (partial selection).
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreeditSegment {
    pub text: String,
    pub kind: PreeditKind,
}

/// Where a candidate came from. The window may mark user words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateSource {
    Dict,
    User,
    Sentence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateItem {
    pub text: String,
    pub source: CandidateSource,
}

/// Everything the candidate window draws for one session at one moment. An
/// empty frame means "hide".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Frame {
    pub preedit: Vec<PreeditSegment>,
    /// The candidates of the current page only.
    pub candidates: Vec<CandidateItem>,
    /// Zero-based page index and page count.
    pub page: usize,
    pub page_count: usize,
    /// Index into `candidates` of the highlighted one.
    pub highlight: usize,
    pub mode: Mode,
    /// A line for the window to show instead of candidates, e.g. that no
    /// dictionary has been imported yet.
    pub notice: Option<String>,
}

impl Frame {
    pub fn is_empty(&self) -> bool {
        self.preedit.is_empty() && self.candidates.is_empty() && self.notice.is_none()
    }

    /// The preedit as one string.
    pub fn preedit_text(&self) -> String {
        self.preedit.iter().map(|s| s.text.as_str()).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    VersionMismatch,
    UnknownSession,
    Malformed,
    NotPermitted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        version: u32,
        settings: InputSettings,
    },
    KeyResult {
        session_id: u64,
        /// `true` when the key was eaten; `false` passes it to the application.
        consumed: bool,
        /// Text to insert into the document before the frame is applied.
        commit: Option<String>,
        frame: Frame,
    },
    Status {
        version: String,
        protocol: u32,
        sessions: u32,
        dictionaries: Vec<String>,
        data_dir: String,
    },
    Ack,
    Error {
        code: ErrorCode,
        /// The server's protocol version, so a mismatched client can log it.
        server_version: u32,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_tags_are_snake_case() {
        let s = serde_json::to_string(&ClientMessage::ReloadDictionaries).unwrap();
        assert_eq!(s, r#"{"type":"reload_dictionaries"}"#);
        let s = serde_json::to_string(&ServerMessage::Error {
            code: ErrorCode::VersionMismatch,
            server_version: 1,
            message: "x".into(),
        })
        .unwrap();
        assert!(s.contains(r#""code":"version_mismatch""#));
        let f = Frame::default();
        assert!(f.is_empty());
    }
}
