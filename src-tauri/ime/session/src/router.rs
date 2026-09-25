//! One session per connected text service, and which of them is on screen.
//!
//! The host is the only caller. It hands every `ClientMessage` here with the
//! connection it arrived on and sends back whatever comes out; it asks
//! `focused_frame` when it wants to redraw; it calls `tick` from its idle
//! loop. Everything the router touches — engine, learner, sessions — is owned
//! by one thread, so there is no lock anywhere in it.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use meridian_ime_engine::{Engine, InputScheme, Learner};
use meridian_ime_proto::{
    ClientKind, ClientMessage, ErrorCode, Frame, InputSettings, PROTOCOL_VERSION, Profile, Rect, Scheme, ServerMessage,
};

use crate::session::{Session, SessionConfig};

/// Learning is flushed this often while the host is idle.
pub const FLUSH_INTERVAL: Duration = Duration::from_secs(60);

/// A session is a connection plus the id the text service gave it, so two
/// application processes that both call their first session `1` do not share
/// a buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionKey {
    pub conn: u64,
    pub session_id: u64,
}

/// The settings every new session starts from; the host rebuilds it from
/// `host.json` and calls `set_config`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterConfig {
    pub scheme: InputScheme,
    pub page_size: usize,
    pub full_width_punctuation: bool,
    pub learning: bool,
    /// Lower-cased executable names whose sessions are always private.
    pub private_apps: Vec<String>,
    /// Lower-cased executable names, besides Meridian's own, that may be
    /// shown the person's memory hints.
    pub context_apps: Vec<String>,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            scheme: InputScheme::Pinyin,
            page_size: 5,
            full_width_punctuation: true,
            learning: true,
            private_apps: Vec::new(),
            context_apps: Vec::new(),
        }
    }
}

impl RouterConfig {
    fn session_config(&self, profile: Profile) -> SessionConfig {
        // The TSF profile is the person's choice at the keyboard switcher and
        // wins over the file: the zh-TW profile always types zhuyin.
        let scheme = match profile {
            Profile::ZhuyinTraditional => InputScheme::Zhuyin,
            Profile::PinyinSimplified => self.scheme,
        };
        SessionConfig {
            scheme,
            page_size: self.page_size,
            full_width_punctuation: self.full_width_punctuation,
            learning: self.learning,
        }
    }

    fn input_settings(&self, profile: Profile) -> InputSettings {
        let cfg = self.session_config(profile);
        InputSettings {
            scheme: match cfg.scheme {
                InputScheme::Pinyin => Scheme::Pinyin,
                InputScheme::Zhuyin => Scheme::Zhuyin,
                InputScheme::Grid => Scheme::Grid,
            },
            page_size: cfg.page_size as u8,
            full_width_punctuation: cfg.full_width_punctuation,
        }
    }
}

struct Entry {
    session: Session,
    profile: Profile,
    app_name: Option<String>,
    private_by_app: bool,
    last_rect: Option<Rect>,
}

pub struct Router {
    engine: Arc<Engine>,
    learner: Box<dyn Learner>,
    config: RouterConfig,
    sessions: HashMap<SessionKey, Entry>,
    /// Connections that said `Hello`, with what they said.
    hellos: HashMap<u64, ClientKind>,
    focused: Option<SessionKey>,
    last_flush: Instant,
    user_words_generation: u64,
    user_words_dirty: bool,
    /// Memory hints, handed only to sessions in an allowed application.
    hints: Arc<[String]>,
    version: String,
    data_dir: String,
    dictionaries: Vec<String>,
}

impl Router {
    pub fn new(engine: Arc<Engine>, learner: Box<dyn Learner>, config: RouterConfig) -> Self {
        let user_words_generation = learner.user_words_generation();
        Self {
            engine,
            learner,
            config,
            sessions: HashMap::new(),
            hellos: HashMap::new(),
            focused: None,
            last_flush: Instant::now(),
            user_words_generation,
            user_words_dirty: false,
            hints: Arc::from(Vec::new()),
            version: env!("CARGO_PKG_VERSION").to_string(),
            data_dir: String::new(),
            dictionaries: Vec::new(),
        }
    }

    /// What `Status` reports.
    pub fn set_status_info(&mut self, data_dir: String, dictionaries: Vec<String>) {
        self.data_dir = data_dir;
        self.dictionaries = dictionaries;
    }

    pub fn config(&self) -> &RouterConfig {
        &self.config
    }

    /// New settings reach every session at once.
    pub fn set_config(&mut self, config: RouterConfig) {
        self.config = config;
        for e in self.sessions.values_mut() {
            e.session.set_config(self.config.session_config(e.profile));
            e.private_by_app = is_private_app(&self.config, e.app_name.as_deref());
            e.session.set_private(e.private_by_app || e.session.is_private());
            e.session
                .set_hints(hints_for(&self.config, e.app_name.as_deref(), &self.hints));
        }
    }

    /// New memory hints, from Meridian. Each session gets them or none,
    /// depending on which application it is in.
    pub fn set_hints(&mut self, hints: Vec<String>) {
        self.hints = Arc::from(hints);
        for e in self.sessions.values_mut() {
            e.session
                .set_hints(hints_for(&self.config, e.app_name.as_deref(), &self.hints));
        }
    }

    /// Dictionaries were reloaded: every session's cache is stale.
    pub fn replace_engine(&mut self, engine: Arc<Engine>) {
        self.engine = engine;
        for e in self.sessions.values_mut() {
            e.session.invalidate_cache();
        }
    }

    pub fn engine(&self) -> &Arc<Engine> {
        &self.engine
    }

    pub fn learner(&self) -> &dyn Learner {
        self.learner.as_ref()
    }

    pub fn learner_mut(&mut self) -> &mut dyn Learner {
        self.learner.as_mut()
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn focused(&self) -> Option<SessionKey> {
        self.focused
    }

    /// The frame and position the candidate window should show, if any.
    pub fn focused_frame(&self) -> Option<(Frame, Option<Rect>)> {
        let key = self.focused?;
        let e = self.sessions.get(&key)?;
        Some((e.session.frame(self.engine.is_empty()), e.last_rect))
    }

    /// One message in, one reply out.
    pub fn handle(&mut self, conn: u64, msg: ClientMessage) -> ServerMessage {
        match msg {
            ClientMessage::Hello {
                version,
                kind,
                session_id,
                profile,
                app_name,
                pid: _,
            } => {
                if version != PROTOCOL_VERSION {
                    return ServerMessage::Error {
                        code: ErrorCode::VersionMismatch,
                        server_version: PROTOCOL_VERSION,
                        message: format!("client speaks protocol {version}, host speaks {PROTOCOL_VERSION}"),
                    };
                }
                self.hellos.insert(conn, kind);
                if kind == ClientKind::Ime {
                    let key = SessionKey { conn, session_id };
                    let private_by_app = is_private_app(&self.config, app_name.as_deref());
                    let mut session = Session::new(self.config.session_config(profile));
                    session.set_private(private_by_app);
                    session.set_hints(hints_for(&self.config, app_name.as_deref(), &self.hints));
                    self.sessions.insert(
                        key,
                        Entry {
                            session,
                            profile,
                            app_name,
                            private_by_app,
                            last_rect: None,
                        },
                    );
                }
                ServerMessage::Welcome {
                    version: PROTOCOL_VERSION,
                    settings: self.config.input_settings(profile),
                }
            }
            ClientMessage::Key {
                session_id,
                event,
                surrounding,
            } => {
                let key = SessionKey { conn, session_id };
                if !self.sessions.contains_key(&key) {
                    return self.unknown_session(session_id);
                }
                self.focus(key);
                self.refresh_user_words();
                let engine = self.engine.clone();
                let e = self.sessions.get_mut(&key).expect("checked above");
                if let Some(s) = surrounding {
                    e.session.set_surrounding(&s.left, &s.right);
                }
                let outcome = e.session.handle_key(&engine, self.learner.as_mut(), event);
                ServerMessage::KeyResult {
                    session_id,
                    consumed: outcome.consumed,
                    commit: outcome.commit,
                    frame: outcome.frame,
                }
            }
            ClientMessage::Focus { session_id, private } => {
                let key = SessionKey { conn, session_id };
                let Some(e) = self.sessions.get_mut(&key) else {
                    return self.unknown_session(session_id);
                };
                e.session.set_private(private || e.private_by_app);
                if e.session.is_composing() {
                    e.session.reset();
                }
                self.focus(key);
                ServerMessage::Ack
            }
            ClientMessage::Layout { session_id, rect } => {
                let key = SessionKey { conn, session_id };
                let Some(e) = self.sessions.get_mut(&key) else {
                    return self.unknown_session(session_id);
                };
                e.last_rect = Some(rect);
                ServerMessage::Ack
            }
            ClientMessage::Reset { session_id } => {
                let key = SessionKey { conn, session_id };
                let Some(e) = self.sessions.get_mut(&key) else {
                    return self.unknown_session(session_id);
                };
                e.session.reset();
                ServerMessage::Ack
            }
            ClientMessage::ReloadDictionaries => ServerMessage::Ack,
            ClientMessage::Shutdown => {
                if self.hellos.get(&conn) == Some(&ClientKind::Control) {
                    ServerMessage::Ack
                } else {
                    ServerMessage::Error {
                        code: ErrorCode::NotPermitted,
                        server_version: PROTOCOL_VERSION,
                        message: "only a control client may shut the host down".into(),
                    }
                }
            }
            ClientMessage::Bye { session_id } => {
                let key = SessionKey { conn, session_id };
                self.remove(key);
                ServerMessage::Ack
            }
        }
    }

    /// Whether `conn` identified itself as a control client.
    pub fn is_control(&self, conn: u64) -> bool {
        self.hellos.get(&conn) == Some(&ClientKind::Control)
    }

    /// The status a control client is told.
    pub fn status(&self) -> ServerMessage {
        ServerMessage::Status {
            version: self.version.clone(),
            protocol: PROTOCOL_VERSION,
            sessions: self.sessions.len() as u32,
            dictionaries: self.dictionaries.clone(),
            data_dir: self.data_dir.clone(),
        }
    }

    /// The connection closed: its sessions go, compositions and all.
    pub fn on_disconnect(&mut self, conn: u64) {
        let keys: Vec<SessionKey> = self.sessions.keys().filter(|k| k.conn == conn).copied().collect();
        for k in keys {
            self.remove(k);
        }
        self.hellos.remove(&conn);
    }

    /// Idle housekeeping: flush learning on the interval.
    pub fn tick(&mut self, now: Instant) {
        if now.duration_since(self.last_flush) >= FLUSH_INTERVAL {
            self.learner.flush();
            self.last_flush = now;
        }
    }

    /// Flushes now (shutdown).
    pub fn flush(&mut self) {
        self.learner.flush();
        self.last_flush = Instant::now();
    }

    fn focus(&mut self, key: SessionKey) {
        if self.focused != Some(key) {
            if let Some(prev) = self.focused.and_then(|p| self.sessions.get_mut(&p))
                && prev.session.is_composing()
            {
                prev.session.reset();
            }
            self.focused = Some(key);
        }
    }

    fn remove(&mut self, key: SessionKey) {
        self.sessions.remove(&key);
        if self.focused == Some(key) {
            self.focused = None;
        }
    }

    fn unknown_session(&self, session_id: u64) -> ServerMessage {
        ServerMessage::Error {
            code: ErrorCode::UnknownSession,
            server_version: PROTOCOL_VERSION,
            message: format!("session {session_id} has not said hello on this connection"),
        }
    }

    /// The learner's user words feed the engine's dictionary set; when they
    /// change, the set has to be rebuilt. `DictSet` is shared immutably
    /// through the engine, so the host rebuilds it; here we only notice.
    fn refresh_user_words(&mut self) {
        let generation = self.learner.user_words_generation();
        if generation != self.user_words_generation {
            self.user_words_generation = generation;
            self.user_words_dirty = true;
        }
    }

    /// `true` once since the user dictionary last changed; the host then
    /// rebuilds the `DictSet` with `learner().user_words()` and calls
    /// `replace_engine`.
    pub fn take_user_words_dirty(&mut self) -> bool {
        std::mem::take(&mut self.user_words_dirty)
    }
}

fn is_private_app(config: &RouterConfig, app_name: Option<&str>) -> bool {
    let Some(name) = app_name else { return false };
    let name = name.trim().to_ascii_lowercase();
    config.private_apps.contains(&name)
}

/// Meridian's own window, whose memory these are.
pub const MERIDIAN_EXE: &str = "meridian.exe";

/// The hints a session in `app_name` may be given: all of them in Meridian
/// or an app the person opted in, none anywhere else — including a session
/// that did not say which application it is in.
fn hints_for(config: &RouterConfig, app_name: Option<&str>, hints: &Arc<[String]>) -> Arc<[String]> {
    let allowed = app_name.is_some_and(|name| {
        let name = name.trim().to_ascii_lowercase();
        name == MERIDIAN_EXE || config.context_apps.contains(&name)
    });
    if allowed {
        Arc::clone(hints)
    } else {
        Arc::from(Vec::new())
    }
}
