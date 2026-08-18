pub mod agent;
/// The JNI calls the core makes into the Android side. The `Java_*` entry
/// points Android calls back into stay in the shell, beside the activity that
/// declares them.
#[cfg(target_os = "android")]
pub mod android_bridge;
pub mod bootstrap;
pub mod client;
pub mod db;
pub mod emoji;
pub mod events;
pub mod files;
/// The endpoint another coding agent's hooks call into. Desktop only: it is a
/// listening socket, and Android has nothing to point at it.
#[cfg(not(target_os = "android"))]
pub mod hooks;
pub mod keyring;
pub mod listen_guard;
pub mod logging;
pub mod mcp;
#[cfg(not(target_os = "android"))]
pub mod onebot;
pub mod provider;
#[cfg(not(target_os = "android"))]
pub mod sandbox;
pub mod secrets;
pub mod services;
pub mod sleep_inhibitor;
pub mod state;
pub mod template;
pub mod tools;
pub mod turn;
pub mod util;
pub mod voice;
