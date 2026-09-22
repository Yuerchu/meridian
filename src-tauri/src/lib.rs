#[macro_use]
mod command_table;

#[cfg(target_os = "android")]
mod android_bridge;
mod commands;
/// Meridian's side of the input method (the DLL and host are separate binaries).
#[cfg(windows)]
mod ime;
mod platform;
/// Serving another device. Desktop only: Android is the client here, never the
/// host.
#[cfg(not(target_os = "android"))]
mod remote;
/// When the launch screen goes away, and why it always does.
mod splash;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use meridian_core::services::Services;
use meridian_core::{bootstrap, events, logging};
#[cfg(desktop)]
use tauri::image::Image;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// The handle, for the one caller that cannot be given anything else.
///
/// `android_bridge` is called from Java, on a thread the app did not start and
/// with no state of its own to carry, so it has nowhere else to reach the app
/// from. Everything else takes `Services`. This is deliberately the only global,
/// and it lives in the shell because a handle is the one thing the core must
/// never know about.
pub(crate) static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Reaching the services from a handle.
///
/// The handle is a service locator and nothing else here, so this is the one
/// place that knows it — everything below takes `Services` and has no idea a
/// window exists. Cloning is one `Arc` bump.
pub(crate) trait ServicesExt {
    fn services(&self) -> Services;
}

impl ServicesExt for tauri::AppHandle {
    fn services(&self) -> Services {
        self.state::<Services>().inner().clone()
    }
}

/// The window, as somewhere an event can go.
///
/// Registered as critical, which is the whole of the desktop's rule: its events
/// *are* the answer, so a window that missed one is showing a transcript that
/// never catches up, and the turn that produced it fails rather than carrying on.
struct WindowSink(tauri::AppHandle);

impl events::EventSink for WindowSink {
    fn emit(&self, channel: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.0.emit(channel, payload).map_err(|e| e.to_string())
    }
}

/// The table, as Tauri's handler.
macro_rules! make_tauri_handler {
    ($($(#[$attr:meta])* $kind:ident $($module:ident)::+ => $name:ident ($($arg:ident : $ty:ty),* $(,)?)),* $(,)?) => {
        tauri::generate_handler![$($(#[$attr])* crate::$($module)::+::$name),*]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Two stages: the subscriber has to exist before Tauri starts, but the file
    // it writes to lives under a path only Tauri can resolve. Events in between
    // are buffered and flushed by `attach_file_sink`.
    logging::init_early();
    logging::install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            let data_dir = app.path().app_data_dir().expect("failed to resolve app data dir");

            // Registered before anything can emit, and critical: the desktop's
            // events are its answer, so a turn whose progress never reached the
            // window fails rather than carrying on talking to nobody.
            let events = events::EventBus::new();
            events.register(Arc::new(WindowSink(app.handle().clone())), true);

            let services = bootstrap::bootstrap(data_dir, events)
                .map_err(|error| std::io::Error::other(format!("bootstrap failed: {error}")))?;
            #[cfg(not(target_os = "android"))]
            let onebot_config = meridian_core::onebot::load_config(&services.db)
                .map_err(|error| std::io::Error::other(format!("invalid stored OneBot config: {error}")))?;
            #[cfg(not(target_os = "android"))]
            let hooks_config = meridian_core::hooks::load_config(&services.db)
                .map_err(|error| std::io::Error::other(format!("invalid stored hooks config: {error}")))?;
            #[cfg(not(target_os = "android"))]
            let remote_config = remote::load_config(&services.db)
                .map_err(|error| std::io::Error::other(format!("invalid stored remote config: {error}")))?;
            let notify_config = meridian_core::notify::load_config(&services.db)
                .map_err(|error| std::io::Error::other(format!("invalid stored notification config: {error}")))?;
            // The one thing core needs from up here: how to run a turn. The
            // prompt queue lives below the line and has to be able to start
            // one, and `commands::chat` is a Tauri command. Set before anything
            // can pump, which is anything a person does.
            let _ = services
                .turn_starter
                .set(Arc::new(commands::chat::DesktopTurns(services.clone())));
            app.manage(services.clone());

            {
                let services = services.clone();
                tauri::async_runtime::spawn(bootstrap::resume_completed_plan_review_queues(services));
            }

            #[cfg(target_os = "android")]
            {
                std::thread::spawn(|| meridian_core::android_bridge::clean_camera_cache());
            }

            // Registered even when the user has the server switched off, so the
            // IPC commands always have something to talk to.
            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(meridian_core::onebot::maybe_start(services, onebot_config).await);
                });
            }

            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(meridian_core::hooks::maybe_start(services, hooks_config).await);
                });
            }

            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(remote::maybe_start(services, remote_config, handle.clone()).await);
                });
            }

            // The input method's host belongs to the login session, not to this
            // window: it is started here if the DLL is registered and nothing is
            // serving the pipe yet, and never stopped on exit.
            #[cfg(windows)]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(ime::maybe_start(services, handle.clone()).await);
                });
            }

            // Registered even when the watcher is switched off, so the IPC
            // commands always have something to talk to — the same arrangement
            // the three listeners above use.
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(meridian_core::notify::maybe_start(services, notify_config).await);
                });
            }

            {
                let services = services.clone();
                tauri::async_runtime::spawn(bootstrap::reconnect_mcp(services));
            }

            // Settle the containers an earlier run left: remove the ones whose
            // conversation no longer exists, stop the ones still counting on
            // their writable layer. This is the path that covers a crash, which
            // the exit hook below never sees.
            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                tauri::async_runtime::spawn(async move {
                    let pool = services.db.clone();
                    let live = tokio::task::spawn_blocking(move || {
                        let mut conn = pool.get().map_err(|e| e.to_string())?;
                        meridian_core::db::ops::conversation::all_ids(&mut conn).map_err(|e| e.to_string())
                    })
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()));
                    match live {
                        Ok(live) => {
                            services.containers.reconcile(&live).await;
                        }
                        // Reconciling against an unknown set would read as "no
                        // conversations exist" and remove every container.
                        Err(e) => {
                            tracing::warn!(error = %e, "skipped container reconcile; could not list conversations")
                        }
                    }
                });
            }

            // Last thing in setup, so the deadline starts counting from the
            // moment the app could conceivably be shown.
            splash::arm(app.handle());

            #[cfg(desktop)]
            {
                let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = MenuBuilder::new(app).item(&show_i).separator().item(&quit_i).build()?;

                TrayIconBuilder::with_id("main-tray")
                    .icon(Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
                    .tooltip("Meridian")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    let handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(with_all_commands!(make_tauri_handler))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            // The only place in the app that has to finish async work before the
            // process goes away. MCP servers and hosted ACP adapters are child
            // processes: without this they outlive every quit and pile up across
            // restarts. `kill_on_drop` does not cover it — `handle.exit` runs no
            // destructors.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // A restart is the one exit that cannot be deferred:
                // `prevent_exit` ignores this code outright (tauri's
                // `app.rs`), so the process is replaced as soon as this
                // callback returns and the async path below never runs. That
                // leaves nowhere to await, and returning without doing anything
                // — which is what this did — hands the restart a set of live
                // adapters that nothing will ever close again.
                //
                // So the cleanup happens here instead, synchronously, before
                // the restart proceeds.
                if *code == Some(RESTART_EXIT_CODE) {
                    #[cfg(not(target_os = "android"))]
                    stop_adapters_blocking(handle);
                    return;
                }
                // A second pass would be re-entering a shutdown already under
                // way — `handle.exit` below raises this event again.
                if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
                    return;
                }
                api.prevent_exit();
                let handle = handle.clone();
                let code = code.unwrap_or(0);
                tauri::async_runtime::spawn(async move {
                    let services = handle.state::<Services>();
                    services.mcp.shutdown_all(MCP_SHUTDOWN_BUDGET).await;
                    // Bounded for the same reason the MCP budget is: an adapter
                    // that will not die must not hold the window open after the
                    // user has asked it to close. The child is killed rather
                    // than asked politely, so this is a formality that only
                    // matters if the OS is slow to reap.
                    #[cfg(not(target_os = "android"))]
                    {
                        let acp = services.acp.clone();
                        if tokio::time::timeout(ACP_SHUTDOWN_BUDGET, acp.close_all())
                            .await
                            .is_err()
                        {
                            tracing::warn!("gave up waiting for the ACP adapters to stop");
                        }
                    }
                    // Stopped, not removed: the writable layer is what the next
                    // launch resumes. Bounded like the rest, because a daemon
                    // that stopped answering must not hold the window open.
                    #[cfg(not(target_os = "android"))]
                    {
                        let containers = services.containers.clone();
                        if tokio::time::timeout(CONTAINER_SHUTDOWN_BUDGET, containers.stop_owned())
                            .await
                            .is_err()
                        {
                            tracing::warn!("gave up waiting for the command containers to stop");
                        }
                    }
                    handle.exit(code);
                });
            }
        });
}

/// Tauri's own restart code. Preventing that exit would turn a restart into a
/// hang.
const RESTART_EXIT_CODE: i32 = tauri::RESTART_EXIT_CODE;

/// How long the whole MCP shutdown gets. Each HTTP transport is allowed a five
/// second DELETE of its own, so without a ceiling a handful of them would hold
/// the window open long after the user asked it to close.
const MCP_SHUTDOWN_BUDGET: std::time::Duration = std::time::Duration::from_secs(3);

/// The same, for hosted ACP adapters. Shorter because there is no graceful
/// handshake to wait out — the child is killed and this only covers the wait
/// for it to actually be gone.
#[cfg(not(target_os = "android"))]
const ACP_SHUTDOWN_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);

/// And for stopping command containers on the way out. Each `docker stop` gets
/// one second of grace inside (`-t 1`, the only thing between commands is
/// `sleep`), so this covers a few containers plus a slow daemon — and a daemon
/// that answers nothing at all is the startup reconcile's problem, not the
/// closing window's.
#[cfg(not(target_os = "android"))]
const CONTAINER_SHUTDOWN_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

/// Stop the hosted adapters from a caller that cannot await.
///
/// Only the restart path needs this. Every other exit prevents itself, does the
/// work on the async runtime and *then* exits; a restart cannot be prevented, so
/// the choice is between blocking here and leaking the children. Blocking wins:
/// the window is going away either way, and `std::process::exit` runs no
/// destructors, so `kill_on_drop` will not collect them afterwards.
///
/// Waits on a plain channel rather than `block_on`. This runs on the event-loop
/// thread, and `block_on` panics if it is ever called from inside the runtime —
/// a condition that depends on how the host set the runtime up rather than on
/// anything visible here. Handing the work to the runtime and blocking on a
/// `std` channel cannot be wrong either way.
///
/// MCP servers have the identical gap on this path and are deliberately left
/// alone: that shutdown is a protocol conversation with a five-second budget of
/// its own, which is a different decision from killing a child, and it was not
/// this change's to make.
#[cfg(not(target_os = "android"))]
fn stop_adapters_blocking(handle: &tauri::AppHandle) {
    let acp = handle.state::<Services>().acp.clone();
    let (done, wait) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(ACP_SHUTDOWN_BUDGET, acp.close_all()).await;
        let _ = done.send(());
    });
    // Slightly longer than the budget the work itself is under, so the inner
    // timeout is what normally ends this and the outer one only covers a
    // runtime that never got to the task at all.
    if wait.recv_timeout(ACP_SHUTDOWN_BUDGET + RESTART_GRACE).is_err() {
        tracing::warn!("gave up waiting for the ACP adapters to stop before a restart");
    }
}

/// How much longer than its own budget the restart path waits, before deciding
/// the runtime is not going to get to the task.
#[cfg(not(target_os = "android"))]
const RESTART_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

/// Guards against re-entering shutdown: `handle.exit` raises `ExitRequested`
/// again, and without this the second pass would prevent its own exit.
static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Called from MainActivity.onCreate to initialize ndk-context and
/// android-keyring before any Rust code touches the Android keystore.
/// Tauri itself does NOT initialize ndk-context; this JNI entry is required.
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_initNdkContext(
    env: jni::JNIEnv,
    _class: jni::objects::JObject,
    context: jni::objects::JObject,
) {
    use jni::objects::GlobalRef;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    static REF: OnceLock<Option<GlobalRef>> = OnceLock::new();
    REF.get_or_init(|| match env.new_global_ref(&context) {
        Ok(ref_) => {
            let vm = env.get_java_vm().unwrap();
            let vm = vm.get_java_vm_pointer() as *mut c_void;
            unsafe {
                ndk_context::initialize_android_context(vm, ref_.as_obj().as_raw() as _);
            }
            android_keyring::set_android_keyring_credential_builder();
            Some(ref_)
        }
        Err(_) => None,
    });
}
