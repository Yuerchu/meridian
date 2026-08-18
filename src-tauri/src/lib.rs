#[cfg(target_os = "android")]
mod android_bridge;
mod commands;
mod platform;

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

            {
                let services = services.clone();
                tauri::async_runtime::spawn(bootstrap::reconnect_mcp(services));
            }

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
        .invoke_handler(tauri::generate_handler![
            commands::chat::chat,
            commands::chat::stop_chat,
            commands::secret::set_secret,
            commands::secret::get_secret,
            commands::secret::delete_secret,
            commands::conversation::list_conversations,
            commands::conversation::create_conversation,
            commands::conversation::update_conversation_title,
            commands::conversation::set_conversation_assistant,
            commands::conversation::set_conversation_reasoning_prefs,
            commands::conversation::toggle_pin_conversation,
            commands::conversation::delete_conversation,
            commands::conversation::compact,
            commands::conversation::get_context_info,
            commands::message::conversation_snapshot,
            commands::message::switch_branch,
            commands::message::delete_message,
            commands::message::rate_message,
            commands::message::export_conversation,
            commands::message::upload_file,
            commands::assistant::list_assistants,
            commands::assistant::create_assistant,
            commands::assistant::update_assistant,
            commands::assistant::delete_assistant,
            commands::provider::list_providers,
            commands::provider::create_provider,
            commands::provider::update_provider,
            commands::provider::delete_provider,
            commands::provider::set_provider_key,
            commands::provider::get_provider_key_exists,
            commands::provider::fetch_provider_models,
            commands::provider::get_provider_capabilities,
            commands::model_config::list_model_configs,
            commands::model_config::get_model_config,
            commands::model_config::save_model_config,
            commands::model_config::delete_model_config,
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::conversation::list_conversations_by_project,
            commands::memory::list_memories,
            commands::memory::save_memory,
            commands::memory::save_memory_scoped,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::todo::get_active_todo_list,
            commands::conversation::set_conversation_mode,
            commands::conversation::set_conversation_accept_edits,
            commands::memory::delete_memories,
            commands::memory::list_all_memories,
            commands::memory::list_memory_subjects,
            commands::memory::forget_memory_subject,
            commands::memory::set_memory_subject_flags,
            commands::memory::list_memory_trash,
            commands::memory::restore_memories,
            commands::memory::purge_memories,
            commands::memory::memory_enums,
            commands::usage::usage_report,
            commands::preference::get_preference,
            commands::preference::set_preference,
            commands::mcp::list_mcp_servers,
            commands::mcp::create_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::connect_mcp_server,
            commands::mcp::disconnect_mcp_server,
            commands::mcp::list_mcp_tools,
            commands::mcp::list_mcp_connection_statuses,
            commands::mcp::list_all_tool_names,
            commands::approval::approve_tool_call,
            commands::approval::deny_tool_call,
            commands::approval::respond_to_ask,
            commands::sub_agent::steer_conversation,
            platform::get_platform,
            platform::get_window_insets,
            platform::get_manage_storage_status,
            platform::request_manage_storage,
            platform::pick_saf_directory,
            platform::list_saf_roots,
            platform::remove_saf_root,
            platform::take_photo,
            platform::pick_gallery_image,
            platform::resolve_file_name,
            #[cfg(not(target_os = "android"))]
            commands::onebot::get_onebot_status,
            #[cfg(not(target_os = "android"))]
            commands::onebot::get_onebot_config,
            #[cfg(not(target_os = "android"))]
            commands::onebot::save_onebot_config,
            #[cfg(not(target_os = "android"))]
            commands::onebot::start_onebot,
            #[cfg(not(target_os = "android"))]
            commands::onebot::stop_onebot,
            #[cfg(not(target_os = "android"))]
            commands::hooks::get_hooks_status,
            #[cfg(not(target_os = "android"))]
            commands::hooks::get_hooks_config,
            #[cfg(not(target_os = "android"))]
            commands::hooks::save_hooks_config,
            #[cfg(not(target_os = "android"))]
            commands::hooks::regenerate_hooks_token,
            #[cfg(not(target_os = "android"))]
            commands::hooks::start_hooks,
            #[cfg(not(target_os = "android"))]
            commands::hooks::stop_hooks,
            commands::dev::voice_probe_echo,
            // Model management and prewarming are the same on both platforms.
            commands::voice::voice_prewarm,
            commands::voice::voice_model_status,
            commands::voice::voice_download_model,
            commands::voice::voice_cancel_download,
            commands::voice::voice_import_model,
            commands::voice::voice_delete_model,
            // Capture lives in Rust only on the desktop. Android records in the
            // WebView, so these have no caller there and are left unregistered
            // rather than answering with an error nobody would ask for.
            #[cfg(not(target_os = "android"))]
            commands::voice::voice_release_prewarm,
            #[cfg(not(target_os = "android"))]
            commands::voice::voice_start_recording,
            #[cfg(not(target_os = "android"))]
            commands::voice::voice_stop_and_transcribe,
            #[cfg(not(target_os = "android"))]
            commands::voice::voice_cancel_recording,
            #[cfg(target_os = "android")]
            commands::voice::voice_transcribe_pcm,
            commands::prompt_template::list_prompt_templates,
            commands::prompt_template::create_prompt_template,
            commands::prompt_template::update_prompt_template,
            commands::prompt_template::delete_prompt_template,
            commands::prompt_template::list_template_variables,
            commands::skill::list_skills,
            commands::skill::rescan_skills,
            commands::skill::get_skill_body,
            commands::skill::create_skill,
            commands::skill::update_skill,
            commands::skill::delete_skill,
            commands::skill::list_skill_bindings,
            commands::skill::set_skill_binding,
            commands::logs::read_logs,
            commands::logs::list_log_files,
            commands::logs::get_log_settings,
            commands::logs::set_log_level,
            commands::logs::export_logs,
            commands::emoji::list_emoji_packs,
            commands::emoji::create_emoji_pack,
            commands::emoji::delete_emoji_pack,
            commands::emoji::list_emojis,
            commands::emoji::import_emojis,
            commands::emoji::delete_emoji,
            commands::emoji::rename_emoji,
            commands::emoji::search_emojis,
            commands::emoji::assign_emoji_pack,
            commands::emoji::unassign_emoji_pack,
            commands::emoji::list_assistant_emoji_packs,
            commands::emoji::get_emoji_file_url,
            commands::tool_system::list_tool_categories,
            commands::tool_system::list_custom_tools,
            commands::tool_system::create_custom_tool,
            commands::tool_system::update_custom_tool,
            commands::tool_system::delete_custom_tool,
            commands::tool_system::list_tool_presets,
            commands::tool_system::create_tool_preset,
            commands::tool_system::update_tool_preset,
            commands::tool_system::delete_tool_preset,
            commands::tool_system::set_service_key,
            commands::tool_system::get_service_key_exists,
        ])
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
