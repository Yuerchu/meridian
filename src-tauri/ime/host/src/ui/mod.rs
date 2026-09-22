//! The candidate window, on a thread of its own.
//!
//! Windows ties an `HWND` to the thread that created it, so the window lives
//! on one thread with a message loop and everybody else talks to it through
//! [`UiHandle`]: a channel for the payload and `PostThreadMessageW` to wake
//! the loop. The router never touches an `HWND`.

mod window;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};

use meridian_ime_proto::{Frame, Rect};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};
use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};

const WM_UI_COMMAND: u32 = WM_APP + 1;

pub enum UiCommand {
    Show { frame: Frame, rect: Option<Rect> },
    Hide,
    Quit,
}

/// The other threads' end of the window.
pub struct UiHandle {
    tx: Sender<UiCommand>,
    thread_id: Arc<AtomicU32>,
    quit_requested: Arc<AtomicBool>,
}

impl UiHandle {
    /// Spawns the window thread and returns once it has a message queue.
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel();
        let thread_id = Arc::new(AtomicU32::new(0));
        let quit_requested = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<()>();
        {
            let thread_id = thread_id.clone();
            let quit_requested = quit_requested.clone();
            std::thread::Builder::new()
                .name("ui".into())
                .spawn(move || window::run(rx, thread_id, quit_requested, ready_tx))
                .expect("spawn ui thread");
        }
        let _ = ready_rx.recv();
        Self {
            tx,
            thread_id,
            quit_requested,
        }
    }

    pub fn show(&self, frame: Frame, rect: Option<Rect>) {
        self.send(UiCommand::Show { frame, rect });
    }

    pub fn hide(&self) {
        self.send(UiCommand::Hide);
    }

    pub fn quit(&self) {
        self.send(UiCommand::Quit);
    }

    /// The window thread got a session-end message; the host should exit.
    pub fn wants_quit(&self) -> bool {
        self.quit_requested.load(Ordering::Relaxed)
    }

    fn send(&self, cmd: UiCommand) {
        if self.tx.send(cmd).is_err() {
            return;
        }
        let tid = self.thread_id.load(Ordering::Relaxed);
        if tid != 0 {
            // SAFETY: posting a message to a thread id we own; failure (the
            // thread is gone) is ignored.
            unsafe {
                let _ = PostThreadMessageW(tid, WM_UI_COMMAND, WPARAM(0), LPARAM(0));
            }
        }
    }
}

/// Per-monitor DPI awareness for the whole process, before any window exists.
pub fn set_process_dpi_awareness() {
    // SAFETY: a process-wide setting with no pointer arguments.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

pub(crate) fn drain(rx: &Receiver<UiCommand>) -> Vec<UiCommand> {
    let mut out = Vec::new();
    while let Ok(c) = rx.try_recv() {
        out.push(c);
    }
    out
}
