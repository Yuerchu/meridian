//! Every command the app answers, written once.
//!
//! Two things consume this: `generate_handler!` in `lib.rs`, which registers
//! them with Tauri, and `remote::dispatch`, which reaches the same functions
//! from a socket. Keeping one list is the point — a second one would be a list
//! of commands the remote client cannot call and nobody would notice for
//! months.
//!
//! ## Reading a row
//!
//! ```text
//! <kind> <module> => <name>(<arg>: <Type>, ...),
//! ```
//!
//! `kind` is one of:
//!
//! - `async` — an `async fn`. Most of them.
//! - `sync` — a plain `fn`. The dispatcher cannot `.await` one, which is the
//!   only reason the distinction is written down.
//! - `local` — reachable from this machine's window and refused over a socket.
//!   Marking a row `local` is a decision about what the command *means* when the
//!   person asking is somewhere else; `dispatch.rs` has a test that pins the
//!   whole set, so the choice cannot be made by accident.
//!
//! The argument list has to match the function's parameters after the
//! `AppHandle` — that is what the dispatcher deserialises the JSON payload
//! into. Get one wrong and this fails to build, which is the intended way to
//! find out.
//!
//! `#[cfg]` attributes go above a row and are honoured by both consumers.

/// The list. See the module docs for the shape of a row.
#[macro_export]
macro_rules! with_all_commands {
    ($callback:ident) => {
        $callback! {
            async commands::chat => chat(
                conversation_id: String,
                message: Option<String>,
                turn_id: Option<String>,
                replaces: Option<String>,
                model_override: Option<String>,
                provider_override: Option<String>,
                thinking_level: Option<String>,
                assistant_id: Option<String>,
                fast: Option<bool>,
                mode: Option<String>,
                voice: Option<bool>,
            ),
            async commands::chat => stop_chat(conversation_id: String, turn_id: Option<String>),

            // The generic key-value door onto the keychain, and so onto every
            // provider's API key: they are stored under a derived name
            // (`PROVIDER_<ID>_KEY`), and a remote caller can list the providers
            // to learn the ids. `get_provider_key_exists` answers the question
            // a client actually has -- is one set -- without handing over the
            // value, and stays reachable; this does not.
            //
            // A remote client has no use for them anyway: its own copies are
            // answered locally, because the remote token itself lives here.
            local commands::secret => set_secret(key: String, value: String),
            local commands::secret => get_secret(key: String),
            local commands::secret => delete_secret(key: String),

            async commands::conversation => list_conversations(archived: bool),
            async commands::conversation => create_conversation(
                title: Option<String>,
                project_id: Option<String>,
            ),
            async commands::conversation => update_conversation_title(id: String, title: String),
            async commands::conversation => set_conversation_assistant(
                id: String,
                assistant_id: Option<String>,
            ),
            async commands::conversation => set_conversation_reasoning_prefs(
                id: String,
                thinking_level: Option<String>,
                fast_mode: bool,
            ),
            async commands::conversation => toggle_pin_conversation(id: String),
            async commands::conversation => delete_conversation(id: String),
            async commands::conversation => compact(
                conversation_id: String,
                custom_instructions: Option<String>,
            ),
            async commands::conversation => get_context_info(conversation_id: String),

            async commands::message => conversation_snapshot(conversation_id: String),
            async commands::message => switch_branch(conversation_id: String, message_id: String),
            async commands::message => delete_message(conversation_id: String, id: String),
            async commands::message => rate_message(id: String, rating: Option<i32>),
            local commands::message => export_conversation(
                conversation_id: String,
                format: String,
                output_path: Option<String>,
            ),
            local commands::message => upload_file(conversation_id: String, file_path: String),

            async commands::assistant => list_assistants(),
            async commands::assistant => create_assistant(
                name: String,
                system_prompt: String,
                model_id: Option<String>,
                temperature: Option<f32>,
                top_p: Option<f32>,
                max_tokens: Option<i32>,
            ),
            async commands::assistant => update_assistant(
                id: String,
                updates: $crate::commands::assistant::AssistantPatch,
            ),
            async commands::assistant => delete_assistant(id: String),

            async commands::provider => list_providers(),
            async commands::provider => create_provider(
                name: String,
                provider_type: String,
                base_url: String,
                api_format: Option<String>,
            ),
            async commands::provider => update_provider(
                id: String,
                name: Option<String>,
                provider_type: Option<String>,
                base_url: Option<String>,
                is_enabled: Option<i32>,
                api_format: Option<String>,
            ),
            async commands::provider => delete_provider(id: String),
            async commands::provider => set_provider_key(provider_id: String, api_key: String),
            async commands::provider => get_provider_key_exists(provider_id: String),
            async commands::provider => fetch_provider_models(
                provider_id: String,
                force_refresh: Option<bool>,
            ),
            async commands::provider => get_provider_capabilities(
                provider_id: String,
                model_id: String,
            ),
            async commands::provider => get_provider_balance(provider_id: String),

            async commands::model_config => list_model_configs(provider_id: String),
            async commands::model_config => get_model_config(
                provider_id: String,
                model_id: String,
            ),
            async commands::model_config => save_model_config(
                input: meridian_core::db::models::model_config::ModelConfigInput,
            ),
            async commands::model_config => delete_model_config(id: String),

            async commands::project => list_projects(),
            async commands::project => create_project(
                name: String,
                path: Option<String>,
                source_type: Option<String>,
                source_id: Option<String>,
                assistant_id: Option<String>,
                description: Option<String>,
            ),
            async commands::project => update_project(
                id: String,
                name: Option<String>,
                path: Option<String>,
                assistant_id: Option<String>,
                description: Option<String>,
            ),
            async commands::project => delete_project(id: String),

            async commands::conversation => list_conversations_by_project(
                project_id: String,
                archived: bool,
            ),

            async commands::memory => list_memories(project_id: String),
            async commands::memory => save_memory(
                project_id: String,
                key: String,
                content: String,
                memory_type: Option<String>,
            ),
            async commands::memory => save_memory_scoped(
                scope: String,
                project_id: Option<String>,
                subject_scope_id: Option<String>,
                key: String,
                content: String,
                memory_type: Option<String>,
                owner_only: Option<bool>,
            ),
            async commands::memory => update_memory(
                id: String,
                content: Option<String>,
                memory_type: Option<String>,
                owner_only: Option<bool>,
            ),
            async commands::memory => delete_memory(id: String),

            async commands::todo => get_active_todo_list(conversation_id: String),

            async commands::conversation => set_conversation_mode(id: String, mode: Option<String>),
            async commands::conversation => set_conversation_accept_edits(
                id: String,
                accept_edits: bool,
            ),

            async commands::memory => delete_memories(ids: Vec<String>),
            async commands::memory => list_all_memories(),
            async commands::memory => list_memory_subjects(),
            async commands::memory => forget_memory_subject(subject_scope_id: String),
            async commands::memory => set_memory_subject_flags(
                subject_scope_id: String,
                is_pinned: Option<bool>,
                opted_out: Option<bool>,
            ),
            async commands::memory => list_memory_trash(limit: Option<i64>),
            async commands::memory => restore_memories(ids: Vec<String>),
            async commands::memory => purge_memories(ids: Vec<String>),
            async commands::memory => memory_enums(),

            async commands::usage => usage_report(
                dimension: meridian_core::db::ops::usage::UsageDimension,
                filter: Option<meridian_core::db::ops::usage::UsageFilter>,
            ),

            async commands::preference => get_preference(key: String),
            async commands::preference => set_preference(key: String, value: String),

            async commands::mcp => list_mcp_servers(),
            async commands::mcp => create_mcp_server(
                name: String,
                transport_type: String,
                command: Option<String>,
                args: Option<String>,
                env: Option<String>,
                url: Option<String>,
                headers: Option<String>,
            ),
            async commands::mcp => update_mcp_server(
                id: String,
                updates: $crate::commands::mcp::McpServerPatch,
            ),
            async commands::mcp => delete_mcp_server(id: String),
            async commands::mcp => connect_mcp_server(id: String),
            async commands::mcp => disconnect_mcp_server(id: String),
            async commands::mcp => list_mcp_tools(server_id: Option<String>),
            async commands::mcp => list_mcp_connection_statuses(),
            async commands::mcp => list_all_tool_names(),

            // Not `local`: a phone that has just connected is exactly the client
            // that needs to know what the desktop was already holding.
            sync commands::approval => all_pending_approvals(),
            async commands::approval => approve_tool_call(approval_id: String),
            async commands::approval => deny_tool_call(approval_id: String, reason: Option<String>),
            async commands::approval => respond_to_ask(approval_id: String, response: String),

            async commands::sub_agent => steer_conversation(conversation_id: String, text: String),

            sync platform => get_platform(),
            local platform => get_window_insets(),
            local platform => get_manage_storage_status(),
            local platform => request_manage_storage(),
            local platform => pick_saf_directory(),
            local platform => list_saf_roots(),
            local platform => remove_saf_root(uri: String),
            local platform => take_photo(),
            local platform => pick_gallery_image(),
            local platform => resolve_file_name(path: String),

            #[cfg(not(target_os = "android"))]
            async commands::onebot => get_onebot_status(),
            // `local` for what it *returns*, not for what it does. `OneBotConfig`
            // carries `access_token` — another server's credential, the same one
            // `guard_preference` refuses to let a remote caller write — plus
            // `admin_users`, and the voice lists, whose private-chat entries are
            // a person's own QQ number. Reading them back over the remote
            // transport undoes the write guard from the other side. Nothing
            // legitimate asks: the panel is hidden whenever `can.manageServers`
            // is false, which is exactly the remote case.
            #[cfg(not(target_os = "android"))]
            local commands::onebot => get_onebot_config(),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => save_onebot_config(
                config: meridian_core::onebot::OneBotConfig,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => get_voice_send_readiness(),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => start_onebot(),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => stop_onebot(),

            #[cfg(not(target_os = "android"))]
            async commands::hooks => get_hooks_status(),
            #[cfg(not(target_os = "android"))]
            async commands::hooks => get_hooks_config(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => save_hooks_config(config: meridian_core::hooks::HookConfig),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => regenerate_hooks_token(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => start_hooks(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => stop_hooks(),

            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_open_session(cwd: String),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_send(conversation_id: String, message: String, turn_id: Option<String>),
            // Not `local`, for the same reason `acp_open_session` is not: that
            // row already lets a remote caller start an adapter in a directory
            // it chose. Listing what sessions exist and taking one over are the
            // same privilege, on a machine whose transcripts the caller can
            // already read.
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_list_sessions(cwd: Option<String>),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_import_session(session: meridian_core::acp::import::ImportRequest),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_attach_session(
                conversation_id: String,
                session_id: String,
                cwd: String,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_conversation_session(conversation_id: String),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_cancel(conversation_id: String),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_close(conversation_id: String),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_live_sessions(),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_session_config(conversation_id: String),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_set_session_config(
                conversation_id: String,
                config_id: String,
                value: serde_json::Value,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_get_config(),
            // `local`: `acp.command` names a binary this app executes, so a
            // remote writer of it has arbitrary code execution here. Not the
            // self-lockout the other `local` rows are about.
            #[cfg(not(target_os = "android"))]
            local commands::acp => acp_save_config(config: meridian_core::acp::AcpConfig),
            #[cfg(not(target_os = "android"))]
            local commands::acp => acp_check_adapter(),

            // Not `local`. The queue is a list of messages for a conversation
            // the caller can already read and write; the phone stacking work up
            // for the desktop to get through is the case this was built for.
            async commands::queue => queue_list(conversation_id: String),
            async commands::queue => queue_enqueue(
                conversation_id: String,
                content: String,
                delivery: String,
            ),
            async commands::queue => queue_remove(conversation_id: String, id: String),
            async commands::queue => queue_reorder(conversation_id: String, ids: Vec<String>),
            async commands::queue => queue_set_delivery(
                conversation_id: String,
                id: String,
                delivery: String,
            ),
            async commands::queue => queue_release(conversation_id: String),

            #[cfg(not(target_os = "android"))]
            async commands::remote => get_listen_status(),
            #[cfg(not(target_os = "android"))]
            async commands::remote => get_listen_config(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => save_listen_config(config: $crate::remote::ListenConfig),
            #[cfg(not(target_os = "android"))]
            local commands::remote => start_listen(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => stop_listen(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => regenerate_listen_token(),
            #[cfg(not(target_os = "android"))]
            sync commands::remote => get_listen_addresses(),

            local commands::dev => voice_probe_echo(sample_rate: u32, pcm: String),

            async commands::voice => voice_prewarm(),
            async commands::voice => voice_model_status(),
            async commands::voice => voice_download_model(url: Option<String>),
            async commands::voice => voice_cancel_download(),
            local commands::voice => voice_import_model(archive_path: String),
            async commands::voice => voice_delete_model(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => voice_release_prewarm(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => voice_start_recording(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => voice_stop_and_transcribe(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => voice_cancel_recording(),
            #[cfg(target_os = "android")]
            async commands::voice => voice_transcribe_pcm(sample_rate: u32, pcm: String),

            // 语料管理。三个命令的远程可见性是分开决定的:
            //
            // 导出是 `local`——它写本机任意路径,而写出去的内容就是声纹语料
            // 本身。列表和删除保持可远程,因为删除**正是那个需要在手机上做的**
            // 隐私动作:有人说"把我的声音删掉"时,你手上多半不是那台电脑。
            // 列表只回答"占了多少地方",会话用的还是假名。
            async commands::voice_corpus => list_voice_corpus(),
            async commands::voice_corpus => delete_voice_corpus(
                selector: meridian_core::voice_corpus::manage::CorpusSelector
            ),
            async commands::voice_corpus => set_voice_optout(sender_id: String, enabled: bool),
            async commands::voice_corpus => forget_voice_sender(sender_id: String),
            local commands::voice_corpus => export_voice_corpus(
                output_dir: String,
                include_sender: bool,
                include_untranscribed: bool
            ),

            sync commands::prompt_template => list_prompt_templates(),
            sync commands::prompt_template => create_prompt_template(
                name: String,
                category: String,
                template_text: String,
                description: Option<String>,
            ),
            sync commands::prompt_template => update_prompt_template(
                id: String,
                updates: $crate::commands::prompt_template::PromptTemplatePatch,
            ),
            sync commands::prompt_template => delete_prompt_template(id: String),
            sync commands::prompt_template => list_template_variables(),

            sync commands::skill => list_skills(),
            sync commands::skill => rescan_skills(),
            sync commands::skill => get_skill_body(dir_name: String),
            sync commands::skill => create_skill(
                dir_name: String,
                llm_description: String,
                body: String,
                display_name: Option<String>,
            ),
            sync commands::skill => update_skill(
                dir_name: String,
                updates: $crate::commands::skill::SkillPatch,
            ),
            sync commands::skill => delete_skill(dir_name: String),
            sync commands::skill => list_skill_bindings(layer: String, anchor_id: Option<String>),
            sync commands::skill => set_skill_binding(
                layer: String,
                anchor_id: Option<String>,
                dir_name: String,
                bound: bool,
            ),

            // Reachable from a phone on purpose: it describes the host, and a
            // remote session asking "what am I actually connected to" is the
            // question About answers.
            sync commands::app_info => get_app_info(),

            // `local` because they move this machine's windows. A remote client
            // has its own launch to worry about and no business closing a
            // splash it cannot see.
            local splash => splash_animation_done(),
            local splash => splash_app_ready(),

            async commands::logs => read_logs(query: $crate::commands::logs::LogQueryInput),
            async commands::logs => list_log_files(),
            async commands::logs => get_log_settings(),
            async commands::logs => set_log_level(level: String),
            local commands::logs => export_logs(output_path: String),

            sync commands::emoji => list_emoji_packs(),
            sync commands::emoji => create_emoji_pack(name: String, description: Option<String>),
            sync commands::emoji => delete_emoji_pack(id: String),
            sync commands::emoji => list_emojis(pack_id: String),
            local commands::emoji => import_emojis(pack_id: String, file_paths: Vec<String>),
            sync commands::emoji => delete_emoji(id: String),
            sync commands::emoji => rename_emoji(id: String, new_name: String),
            async commands::emoji => suggest_sticker_semantics(id: String),
            sync commands::emoji => confirm_sticker_semantics(id: String, name: String, tags: Option<String>),
            sync commands::emoji => search_emojis(query: String),
            sync commands::emoji => assign_emoji_pack(assistant_id: String, pack_id: String),
            sync commands::emoji => unassign_emoji_pack(assistant_id: String, pack_id: String),
            sync commands::emoji => list_assistant_emoji_packs(assistant_id: String),
            sync commands::emoji => get_emoji_file_url(emoji_id: String),

            sync commands::tool_system => list_tool_categories(),
            sync commands::tool_system => list_custom_tools(),
            sync commands::tool_system => create_custom_tool(
                name: String,
                description: String,
                command: String,
                category_id: Option<String>,
                parameters_schema: Option<String>,
                args_template: Option<String>,
                working_directory: Option<String>,
                timeout_ms: Option<i32>,
                permission: Option<String>,
            ),
            sync commands::tool_system => update_custom_tool(
                id: String,
                updates: $crate::commands::tool_system::CustomToolPatch,
            ),
            sync commands::tool_system => delete_custom_tool(id: String),
            sync commands::tool_system => list_tool_presets(),
            sync commands::tool_system => create_tool_preset(
                name: String,
                description: Option<String>,
                tool_names: String,
            ),
            sync commands::tool_system => update_tool_preset(
                id: String,
                updates: $crate::commands::tool_system::ToolPresetPatch,
            ),
            sync commands::tool_system => delete_tool_preset(id: String),
            sync commands::tool_system => set_service_key(service: String, key: String),
            sync commands::tool_system => get_service_key_exists(service: String),
        }
    };
}
