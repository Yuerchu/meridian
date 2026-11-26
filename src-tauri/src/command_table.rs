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
            async commands::chat => start_chat(
                request: $crate::commands::chat::ChatStartRequest,
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
            async commands::user_command => invoke_user_command(
                request: $crate::commands::user_command::UserCommandRunRequest,
            ),
            async commands::user_command => get_user_command_result(
                request: $crate::commands::user_command::UserCommandResultReadRequest,
            ),
            async commands::user_command => get_active_user_command(
                request: $crate::commands::user_command::UserCommandActiveReadRequest,
            ),

            // The generic key-value door onto the keychain, and so onto every
            // provider's API key: they are stored under a derived name
            // (`PROVIDER_<ID>_KEY`), and a remote caller can list the providers
            // to learn the ids. `test_provider_key` answers the question
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

            async commands::conversation => list_conversations(
                request: $crate::commands::conversation::ConversationListRequest,
            ),
            async commands::conversation => create_conversation(
                request: $crate::commands::conversation::ConversationCreateRequest,
            ),
            async commands::conversation => update_conversation(
                request: $crate::commands::conversation::ConversationUpdateRequest,
            ),
            async commands::conversation => search_conversations(
                request: $crate::commands::conversation::ConversationSearchRequest,
            ),
            async commands::conversation => delete_conversation(
                request: $crate::commands::conversation::ConversationDeleteRequest,
            ),
            async commands::conversation => invoke_conversation_compaction(
                request: $crate::commands::conversation::ConversationCompactionRequest,
            ),
            async commands::conversation => get_conversation_context(
                request: $crate::commands::conversation::ConversationContextReadRequest,
            ),

            async commands::message => get_conversation_snapshot(
                request: $crate::commands::message::ConversationSnapshotRequest,
            ),
            async commands::plan_review => get_plan_review(
                request: $crate::commands::plan_review::PlanReviewReadRequest,
            ),
            async commands::plan_review => list_plan_revisions(
                request: $crate::commands::plan_review::PlanRevisionListRequest,
            ),
            async commands::plan_review => set_plan_review_draft(
                request: $crate::commands::plan_review::PlanReviewDraftSaveRequest,
            ),
            async commands::plan_review => delete_plan_review_draft(
                request: $crate::commands::plan_review::PlanReviewDraftDeleteRequest,
            ),
            async commands::plan_review => submit_plan_review_decision(
                request: $crate::commands::plan_review::PlanReviewDecisionRequest,
            ),
            async commands::plan_review => resolve_plan_file_conflict(
                request: $crate::commands::plan_review::PlanFileConflictResolveRequest,
            ),
            async commands::message => switch_message_branch(
                request: $crate::commands::message::MessageBranchSwitchRequest,
            ),
            async commands::message => delete_message(
                request: $crate::commands::message::MessageDeleteRequest,
            ),
            async commands::message => update_message_rating(
                request: $crate::commands::message::MessageRatingUpdateRequest,
            ),
            local commands::message => export_conversation(
                request: $crate::commands::message::ConversationExportRequest,
            ),
            local commands::message => export_message_media(
                request: $crate::commands::message::MessageMediaExportRequest,
            ),
            local commands::message => upload_message_file(
                request: $crate::commands::message::MessageFileUploadRequest,
            ),
            local commands::message => read_local_image_preview(
                request: $crate::commands::message::LocalImagePreviewRequest,
            ),

            async commands::assistant => list_assistants(),
            async commands::assistant => create_assistant(
                request: $crate::commands::assistant::AssistantCreateRequest,
            ),
            async commands::assistant => update_assistant(
                request: $crate::commands::assistant::AssistantUpdateRequest,
            ),
            async commands::assistant => delete_assistant(
                request: $crate::commands::assistant::AssistantDeleteRequest,
            ),

            // Compiled-in data, no lock and no disk — hence sync. Not `local`:
            // a phone building the same "add a provider" list needs it too.
            sync commands::provider => list_provider_catalog(),
            // Not `local`: a phone showing provider settings needs the same
            // answer, and the reply carries no credential material.
            async commands::provider => get_codex_auth_status(),
            async commands::provider => list_providers(),
            local commands::local_model => test_local_model(
                request: $crate::commands::local_model::LocalModelInspectRequest,
            ),
            async commands::local_model => get_provider_local_model(
                request: $crate::commands::local_model::ProviderLocalModelReadRequest,
            ),
            async commands::provider => create_provider(
                request: $crate::commands::provider::ProviderCreateRequest,
            ),
            async commands::provider => update_provider(
                request: $crate::commands::provider::ProviderUpdateRequest,
            ),
            async commands::provider => delete_provider(
                request: $crate::commands::provider::ProviderDeleteRequest,
            ),
            async commands::provider => set_provider_key(
                request: $crate::commands::provider::ProviderKeyUpdateRequest,
            ),
            async commands::provider => test_provider_key(
                request: $crate::commands::provider::ProviderKeyTestRequest,
            ),
            async commands::provider => list_provider_models(
                request: $crate::commands::provider::ProviderModelListRequest,
            ),
            async commands::provider => get_provider_capabilities(
                request: $crate::commands::provider::ProviderCapabilitiesReadRequest,
            ),
            async commands::provider => get_provider_balance(
                request: $crate::commands::provider::ProviderBalanceReadRequest,
            ),

            async commands::model_config => list_model_configs(
                request: $crate::commands::model_config::ModelConfigListRequest,
            ),
            async commands::model_config => list_model_profiles(),
            async commands::model_config => get_model_config(
                request: $crate::commands::model_config::ModelConfigReadRequest,
            ),
            async commands::model_config => set_model_config(
                request: $crate::commands::model_config::ModelConfigUpsertRequest,
            ),
            async commands::model_config => delete_model_config(
                request: $crate::commands::model_config::ModelConfigDeleteRequest,
            ),
            async commands::model_config => list_logical_models(),
            async commands::model_config => create_logical_model(
                request: $crate::commands::model_config::LogicalModelCreateRequest,
            ),
            async commands::model_config => update_logical_model(
                request: $crate::commands::model_config::LogicalModelUpdateRequest,
            ),
            async commands::model_config => delete_logical_model(
                request: $crate::commands::model_config::LogicalModelDeleteRequest,
            ),
            async commands::model_config => attach_model_deployment(
                request: $crate::commands::model_config::ModelDeploymentAttachRequest,
            ),
            async commands::model_config => update_model_deployment(
                request: $crate::commands::model_config::ModelDeploymentUpdateRequest,
            ),
            async commands::model_config => switch_model_deployment_profile(
                request: $crate::commands::model_config::ModelDeploymentProfileSwitchRequest,
            ),
            async commands::model_config => delete_model_deployment(
                request: $crate::commands::model_config::ModelDeploymentDeleteRequest,
            ),

            async commands::media_gen => create_media_generation(
                request: $crate::commands::media_gen::MediaGenerationCreateRequest,
            ),
            async commands::media_gen => list_media_generations(
                request: $crate::commands::media_gen::MediaGenerationListRequest,
            ),
            async commands::media_gen => get_media_generation(
                request: $crate::commands::media_gen::MediaGenerationReadRequest,
            ),
            async commands::media_gen => cancel_media_generation(
                request: $crate::commands::media_gen::MediaGenerationCancelRequest,
            ),
            async commands::media_gen => delete_media_generation(
                request: $crate::commands::media_gen::MediaGenerationDeleteRequest,
            ),
            async commands::media_gen => export_media_generation(
                request: $crate::commands::media_gen::MediaGenerationExportRequest,
            ),

            async commands::project => list_projects(),
            async commands::project => create_project(
                request: $crate::commands::project::ProjectCreateRequest,
            ),
            async commands::project => update_project(
                request: $crate::commands::project::ProjectUpdateRequest,
            ),
            async commands::project => delete_project(
                request: $crate::commands::project::ProjectDeleteRequest,
            ),

            // The file panel. Read-only and deliberately not `local`: in remote
            // mode the phone is asking about the *host's* project files, which
            // is the whole point of looking at them from a phone.
            async commands::workspace => get_workspace_root(
                request: $crate::commands::workspace::WorkspaceRootRequest,
            ),
            async commands::workspace => list_workspace_entries(
                request: $crate::commands::workspace::WorkspaceTreeRequest,
            ),
            async commands::workspace => read_workspace_file(
                request: $crate::commands::workspace::WorkspaceFileReadRequest,
            ),
            async commands::workspace => search_workspace_refs(
                request: $crate::commands::workspace::WorkspaceReferenceSuggestRequest,
            ),
            async commands::workspace => resolve_workspace_ref(
                request: $crate::commands::workspace::WorkspaceReferenceResolveRequest,
            ),
            async commands::workspace => test_workspace_ref(
                request: $crate::commands::workspace::WorkspaceReferenceProbeRequest,
            ),
            async commands::workspace => get_workspace_git_status(
                request: $crate::commands::workspace::WorkspaceGitStatusRequest,
            ),
            async commands::workspace => get_workspace_git_diff(
                request: $crate::commands::workspace::WorkspaceGitDiffRequest,
            ),
            // Runs the user's configured editor command — a program launch, so
            // a remote caller is refused outright.
            local commands::workspace => open_workspace_editor(
                request: $crate::commands::workspace::WorkspaceEditorOpenRequest,
            ),

            // The journal's read side: per-line attribution and file history.
            // Read-only, and not `local` for the workspace commands' reason —
            // remote mode asks about the host's record.
            async commands::journal => get_journal_blame(
                request: $crate::commands::journal::JournalBlameRequest,
            ),
            async commands::journal => list_journal_versions(
                request: $crate::commands::journal::JournalFileHistoryRequest,
            ),
            async commands::journal => read_journal_version(
                request: $crate::commands::journal::JournalVersionContentRequest,
            ),

            async commands::memory => list_memories(
                request: $crate::commands::memory::MemoryListRequest,
            ),
            async commands::memory => create_memory(
                request: $crate::commands::memory::MemoryCreateRequest,
            ),
            async commands::memory => update_memory(
                request: $crate::commands::memory::MemoryUpdateRequest,
            ),
            async commands::memory => delete_memories(
                request: $crate::commands::memory::MemoryDeleteRequest,
            ),

            async commands::todo => get_todo_list(
                request: $crate::commands::todo::TodoListReadRequest,
            ),

            async commands::memory => list_memory_subjects(),
            async commands::memory => delete_memory_subject(
                request: $crate::commands::memory::MemorySubjectDeleteRequest,
            ),
            async commands::memory => update_memory_subject(
                request: $crate::commands::memory::MemorySubjectUpdateRequest,
            ),
            async commands::memory => restore_memories(
                request: $crate::commands::memory::MemoryRestoreRequest,
            ),
            async commands::memory => get_memory_enums(),

            async commands::usage => get_usage_report(
                request: $crate::commands::usage::UsageReportRequest,
            ),
            async commands::usage => list_usage_gaps(
                request: $crate::commands::usage::UsageGapListRequest,
            ),
            async commands::usage => get_usage_cache_misses(
                request: $crate::commands::usage::UsageCacheMissRequest,
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
            // `set_acp_config` is local. Listing stays reachable; env/headers
            // are stripped in `sanitize_remote_output`.
            local commands::mcp => create_mcp_server(
                request: $crate::commands::mcp::McpServerCreateRequest,
            ),
            local commands::mcp => update_mcp_server(
                request: $crate::commands::mcp::McpServerUpdateRequest,
            ),
            async commands::mcp => delete_mcp_server(
                request: $crate::commands::mcp::McpServerDeleteRequest,
            ),
            local commands::mcp => connect_mcp_server(
                request: $crate::commands::mcp::McpServerConnectRequest,
            ),
            local commands::mcp => set_mcp_tool_enabled(
                request: $crate::commands::mcp::McpToolEnabledUpdateRequest,
            ),
            async commands::mcp => disconnect_mcp_server(
                request: $crate::commands::mcp::McpServerDisconnectRequest,
            ),
            async commands::mcp => list_mcp_tools(
                request: $crate::commands::mcp::McpToolListRequest,
            ),
            async commands::mcp => list_mcp_connection_statuses(),
            async commands::mcp => list_tools(),

            // Not `local`: a phone that has just connected is exactly the client
            // that needs to know what the desktop was already holding.
            sync commands::approval => list_pending_approvals(),
            async commands::approval => submit_approval_decision(
                request: $crate::commands::approval::ApprovalDecisionRequest,
            ),

            async commands::sub_agent => send_conversation_steer(
                request: $crate::commands::sub_agent::ConversationSteerRequest,
            ),

            sync platform => get_platform(),
            local platform => get_window_insets(),
            // This device's installed families. A remote client's WebView paints
            // with the fonts on the phone, not the host's, so the picker lists
            // here.
            local fonts => list_system_fonts(),
            local platform => take_launch_request(),
            local platform => get_manage_storage_status(),
            local platform => open_manage_storage_settings(),
            local platform => select_saf_directory(),
            local platform => list_saf_roots(),
            local platform => delete_saf_root(
                request: $crate::platform::SafRootDeleteRequest,
            ),
            local platform => select_camera_photo(),
            local platform => select_gallery_image(),
            local platform => resolve_file_name(
                request: $crate::platform::FileNameResolveRequest,
            ),

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
            local commands::onebot => set_onebot_config(
                request: $crate::commands::onebot::OneBotConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => get_onebot_voice_readiness(),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => start_onebot(),
            #[cfg(not(target_os = "android"))]
            local commands::onebot => stop_onebot(),

            // All `local`, and for a reason that is not self-lockout. The URL
            // decides where an alert — which names a provider and an amount of
            // money — is delivered, so a remote caller able to write it
            // redirects the alerts somewhere of their choosing. The signing
            // secret is a credential on top of that. This is the `acp.command`
            // class of setting: it configures the machine running Meridian.
            local commands::notify => get_notify_config(),
            local commands::notify => set_notify_config(
                request: $crate::commands::notify::NotifyConfigUpdateRequest,
            ),
            local commands::notify => list_notification_webhooks(),
            local commands::notify => create_notification_webhook(
                request: $crate::commands::notify::NotificationWebhookCreateRequest,
            ),
            local commands::notify => update_notification_webhook(
                request: $crate::commands::notify::NotificationWebhookUpdateRequest,
            ),
            local commands::notify => delete_notification_webhook(
                request: $crate::commands::notify::NotificationWebhookDeleteRequest,
            ),
            local commands::notify => test_notification_webhook(
                request: $crate::commands::notify::NotificationWebhookTestRequest,
            ),

            #[cfg(not(target_os = "android"))]
            async commands::hooks => get_hooks_status(),
            #[cfg(not(target_os = "android"))]
            async commands::hooks => get_hooks_config(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => set_hooks_config(
                request: $crate::commands::hooks::HookConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => reset_hooks_token(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => start_hooks(),
            #[cfg(not(target_os = "android"))]
            local commands::hooks => stop_hooks(),

            // The agent board. Not `local`, for the reason `open_acp_session`
            // below is not: starting a card opens an agent in a directory, which
            // a remote caller can already do.
            #[cfg(not(target_os = "android"))]
            async commands::board => list_board_tasks(),
            #[cfg(not(target_os = "android"))]
            async commands::board => create_board_task(
                request: $crate::commands::board::BoardTaskCreateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::board => update_board_task(
                request: $crate::commands::board::BoardTaskUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::board => start_board_task(
                request: $crate::commands::board::BoardTaskStartRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::board => delete_board_task_worktree(
                request: $crate::commands::board::BoardTaskWorktreeDeleteRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::board => delete_board_task(
                request: $crate::commands::board::BoardTaskDeleteRequest,
            ),

            #[cfg(not(target_os = "android"))]
            async commands::acp => open_acp_session(
                request: $crate::commands::acp::AcpSessionOpenRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => send_acp_prompt(
                request: $crate::commands::acp::AcpPromptSendRequest,
            ),
            // Not `local`, for the same reason `open_acp_session` is not: that
            // row already lets a remote caller start an adapter in a directory
            // it chose. Listing what sessions exist and taking one over are the
            // same privilege, on a machine whose transcripts the caller can
            // already read.
            #[cfg(not(target_os = "android"))]
            async commands::acp => list_acp_sessions(
                request: $crate::commands::acp::AcpSessionListRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => import_acp_session(
                request: $crate::commands::acp::AcpImportSessionRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => attach_acp_session(
                request: $crate::commands::acp::AcpSessionAttachRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => get_acp_session(
                request: $crate::commands::acp::AcpSessionReadRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => stop_acp_turn(
                request: $crate::commands::acp::AcpTurnStopRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => close_acp_session(
                request: $crate::commands::acp::AcpSessionCloseRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => list_live_acp_sessions(),
            #[cfg(not(target_os = "android"))]
            async commands::acp => get_acp_session_config(
                request: $crate::commands::acp::AcpSessionConfigReadRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => set_acp_session_config(
                request: $crate::commands::acp::AcpSessionConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::acp => get_acp_config(),
            // `local`: `acp.command` names a binary this app executes, so a
            // remote writer of it has arbitrary code execution here. Not the
            // self-lockout the other `local` rows are about.
            #[cfg(not(target_os = "android"))]
            local commands::acp => set_acp_config(
                request: $crate::commands::acp::AcpConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::acp => test_acp_adapter(),

            // Not `local`. The queue is a list of messages for a conversation
            // the caller can already read and write; the phone stacking work up
            // for the desktop to get through is the case this was built for.
            async commands::queue => list_queued_prompts(
                request: $crate::commands::queue::QueuedPromptListRequest,
            ),
            async commands::queue => create_queued_prompt(
                request: $crate::commands::queue::QueuedPromptCreateRequest,
            ),
            async commands::queue => delete_queued_prompt(
                request: $crate::commands::queue::QueuedPromptDeleteRequest,
            ),
            async commands::queue => set_queued_prompt_order(
                request: $crate::commands::queue::QueuedPromptReorderRequest,
            ),
            async commands::queue => update_queued_prompt(
                request: $crate::commands::queue::QueuedPromptUpdateRequest,
            ),
            async commands::queue => start_queued_prompts(
                request: $crate::commands::queue::QueuedPromptReleaseRequest,
            ),

            // Not `local`, for the queue's reason: a conversation's own
            // background commands, which the caller can already read and
            // drive. Stopping one from a phone is the point.
            #[cfg(not(target_os = "android"))]
            async commands::background => list_background_tasks(
                request: $crate::commands::background::BackgroundTaskListRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::background => list_background_task_counts(),
            #[cfg(not(target_os = "android"))]
            async commands::background => stop_background_task(
                request: $crate::commands::background::BackgroundTaskStopRequest,
            ),
            #[cfg(not(target_os = "android"))]
            async commands::background => read_background_task_output(
                request: $crate::commands::background::BackgroundTaskOutputReadRequest,
            ),

            // Not `local`, for the reason the queue is not: a draft is text
            // for a conversation the caller can already read and write, kept
            // on the host that owns that conversation. A phone is the client
            // most likely to be killed mid-sentence, and switching device is
            // meant to find the draft where it was left.
            async commands::composer_draft => get_composer_draft(
                request: $crate::commands::composer_draft::ComposerDraftReadRequest,
            ),
            async commands::composer_draft => set_composer_draft(
                request: $crate::commands::composer_draft::ComposerDraftUpsertRequest,
            ),
            async commands::composer_draft => delete_composer_draft(
                request: $crate::commands::composer_draft::ComposerDraftDeleteRequest,
            ),

            #[cfg(not(target_os = "android"))]
            async commands::remote => get_remote_status(),
            #[cfg(not(target_os = "android"))]
            async commands::remote => get_remote_config(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => set_remote_config(
                request: $crate::commands::remote::RemoteConfigUpdateRequest,
            ),
            #[cfg(not(target_os = "android"))]
            local commands::remote => start_remote(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => stop_remote(),
            #[cfg(not(target_os = "android"))]
            local commands::remote => reset_remote_token(),
            #[cfg(not(target_os = "android"))]
            sync commands::remote => list_remote_addresses(),

            // The input method. All `local` but the reads: what they configure is
            // this machine's keyboard, and on Windows several run a process or ask
            // for elevation on it. Configuration, dictionaries, models and hints
            // are the same on Windows and Android; the TSF registration and host
            // are Windows', the keyboard's system state Android's.
            #[cfg(windows)]
            async commands::ime => get_ime_status(),
            #[cfg(any(windows, target_os = "android"))]
            async commands::ime => get_ime_config(),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => set_ime_config(
                request: $crate::commands::ime::ImeConfigUpdateRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            async commands::ime => list_ime_dictionaries(),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => stage_ime_dictionary(
                request: $crate::commands::ime::ImeDictionaryStageRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => import_ime_dictionaries(
                request: $crate::commands::ime::ImeDictionaryStagedImportRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => cancel_ime_dictionary_staging(
                request: $crate::commands::ime::ImeDictionaryStagedCancelRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => import_ime_rime_ice(),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => set_ime_dictionary_enabled(
                request: $crate::commands::ime::ImeDictionaryToggleRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            // What was typed on this machine: never answered to a remote client.
            local commands::ime => get_ime_learning(),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => delete_ime_learning(
                request: $crate::commands::ime::ImeLearningDeleteRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => export_ime_learning(
                request: $crate::commands::ime::ImeLearningExportRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => import_ime_learning(
                request: $crate::commands::ime::ImeLearningImportRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => delete_ime_dictionary(
                request: $crate::commands::ime::ImeDictionaryDeleteRequest,
            ),
            local commands::system_notice => list_system_notices(),
            local commands::system_notice => delete_system_notice(
                request: $crate::commands::system_notice::SystemNoticeDeleteRequest,
            ),
            #[cfg(windows)]
            local commands::ime => start_ime_host(),
            #[cfg(windows)]
            local commands::ime => stop_ime_host(),
            #[cfg(windows)]
            local commands::ime => set_ime_profile_enabled(
                request: $crate::commands::ime::ImeProfileUpdateRequest,
            ),
            #[cfg(windows)]
            local commands::ime => register_ime(),
            #[cfg(any(windows, target_os = "android"))]
            async commands::ime => get_ime_lm_status(),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => import_ime_lm(
                request: $crate::commands::ime::ImeLmImportRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => delete_ime_lm(
                request: $crate::commands::ime::ImeLmDeleteRequest,
            ),
            #[cfg(any(windows, target_os = "android"))]
            local commands::ime => invoke_ime_memory_hints_refresh(),
            #[cfg(target_os = "android")]
            local commands::ime => get_android_ime_status(),
            #[cfg(target_os = "android")]
            local commands::ime => open_android_ime_settings(),
            #[cfg(target_os = "android")]
            local commands::ime => open_android_ime_picker(),

            local commands::dev => test_voice_echo(
                request: $crate::commands::dev::VoiceProbeEchoRequest,
            ),

            async commands::voice => start_voice_prewarm(),
            async commands::voice => get_voice_model_status(),
            local commands::voice => start_voice_model_download(
                request: $crate::commands::voice::VoiceModelDownloadRequest,
            ),
            async commands::voice => stop_voice_model_download(),
            local commands::voice => import_voice_model(
                request: $crate::commands::voice::VoiceModelImportRequest,
            ),
            async commands::voice => delete_voice_model(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => stop_voice_prewarm(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => start_voice_recording(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => stop_voice_recording(),
            #[cfg(not(target_os = "android"))]
            local commands::voice => cancel_voice_recording(),
            #[cfg(target_os = "android")]
            async commands::voice => invoke_voice_transcription(
                request: $crate::commands::voice::VoicePcmTranscriptionRequest,
            ),

            // 语料管理。五个命令的远程可见性是分开决定的:
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
            async commands::voice_corpus => delete_voice_sender(
                request: $crate::commands::voice_corpus::VoiceCorpusForgetRequest,
            ),
            local commands::voice_corpus => export_voice_corpus(
                request: $crate::commands::voice_corpus::VoiceCorpusExportRequest,
            ),

            async commands::skill => list_skills(),
            async commands::skill => invoke_skill_rescan(),
            sync commands::skill => read_skill_body(
                request: $crate::commands::skill::SkillBodyReadRequest,
            ),
            async commands::skill => create_skill(
                request: $crate::commands::skill::SkillCreateRequest,
            ),
            async commands::skill => update_skill(
                request: $crate::commands::skill::SkillUpdateRequest,
            ),
            async commands::skill => delete_skill(
                request: $crate::commands::skill::SkillDeleteRequest,
            ),
            async commands::skill => list_skill_bindings(
                request: $crate::commands::skill::SkillBindingListRequest,
            ),
            async commands::skill => set_skill_binding(
                request: $crate::commands::skill::SkillBindingUpdateRequest,
            ),

            // Reachable from a phone on purpose: it describes the host, and a
            // remote session asking "what am I actually connected to" is the
            // question About answers.
            sync commands::app_info => get_app_info(),

            // `local` because they move this machine's windows. A remote client
            // has its own launch to worry about and no business closing a
            // splash it cannot see.
            local splash => complete_splash_animation(),
            local splash => complete_splash_app_ready(),

            async commands::logs => read_logs(
                request: $crate::commands::logs::LogQueryRequest,
            ),
            async commands::logs => list_log_files(),
            async commands::logs => get_log_settings(),
            async commands::logs => set_log_level(
                request: $crate::commands::logs::LogLevelUpdateRequest,
            ),
            local commands::logs => export_logs(
                request: $crate::commands::logs::LogExportRequest,
            ),

            async commands::emoji => list_emoji_packs(
                request: $crate::commands::emoji::EmojiPackListRequest,
            ),
            async commands::emoji => create_emoji_pack(
                request: $crate::commands::emoji::EmojiPackCreateRequest,
            ),
            async commands::emoji => delete_emoji_pack(
                request: $crate::commands::emoji::EmojiPackDeleteRequest,
            ),
            async commands::emoji => list_emojis(
                request: $crate::commands::emoji::EmojiListRequest,
            ),
            local commands::emoji => import_emojis(
                request: $crate::commands::emoji::EmojiImportRequest,
            ),
            async commands::emoji => delete_emoji(
                request: $crate::commands::emoji::EmojiDeleteRequest,
            ),
            async commands::emoji => update_emoji(
                request: $crate::commands::emoji::EmojiUpdateRequest,
            ),
            async commands::emoji => invoke_emoji_semantics_suggestion(
                request: $crate::commands::emoji::EmojiSemanticsSuggestRequest,
            ),
            async commands::emoji => set_emoji_pack_assignment(
                request: $crate::commands::emoji::EmojiPackAssignmentUpdateRequest,
            ),
            async commands::emoji => get_emoji_file_url(
                request: $crate::commands::emoji::EmojiFileUrlReadRequest,
            ),

            async commands::tool_system => list_tool_categories(),
            async commands::tool_system => list_custom_tools(),
            // `local`: `command` plus `permission: always` is a shell tool that
            // never asks, and custom tools skip the OS sandbox. Same ACE
            // reason as `acp.command`.
            local commands::tool_system => create_custom_tool(
                request: $crate::commands::tool_system::CustomToolCreateRequest,
            ),
            local commands::tool_system => update_custom_tool(
                request: $crate::commands::tool_system::CustomToolUpdateRequest,
            ),
            async commands::tool_system => delete_custom_tool(
                request: $crate::commands::tool_system::CustomToolDeleteRequest,
            ),
            async commands::tool_system => list_tool_presets(),
            async commands::tool_system => create_tool_preset(
                request: $crate::commands::tool_system::ToolPresetCreateRequest,
            ),
            async commands::tool_system => update_tool_preset(
                request: $crate::commands::tool_system::ToolPresetUpdateRequest,
            ),
            async commands::tool_system => delete_tool_preset(
                request: $crate::commands::tool_system::ToolPresetDeleteRequest,
            ),
            sync commands::tool_system => set_service_key(
                request: $crate::commands::tool_system::ServiceKeyUpdateRequest,
            ),
            sync commands::tool_system => test_service_key(
                request: $crate::commands::tool_system::ServiceKeyTestRequest,
            ),
        }
    };
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;

    /// The modules `commands/mod.rs` compiles only on some platforms, by name.
    fn gated_modules(modules: &str) -> Vec<&str> {
        let lines: Vec<&str> = modules.lines().map(str::trim).collect();
        lines
            .windows(2)
            .filter(|pair| pair[0].starts_with("#[cfg("))
            .filter_map(|pair| pair[1].strip_prefix("pub mod ")?.strip_suffix(';'))
            .collect()
    }

    /// Rows naming one of `gated` with no `#[cfg]` of their own. An attribute
    /// covers the row straight after it (comments between are allowed), so a
    /// row inserted between an attribute and the row it was written for
    /// takes it, and the row left bare names a module that does not exist on
    /// the other platforms.
    fn bare_rows<'a>(table: &'a str, gated: &[&str]) -> Vec<&'a str> {
        let lines: Vec<&str> = table.lines().map(str::trim).collect();
        let mut bare = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let Some(module) = ["async ", "sync ", "local "]
                .iter()
                .find_map(|kind| line.strip_prefix(kind)?.strip_prefix("commands::"))
                .and_then(|rest| rest.split_whitespace().next())
            else {
                continue;
            };
            if !gated.contains(&module) {
                continue;
            }
            let above = lines[..i].iter().rev().find(|l| !l.starts_with("//"));
            if !above.is_some_and(|l| l.starts_with("#[cfg(")) {
                bare.push(*line);
            }
        }
        bare
    }

    /// Found by the Linux CI after #72 merged: four `commands::ime` rows had
    /// lost their `#[cfg]` to rows inserted above them, and built on Windows
    /// and Android, where the module exists, and nowhere else. This reads the
    /// source, so it fails on whichever platform runs it.
    #[test]
    fn every_row_of_a_platform_module_carries_its_own_cfg() {
        let gated = gated_modules(include_str!("commands/mod.rs"));
        assert!(gated.contains(&"ime") && gated.contains(&"acp"), "{gated:?}");
        let bare = bare_rows(include_str!("command_table.rs"), &gated);
        assert!(bare.is_empty(), "rows without a #[cfg] of their own: {bare:#?}");
    }

    #[test]
    fn a_row_that_took_the_attribute_above_it_leaves_the_next_one_bare() {
        let table = "#[cfg(windows)]\nlocal commands::ime => a(),\nlocal commands::ime => b(),\n\
                     #[cfg(windows)]\n// a note\nlocal commands::ime => c(),\nsync commands::chat => d(),";
        assert_eq!(bare_rows(table, &["ime"]), ["local commands::ime => b(),"]);
    }

    fn rejects_unknown<T: DeserializeOwned>(value: serde_json::Value) {
        assert!(serde_json::from_value::<T>(value).is_err());
    }

    fn requires_nullable_keys<T: DeserializeOwned>(value: serde_json::Value, keys: &[&str]) {
        serde_json::from_value::<T>(value.clone())
            .unwrap_or_else(|error| panic!("complete {} must deserialize: {error}", std::any::type_name::<T>()));
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
            "name": "Helper", "system_prompt": "Help", "model_id": null, "temperature": null,
            "top_p": null, "max_tokens": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::assistant::AssistantUpdateRequest>(serde_json::json!({
            "id": "assistant-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::emoji::EmojiPackCreateRequest>(serde_json::json!({
            "name": "Pack", "description": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::mcp::McpServerCreateRequest>(serde_json::json!({
            "name": "Server", "transport_type": "stdio", "command": null, "args": null,
            "env": null, "url": null, "headers": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::mcp::McpServerUpdateRequest>(serde_json::json!({
            "id": "server-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::mcp::McpToolEnabledUpdateRequest>(serde_json::json!({
            "server_id": "server-1", "tool_name": "list", "enabled": true, "future_field": true
        }));
        assert!(
            serde_json::from_value::<crate::commands::mcp::McpServerUpdateRequest>(
                serde_json::json!({ "name": "Server" })
            )
            .is_err(),
            "McpServerUpdateRequest.id must be required",
        );
        rejects_unknown::<crate::commands::memory::MemoryUpdateRequest>(serde_json::json!({
            "id": "memory-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::memory::MemoryCreateRequest>(serde_json::json!({
            "scope": "project", "project_id": "project-1", "subject_scope_id": null,
            "key": "preference", "content": "concise", "memory_type": null,
            "owner_only": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::project::ProjectCreateRequest>(serde_json::json!({
            "name": "Project", "path": null, "source_type": "local", "source_id": null,
            "assistant_id": null, "description": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::project::ProjectUpdateRequest>(serde_json::json!({
            "id": "project-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::provider::ProviderCreateRequest>(serde_json::json!({
            "name": "OpenAI", "provider_type": "openai", "base_url": "https://example.invalid",
            "api_format": null, "catalog_id": null, "auth_option": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::provider::ProviderUpdateRequest>(serde_json::json!({
            "id": "provider-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::skill::SkillCreateRequest>(serde_json::json!({
            "dir_name": "review", "llm_description": "Review", "body": "Body",
            "display_name": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::skill::SkillUpdateRequest>(serde_json::json!({
            "dir_name": "review", "future_field": true
        }));
        rejects_unknown::<crate::commands::tool_system::CustomToolCreateRequest>(serde_json::json!({
            "name": "Echo", "description": "Echo", "command": "echo", "category_id": null,
            "parameters_schema": null, "args_template": null, "execution": null, "working_directory": null,
            "timeout_ms": null, "permission": null, "future_field": true
        }));
        rejects_unknown::<crate::commands::tool_system::CustomToolUpdateRequest>(serde_json::json!({
            "id": "tool-1", "future_field": true
        }));
        rejects_unknown::<crate::commands::tool_system::ToolPresetCreateRequest>(serde_json::json!({
            "name": "Default", "description": null, "tool_names": [], "future_field": true
        }));
        rejects_unknown::<crate::commands::tool_system::ToolPresetUpdateRequest>(serde_json::json!({
            "id": "preset-1", "future_field": true
        }));
    }

    #[test]
    fn named_create_requests_require_every_nullable_key() {
        requires_nullable_keys::<crate::commands::assistant::AssistantCreateRequest>(
            serde_json::json!({
                "name": "Helper", "system_prompt": "Help", "model_id": null,
                "temperature": null, "top_p": null, "max_tokens": null
            }),
            &["model_id", "temperature", "top_p", "max_tokens"],
        );
        requires_nullable_keys::<crate::commands::emoji::EmojiPackCreateRequest>(
            serde_json::json!({ "name": "Pack", "description": null }),
            &["description"],
        );
        requires_nullable_keys::<crate::commands::mcp::McpServerCreateRequest>(
            serde_json::json!({
                "name": "Server", "transport_type": "stdio", "command": null,
                "args": null, "env": null, "url": null, "headers": null
            }),
            &["command", "args", "env", "url", "headers"],
        );
        requires_nullable_keys::<crate::commands::memory::MemoryCreateRequest>(
            serde_json::json!({
                "scope": "project", "project_id": "project-1", "subject_scope_id": null,
                "key": "preference", "content": "concise", "memory_type": null,
                "owner_only": null
            }),
            &["project_id", "subject_scope_id", "memory_type", "owner_only"],
        );
        requires_nullable_keys::<crate::commands::project::ProjectCreateRequest>(
            serde_json::json!({
                "name": "Project", "path": null, "source_type": "local", "source_id": null,
                "assistant_id": null, "description": null
            }),
            &["path", "source_id", "assistant_id", "description"],
        );
        requires_nullable_keys::<crate::commands::skill::SkillCreateRequest>(
            serde_json::json!({
                "dir_name": "review", "llm_description": "Review", "body": "Body",
                "display_name": null
            }),
            &["display_name"],
        );
        requires_nullable_keys::<crate::commands::tool_system::CustomToolCreateRequest>(
            serde_json::json!({
                "name": "Echo", "description": "Echo", "command": "echo", "category_id": null,
                "parameters_schema": null, "args_template": null, "execution": null, "working_directory": null,
                "timeout_ms": null, "permission": null
            }),
            &[
                "category_id",
                "parameters_schema",
                "args_template",
                "execution",
                "working_directory",
                "timeout_ms",
                "permission",
            ],
        );
        requires_nullable_keys::<crate::commands::tool_system::ToolPresetCreateRequest>(
            serde_json::json!({ "name": "Default", "description": null, "tool_names": [] }),
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
            serde_json::from_value::<crate::commands::skill::SkillUpdateRequest>(serde_json::json!({
                "is_enabled": true
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
