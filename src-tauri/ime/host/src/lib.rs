//! What both input method hosts share: the Windows host process in this
//! package's binary, and the Android keyboard (`meridian-ime-android`), which
//! runs the same session machinery inside the keyboard's own process.
//!
//! [`data`] turns a data directory into an engine, a learner, a scorer and
//! hints; [`logging`] is the host log. Neither knows about a platform. The
//! pipe, the candidate window and the message loop are Windows-only and live
//! in the binary.

pub mod data;
pub mod logging;
