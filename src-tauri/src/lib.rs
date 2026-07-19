#[cfg(target_os = "android")]
mod android_bridge;
mod client;
mod db;
mod edit_session;
mod emoji;
mod files;
mod keyring;
mod mcp;
#[cfg(not(target_os = "android"))]
mod onebot;
mod platform;
mod provider;
#[cfg(not(target_os = "android"))]
mod sandbox;
mod secrets;
mod template;
mod tools;
mod util;
mod state;
mod agent;
mod commands;

use std::collections::HashMap;
use std::sync::Arc;

use db::models::assistant::{AssistantUpdate, NewAssistant};
use db::models::tool_category::NewToolCategory;
use db::models::tool_preset::NewToolPreset;
use db::models::prompt_template::NewPromptTemplate;
use db::models::provider::NewProvider;
use secrets::{SecretName, SecretScope, SecretsManager};
use tauri::Manager;
#[cfg(desktop)]
use tauri::image::Image;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tokio::sync::Mutex;
use util::now_ms;
use state::{AppSecrets, AppDb, AppTools, AppMcp, APP_HANDLE, ApprovalWaiters, ActiveChats, EditSessions};
use agent::provider_secret_name;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
            let mgr = Arc::new(SecretsManager::new(data_dir.clone()));
            app.manage(AppSecrets(mgr.clone()));

            let db_path = data_dir.join("meridian.db");
            let pool = db::init_db(db_path.to_str().expect("invalid db path"));

            // Create default assistant on first run
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::assistant::get_default_assistant(&mut conn)
                    .ok().flatten().is_none()
                {
                    let id = uuid::Uuid::new_v4().to_string();
                    let now = now_ms();
                    let _ = db::ops::assistant::create_assistant(&mut conn, &NewAssistant {
                        id: &id,
                        name: "Default",
                        description: None,
                        avatar: None,
                        system_prompt: "You are a helpful assistant.",
                        provider_id: None,
                        model_id: None,
                        temperature: None,
                        top_p: None,
                        max_tokens: None,
                        is_default: 1,
                        sort_order: 0,
                        created_at: now,
                        updated_at: now,
                        context_limit: 128000,
                        compact_keep_recent: 10,
                        enabled_tools: None,
                        thinking_enabled: 0,
                        thinking_budget: None,
                        tool_preset_id: None,
                        auto_compact_enabled: 0,
                    });
                }
            }

            // Migrate legacy secrets-based provider to DB
            {
                let mut conn = pool.get().expect("db connection");
                let count = db::ops::provider::count_providers(&mut conn).unwrap_or(0);
                if count == 0 {
                    if let Some(api_key) = mgr
                        .get(&SecretScope::Global, &SecretName::new("API_KEY").unwrap())
                        .ok()
                        .flatten()
                    {
                        let provider_type = mgr
                            .get(&SecretScope::Global, &SecretName::new("PROVIDER_TYPE").unwrap())
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "openai".into());
                        let base_url = mgr
                            .get(&SecretScope::Global, &SecretName::new("API_BASE").unwrap())
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "https://api.openai.com/v1".into());
                        let model = mgr
                            .get(&SecretScope::Global, &SecretName::new("MODEL").unwrap())
                            .ok()
                            .flatten();

                        let pid = uuid::Uuid::new_v4().to_string();
                        let now = now_ms();
                        if let Ok(provider) = db::ops::provider::create_provider(
                            &mut conn,
                            &NewProvider {
                                id: &pid,
                                name: "Default",
                                provider_type: &provider_type,
                                base_url: &base_url,
                                is_enabled: 1,
                                sort_order: 0,
                                created_at: now,
                                updated_at: now,
                                api_format: "chat_completions",
                            },
                        ) {
                            let key_name = provider_secret_name(&provider.id);
                            let _ = mgr.set(
                                &SecretScope::Global,
                                &SecretName::new(&key_name).unwrap(),
                                &api_key,
                            );
                            // Link default assistant to this provider
                            if let Ok(Some(default_assistant)) =
                                db::ops::assistant::get_default_assistant(&mut conn)
                            {
                                let changeset = AssistantUpdate {
                                    provider_id: Some(Some(provider.id.clone())),
                                    model_id: model.map(Some),
                                    updated_at: Some(now),
                                    ..Default::default()
                                };
                                let _ = db::ops::assistant::update_assistant(
                                    &mut conn,
                                    &default_assistant.id,
                                    &changeset,
                                );
                            }
                        }
                    }
                }
            }

            // Seed built-in prompt templates on first run
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::prompt_template::count_templates(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let templates = [
                        ("casual_friend", "Casual Friend", "随意朋友", "character", "You are {{assistant_name}}, a casual and friendly chat partner. Talk naturally, use slang, emoji, and informal language. Be playful and genuine. The current time is {{current_time}} on {{current_date}} ({{day_of_week}}).\n\n{{chat_style_hint}}\n\nExample of segmented response:\nwhat\n---\nno way lol\n---\n[emoji:shocked]"),
                        ("professional", "Professional Assistant", "专业助手", "character", "You are {{assistant_name}}, a professional and knowledgeable assistant. Respond in a structured, clear, and formal manner. Provide thorough and accurate answers. Current date: {{current_date}}."),
                        ("code_expert", "Code Expert", "代码专家", "coding", "You are {{assistant_name}}, an expert software engineer. Write clean, efficient, and well-documented code. Explain technical concepts clearly. Use code blocks with language tags. Current date: {{current_date}}."),
                        ("creative_writer", "Creative Writer", "创意写手", "character", "You are {{assistant_name}}, a creative and expressive writer. Use vivid language, metaphors, and storytelling techniques. Be imaginative and emotionally engaging."),
                        ("study_buddy", "Study Buddy", "学习伙伴", "character", "You are {{assistant_name}}, a patient and encouraging study partner for {{user_name}}. Break down complex topics into simple explanations. Use analogies and examples. Ask follow-up questions to check understanding. Current date: {{current_date}}."),
                    ];
                    for (i, (id_suffix, name, desc, category, text)) in templates.iter().enumerate() {
                        let id = format!("builtin_{id_suffix}");
                        let _ = db::ops::prompt_template::create_template(&mut conn, &NewPromptTemplate {
                            id: &id,
                            name,
                            description: Some(desc),
                            category,
                            template_text: text,
                            is_builtin: 1,
                            sort_order: i as i32,
                            created_at: now,
                            updated_at: now,
                        });
                    }
                }
            }

            // Seed built-in tool categories and presets
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::tool_category::count_categories(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let cats = [
                        ("cat_interaction", "Interaction", "User interaction tools", 0),
                        ("cat_filesystem", "Filesystem", "File and directory operations", 1),
                        ("cat_system", "System", "System and shell commands", 2),
                        ("cat_coding", "Coding", "Code analysis and editing", 3),
                    ];
                    for (id, name, desc, order) in &cats {
                        let _ = db::ops::tool_category::create_category(&mut conn, &NewToolCategory {
                            id, name, description: Some(desc), icon: None, sort_order: *order, created_at: now,
                        });
                    }
                }
                if db::ops::tool_preset::count_presets(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let presets = [
                        ("preset_coding", "Coding Agent", "All tools for coding tasks", r#"["ask_user","read_file","write_file","edit_file","apply_patch","run_command","list_directory","search_files","glob_files"]"#, 0),
                        ("preset_research", "Research", "Minimal tools for research and reading", r#"["ask_user","read_file","list_directory","search_files","glob_files"]"#, 1),
                        ("preset_writing", "Writing", "Tools for writing and editing files", r#"["ask_user","read_file","write_file","edit_file"]"#, 2),
                    ];
                    for (id, name, desc, tools_json, order) in &presets {
                        let _ = db::ops::tool_preset::create_preset(&mut conn, &NewToolPreset {
                            id, name, description: Some(desc), icon: None,
                            tool_names: tools_json, is_builtin: 1, sort_order: *order,
                            created_at: now, updated_at: now,
                        });
                    }
                }
            }

            // Load custom tools from DB into tool registry
            let mut registry = tools::ToolRegistry::new();
            {
                let mut conn = pool.get().expect("db connection");
                if let Ok(custom_tools) = db::ops::custom_tool::list_enabled_tools(&mut conn) {
                    for ct in &custom_tools {
                        registry.register(Box::new(tools::custom::CustomToolExecutor::from_db(ct)));
                    }
                }
            }

            app.manage(AppDb(pool));
            app.manage(AppTools(Arc::new(registry)));
            app.manage(ApprovalWaiters(Mutex::new(HashMap::new())));
            app.manage(ActiveChats(Mutex::new(HashMap::new())));
            app.manage(EditSessions(Mutex::new(HashMap::new())));
            app.manage(AppMcp(Arc::new(Mutex::new(mcp::McpManager::new()))));

            #[cfg(not(target_os = "android"))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    onebot::maybe_start(handle).await;
                });
            }

            #[cfg(desktop)]
            {
                let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = MenuBuilder::new(app)
                    .item(&show_i)
                    .separator()
                    .item(&quit_i)
                    .build()?;

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
            commands::conversation::get_conversation,
            commands::conversation::update_conversation_title,
            commands::conversation::toggle_pin_conversation,
            commands::conversation::delete_conversation,
            commands::conversation::compact,
            commands::message::load_messages,
            commands::message::update_message_content,
            commands::message::delete_message,
            commands::message::delete_messages_from,
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
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::conversation::list_conversations_by_project,
            commands::memory::list_memories,
            commands::memory::save_memory,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::preference::get_preference,
            commands::preference::set_preference,
            commands::mcp::list_mcp_servers,
            commands::mcp::create_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::connect_mcp_server,
            commands::mcp::disconnect_mcp_server,
            commands::mcp::list_mcp_tools,
            commands::mcp::list_all_tool_names,
            commands::edit_session::list_staged_edits,
            commands::edit_session::approve_staged_edit,
            commands::edit_session::approve_all_staged_edits,
            commands::edit_session::reject_staged_edit,
            commands::approval::approve_tool_call,
            commands::approval::deny_tool_call,
            commands::approval::respond_to_ask,
            platform::get_platform,
            platform::get_window_insets,
            platform::get_manage_storage_status,
            platform::request_manage_storage,
            platform::pick_saf_directory,
            platform::list_saf_roots,
            platform::remove_saf_root,
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
            commands::prompt_template::list_prompt_templates,
            commands::prompt_template::create_prompt_template,
            commands::prompt_template::update_prompt_template,
            commands::prompt_template::delete_prompt_template,
            commands::prompt_template::list_template_variables,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
    use std::ffi::c_void;
    use std::sync::OnceLock;
    use jni::objects::GlobalRef;

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
