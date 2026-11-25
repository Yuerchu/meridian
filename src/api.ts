// Not `@tauri-apps/api/core`. Every method below is unchanged by that: the
// transport keeps Tauri's signature and answers locally unless this session was
// pointed at another machine. See `lib/transport.ts`.
import { invoke } from '@/lib/transport'
import type {
  AcpCheckResponse,
  AcpConfigInfoResponse,
  AcpConfigOptionListResponse,
  AcpConfigUpdateRequest,
  AcpConversationSessionInfoResponse,
  AcpDiscoveredSessionListResponse,
  AcpImportSessionRequest,
  AcpImportSessionResponse,
  AcpLiveConversationIdsResponse,
  AcpPromptSendRequest,
  AcpSessionAttachRequest,
  AcpSessionCloseRequest,
  AcpSessionConfigReadRequest,
  AcpSessionConfigUpdateRequest,
  AcpSessionListRequest,
  AcpSessionOpenRequest,
  AcpSessionReadRequest,
  AcpTurnStopRequest,
  AndroidImeStatusInfoResponse,
  AppInfoResponse,
  ApprovalDecisionRequest,
  AssistantCreateRequest,
  AssistantDeleteRequest,
  AssistantInfoResponse,
  AssistantListResponse,
  AssistantUpdateRequest,
  BackgroundTaskCountListResponse,
  BackgroundTaskInfoResponse,
  BackgroundTaskListRequest,
  BackgroundTaskListResponse,
  BackgroundTaskOutputInfoResponse,
  BackgroundTaskOutputReadRequest,
  BackgroundTaskStopRequest,
  BoardTaskCreateRequest,
  BoardTaskDeleteRequest,
  BoardTaskInfoResponse,
  BoardTaskListResponse,
  BoardTaskStartRequest,
  BoardTaskStartResponse,
  BoardTaskUpdateRequest,
  BoardTaskWorktreeDeleteRequest,
  ChatStartRequest,
  ChatStopRequest,
  CodexAuthStatusResponse,
  ComposerDraftDeleteRequest,
  ComposerDraftInfoResponse,
  ComposerDraftReadRequest,
  ComposerDraftUpsertRequest,
  ComposerDraftWriteResponse,
  ContextInfoResponse,
  ConversationCompactionRequest,
  ConversationContextReadRequest,
  ConversationCreateRequest,
  ConversationDeleteRequest,
  ConversationExportRequest,
  ConversationExportResponse,
  ConversationInfoResponse,
  ConversationListRequest,
  ConversationListResponse,
  ConversationSearchHitListResponse,
  ConversationSearchRequest,
  ConversationSnapshotRequest,
  ConversationSnapshotResponse,
  ConversationSteerRequest,
  ConversationUpdateRequest,
  CustomToolCreateRequest,
  CustomToolDeleteRequest,
  CustomToolInfoResponse,
  CustomToolListResponse,
  CustomToolUpdateRequest,
  EmojiDeleteRequest,
  EmojiFileUrlReadRequest,
  EmojiImportRequest,
  EmojiInfoResponse,
  EmojiListRequest,
  EmojiListResponse,
  EmojiPackAssignmentUpdateRequest,
  EmojiPackCreateRequest,
  EmojiPackDeleteRequest,
  EmojiPackInfoResponse,
  EmojiPackListRequest,
  EmojiPackListResponse,
  EmojiSemanticsSuggestRequest,
  EmojiUpdateRequest,
  FileNameResolveRequest,
  FontFamilyListResponse,
  HookConfigInfoResponse,
  HookConfigUpdateRequest,
  HookStatusInfoResponse,
  ImeConfigInfoResponse,
  ImeConfigUpdateRequest,
  ImeDictionaryDeleteRequest,
  ImeDictionaryImportReportResponse,
  ImeDictionaryListResponse,
  ImeDictionaryStageRequest,
  ImeDictionaryStagedCancelRequest,
  ImeDictionaryStagedImportRequest,
  ImeDictionaryStagedInfoResponse,
  ImeDictionaryToggleRequest,
  ImeLearningDeleteRequest,
  ImeLearningExportInfoResponse,
  ImeLearningExportRequest,
  ImeLearningImportRequest,
  ImeLearningInfoResponse,
  ImeLmDeleteRequest,
  ImeLmImportRequest,
  ImeLmStatusInfoResponse,
  ImeMemoryHintsInfoResponse,
  ImeProfileUpdateRequest,
  ImeStatusInfoResponse,
  JournalBlameRequest,
  JournalBlameResponse,
  JournalFileHistoryRequest,
  JournalVersionContentRequest,
  JournalVersionContentResponse,
  JournalVersionListResponse,
  LaunchRequestInfoResponse,
  LocalImagePreviewRequest,
  LocalImagePreviewResponse,
  LocalModelInfoResponse,
  LocalModelInspectRequest,
  LogExportRequest,
  LogExportResponse,
  LogFileListResponse,
  LogLevelUpdateRequest,
  LogPageResponse,
  LogQueryRequest,
  LogSettingsResponse,
  McpConnectionStatusListResponse,
  McpServerConnectRequest,
  McpServerCreateRequest,
  McpServerDeleteRequest,
  McpServerDisconnectRequest,
  McpServerInfoResponse,
  McpServerListResponse,
  McpServerToolListResponse,
  McpServerUpdateRequest,
  McpToolEnabledUpdateRequest,
  McpToolListRequest,
  McpToolListResponse,
  MemoryCreateRequest,
  MemoryDeleteRequest,
  MemoryEnumsResponse,
  MemoryInfoResponse,
  MemoryListRequest,
  MemoryListResponse,
  MemoryRestoreRequest,
  MemorySubjectDeleteRequest,
  MemorySubjectListResponse,
  MemorySubjectUpdateRequest,
  MemoryUpdateRequest,
  MessageBranchSwitchRequest,
  MessageContextContentResponse,
  MessageContextReadRequest,
  MessageDeleteRequest,
  MessageFileUploadRequest,
  MessageMediaExportRequest,
  MessageRatingUpdateRequest,
  ModelConfigDeleteRequest,
  ModelConfigInfoResponse,
  ModelConfigListRequest,
  ModelConfigListResponse,
  ModelConfigReadRequest,
  ModelConfigUpsertRequest,
  ModelProfileListResponse,
  OneBotConfigInfoResponse,
  OneBotConfigUpdateRequest,
  OneBotStatusInfoResponse,
  PendingApprovalListResponse,
  PlanDocumentInfoResponse,
  PlanFileConflictResolveRequest,
  PlanReviewDecisionRequest,
  PlanReviewDecisionResponse,
  PlanReviewDraftDeleteRequest,
  PlanReviewDraftSaveRequest,
  PlanReviewDraftSaveResponse,
  PlanReviewInfoResponse,
  PlanReviewReadRequest,
  PlanRevisionListRequest,
  PlanRevisionListResponse,
  PlatformInfoResponse,
  PreferenceInfoResponse,
  PreferenceKey,
  PreferenceReadRequest,
  PreferenceUpdateRequest,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectInfoResponse,
  ProjectListResponse,
  ProjectUpdateRequest,
  ProviderBalanceInfoResponse,
  ProviderBalanceReadRequest,
  ProviderCapabilitiesInfoResponse,
  ProviderCapabilitiesReadRequest,
  ProviderCatalogEntryListResponse,
  ProviderCreateRequest,
  ProviderDeleteRequest,
  ProviderInfoResponse,
  ProviderKeyTestRequest,
  ProviderKeyUpdateRequest,
  ProviderListResponse,
  ProviderLocalModelReadRequest,
  ProviderModelListRequest,
  ProviderModelListResponse,
  ProviderUpdateRequest,
  QueuedPromptCreateRequest,
  QueuedPromptDeleteRequest,
  QueuedPromptInfoResponse,
  QueuedPromptListRequest,
  QueuedPromptListResponse,
  QueuedPromptReleaseRequest,
  QueuedPromptReorderRequest,
  QueuedPromptUpdateRequest,
  RemoteAddressesResponse,
  RemoteConfigInfoResponse,
  RemoteConfigUpdateRequest,
  RemoteStatusResponse,
  SafRootDeleteRequest,
  SafRootListResponse,
  SecretDeleteRequest,
  SecretReadRequest,
  SecretUpsertRequest,
  ServiceKeyTestRequest,
  ServiceKeyUpdateRequest,
  SkillBindingListRequest,
  SkillBindingNamesResponse,
  SkillBindingUpdateRequest,
  SkillBodyReadRequest,
  SkillCreateRequest,
  SkillDeleteRequest,
  SkillInfoResponse,
  SkillListResponse,
  SkillUpdateRequest,
  SystemNoticeDeleteRequest,
  SystemNoticeListResponse,
  TodoInfoResponse,
  TodoListReadRequest,
  ToolCategoryListResponse,
  ToolPresetCreateRequest,
  ToolPresetDeleteRequest,
  ToolPresetInfoResponse,
  ToolPresetListResponse,
  ToolPresetUpdateRequest,
  UploadFileResponse,
  UsageBucketListResponse,
  UsageCacheMissInfoResponse,
  UsageCacheMissRequest,
  UsageGapListRequest,
  UsageGapListResponse,
  UsageReportRequest,
  UserCommandActiveReadRequest,
  UserCommandResultReadRequest,
  UserCommandResultResponse,
  UserCommandRunRequest,
  VoiceCorpusDeleteRequest,
  VoiceCorpusDeleteResponse,
  VoiceCorpusExportRequest,
  VoiceCorpusExportResponse,
  VoiceCorpusForgetRequest,
  VoiceCorpusForgetResponse,
  VoiceCorpusOptoutUpdateRequest,
  VoiceCorpusSessionListResponse,
  VoiceModelDownloadRequest,
  VoiceModelImportRequest,
  VoiceModelStatusInfoResponse,
  VoicePcmTranscriptionRequest,
  VoiceProbeEchoRequest,
  VoiceSendReadinessInfoResponse,
  VoiceTranscriptResponse,
  WindowInsetsInfoResponse,
  WorkspaceEditorOpenRequest,
  WorkspaceFileContentResponse,
  WorkspaceFileReadRequest,
  WorkspaceGitDiffRequest,
  WorkspaceGitDiffResponse,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResponse,
  WorkspaceReferencePreviewResponse,
  WorkspaceReferenceProbeRequest,
  WorkspaceReferenceProbeResponse,
  WorkspaceReferenceResolveRequest,
  WorkspaceReferenceSuggestRequest,
  WorkspaceReferenceSuggestionListResponse,
  WorkspaceRootRequest,
  WorkspaceRootResponse,
  WorkspaceTreeEntryListResponse,
  WorkspaceTreeRequest,
} from '@/types'

/**
 * First-party IPC client grouped by resource namespace (`.claude/rules/ipc.md`).
 *
 * Every parameterized command takes a single `snake_case` `request` object and
 * routes through `invoke<T>(cmd, { request })`, which is also the sole AST
 * entry point for `scripts/generate-invoke-response-schema.mjs`.
 */
export const api = {
  chat: {
    start: (request: ChatStartRequest) => invoke<void>('start_chat', { request }),
    stop: (request: ChatStopRequest) => invoke<void>('stop_chat', { request }),
  },

  conversations: {
    list: (request: ConversationListRequest) => invoke<ConversationListResponse>('list_conversations', { request }),
    create: (request: ConversationCreateRequest) =>
      invoke<ConversationInfoResponse>('create_conversation', { request }),
    update: (request: ConversationUpdateRequest) =>
      invoke<ConversationInfoResponse>('update_conversation', { request }),
    search: (request: ConversationSearchRequest) =>
      invoke<ConversationSearchHitListResponse>('search_conversations', { request }),
    delete: (request: ConversationDeleteRequest) => invoke<void>('delete_conversation', { request }),
    compact: (request: ConversationCompactionRequest) => invoke<void>('invoke_conversation_compaction', { request }),
    getContext: (request: ConversationContextReadRequest) =>
      invoke<ContextInfoResponse>('get_conversation_context', { request }),
    getSnapshot: (request: ConversationSnapshotRequest) =>
      invoke<ConversationSnapshotResponse>('get_conversation_snapshot', { request }),
    export: (request: ConversationExportRequest) =>
      invoke<ConversationExportResponse>('export_conversation', { request }),
  },

  messages: {
    readContextItem: (request: MessageContextReadRequest) =>
      invoke<MessageContextContentResponse>('read_message_context_item', { request }),
    switchBranch: (request: MessageBranchSwitchRequest) => invoke<void>('switch_message_branch', { request }),
    delete: (request: MessageDeleteRequest) => invoke<void>('delete_message', { request }),
    updateRating: (request: MessageRatingUpdateRequest) => invoke<void>('update_message_rating', { request }),
    exportMedia: (request: MessageMediaExportRequest) => invoke<void>('export_message_media', { request }),
    uploadFile: (request: MessageFileUploadRequest) => invoke<UploadFileResponse>('upload_message_file', { request }),
    readLocalImagePreview: (request: LocalImagePreviewRequest) =>
      invoke<LocalImagePreviewResponse>('read_local_image_preview', { request }),
  },

  userCommands: {
    invoke: (request: UserCommandRunRequest) => invoke<UserCommandResultResponse>('invoke_user_command', { request }),
    getResult: (request: UserCommandResultReadRequest) =>
      invoke<UserCommandResultResponse | null>('get_user_command_result', { request }),
    getActive: (request: UserCommandActiveReadRequest) => invoke<string | null>('get_active_user_command', { request }),
  },

  planReview: {
    get: (request: PlanReviewReadRequest) => invoke<PlanReviewInfoResponse>('get_plan_review', { request }),
    listRevisions: (request: PlanRevisionListRequest) =>
      invoke<PlanRevisionListResponse>('list_plan_revisions', { request }),
    setDraft: (request: PlanReviewDraftSaveRequest) =>
      invoke<PlanReviewDraftSaveResponse>('set_plan_review_draft', { request }),
    deleteDraft: (request: PlanReviewDraftDeleteRequest) =>
      invoke<PlanReviewInfoResponse>('delete_plan_review_draft', { request }),
    submitDecision: (request: PlanReviewDecisionRequest) =>
      invoke<PlanReviewDecisionResponse>('submit_plan_review_decision', { request }),
    resolveConflict: (request: PlanFileConflictResolveRequest) =>
      invoke<PlanDocumentInfoResponse>('resolve_plan_file_conflict', { request }),
  },

  secrets: {
    set: (request: SecretUpsertRequest) => invoke<void>('set_secret', { request }),
    get: (request: SecretReadRequest) => invoke<string | null>('get_secret', { request }),
    delete: (request: SecretDeleteRequest) => invoke<boolean>('delete_secret', { request }),
  },

  assistants: {
    list: () => invoke<AssistantListResponse>('list_assistants'),
    create: (request: AssistantCreateRequest) => invoke<AssistantInfoResponse>('create_assistant', { request }),
    update: (request: AssistantUpdateRequest) => invoke<AssistantInfoResponse>('update_assistant', { request }),
    delete: (request: AssistantDeleteRequest) => invoke<void>('delete_assistant', { request }),
  },

  providers: {
    listCatalog: () => invoke<ProviderCatalogEntryListResponse>('list_provider_catalog'),
    getCodexAuthStatus: () => invoke<CodexAuthStatusResponse>('get_codex_auth_status'),
    list: () => invoke<ProviderListResponse>('list_providers'),
    create: (request: ProviderCreateRequest) => invoke<ProviderInfoResponse>('create_provider', { request }),
    update: (request: ProviderUpdateRequest) => invoke<ProviderInfoResponse>('update_provider', { request }),
    delete: (request: ProviderDeleteRequest) => invoke<void>('delete_provider', { request }),
    setKey: (request: ProviderKeyUpdateRequest) => invoke<void>('set_provider_key', { request }),
    testKey: (request: ProviderKeyTestRequest) => invoke<boolean>('test_provider_key', { request }),
    listModels: (request: ProviderModelListRequest) =>
      invoke<ProviderModelListResponse>('list_provider_models', { request }),
    getCapabilities: (request: ProviderCapabilitiesReadRequest) =>
      invoke<ProviderCapabilitiesInfoResponse>('get_provider_capabilities', { request }),
    getBalance: (request: ProviderBalanceReadRequest) =>
      invoke<ProviderBalanceInfoResponse | null>('get_provider_balance', { request }),
    testLocalModel: (request: LocalModelInspectRequest) =>
      invoke<LocalModelInfoResponse>('test_local_model', { request }),
    getLocalModel: (request: ProviderLocalModelReadRequest) =>
      invoke<LocalModelInfoResponse>('get_provider_local_model', { request }),
  },

  modelConfigs: {
    list: (request: ModelConfigListRequest) => invoke<ModelConfigListResponse>('list_model_configs', { request }),
    listProfiles: () => invoke<ModelProfileListResponse>('list_model_profiles'),
    get: (request: ModelConfigReadRequest) => invoke<ModelConfigInfoResponse | null>('get_model_config', { request }),
    set: (request: ModelConfigUpsertRequest) => invoke<ModelConfigInfoResponse>('set_model_config', { request }),
    delete: (request: ModelConfigDeleteRequest) => invoke<void>('delete_model_config', { request }),
  },

  projects: {
    list: () => invoke<ProjectListResponse>('list_projects'),
    create: (request: ProjectCreateRequest) => invoke<ProjectInfoResponse>('create_project', { request }),
    update: (request: ProjectUpdateRequest) => invoke<ProjectInfoResponse>('update_project', { request }),
    delete: (request: ProjectDeleteRequest) => invoke<void>('delete_project', { request }),
  },

  workspace: {
    getRoot: (request: WorkspaceRootRequest) => invoke<WorkspaceRootResponse>('get_workspace_root', { request }),
    listEntries: (request: WorkspaceTreeRequest) =>
      invoke<WorkspaceTreeEntryListResponse>('list_workspace_entries', { request }),
    readFile: (request: WorkspaceFileReadRequest) =>
      invoke<WorkspaceFileContentResponse>('read_workspace_file', { request }),
    searchRefs: (request: WorkspaceReferenceSuggestRequest) =>
      invoke<WorkspaceReferenceSuggestionListResponse>('search_workspace_refs', { request }),
    resolveRef: (request: WorkspaceReferenceResolveRequest) =>
      invoke<WorkspaceReferencePreviewResponse>('resolve_workspace_ref', { request }),
    testRef: (request: WorkspaceReferenceProbeRequest) =>
      invoke<WorkspaceReferenceProbeResponse>('test_workspace_ref', { request }),
    getGitStatus: (request: WorkspaceGitStatusRequest) =>
      invoke<WorkspaceGitStatusResponse>('get_workspace_git_status', { request }),
    getGitDiff: (request: WorkspaceGitDiffRequest) =>
      invoke<WorkspaceGitDiffResponse>('get_workspace_git_diff', { request }),
    openEditor: (request: WorkspaceEditorOpenRequest) => invoke<void>('open_workspace_editor', { request }),
  },

  journal: {
    getBlame: (request: JournalBlameRequest) => invoke<JournalBlameResponse>('get_journal_blame', { request }),
    listVersions: (request: JournalFileHistoryRequest) =>
      invoke<JournalVersionListResponse>('list_journal_versions', { request }),
    readVersion: (request: JournalVersionContentRequest) =>
      invoke<JournalVersionContentResponse>('read_journal_version', { request }),
  },

  memories: {
    list: (request: MemoryListRequest) => invoke<MemoryListResponse>('list_memories', { request }),
    create: (request: MemoryCreateRequest) => invoke<MemoryInfoResponse>('create_memory', { request }),
    update: (request: MemoryUpdateRequest) => invoke<MemoryInfoResponse>('update_memory', { request }),
    delete: (request: MemoryDeleteRequest) => invoke<number>('delete_memories', { request }),
    restore: (request: MemoryRestoreRequest) => invoke<number>('restore_memories', { request }),
    listSubjects: () => invoke<MemorySubjectListResponse>('list_memory_subjects'),
    deleteSubject: (request: MemorySubjectDeleteRequest) => invoke<number>('delete_memory_subject', { request }),
    updateSubject: (request: MemorySubjectUpdateRequest) => invoke<void>('update_memory_subject', { request }),
    getEnums: () => invoke<MemoryEnumsResponse>('get_memory_enums'),
  },

  todos: {
    get: (request: TodoListReadRequest) => invoke<TodoInfoResponse | null>('get_todo_list', { request }),
  },

  usage: {
    getReport: (request: UsageReportRequest) => invoke<UsageBucketListResponse>('get_usage_report', { request }),
    listGaps: (request: UsageGapListRequest) => invoke<UsageGapListResponse>('list_usage_gaps', { request }),
    getCacheMisses: (request: UsageCacheMissRequest) =>
      invoke<UsageCacheMissInfoResponse>('get_usage_cache_misses', { request }),
  },

  preferences: {
    get: <K extends PreferenceKey>(request: PreferenceReadRequest<K>) =>
      invoke<PreferenceInfoResponse<K>>('get_preference', { request }),
    set: (request: PreferenceUpdateRequest) => invoke<void>('set_preference', { request }),
  },

  mcp: {
    listServers: () => invoke<McpServerListResponse>('list_mcp_servers'),
    createServer: (request: McpServerCreateRequest) => invoke<McpServerInfoResponse>('create_mcp_server', { request }),
    updateServer: (request: McpServerUpdateRequest) => invoke<McpServerInfoResponse>('update_mcp_server', { request }),
    deleteServer: (request: McpServerDeleteRequest) => invoke<void>('delete_mcp_server', { request }),
    connectServer: (request: McpServerConnectRequest) => invoke<void>('connect_mcp_server', { request }),
    disconnectServer: (request: McpServerDisconnectRequest) => invoke<void>('disconnect_mcp_server', { request }),
    setToolEnabled: (request: McpToolEnabledUpdateRequest) =>
      invoke<McpServerInfoResponse>('set_mcp_tool_enabled', { request }),
    listServerTools: (request: McpToolListRequest) => invoke<McpServerToolListResponse>('list_mcp_tools', { request }),
    listConnectionStatuses: () => invoke<McpConnectionStatusListResponse>('list_mcp_connection_statuses'),
    listAllTools: () => invoke<McpToolListResponse>('list_tools'),
  },

  approvals: {
    listPending: () => invoke<PendingApprovalListResponse>('list_pending_approvals'),
    submitDecision: (request: ApprovalDecisionRequest) => invoke<void>('submit_approval_decision', { request }),
  },

  subAgents: {
    steer: (request: ConversationSteerRequest) => invoke<void>('send_conversation_steer', { request }),
  },

  platform: {
    getInfo: () => invoke<PlatformInfoResponse>('get_platform'),
    getWindowInsets: () => invoke<WindowInsetsInfoResponse>('get_window_insets'),
    listSystemFonts: () => invoke<FontFamilyListResponse>('list_system_fonts'),
    takeLaunchRequest: () => invoke<LaunchRequestInfoResponse | null>('take_launch_request'),
    getManageStorageStatus: () => invoke<boolean>('get_manage_storage_status'),
    openManageStorageSettings: () => invoke<void>('open_manage_storage_settings'),
    selectSafDirectory: () => invoke<SafRootListResponse>('select_saf_directory'),
    listSafRoots: () => invoke<SafRootListResponse>('list_saf_roots'),
    deleteSafRoot: (request: SafRootDeleteRequest) => invoke<SafRootListResponse>('delete_saf_root', { request }),
    selectCameraPhoto: () => invoke<string | null>('select_camera_photo'),
    selectGalleryImage: () => invoke<string | null>('select_gallery_image'),
    resolveFileName: (request: FileNameResolveRequest) => invoke<string>('resolve_file_name', { request }),
    getAppInfo: () => invoke<AppInfoResponse>('get_app_info'),
  },

  onebot: {
    getStatus: () => invoke<OneBotStatusInfoResponse>('get_onebot_status'),
    getConfig: () => invoke<OneBotConfigInfoResponse>('get_onebot_config'),
    setConfig: (request: OneBotConfigUpdateRequest) =>
      invoke<OneBotConfigInfoResponse>('set_onebot_config', { request }),
    getVoiceReadiness: () => invoke<VoiceSendReadinessInfoResponse>('get_onebot_voice_readiness'),
    start: () => invoke<void>('start_onebot'),
    stop: () => invoke<void>('stop_onebot'),
  },

  hooks: {
    getStatus: () => invoke<HookStatusInfoResponse>('get_hooks_status'),
    getConfig: () => invoke<HookConfigInfoResponse>('get_hooks_config'),
    setConfig: (request: HookConfigUpdateRequest) => invoke<HookConfigInfoResponse>('set_hooks_config', { request }),
    resetToken: () => invoke<string>('reset_hooks_token'),
    start: () => invoke<void>('start_hooks'),
    stop: () => invoke<void>('stop_hooks'),
  },

  board: {
    listTasks: () => invoke<BoardTaskListResponse>('list_board_tasks'),
    createTask: (request: BoardTaskCreateRequest) => invoke<BoardTaskInfoResponse>('create_board_task', { request }),
    updateTask: (request: BoardTaskUpdateRequest) => invoke<BoardTaskInfoResponse>('update_board_task', { request }),
    startTask: (request: BoardTaskStartRequest) => invoke<BoardTaskStartResponse>('start_board_task', { request }),
    deleteTaskWorktree: (request: BoardTaskWorktreeDeleteRequest) =>
      invoke<BoardTaskInfoResponse>('delete_board_task_worktree', { request }),
    deleteTask: (request: BoardTaskDeleteRequest) => invoke<void>('delete_board_task', { request }),
  },

  acp: {
    openSession: (request: AcpSessionOpenRequest) => invoke<string>('open_acp_session', { request }),
    sendPrompt: (request: AcpPromptSendRequest) => invoke<void>('send_acp_prompt', { request }),
    listSessions: (request: AcpSessionListRequest) =>
      invoke<AcpDiscoveredSessionListResponse>('list_acp_sessions', { request }),
    importSession: (request: AcpImportSessionRequest) =>
      invoke<AcpImportSessionResponse>('import_acp_session', { request }),
    attachSession: (request: AcpSessionAttachRequest) => invoke<void>('attach_acp_session', { request }),
    getSession: (request: AcpSessionReadRequest) =>
      invoke<AcpConversationSessionInfoResponse | null>('get_acp_session', { request }),
    stopTurn: (request: AcpTurnStopRequest) => invoke<void>('stop_acp_turn', { request }),
    closeSession: (request: AcpSessionCloseRequest) => invoke<void>('close_acp_session', { request }),
    listLiveSessions: () => invoke<AcpLiveConversationIdsResponse>('list_live_acp_sessions'),
    getSessionConfig: (request: AcpSessionConfigReadRequest) =>
      invoke<AcpConfigOptionListResponse>('get_acp_session_config', { request }),
    setSessionConfig: (request: AcpSessionConfigUpdateRequest) =>
      invoke<AcpConfigOptionListResponse>('set_acp_session_config', { request }),
    getConfig: () => invoke<AcpConfigInfoResponse>('get_acp_config'),
    setConfig: (request: AcpConfigUpdateRequest) => invoke<AcpConfigInfoResponse>('set_acp_config', { request }),
    testAdapter: () => invoke<AcpCheckResponse>('test_acp_adapter'),
  },

  queue: {
    list: (request: QueuedPromptListRequest) => invoke<QueuedPromptListResponse>('list_queued_prompts', { request }),
    create: (request: QueuedPromptCreateRequest) =>
      invoke<QueuedPromptInfoResponse>('create_queued_prompt', { request }),
    delete: (request: QueuedPromptDeleteRequest) => invoke<void>('delete_queued_prompt', { request }),
    setOrder: (request: QueuedPromptReorderRequest) => invoke<void>('set_queued_prompt_order', { request }),
    update: (request: QueuedPromptUpdateRequest) => invoke<void>('update_queued_prompt', { request }),
    start: (request: QueuedPromptReleaseRequest) => invoke<void>('start_queued_prompts', { request }),
  },

  backgroundTasks: {
    list: (request: BackgroundTaskListRequest) =>
      invoke<BackgroundTaskListResponse>('list_background_tasks', { request }),
    listCounts: () => invoke<BackgroundTaskCountListResponse>('list_background_task_counts'),
    stop: (request: BackgroundTaskStopRequest) =>
      invoke<BackgroundTaskInfoResponse>('stop_background_task', { request }),
    readOutput: (request: BackgroundTaskOutputReadRequest) =>
      invoke<BackgroundTaskOutputInfoResponse>('read_background_task_output', { request }),
  },

  composerDrafts: {
    get: (request: ComposerDraftReadRequest) =>
      invoke<ComposerDraftInfoResponse | null>('get_composer_draft', { request }),
    set: (request: ComposerDraftUpsertRequest) => invoke<ComposerDraftWriteResponse>('set_composer_draft', { request }),
    delete: (request: ComposerDraftDeleteRequest) =>
      invoke<ComposerDraftWriteResponse>('delete_composer_draft', { request }),
  },

  remote: {
    getStatus: () => invoke<RemoteStatusResponse>('get_remote_status'),
    getConfig: () => invoke<RemoteConfigInfoResponse>('get_remote_config'),
    setConfig: (request: RemoteConfigUpdateRequest) =>
      invoke<RemoteConfigInfoResponse>('set_remote_config', { request }),
    start: () => invoke<RemoteStatusResponse>('start_remote'),
    stop: () => invoke<RemoteStatusResponse>('stop_remote'),
    resetToken: () => invoke<RemoteConfigInfoResponse>('reset_remote_token'),
    listAddresses: () => invoke<RemoteAddressesResponse>('list_remote_addresses'),
  },

  ime: {
    getStatus: () => invoke<ImeStatusInfoResponse>('get_ime_status'),
    getConfig: () => invoke<ImeConfigInfoResponse>('get_ime_config'),
    setConfig: (request: ImeConfigUpdateRequest) => invoke<ImeConfigInfoResponse>('set_ime_config', { request }),
    listDictionaries: () => invoke<ImeDictionaryListResponse>('list_ime_dictionaries'),
    stageDictionary: (request: ImeDictionaryStageRequest) =>
      invoke<ImeDictionaryStagedInfoResponse>('stage_ime_dictionary', { request }),
    importDictionaries: (request: ImeDictionaryStagedImportRequest) =>
      invoke<ImeDictionaryImportReportResponse[]>('import_ime_dictionaries', { request }),
    cancelDictionaryStaging: (request: ImeDictionaryStagedCancelRequest) =>
      invoke<void>('cancel_ime_dictionary_staging', { request }),
    importRimeIce: () => invoke<ImeDictionaryImportReportResponse[]>('import_ime_rime_ice'),
    setDictionaryEnabled: (request: ImeDictionaryToggleRequest) =>
      invoke<ImeDictionaryListResponse>('set_ime_dictionary_enabled', { request }),
    deleteDictionary: (request: ImeDictionaryDeleteRequest) =>
      invoke<ImeDictionaryListResponse>('delete_ime_dictionary', { request }),
    getLearning: () => invoke<ImeLearningInfoResponse>('get_ime_learning'),
    deleteLearning: (request: ImeLearningDeleteRequest) =>
      invoke<ImeLearningInfoResponse>('delete_ime_learning', { request }),
    exportLearning: (request: ImeLearningExportRequest) =>
      invoke<ImeLearningExportInfoResponse>('export_ime_learning', { request }),
    importLearning: (request: ImeLearningImportRequest) =>
      invoke<ImeLearningInfoResponse>('import_ime_learning', { request }),
    startHost: () => invoke<ImeStatusInfoResponse>('start_ime_host'),
    stopHost: () => invoke<ImeStatusInfoResponse>('stop_ime_host'),
    setProfileEnabled: (request: ImeProfileUpdateRequest) =>
      invoke<ImeStatusInfoResponse>('set_ime_profile_enabled', { request }),
    register: () => invoke<ImeStatusInfoResponse>('register_ime'),
    getLmStatus: () => invoke<ImeLmStatusInfoResponse>('get_ime_lm_status'),
    importLm: (request: ImeLmImportRequest) => invoke<ImeLmStatusInfoResponse>('import_ime_lm', { request }),
    deleteLm: (request: ImeLmDeleteRequest) => invoke<ImeLmStatusInfoResponse>('delete_ime_lm', { request }),
    refreshMemoryHints: () => invoke<ImeMemoryHintsInfoResponse>('invoke_ime_memory_hints_refresh'),
    getAndroidStatus: () => invoke<AndroidImeStatusInfoResponse>('get_android_ime_status'),
    openAndroidSettings: () => invoke<void>('open_android_ime_settings'),
    openAndroidPicker: () => invoke<void>('open_android_ime_picker'),
  },

  systemNotices: {
    list: () => invoke<SystemNoticeListResponse>('list_system_notices'),
    delete: (request: SystemNoticeDeleteRequest) => invoke<void>('delete_system_notice', { request }),
  },

  voice: {
    testEcho: (request: VoiceProbeEchoRequest) => invoke<number>('test_voice_echo', { request }),
    startPrewarm: () => invoke<void>('start_voice_prewarm'),
    stopPrewarm: () => invoke<void>('stop_voice_prewarm'),
    getModelStatus: () => invoke<VoiceModelStatusInfoResponse>('get_voice_model_status'),
    startModelDownload: (request: VoiceModelDownloadRequest) => invoke<void>('start_voice_model_download', { request }),
    stopModelDownload: () => invoke<void>('stop_voice_model_download'),
    importModel: (request: VoiceModelImportRequest) =>
      invoke<VoiceModelStatusInfoResponse>('import_voice_model', { request }),
    deleteModel: () => invoke<void>('delete_voice_model'),
    startRecording: () => invoke<void>('start_voice_recording'),
    stopRecording: () => invoke<VoiceTranscriptResponse>('stop_voice_recording'),
    cancelRecording: () => invoke<void>('cancel_voice_recording'),
    transcribePcm: (request: VoicePcmTranscriptionRequest) =>
      invoke<VoiceTranscriptResponse>('invoke_voice_transcription', { request }),
    listCorpus: () => invoke<VoiceCorpusSessionListResponse>('list_voice_corpus'),
    deleteCorpus: (request: VoiceCorpusDeleteRequest) =>
      invoke<VoiceCorpusDeleteResponse>('delete_voice_corpus', { request }),
    setOptout: (request: VoiceCorpusOptoutUpdateRequest) => invoke<void>('set_voice_optout', { request }),
    deleteSender: (request: VoiceCorpusForgetRequest) =>
      invoke<VoiceCorpusForgetResponse>('delete_voice_sender', { request }),
    exportCorpus: (request: VoiceCorpusExportRequest) =>
      invoke<VoiceCorpusExportResponse>('export_voice_corpus', { request }),
  },

  skills: {
    list: () => invoke<SkillListResponse>('list_skills'),
    rescan: () => invoke<SkillListResponse>('invoke_skill_rescan'),
    readBody: (request: SkillBodyReadRequest) => invoke<string>('read_skill_body', { request }),
    create: (request: SkillCreateRequest) => invoke<SkillInfoResponse>('create_skill', { request }),
    update: (request: SkillUpdateRequest) => invoke<SkillInfoResponse>('update_skill', { request }),
    delete: (request: SkillDeleteRequest) => invoke<void>('delete_skill', { request }),
    listBindings: (request: SkillBindingListRequest) =>
      invoke<SkillBindingNamesResponse>('list_skill_bindings', { request }),
    setBinding: (request: SkillBindingUpdateRequest) =>
      invoke<SkillBindingNamesResponse>('set_skill_binding', { request }),
  },

  logs: {
    read: (request: LogQueryRequest) => invoke<LogPageResponse>('read_logs', { request }),
    listFiles: () => invoke<LogFileListResponse>('list_log_files'),
    getSettings: () => invoke<LogSettingsResponse>('get_log_settings'),
    setLevel: (request: LogLevelUpdateRequest) => invoke<void>('set_log_level', { request }),
    export: (request: LogExportRequest) => invoke<LogExportResponse>('export_logs', { request }),
  },

  emojis: {
    listPacks: (request: EmojiPackListRequest) => invoke<EmojiPackListResponse>('list_emoji_packs', { request }),
    createPack: (request: EmojiPackCreateRequest) => invoke<EmojiPackInfoResponse>('create_emoji_pack', { request }),
    deletePack: (request: EmojiPackDeleteRequest) => invoke<void>('delete_emoji_pack', { request }),
    list: (request: EmojiListRequest) => invoke<EmojiListResponse>('list_emojis', { request }),
    import: (request: EmojiImportRequest) => invoke<EmojiListResponse>('import_emojis', { request }),
    delete: (request: EmojiDeleteRequest) => invoke<void>('delete_emoji', { request }),
    update: (request: EmojiUpdateRequest) => invoke<EmojiInfoResponse>('update_emoji', { request }),
    suggestSemantics: (request: EmojiSemanticsSuggestRequest) =>
      invoke<EmojiInfoResponse>('invoke_emoji_semantics_suggestion', { request }),
    setPackAssignment: (request: EmojiPackAssignmentUpdateRequest) =>
      invoke<void>('set_emoji_pack_assignment', { request }),
    getFileUrl: (request: EmojiFileUrlReadRequest) => invoke<string>('get_emoji_file_url', { request }),
  },

  tools: {
    listCategories: () => invoke<ToolCategoryListResponse>('list_tool_categories'),
    listCustom: () => invoke<CustomToolListResponse>('list_custom_tools'),
    createCustom: (request: CustomToolCreateRequest) =>
      invoke<CustomToolInfoResponse>('create_custom_tool', { request }),
    updateCustom: (request: CustomToolUpdateRequest) =>
      invoke<CustomToolInfoResponse>('update_custom_tool', { request }),
    deleteCustom: (request: CustomToolDeleteRequest) => invoke<void>('delete_custom_tool', { request }),
    listPresets: () => invoke<ToolPresetListResponse>('list_tool_presets'),
    createPreset: (request: ToolPresetCreateRequest) =>
      invoke<ToolPresetInfoResponse>('create_tool_preset', { request }),
    updatePreset: (request: ToolPresetUpdateRequest) =>
      invoke<ToolPresetInfoResponse>('update_tool_preset', { request }),
    deletePreset: (request: ToolPresetDeleteRequest) => invoke<void>('delete_tool_preset', { request }),
    setServiceKey: (request: ServiceKeyUpdateRequest) => invoke<void>('set_service_key', { request }),
    testServiceKey: (request: ServiceKeyTestRequest) => invoke<boolean>('test_service_key', { request }),
  },
}
