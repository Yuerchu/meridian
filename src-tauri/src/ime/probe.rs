//! A control client on the host's pipe: status, reload, shutdown.
//!
//! Blocking, and meant to be called from `spawn_blocking`: the pipe answers
//! in microseconds when the host is there and fails at once when it is not.

use std::fs::File;
use std::os::windows::fs::OpenOptionsExt;

use meridian_ime_proto::{ClientKind, ClientMessage, PROTOCOL_VERSION, Profile, ServerMessage, pipe_name};
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;

/// What `Status` said.
#[derive(Debug, Clone)]
pub struct HostStatus {
    pub version: String,
    pub protocol: u32,
    pub sessions: u32,
}

fn session_id() -> u32 {
    let mut id = 0u32;
    // SAFETY: valid out-pointer.
    let _ = unsafe { ProcessIdToSessionId(std::process::id(), &mut id) };
    id
}

fn open() -> Option<File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(pipe_name(session_id()))
        .ok()
}

fn hello() -> ClientMessage {
    ClientMessage::Hello {
        version: PROTOCOL_VERSION,
        kind: ClientKind::Control,
        session_id: 0,
        profile: Profile::PinyinSimplified,
        app_name: Some("meridian.exe".into()),
        pid: std::process::id(),
    }
}

fn request(file: &mut File, msg: &ClientMessage) -> Option<ServerMessage> {
    meridian_ime_proto::write_message(file, msg).ok()?;
    meridian_ime_proto::read_message(file).ok().flatten()
}

/// `None` when nothing answers the pipe or the host speaks another protocol.
pub fn status() -> Option<HostStatus> {
    let mut file = open()?;
    match request(&mut file, &hello())? {
        ServerMessage::Status {
            version,
            protocol,
            sessions,
            ..
        } => Some(HostStatus {
            version,
            protocol,
            sessions,
        }),
        ServerMessage::Error { server_version, .. } => Some(HostStatus {
            version: String::new(),
            protocol: server_version,
            sessions: 0,
        }),
        _ => None,
    }
}

/// Tells a running host that the dictionaries changed. No host is not an error.
pub fn reload_dictionaries() {
    if let Some(mut file) = open() {
        let _ = request(&mut file, &hello());
        let _ = request(&mut file, &ClientMessage::ReloadDictionaries);
    }
}

/// Asks the host to exit. `true` when it acknowledged.
pub fn shutdown() -> bool {
    let Some(mut file) = open() else { return false };
    let _ = request(&mut file, &hello());
    matches!(request(&mut file, &ClientMessage::Shutdown), Some(ServerMessage::Ack))
}
