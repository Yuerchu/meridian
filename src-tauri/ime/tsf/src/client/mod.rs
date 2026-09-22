//! The text service's end of the pipe.
//!
//! One connection per TSF thread, kept open across keys, blocking on the
//! application's UI thread: a round trip is a few hundred microseconds and
//! the host answers every message, so there is nothing to wait on
//! asynchronously. When the host is not there the connection fails fast, the
//! text service tries to start it (once, with a cooldown), and the key is
//! handled locally in the meantime.

pub mod launch;

use std::fs::File;
use std::os::windows::fs::OpenOptionsExt;
use std::time::{Duration, Instant};

use meridian_ime_proto::{
    ClientKind, ClientMessage, ErrorCode, InputSettings, PROTOCOL_VERSION, Profile, ServerMessage, pipe_name,
};
use windows::Win32::Foundation::ERROR_PIPE_BUSY;
use windows::Win32::System::Pipes::WaitNamedPipeW;
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_core::PCWSTR;

use crate::com::log;

/// After a failed connection, no retry for this long.
const RETRY_AFTER: Duration = Duration::from_secs(2);
/// After the host refused our protocol version, no retry for this long: an
/// upgrade is in progress and pestering the new host every key helps nobody.
const RETRY_AFTER_VERSION_MISMATCH: Duration = Duration::from_secs(30);
/// How long to wait for a busy pipe instance before giving the key up.
const BUSY_WAIT_MS: u32 = 300;

/// An open, greeted connection.
pub struct Connection {
    file: File,
    pub settings: InputSettings,
}

impl Connection {
    /// One request, one reply. An error means the connection is dead.
    pub fn request(&mut self, msg: &ClientMessage) -> Result<ServerMessage, String> {
        meridian_ime_proto::write_message(&mut self.file, msg).map_err(|e| e.to_string())?;
        match meridian_ime_proto::read_message(&mut self.file) {
            Ok(Some(reply)) => Ok(reply),
            Ok(None) => Err("host closed the pipe".into()),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Sends and ignores the reply's content (still reads it, to stay in step).
    pub fn notify(&mut self, msg: &ClientMessage) {
        let _ = self.request(msg);
    }
}

/// Connection state with retry bookkeeping.
pub struct Client {
    session_id: u64,
    profile: Profile,
    app_name: Option<String>,
    conn: Option<Connection>,
    next_attempt: Option<Instant>,
    launcher: launch::Launcher,
}

impl Client {
    pub fn new(session_id: u64, profile: Profile) -> Self {
        Self {
            session_id,
            profile,
            app_name: launch::current_exe_name(),
            conn: None,
            next_attempt: None,
            launcher: launch::Launcher::new(),
        }
    }

    pub fn session_id(&self) -> u64 {
        self.session_id
    }

    pub fn profile(&self) -> Profile {
        self.profile
    }

    /// The profile changed: greet again under the new one.
    pub fn set_profile(&mut self, profile: Profile) {
        if self.profile != profile {
            self.profile = profile;
            self.disconnect();
        }
    }

    pub fn is_connected(&self) -> bool {
        self.conn.is_some()
    }

    pub fn settings(&self) -> Option<&InputSettings> {
        self.conn.as_ref().map(|c| &c.settings)
    }

    /// The connection, opening and greeting it if necessary and allowed.
    pub fn connection(&mut self) -> Option<&mut Connection> {
        if self.conn.is_none() {
            if let Some(t) = self.next_attempt
                && Instant::now() < t
            {
                return None;
            }
            match self.connect() {
                Ok(c) => {
                    self.conn = Some(c);
                    self.next_attempt = None;
                }
                Err(Failure::Unavailable(reason)) => {
                    log::debug(&format!("host unavailable: {reason}"));
                    self.next_attempt = Some(Instant::now() + RETRY_AFTER);
                    self.launcher.try_launch();
                }
                Err(Failure::VersionMismatch(server)) => {
                    log::warn(&format!(
                        "host speaks protocol {server}, this DLL speaks {PROTOCOL_VERSION}"
                    ));
                    self.next_attempt = Some(Instant::now() + RETRY_AFTER_VERSION_MISMATCH);
                }
            }
        }
        self.conn.as_mut()
    }

    /// A request that returns `None` when the host cannot be reached; a
    /// failed send drops the connection so the next key reconnects.
    pub fn request(&mut self, msg: &ClientMessage) -> Option<ServerMessage> {
        let conn = self.connection()?;
        match conn.request(msg) {
            Ok(reply) => Some(reply),
            Err(e) => {
                log::debug(&format!("request failed: {e}"));
                self.disconnect();
                None
            }
        }
    }

    pub fn disconnect(&mut self) {
        self.conn = None;
        self.next_attempt = None;
    }

    /// Says goodbye and closes.
    pub fn bye(&mut self) {
        let id = self.session_id;
        if let Some(conn) = self.conn.as_mut() {
            conn.notify(&ClientMessage::Bye { session_id: id });
        }
        self.conn = None;
    }

    fn connect(&self) -> Result<Connection, Failure> {
        let name = pipe_name(current_session_id());
        let file = open_pipe(&name).map_err(Failure::Unavailable)?;
        let mut conn = Connection {
            file,
            settings: InputSettings {
                scheme: Default::default(),
                page_size: 5,
                full_width_punctuation: true,
            },
        };
        let hello = ClientMessage::Hello {
            version: PROTOCOL_VERSION,
            kind: ClientKind::Ime,
            session_id: self.session_id,
            profile: self.profile,
            app_name: self.app_name.clone(),
            pid: std::process::id(),
        };
        match conn.request(&hello).map_err(Failure::Unavailable)? {
            ServerMessage::Welcome { settings, .. } => {
                conn.settings = settings;
                Ok(conn)
            }
            ServerMessage::Error {
                code: ErrorCode::VersionMismatch,
                server_version,
                ..
            } => Err(Failure::VersionMismatch(server_version)),
            other => Err(Failure::Unavailable(format!("unexpected reply to hello: {other:?}"))),
        }
    }
}

enum Failure {
    Unavailable(String),
    VersionMismatch(u32),
}

fn open_pipe(name: &str) -> Result<File, String> {
    let open = || {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(name)
    };
    match open() {
        Ok(f) => Ok(f),
        Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY.0 as i32) => {
            let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            // SAFETY: NUL-terminated name; a bounded wait.
            let _ = unsafe { WaitNamedPipeW(PCWSTR(wide.as_ptr()), BUSY_WAIT_MS) };
            open().map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn current_session_id() -> u32 {
    let mut id = 0u32;
    // SAFETY: valid out-pointer.
    let _ = unsafe { ProcessIdToSessionId(std::process::id(), &mut id) };
    id
}
