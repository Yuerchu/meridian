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
                request: $crate::commands::chat::ChatRequest,
            ),
            async commands::chat => stop_chat(
                request: $crate::commands::chat::ChatStopRequest,
            ),
            async commands::message => read_message_context_item(
                request: $crate::commands::message::MessageContextReadRequest,
            ),
            // A literal command the user typed with `!`. Desktop owns the
            // process; remote clients may request it on that host. Standalone
            // Android registers an explicit unavailable stub instead of
            // failing with an unknown-command transport error.
            async commands::user_command => run_user_command(
                request: $crate::commands::user_command::UserCommandRunRequest,
            ),
            async commands::user_command => get_user_command_result(
                request: $crate::commands::user_command::UserCommandResultReadRequest,
            ),
            async commands::user_command => active_user_shell_turn(
                conversation_id: String,
            ),

            // The generic key-value door onto the keychain, and so onto every
            // provider's API key: they are stored under a derived name
            // (`PROVIDER_<ID>_KEY`), and a remote caller can list the providers
            // to learn the ids. `get_provider_key_exists` answers the question
            // a client actually has -- is one set -- without handing over the
            // value, and stays reachable; this does not.
            //
            // A remote client has no use for them anyway: its own copies are
            // answered locally, because the remote token itself lives here.
            local commands::secret => set_secret(
                request: $crate::commands::secret::SecretUpsertRequest,
            ),
            local commands::secret => get_secret(
                request: $crate::commands::secret::SecretReadRequest,
            ),
            local commands::secret => delete_secret(
                request: $crate::commands::secret::SecretDeleteRequest,
            ),

            async commands::conversation => list_conversations(archived: bool),
            async commands::conversation => create_conversation(
                request: $crate::commands::conversation::ConversationCreateRequest,
            ),
            async commands::conversation => update_conversation_title(
                request: $crate::commands::conversation::ConversationTitleUpdateRequest,
            ),
            async commands::conversation => search_conversations(
                request: $crate::commands::conversation::ConversationSearchRequest,
            ),
            async commands::conversation => set_conversation_assistant(
                request: $crate::commands::conversation::ConversationAssistantUpdateRequest,
            ),
            async commands::conversation => set_conversation_reasoning_prefs(
                request: $crate::commands::conversation::ConversationReasoningPreferencesUpdateRequest,
            ),
            async commands::conversation => toggle_pin_conversation(id: String),
            async commands::conversation => delete_conversation(id: String),
            async commands::conversation => compact(
                request: $crate::commands::conversation::ConversationCompactionRequest,
            ),
            async commands::conversation => get_context_info(conversation_id: String),

            async commands::message => conversation_snapshot(
                request: $crate::commands::message::ConversationSnapshotRequest,
            ),
            async commands::plan_review => get_plan_review(
                request: $crate::commands::plan_review::PlanReviewReadRequest,
            ),
            async commands::plan_review => list_plan_revisions(
                request: $crate::commands::plan_review::PlanRevisionListRequest,
            ),
            async commands::plan_review => save_plan_review_draft(
                request: $crate::commands::plan_review::PlanReviewDraftSaveRequest,
            ),
            async commands::plan_review => discard_plan_review_draft(
                request: $crate::commands::plan_review::PlanReviewDraftDiscardRequest,
            ),
            async commands::plan_review => decide_plan_review(
                request: $crate::commands::plan_review::PlanReviewDecisionRequest,
            ),
            async commands::plan_review => get_plan_review_delivery(
                request: $crate::commands::plan_review::PlanReviewDeliveryReadRequest,
            ),
            async commands::plan_review => continue_plan_review_delivery(
                request: $crate::commands::plan_review::PlanReviewDeliveryContinueRequest,
            ),
            async commands::plan_review => resolve_plan_file_conflict(
                request: $crate::commands::plan_review::PlanFileConflictResolveRequest,
            ),
            async commands::message => switch_branch(
                request: $crate::commands::message::MessageBranchSwitchRequest,
            ),
            async commands::message => delete_message(
                request: $crate::commands::message::MessageDeleteRequest,
            ),
            async commands::message => rate_message(
                request: $crate::commands::message::MessageRatingUpdateRequest,
            ),
            local commands::message => export_conversation(
                request: $crate::commands::message::ConversationExportRequest,
            ),
            local commands::message => upload_file(
                request: $crate::commands::message::MessageFileUploadRequest,
            ),

            async commands::assistant => list_assistants(),
            async commands::assistant => create_assistant(
                request: $crate::commands::assistant::AssistantCreateRequest,
            ),
            async commands::assistant => update_assistant(
                request: $crate::commands::assistant::AssistantUpdateRequest,
            ),
            async commands::assistant => delete_assistant(id: String),

            // Compiled-in data, no lock and no disk — hence sync. Not `local`:
            // a phone building the same "add a provider" list needs it too.
            sync commands::provider => list_provider_catalog(),
            // Not `local`: a phone showing provider settings needs the same
            // answer, and the reply carries no credential material.
            async commands::provider => codex_auth_status(),
            async commands::provider => list_providers(),
            async commands::provider => create_provider(
                request: $crate::commands::provider::ProviderCreateRequest,
            ),
            async commands::provider => update_provider(
                request: $crate::commands::provider::ProviderUpdateRequest,
            ),
            async commands::provider => delete_provider(id: String),
            async commands::provider => set_provider_key(
                request: $crate::commands::provider::ProviderKeyUpdateRequest,
            ),
            async commands::provider => get_provider_key_exists(provider_id: String),
            async commands::provider => fetch_provider_models(
                request: $crate::commands::provider::ProviderModelListRequest,
            ),
            async commands::provider => get_provider_capabilities(
                request: $crate::commands::provider::ProviderCapabilitiesReadRequest,
            ),
            async commands::provider => get_provider_balance(provider_id: String),

            async commands::model_config => list_model_configs(provider_id: String),
            async commands::model_config => get_model_config(
                request: $crate::commands::model_config::ModelConfigReadRequest,
            ),
            async commands::model_config => save_model_config(
                request: $crate::commands::model_config::ModelConfigUpsertRequest,
            ),
            async commands::model_config => delete_model_config(id: String),

            async commands::project => list_projects(),
            async commands::project => create_project(
                request: $crate::commands::project::ProjectCreateRequest,
            ),
            async commands::project => update_project(
                request: $crate::commands::project::ProjectUpdateRequest,
            ),
            async commands::project => delete_project(id: String),

            // The file panel. Read-only and deliberately not `local`: in remote
            // mode the phone is asking about the *host's* project files, which
            // is the whole point of looking at them from a phone.
            async commands::workspace => workspace_root(
                request: $crate::commands::workspace::WorkspaceRootRequest,
            ),
            async commands::workspace => workspace_tree(
                request: $crate::commands::workspace::WorkspaceTreeRequest,
            ),
            async commands::workspace => workspace_read_file(
                request: $crate::commands::workspace::WorkspaceFileReadRequest,
            ),
            async commands::workspace => workspace_suggest_refs(
                request: $crate::commands::workspace::WorkspaceReferenceSuggestRequest,
            ),
            async commands::workspace => workspace_resolve_ref(
                request: $crate::commands::workspace::WorkspaceReferenceResolveRequest,
            ),
            async commands::workspace => workspace_probe_ref(
                request: $crate::commands::workspace::WorkspaceReferenceProbeRequest,
            ),
            async commands::workspace => workspace_git_status(
                request: $crate::commands::workspace::WorkspaceGitStatusRequest,
            ),
            async commands::workspace => workspace_git_diff(
                request: $crate::commands::workspace::WorkspaceGitDiffRequest,
            ),
            // Runs the user's configured editor command — a program launch, so
            // a remote caller is refused outright.
            local commands::workspace => open_in_editor(
                request: $crate::commands::workspace::WorkspaceEditorOpenRequest,
            ),

            // The journal's read side: per-line attribution and file history.
            // Read-only, and not `local` for the workspace commands' reason —
            // remote mode asks about the host's record.
            async commands::journal => journal_blame(
                request: $crate::commands::journal::JournalBlameRequest,
            ),
            async commands::journal => journal_file_history(
                request: $crate::commands::journal::JournalFileHistoryRequest,
            ),
            async commands::journal => journal_version_content(
                request: $crate::commands::journal::JournalVersionContentRequest,
            ),

            async commands::conversation => list_conversations_by_project(
                request: $crate::commands::conversation::ConversationListByProjectRequest,
            ),

            async commands::memory => list_memories(project_id: String),
            async commands::memory => save_memory(
                request: $crate::commands::memory::MemoryUpsertRequest,
            ),
            async commands::memory => save_memory_scoped(
                request: $crate::commands::memory::MemoryScopedUpsertRequest,
            ),
            async commands::memory => update_memory(
                request: $crate::commands::memory::MemoryUpdateRequest,
            ),
            async commands::memory => delete_memory(id: String),

            async commands::todo => get_active_todo_list(conversation_id: String),

            async commands::conversation => set_conversation_mode(
                request: $crate::commands::conversation::ConversationModeUpdateRequest,
            ),
            async commands::conversation => set_conversation_accept_edits(
                request: $crate::commands::conversation::ConversationAcceptEditsUpdateRequest,
            ),
            async commands::conversation => set_conversation_project(
                request: $crate::commands::conversation::ConversationProjectUpdateRequest,
            ),

            async commands::memory => delete_memories(ids: Vec<String>),
            async commands::memory => list_all_memories(),
            async commands::memory => list_memory_subjects(),
            async commands::memory => forget_memory_subject(subject_scope_id: String),
            async commands::memory => set_memory_subject_flags(
                request: $crate::commands::memory::MemorySubjectFlagsUpdateRequest,
            ),
            async commands::memory => list_memory_trash(limit: Option<i64>),
            async commands::memory => restore_memories(ids: Vec<String>),
            async commands::memory => purge_memories(ids: Vec<String>),
            async commands::memory => memory_enums(),

            async commands::usage => usage_report(
                request: $crate::commands::usage::UsageReportRequest,
            ),

            async commands::preference => get_preference(
                request: $crate::commands::preference::PreferenceReadRequest,
            ),
            async commands::preference => set_preference(
                request: $crate::commands::preference::PreferenceUpdateRequest,
            ),

            async commands::mcp => list_mcp_servers(),
            // `local`: `command` is a binary this app will spawn, so a remote
            // writer of it has arbitrary code execution here — the same reason
            // `acp_save_config` is local. Listing stays reachable; env/headers
            // are stripped in `sanitize_remote_output`.
            local commands::mcp => create_mcp_server(
                request: $crate::commands::mcp::McpServerCreateRequest,
            ),
            local commands::mcp => update_mcp_server(
                request: $crate::commands::mcp::McpServerUpdateRequest,
            ),
            async commands::mcp => delete_mcp_server(id: String),
            local commands::mcp => connect_mcp_server(id: String),
            async commands::mcp => disconnect_mcp_server(id: String),
            async commands::mcp => list_mcp_tools(server_id: Option<String>),
            async commands::mcp => list_mcp_connection_statuses(),
            async commands::mcp => list_all_tool_names(),

            // Not `local`: a phone that has just connected is exactly the client
            // that needs to know what the desktop was already holding.
            sync commands::approval => all_pending_approvals(),
            async commands::approval => approve_tool_call(approval_id: String),
            async commands::approval => deny_tool_call(
                request: $crate::commands::approval::ToolCallDenyRequest,
            ),
            async commands::approval => respond_to_ask(
                request: $crate::commands::approval::AskResponseRequest,
            ),

            async commands::sub_agent => steer_conversation(
                request: $crate::commands::sub_agent::ConversationSteerRequest,
            ),

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
            // `local` for what it *returns*, not for what it does. `OneBotConfigInfoResponse`
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
                request: $crate::commands::onebot::OneBotConfigUpdateRequest,
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
            local commands::hooks => save_hooks_config(
                request: $crate::commands::hooks::HookConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => regenerate_hooks_token(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => start_hooks(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => stop_hooks(),

            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_open_session(
                request: $crate::commands::acp::AcpSessionOpenRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_send(
                request: $crate::commands::acp::AcpPromptSendRequest,
            ),
            // Not `local`, for the same reason `acp_open_session` is not: that
            // row already lets a remote caller start an adapter in a directory
            // it chose. Listing what sessions exist and taking one over are the
            // same privilege, on a machine whose transcripts the caller can
            // already read.
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_list_sessions(
                request: $crate::commands::acp::AcpSessionListRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_import_session(
                request: $crate::commands::acp::AcpImportSessionRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_attach_session(
                request: $crate::commands::acp::AcpSessionAttachRequest,
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
            async commands::acp => acp_session_config(
                request: $crate::commands::acp::AcpSessionConfigReadRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_set_session_config(
                request: $crate::commands::acp::AcpSessionConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => acp_get_config(),
            // `local`: `acp.command` names a binary this app executes, so a
            // remote writer of it has arbitrary code execution here. Not the
            // self-lockout the other `local` rows are about.
            #[cfg(not(target_os = "android"))]
            local commands::acp => acp_save_config(
                request: $crate::commands::acp::AcpConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::acp => acp_check_adapter(),

            // Not `local`. The queue is a list of messages for a conversation
            // the caller can already read and write; the phone stacking work up
            // for the desktop to get through is the case this was built for.
            async commands::queue => queue_list(conversation_id: String),
            async commands::queue => queue_enqueue(
                request: $crate::commands::queue::QueuedPromptCreateRequest,
            ),
            async commands::queue => queue_remove(
                request: $crate::commands::queue::QueuedPromptRemoveRequest,
            ),
            async commands::queue => queue_reorder(
                request: $crate::commands::queue::QueuedPromptReorderRequest,
            ),
            async commands::queue => queue_set_delivery(
                request: $crate::commands::queue::QueuedPromptDeliveryUpdateRequest,
            ),
            async commands::queue => queue_release(conversation_id: String),

            #[cfg(not(target_os = "android"))]
            async commands::remote => get_listen_status(),
            #[cfg(not(target_os = "android"))]
            async commands::remote => get_listen_config(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => save_listen_config(
                request: $crate::commands::remote::ListenConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::remote => start_listen(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => stop_listen(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => regenerate_listen_token(),
            #[cfg(not(target_os = "android"))]
            sync commands::remote => get_listen_addresses(),

            local commands::dev => voice_probe_echo(
                request: $crate::commands::dev::VoiceProbeEchoRequest,
            ),

            async commands::voice => voice_prewarm(),
            async commands::voice => voice_model_status(),
            local commands::voice => voice_download_model(
                request: $crate::commands::voice::VoiceModelDownloadRequest,
            ),
            async commands::voice => voice_cancel_download(),
            local commands::voice => voice_import_model(
                request: $crate::commands::voice::VoiceModelImportRequest,
            ),
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
            async commands::voice => voice_transcribe_pcm(
                request: $crate::commands::voice::VoicePcmTranscriptionRequest,
            ),

            // 语料管理。三个命令的远程可见性是分开决定的:
            //
            // 导出是 `local`——它写本机任意路径,而写出去的内容就是声纹语料
            // 本身。列表和删除保持可远程,因为删除**正是那个需要在手机上做的**
            // 隐私动作:有人说"把我的声音删掉"时,你手上多半不是那台电脑。
            // 列表只回答"占了多少地方",会话用的还是假名。
            async commands::voice_corpus => list_voice_corpus(),
            async commands::voice_corpus => delete_voice_corpus(
                request: $crate::commands::voice_corpus::VoiceCorpusDeleteRequest,
            ),
            async commands::voice_corpus => set_voice_optout(
                request: $crate::commands::voice_corpus::VoiceCorpusOptoutUpdateRequest,
            ),
            async commands::voice_corpus => forget_voice_sender(
                request: $crate::commands::voice_corpus::VoiceCorpusForgetRequest,
            ),
            local commands::voice_corpus => export_voice_corpus(
                request: $crate::commands::voice_corpus::VoiceCorpusExportRequest,
            ),

            sync commands::prompt_template => list_prompt_templates(),
            sync commands::prompt_template => create_prompt_template(
                request: $crate::commands::prompt_template::PromptTemplateCreateRequest,
            ),
            sync commands::prompt_template => update_prompt_template(
                request: $crate::commands::prompt_template::PromptTemplateUpdateRequest,
            ),
            sync commands::prompt_template => delete_prompt_template(id: String),
            sync commands::prompt_template => list_template_variables(),

            sync commands::skill => list_skills(),
            sync commands::skill => rescan_skills(),
            sync commands::skill => get_skill_body(dir_name: String),
            sync commands::skill => create_skill(
                request: $crate::commands::skill::SkillCreateRequest,
            ),
            sync commands::skill => update_skill(
                request: $crate::commands::skill::SkillUpdateRequest,
            ),
            sync commands::skill => delete_skill(dir_name: String),
            sync commands::skill => list_skill_bindings(
                request: $crate::commands::skill::SkillBindingListRequest,
            ),
            sync commands::skill => set_skill_binding(
                request: $crate::commands::skill::SkillBindingUpdateRequest,
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

            async commands::logs => read_logs(request: $crate::commands::logs::LogQueryRequest),
            async commands::logs => list_log_files(),
            async commands::logs => get_log_settings(),
            async commands::logs => set_log_level(request: $crate::commands::logs::LogLevelUpdateRequest),
            local commands::logs => export_logs(request: $crate::commands::logs::LogExportRequest),

            sync commands::emoji => list_emoji_packs(),
            sync commands::emoji => create_emoji_pack(
                request: $crate::commands::emoji::EmojiPackCreateRequest,
            ),
            sync commands::emoji => delete_emoji_pack(id: String),
            sync commands::emoji => list_emojis(pack_id: String),
            local commands::emoji => import_emojis(
                request: $crate::commands::emoji::EmojiImportRequest,
            ),
            sync commands::emoji => delete_emoji(id: String),
            sync commands::emoji => rename_emoji(
                request: $crate::commands::emoji::EmojiRenameRequest,
            ),
            async commands::emoji => suggest_sticker_semantics(id: String),
            sync commands::emoji => confirm_sticker_semantics(
                request: $crate::commands::emoji::EmojiSemanticsConfirmRequest,
            ),
            sync commands::emoji => search_emojis(query: String),
            sync commands::emoji => assign_emoji_pack(
                request: $crate::commands::emoji::AssistantEmojiPackAssignmentRequest,
            ),
            sync commands::emoji => unassign_emoji_pack(
                request: $crate::commands::emoji::AssistantEmojiPackAssignmentRequest,
            ),
            sync commands::emoji => list_assistant_emoji_packs(assistant_id: String),
            sync commands::emoji => get_emoji_file_url(emoji_id: String),

            sync commands::tool_system => list_tool_categories(),
            sync commands::tool_system => list_custom_tools(),
            // `local`: `command` plus `permission: always` is a shell tool that
            // never asks, and custom tools skip the OS sandbox. Same ACE
            // reason as `acp.command`.
            local commands::tool_system => create_custom_tool(
                request: $crate::commands::tool_system::CustomToolCreateRequest,
            ),
            local commands::tool_system => update_custom_tool(
                request: $crate::commands::tool_system::CustomToolUpdateRequest,
            ),
            sync commands::tool_system => delete_custom_tool(id: String),
            sync commands::tool_system => list_tool_presets(),
            sync commands::tool_system => create_tool_preset(
                request: $crate::commands::tool_system::ToolPresetCreateRequest,
            ),
            sync commands::tool_system => update_tool_preset(
                request: $crate::commands::tool_system::ToolPresetUpdateRequest,
            ),
            sync commands::tool_system => delete_tool_preset(id: String),
            sync commands::tool_system => set_service_key(
                request: $crate::commands::tool_system::ServiceKeyUpdateRequest,
            ),
            sync commands::tool_system => get_service_key_exists(service: $crate::commands::tool_system::ServiceKey),
        }
    };
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;

    fn rejects_unknown<T: DeserializeOwned>(value: serde_json::Value) {
        assert!(serde_json::from_value::<T>(value).is_err());
    }

    fn requires_nullable_keys<T: DeserializeOwned>(value: serde_json::Value, keys: &[&str]) {
        assert!(
            serde_json::from_value::<T>(value.clone()).is_ok(),
            "complete request must deserialize"
        );
        for key in keys {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(*key);
            assert!(
                serde_json::from_value::<T>(missing).is_err(),
                "missing nullable key {key:?} must be rejected"
            );
        }
    }

    #[test]
    fn named_write_requests_reject_unknown_fields() {
        rejects_unknown::<crate::commands::assistant::AssistantCreateRequest>(serde_json::json!({
            "name": "Helper", "systemPrompt": "Help", "modelId": null, "temperature": null,
            "topP": null, "maxTokens": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::assistant::AssistantUpdateRequest>(serde_json::json!({
            "id": "assistant-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::emoji::EmojiPackCreateRequest>(serde_json::json!({
            "name": "Pack", "description": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::mcp::McpServerCreateRequest>(serde_json::json!({
            "name": "Server", "transportType": "stdio", "command": null, "args": null,
            "env": null, "url": null, "headers": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::mcp::McpServerUpdateRequest>(serde_json::json!({
            "id": "server-1", "futureField": true
        }));
        assert!(
            serde_json::from_value::<crate::commands::mcp::McpServerUpdateRequest>(
                serde_json::json!({ "name": "Server" })
            )
            .is_err(),
            "McpServerUpdateRequest.id must be required",
        );
        rejects_unknown::<crate::commands::memory::MemoryUpdateRequest>(serde_json::json!({
            "id": "memory-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::memory::MemoryUpsertRequest>(serde_json::json!({
            "projectId": "project-1", "key": "preference", "content": "concise",
            "memoryType": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::memory::MemoryScopedUpsertRequest>(serde_json::json!({
            "scope": "project", "projectId": "project-1", "subjectScopeId": null,
            "key": "preference", "content": "concise", "memoryType": null,
            "ownerOnly": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::project::ProjectCreateRequest>(serde_json::json!({
            "name": "Project", "path": null, "sourceType": "local", "sourceId": null,
            "assistantId": null, "description": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::project::ProjectUpdateRequest>(serde_json::json!({
            "id": "project-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::prompt_template::PromptTemplateCreateRequest>(serde_json::json!({
            "name": "Template", "category": "general", "templateText": "Hello",
            "description": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::prompt_template::PromptTemplateUpdateRequest>(serde_json::json!({
            "id": "template-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::provider::ProviderCreateRequest>(serde_json::json!({
            "name": "OpenAI", "providerType": "openai", "baseUrl": "https://example.invalid",
            "apiFormat": null, "catalogId": null, "authOption": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::provider::ProviderUpdateRequest>(serde_json::json!({
            "id": "provider-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::skill::SkillCreateRequest>(serde_json::json!({
            "dirName": "review", "llmDescription": "Review", "body": "Body",
            "displayName": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::skill::SkillUpdateRequest>(serde_json::json!({
            "dirName": "review", "futureField": true
        }));
        rejects_unknown::<crate::commands::tool_system::CustomToolCreateRequest>(serde_json::json!({
            "name": "Echo", "description": "Echo", "command": "echo", "categoryId": null,
            "parametersSchema": null, "argsTemplate": null, "workingDirectory": null,
            "timeoutMs": null, "permission": null, "futureField": true
        }));
        rejects_unknown::<crate::commands::tool_system::CustomToolUpdateRequest>(serde_json::json!({
            "id": "tool-1", "futureField": true
        }));
        rejects_unknown::<crate::commands::tool_system::ToolPresetCreateRequest>(serde_json::json!({
            "name": "Default", "description": null, "toolNames": [], "futureField": true
        }));
        rejects_unknown::<crate::commands::tool_system::ToolPresetUpdateRequest>(serde_json::json!({
            "id": "preset-1", "futureField": true
        }));
    }

    #[test]
    fn named_create_requests_require_every_nullable_key() {
        requires_nullable_keys::<crate::commands::assistant::AssistantCreateRequest>(
            serde_json::json!({
                "name": "Helper", "systemPrompt": "Help", "modelId": null,
                "temperature": null, "topP": null, "maxTokens": null
            }),
            &["modelId", "temperature", "topP", "maxTokens"],
        );
        requires_nullable_keys::<crate::commands::emoji::EmojiPackCreateRequest>(
            serde_json::json!({ "name": "Pack", "description": null }),
            &["description"],
        );
        requires_nullable_keys::<crate::commands::mcp::McpServerCreateRequest>(
            serde_json::json!({
                "name": "Server", "transportType": "stdio", "command": null,
                "args": null, "env": null, "url": null, "headers": null
            }),
            &["command", "args", "env", "url", "headers"],
        );
        requires_nullable_keys::<crate::commands::memory::MemoryUpsertRequest>(
            serde_json::json!({
                "projectId": "project-1", "key": "preference", "content": "concise",
                "memoryType": null
            }),
            &["memoryType"],
        );
        requires_nullable_keys::<crate::commands::memory::MemoryScopedUpsertRequest>(
            serde_json::json!({
                "scope": "project", "projectId": "project-1", "subjectScopeId": null,
                "key": "preference", "content": "concise", "memoryType": null,
                "ownerOnly": null
            }),
            &["projectId", "subjectScopeId", "memoryType", "ownerOnly"],
        );
        requires_nullable_keys::<crate::commands::project::ProjectCreateRequest>(
            serde_json::json!({
                "name": "Project", "path": null, "sourceType": "local", "sourceId": null,
                "assistantId": null, "description": null
            }),
            &["path", "sourceId", "assistantId", "description"],
        );
        requires_nullable_keys::<crate::commands::prompt_template::PromptTemplateCreateRequest>(
            serde_json::json!({
                "name": "Template", "category": "general", "templateText": "Hello",
                "description": null
            }),
            &["description"],
        );
        requires_nullable_keys::<crate::commands::skill::SkillCreateRequest>(
            serde_json::json!({
                "dirName": "review", "llmDescription": "Review", "body": "Body",
                "displayName": null
            }),
            &["displayName"],
        );
        requires_nullable_keys::<crate::commands::tool_system::CustomToolCreateRequest>(
            serde_json::json!({
                "name": "Echo", "description": "Echo", "command": "echo", "categoryId": null,
                "parametersSchema": null, "argsTemplate": null, "workingDirectory": null,
                "timeoutMs": null, "permission": null
            }),
            &[
                "categoryId",
                "parametersSchema",
                "argsTemplate",
                "workingDirectory",
                "timeoutMs",
                "permission",
            ],
        );
        requires_nullable_keys::<crate::commands::tool_system::ToolPresetCreateRequest>(
            serde_json::json!({ "name": "Default", "description": null, "toolNames": [] }),
            &["description"],
        );
    }

    #[test]
    fn named_update_requests_require_their_routing_field() {
        assert!(
            serde_json::from_value::<crate::commands::assistant::AssistantUpdateRequest>(serde_json::json!({
                "name": "Helper"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<crate::commands::prompt_template::PromptTemplateUpdateRequest>(
                serde_json::json!({ "name": "Template" })
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<crate::commands::skill::SkillUpdateRequest>(serde_json::json!({
                "isEnabled": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<crate::commands::tool_system::CustomToolUpdateRequest>(serde_json::json!({
                "name": "Echo"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<crate::commands::tool_system::ToolPresetUpdateRequest>(serde_json::json!({
                "name": "Default"
            }))
            .is_err()
        );
    }
}
