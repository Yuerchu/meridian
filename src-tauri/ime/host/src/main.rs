//! Meridian 输入法宿主进程。
//!
//! One per login session. Holds the engine and the learner, listens on a
//! named pipe for the text service in every application, draws the candidate
//! window, and keeps running whether or not Meridian is. It has no dependency
//! on Tauri or on meridian-core: everything it needs is under the data
//! directory, and it computes that directory itself.
//!
//! Threads: one accepts pipe connections; one per connection reads frames and
//! forwards them; the main thread owns the [`Router`] and answers them in
//! order; one draws the window. Nothing is shared under a lock except the
//! channels between them.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod ipc;
#[cfg(windows)]
mod ui;

fn main() {
    #[cfg(not(windows))]
    {
        eprintln!("meridian-ime-host 只在 Windows 上运行");
        std::process::exit(2);
    }
    #[cfg(windows)]
    {
        let code = app::run(std::env::args().skip(1).collect());
        std::process::exit(code);
    }
}
