//! The wire between the TSF text service (in every application process) and
//! the host (one per login session).
//!
//! Framing is a four-byte little-endian length followed by JSON. Every
//! `ClientMessage` has exactly one reply, so the text service can be a plain
//! blocking client on the application's UI thread. The structures carry no
//! `deny_unknown_fields`: an application that loaded last month's DLL keeps
//! talking to a newer host, and a message shape a peer does not understand is
//! answered by [`ServerMessage::Error`] rather than a parse failure. Adding a
//! variant is a compatible change; changing the meaning of one is what
//! [`PROTOCOL_VERSION`] is for — a text service whose `Hello` is refused
//! passes every key through and tries again later, never guessing.

pub mod codec;
mod messages;

pub use codec::{CodecError, MAX_FRAME, read_message, write_message};
pub use messages::*;

/// Bumped when a message changes meaning. A mismatch ends the conversation at
/// `Hello`.
///
/// 2: `Scheme::Grid`. Adding an enum value is not a compatible change here —
/// `Scheme` has no catch-all variant, so an older DLL fails to parse the
/// `Welcome` that names it rather than quietly typing pinyin.
pub const PROTOCOL_VERSION: u32 = 2;

/// The named pipe the host listens on, per Windows login session so a remote
/// desktop session and a fast-switched second user each get their own host.
/// Both ends compute it from `ProcessIdToSessionId` on their own pid.
pub fn pipe_name(session_id: u32) -> String {
    format!(r"\\.\pipe\meridian-ime-s{session_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipe_name_is_per_session() {
        assert_eq!(pipe_name(1), r"\\.\pipe\meridian-ime-s1");
        assert_ne!(pipe_name(1), pipe_name(2));
    }
}

/// The identifiers the text service registers under. They live here, in the
/// contract crate, because the DLL registers them and Meridian's settings
/// page looks them up; two copies would be two copies of a GUID.
pub mod ids {
    /// The text service's COM class.
    pub const CLSID: u128 = 0xE3D669E0_5381_4735_B334_F5620824047C;
    /// Registry spelling of [`CLSID`]: braces, uppercase.
    pub const CLSID_STR: &str = "{E3D669E0-5381-4735-B334-F5620824047C}";
    /// The zh-CN profile (pinyin).
    pub const PROFILE_PINYIN: u128 = 0x6C314C90_0F7A_4AC0_B092_9E12F3E84C05;
    /// The zh-TW profile (zhuyin).
    pub const PROFILE_ZHUYIN: u128 = 0xD4DE7406_D5C2_4020_BB1D_0DE677D559A2;
    /// The display attribute the composition is drawn with.
    pub const DISPLAY_ATTR_INPUT: u128 = 0xBAF8D134_7026_41CB_B16F_39F8ED64CCDB;
    pub const LANGID_ZH_CN: u16 = 0x0804;
    pub const LANGID_ZH_TW: u16 = 0x0404;
    pub const DISPLAY_NAME_PINYIN: &str = "Meridian 输入法";
    pub const DISPLAY_NAME_ZHUYIN: &str = "Meridian 輸入法（注音）";
    /// The icon file the installer places beside the DLL.
    pub const ICON_FILE_NAME: &str = "meridian-ime.ico";
    /// The host executable, beside the DLL.
    pub const HOST_EXE_NAME: &str = "meridian-ime-host.exe";
}
