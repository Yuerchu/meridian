//! The input method on Android: the engine inside the keyboard's process.
//!
//! On Windows the engine lives in a host process and every application's
//! text service talks to it over a pipe, because a text service is loaded
//! into other people's processes. An Android keyboard is a service in its own
//! process (`:ime`), so there is nothing to talk to: [`ImeHost`] is one
//! [`Session`](meridian_ime_session::Session) with the same engine, learner,
//! scorer and hints the Windows host builds — read by the same
//! `meridian_ime_host::data` — driven by direct calls. One keyboard types into
//! one field at a time, so there is no router.
//!
//! [`ImeHost`] knows nothing about Android and is tested on the desktop. The
//! JNI surface the Kotlin keyboard calls is `jni`, compiled for Android only.

pub mod bridge;
#[cfg(test)]
mod fixtures;
mod host;
#[cfg(target_os = "android")]
mod jni;
mod tokens;

pub use host::{ImeHost, hints_allowed};
pub use tokens::grid_tokens_json;
