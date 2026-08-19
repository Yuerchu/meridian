#[macro_use]
mod command_table;

#[cfg(target_os = "android")]
mod android_bridge;
mod commands;
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

            let services = bootstrap::bootstrap(data_dir, events);
            app.manage(services.clone());

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
                    handle.manage(meridian_core::onebot::maybe_start(services).await);
                });
            }

            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(meridian_core::hooks::maybe_start(services).await);
                });
            }

            #[cfg(not(target_os = "android"))]
            {
                let services = services.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.manage(remote::maybe_start(services, handle.clone()).await);
                });
            }

            {
                let services = services.clone();
                tauri::async_runtime::spawn(bootstrap::reconnect_mcp(services));
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
            // process goes away. MCP servers are child processes: without this
            // they outlive every quit and pile up across restarts.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // RESTART_EXIT_CODE cannot be prevented, and a second pass would
                // be re-entering a shutdown already under way.
                if *code == Some(RESTART_EXIT_CODE) || SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
                    return;
                }
                api.prevent_exit();
                let handle = handle.clone();
                let code = code.unwrap_or(0);
                tauri::async_runtime::spawn(async move {
                    handle.state::<Services>().mcp.shutdown_all(MCP_SHUTDOWN_BUDGET).await;
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
