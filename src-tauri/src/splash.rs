//! When the launch screen goes away.
//!
//! Two things have to happen before the main window is worth showing: the
//! splash's animation has to finish, and the app behind it has to be ready.
//! Neither implies the other — on a warm start the app is ready long before
//! 1.8s of animation is up, and on a cold one with a large conversation the
//! animation finishes first.
//!
//! **The timeout is not a nicety.** Either signal can fail to arrive: the
//! frontend can throw before it mounts, the splash's webview can fail to load
//! its script, a future refactor can drop a call. Every one of those leaves the
//! main window hidden behind a splash that never closes — which the user reads
//! as the app not starting at all, not as a slow launch. So the deadline
//! finishes the sequence regardless, and both signals are only ever able to
//! make it happen *sooner*.
//!
//! This is the mirror image of the hook gates, which let an action through when
//! they are unsure. Here the uncertain outcome is "show the window anyway", and
//! it is the same instinct: the failure mode that locks the user out is always
//! the worse one.
//!
//! ## There is no splash on Android, and the reason is not cosmetic
//!
//! Multiple windows are a desktop feature. A mobile Tauri app is one Activity
//! with one webview, so the second entry in `app.windows` does not give the
//! phone a launch screen — but `"visible": false` on the *first* entry is
//! honoured, which left the app with its only window hidden and nothing on the
//! way to show it. That is why `tauri.android.conf.json` replaces the whole
//! `windows` array with a single visible `main`: the array is substituted
//! wholesale by the platform overlay, not merged element by element, so the
//! splash entry and the hidden flag both disappear together.
//!
//! What remains of this module on Android is the early return in [`arm`],
//! which finds no splash window and lets the app through immediately. Android's
//! own launch screen is the system's, drawn from the theme before any of this
//! runs.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

pub const SPLASH_LABEL: &str = "splashscreen";
pub const MAIN_LABEL: &str = "main";

/// Long enough that neither signal is cut off on a slow cold start, short
/// enough that a launch which has gone wrong still produces a window. Measured
/// against the animation's 1.8s plus room for a first-run migration.
const DEADLINE: Duration = Duration::from_secs(8);

#[derive(Default)]
struct State {
    animation_done: bool,
    app_ready: bool,
    finished: bool,
}

static STATE: Mutex<State> = Mutex::new(State {
    animation_done: false,
    app_ready: false,
    finished: false,
});

/// Show the main window and close the splash. Safe to call repeatedly.
fn finish(app: &AppHandle) {
    {
        // A poisoned lock here would mean giving up on ever showing the window,
        // so take the state either way.
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if state.finished {
            return;
        }
        state.finished = true;
    }

    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    // Closed after the main window is up: the other order leaves a frame with
    // nothing on screen, which reads as a flicker.
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        let _ = splash.close();
    }
}

fn signal(app: &AppHandle, set: impl FnOnce(&mut State)) {
    let ready = {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        set(&mut state);
        state.animation_done && state.app_ready
    };
    if ready {
        finish(app);
    }
}

/// Called by the splash window once its animation has played out.
#[tauri::command]
pub fn splash_animation_done(app: AppHandle) {
    signal(&app, |s| s.animation_done = true);
}

/// Called by the app once it has mounted.
#[tauri::command]
pub fn splash_app_ready(app: AppHandle) {
    signal(&app, |s| s.app_ready = true);
}

/// Arm the deadline. Called once from `setup`.
pub fn arm(app: &AppHandle) {
    // Nothing to wait for if the window was never created — a build or config
    // without a splash must not leave the main window hidden.
    if app.get_webview_window(SPLASH_LABEL).is_none() {
        finish(app);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DEADLINE).await;
        finish(&app);
    });
}
