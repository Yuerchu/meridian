// Not `@tauri-apps/api/core`. Every method below is unchanged by that: the
// transport keeps Tauri's signature and answers locally unless this session was
// pointed at another machine. See `lib/transport.ts`.
import { invoke } from '@/lib/transport'
import type {
  AcpCheckResponse,
  AcpConfigInfoResponse,
  AcpConfigUpdateRequest,
  AcpConfigOptionListResponse,
  JournalBlameRequest,
  JournalBlameResponse,
  AcpConversationSessionInfoResponse,
  AcpDiscoveredSessionListResponse,
  AcpImportSessionRequest,
  AcpImportSessionResponse,
  AcpLiveConversationIdsResponse,
  AcpPromptSendRequest,
  AcpSessionAttachRequest,
  AcpSessionConfigReadRequest,
  AcpSessionConfigUpdateRequest,
  AcpSessionListRequest,
  AcpSessionOpenRequest,
  AskResponseRequest,
  AppInfoResponse,
  AssistantEmojiPackAssignmentRequest,
  AssistantInfoResponse,
  AssistantListResponse,
  AssistantCreateRequest,
  AssistantUpdateRequest,
  ChatRequest,
  ChatStopRequest,
  UserCommandRunRequest,
  UserCommandResultReadRequest,
  UserCommandResultResponse,
  CodexAuthStatusResponse,
  ContextInfoResponse,
  ConversationAcceptEditsUpdateRequest,
  ConversationAssistantUpdateRequest,
  ConversationCompactionRequest,
  ConversationCreateRequest,
  ConversationInfoResponse,
  ConversationListByProjectRequest,
  ConversationListResponse,
  ConversationModeUpdateRequest,
  ConversationProjectUpdateRequest,
  ConversationReasoningPreferencesUpdateRequest,
  ConversationSearchHitListResponse,
  ConversationSearchRequest,
  ConversationSnapshotRequest,
  ConversationSnapshotResponse,
  ConversationSteerRequest,
  ConversationExportRequest,
  ConversationExportResponse,
  ConversationTitleUpdateRequest,
  CustomToolInfoResponse,
  CustomToolListResponse,
  CustomToolCreateRequest,
  CustomToolUpdateRequest,
  EmojiInfoResponse,
  EmojiImportRequest,
  EmojiListResponse,
  EmojiPackCreateRequest,
  EmojiPackInfoResponse,
  EmojiPackListResponse,
  EmojiRenameRequest,
  EmojiSemanticsConfirmRequest,
  HookConfigInfoResponse,
  HookConfigUpdateRequest,
  HookStatusInfoResponse,
  ListenConfigInfoResponse,
  ListenConfigUpdateRequest,
  ListenAddressesResponse,
  JournalFileHistoryRequest,
  JournalVersionContentRequest,
  JournalVersionContentResponse,
  JournalVersionListResponse,
  ListenStatusResponse,
  ImeConfigInfoResponse,
  ImeConfigUpdateRequest,
  ImeDictionaryImportReportResponse,
  ImeDictionaryImportRequest,
  ImeDictionaryListResponse,
  ImeDictionaryRemoveRequest,
  ImeDictionaryToggleRequest,
  ImeProfileUpdateRequest,
  ImeStatusInfoResponse,
  LogFileListResponse,
  LogLevelUpdateRequest,
  LogExportRequest,
  LogExportResponse,
  LogPageResponse,
  LogQueryRequest,
  LogSettingsResponse,
  McpConnectionStatusListResponse,
  McpServerCreateRequest,
  McpServerInfoResponse,
  McpServerListResponse,
  McpServerUpdateRequest,
  McpServerToolListResponse,
  McpToolListResponse,
  MemoryInfoResponse,
  MemoryListResponse,
  MemoryEnumsResponse,
  MemoryScopedUpsertRequest,
  MemoryUpsertRequest,
  MemoryUpdateRequest,
  MemorySubjectListResponse,
  MemorySubjectFlagsUpdateRequest,
  MessageBranchSwitchRequest,
  MessageContextContentResponse,
  MessageContextReadRequest,
  MessageDeleteRequest,
  MessageFileBytesUploadRequest,
  MessageFileUploadRequest,
  MessageRatingUpdateRequest,
  ModelConfigInfoResponse,
  ModelConfigListResponse,
  ModelProfileListResponse,
  ModelConfigReadRequest,
  ModelConfigUpsertRequest,
  OneBotConfigInfoResponse,
  OneBotConfigUpdateRequest,
  ProviderModelListResponse,
  OneBotStatusInfoResponse,
  PendingApprovalListResponse,
  PlanDocumentInfoResponse,
  PlanFileConflictResolveRequest,
  PlanReviewDecisionRequest,
  PlanReviewDecisionResponse,
  PlanReviewDeliveryContinueRequest,
  PlanReviewDeliveryInfoResponse,
  PlanReviewDeliveryReadRequest,
  PlanReviewDraftDiscardRequest,
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
  ProjectInfoResponse,
  ProjectListResponse,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProviderInfoResponse,
  ProviderListResponse,
  ProviderCapabilitiesReadRequest,
  ProviderCreateRequest,
  ProviderKeyUpdateRequest,
  ProviderModelListRequest,
  ProviderUpdateRequest,
  ProviderBalanceInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ProviderCatalogEntryListResponse,
  QueuedPromptCreateRequest,
  QueuedPromptDeliveryUpdateRequest,
  QueuedPromptInfoResponse,
  QueuedPromptListResponse,
  QueuedPromptRemoveRequest,
  QueuedPromptReorderRequest,
  SafRootListResponse,
  SecretDeleteRequest,
  SecretReadRequest,
  SecretUpsertRequest,
  ServiceKey,
  ServiceKeyUpdateRequest,
  SkillInfoResponse,
  SkillBindingNamesResponse,
  SkillListResponse,
  SkillBindingListRequest,
  SkillBindingUpdateRequest,
  SkillCreateRequest,
  SkillUpdateRequest,
  TemplateVariableListResponse,
  TodoInfoResponse,
  ToolCallDenyRequest,
  ToolCategoryListResponse,
  ToolPresetCreateRequest,
  ToolPresetInfoResponse,
  ToolPresetListResponse,
  ToolPresetUpdateRequest,
  UsageReportRequest,
  UsageBucketListResponse,
  UploadFileResponse,
  VoiceModelDownloadRequest,
  VoiceModelImportRequest,
  VoiceModelStatusInfoResponse,
  VoicePcmTranscriptionRequest,
  VoiceProbeEchoRequest,
  VoiceSendReadinessInfoResponse,
  VoiceCorpusDeleteRequest,
  VoiceCorpusDeleteResponse,
  VoiceCorpusExportRequest,
  VoiceCorpusExportResponse,
  VoiceCorpusForgetRequest,
  VoiceCorpusForgetResponse,
  VoiceCorpusOptoutUpdateRequest,
  VoiceCorpusSessionListResponse,
  VoiceTranscriptResponse,
  WorkspaceEditorOpenRequest,
  WorkspaceFileContentResponse,
  WorkspaceFileReadRequest,
  WorkspaceGitDiffRequest,
  WorkspaceGitDiffResponse,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResponse,
  WorkspaceReferenceProbeRequest,
  WorkspaceReferenceProbeResponse,
  WorkspaceReferencePreviewResponse,
  WorkspaceReferenceResolveRequest,
  WorkspaceReferenceSuggestRequest,
  WorkspaceReferenceSuggestionListResponse,
  WorkspaceRootRequest,
  WorkspaceRootResponse,
  WorkspaceTreeEntryListResponse,
  WorkspaceTreeRequest,
  WindowInsetsInfoResponse,
} from './types'

export const api = {
  listConversations: (archived = false) => invoke<ConversationListResponse>('list_conversations', { archived }),

  createConversation: (request: ConversationCreateRequest = { title: null, projectId: null }) =>
    invoke<ConversationInfoResponse>('create_conversation', { request }),

  updateConversationTitle: (request: ConversationTitleUpdateRequest) =>
    invoke<void>('update_conversation_title', { request }),

  setConversationAssistant: (request: ConversationAssistantUpdateRequest) =>
    invoke<void>('set_conversation_assistant', { request }),

  setConversationReasoningPrefs: (request: ConversationReasoningPreferencesUpdateRequest) =>
    invoke<void>('set_conversation_reasoning_prefs', { request }),

  // Its own setter rather than another field on the one above: that one writes
  // two columns at once, so every caller has to pass the other's current value.
  setConversationMode: (request: ConversationModeUpdateRequest) => invoke<void>('set_conversation_mode', { request }),

  // Also its own setter, and kept apart from the mode for a second reason: a
  // mode narrows what the assistant may do, this widens what it may do without
  // asking. One call writing both would suggest they are the same kind of thing.
  setConversationAcceptEdits: (request: ConversationAcceptEditsUpdateRequest) =>
    invoke<void>('set_conversation_accept_edits', { request }),

  togglePinConversation: (id: string) => invoke<ConversationInfoResponse>('toggle_pin_conversation', { id }),

  toggleArchiveConversation: (id: string) => invoke<ConversationInfoResponse>('toggle_archive_conversation', { id }),

  /** Refile a conversation under another project, or under none (`null`). For
   *  a native conversation this also moves what the next turn resolves its
   *  working directory and file access against. */
  setConversationProject: (request: ConversationProjectUpdateRequest) =>
    invoke<void>('set_conversation_project', { request }),

  /** Conversations whose transcript says the query, newest mention first. */
  searchConversations: (request: ConversationSearchRequest) =>
    invoke<ConversationSearchHitListResponse>('search_conversations', { request }),

  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  compact: (request: ConversationCompactionRequest) => invoke<void>('compact', { request }),

  getContextInfo: (conversationId: string) => invoke<ContextInfoResponse>('get_context_info', { conversationId }),

  listModelConfigs: (providerId: string) => invoke<ModelConfigListResponse>('list_model_configs', { providerId }),

  /** The model descriptions a provider's model page can point at. */
  listModelProfiles: () => invoke<ModelProfileListResponse>('list_model_profiles'),

  getModelConfig: (request: ModelConfigReadRequest) =>
    invoke<ModelConfigInfoResponse | null>('get_model_config', { request }),

  saveModelConfig: (request: ModelConfigUpsertRequest) =>
    invoke<ModelConfigInfoResponse>('save_model_config', { request }),

  deleteModelConfig: (id: string) => invoke<void>('delete_model_config', { id }),

  /** Everything needed to draw a conversation, read as one state.
   *
   *  The only way to read a transcript. Fetching the tree, the row, the turns
   *  and the approvals separately is what this replaced: a running turn writes
   *  between such requests, and what came back described no moment that ever
   *  existed. */
  conversationSnapshot: (request: ConversationSnapshotRequest) =>
    invoke<ConversationSnapshotResponse>('conversation_snapshot', { request }),

  readMessageContextItem: (request: MessageContextReadRequest) =>
    invoke<MessageContextContentResponse>('read_message_context_item', { request }),

  /** Makes that message's branch active, landing on its most recent tip. Read
   *  the result back with `conversationSnapshot`. */
  switchBranch: (request: MessageBranchSwitchRequest) => invoke<void>('switch_branch', { request }),

  /** Deletes the message and everything descended from it. Read the result back
   *  with `conversationSnapshot`, same as a branch switch. */
  deleteMessage: (request: MessageDeleteRequest) => invoke<void>('delete_message', { request }),

  rateMessage: (request: MessageRatingUpdateRequest) => invoke<void>('rate_message', { request }),

  exportConversation: (request: ConversationExportRequest) =>
    invoke<ConversationExportResponse>('export_conversation', { request }),

  uploadFile: (request: MessageFileUploadRequest) => invoke<UploadFileResponse>('upload_file', { request }),

  uploadFileBytes: (request: MessageFileBytesUploadRequest) =>
    invoke<UploadFileResponse>('upload_file_bytes', { request }),

  // `turnId` says which run to stop. Without it the backend stops whatever is
  // running, which is what a reloaded window has to fall back on — but sending
  // it means "stop, then send again" can no longer cancel the new turn instead
  // of the old one.
  stopChat: (request: ChatStopRequest) => invoke<void>('stop_chat', { request }),

  /** Run a literal user-authored shell command without querying the model.
   *  Reusing `turnId` returns the persisted result rather than running again.
   *  `retryWithoutSandbox` succeeds only after this exact command was refused
   *  by the Windows restricted-token sandbox. */
  runUserCommand: (request: UserCommandRunRequest) =>
    invoke<UserCommandResultResponse>('run_user_command', { request }),

  /** Rehydrate a persisted terminal card. Deliberately narrower than a raw
   *  context-item reader. */
  getUserCommandResult: (request: UserCommandResultReadRequest) =>
    invoke<UserCommandResultResponse | null>('get_user_command_result', { request }),

  /** The live literal-command lease, if this conversation currently owns one.
   *  Unlike the persisted row this distinguishes "still running" from a
   *  process whose final result was never recorded. */
  activeUserShellTurn: (conversationId: string) => invoke<string | null>('active_user_shell_turn', { conversationId }),

  // Says something to a run already going, rather than starting one: the text
  // goes into the run's inbox and the loop takes it between rounds. Rejects
  // when nobody is reading — the run has ended, or there never was one — and
  // nothing is written down in that case, which is why the caller has to keep
  // hold of the text until this resolves.
  steerConversation: (request: ConversationSteerRequest) => invoke<void>('steer_conversation', { request }),

  // `mode` is passed per-request as well as being stored on the conversation:
  // the setter is async, and a message sent right after flipping the switch
  // would otherwise race it and run under the previous mode.
  //
  // `message` and `replaces` pick which of three things this is:
  //   message only  — continue from the conversation's head
  //   replaces only — regenerate: another answer alongside that one
  //   both          — edit: another version of that question, answered afresh
  // `replaces` names the message being offered an alternative; it is left in
  // place, reachable as a sibling of whatever the turn writes.
  //
  // `turnId` is minted here rather than by the backend, and it is the reason
  // the composer can be locked and the turn identified at the same instant.
  // A backend-minted id does not exist until the command has been dispatched,
  // acquired the conversation, read the assistant and resolved the provider —
  // and a stop belonging to the *previous* turn, arriving in that gap, would
  // find no id to be measured against and be taken for this one's.
  chat: (request: ChatRequest) => invoke<void>('chat', { request }),

  // A hosted Claude Code session, over ACP. `acpSend` is the `chat` of these
  // conversations: it takes the same caller-minted `turnId`, for the same
  // reason — the composer locks on it before the backend has been reached, and
  // the stop event it waits for has to carry it back.
  acpOpenSession: (request: AcpSessionOpenRequest) => invoke<string>('acp_open_session', { request }),

  // Sessions that already exist on this machine, including every one started
  // from a terminal. Starts a short-lived adapter, so it takes a second or two.
  // `cwd` narrows it to one directory; omitted means every project.
  acpListSessions: (request: AcpSessionListRequest) =>
    invoke<AcpDiscoveredSessionListResponse>('acp_list_sessions', { request }),

  // Take one over. The transcript comes with it — `session/load` recites the
  // whole history and this is the one path that writes the recital down.
  // Resolves to the new conversation's id.
  acpImportSession: (request: AcpImportSessionRequest) =>
    invoke<AcpImportSessionResponse>('acp_import_session', { request }),

  // Point a conversation that already exists at a session on disk. Writes the
  // id and nothing else: the rows are here already and came from that session,
  // so replaying them would double the transcript.
  acpAttachSession: (request: AcpSessionAttachRequest) => invoke<void>('acp_attach_session', { request }),

  acpConversationSession: (conversationId: string) =>
    invoke<AcpConversationSessionInfoResponse | null>('acp_conversation_session', { conversationId }),

  acpSend: (request: AcpPromptSendRequest) => invoke<void>('acp_send', { request }),

  acpCancel: (conversationId: string) => invoke<void>('acp_cancel', { conversationId }),

  acpClose: (conversationId: string) => invoke<void>('acp_close', { conversationId }),

  acpLiveSessions: () => invoke<AcpLiveConversationIdsResponse>('acp_live_sessions'),

  // The knobs the *agent* exposes for one session — model, mode, effort —
  // as opposed to `acpGetConfig`, which is how this app launches the adapter.
  // Empty when nothing is running there: the composer falls back to the model
  // recorded on the transcript, because there is no session to change.
  acpSessionConfig: (request: AcpSessionConfigReadRequest) =>
    invoke<AcpConfigOptionListResponse>('acp_session_config', { request }),

  // Hands back the whole set, not just the option that changed: picking a model
  // re-derives which modes exist.
  acpSetSessionConfig: (request: AcpSessionConfigUpdateRequest) =>
    invoke<AcpConfigOptionListResponse>('acp_set_session_config', { request }),

  acpGetConfig: () => invoke<AcpConfigInfoResponse>('acp_get_config'),

  acpSaveConfig: (request: AcpConfigUpdateRequest) => invoke<AcpConfigInfoResponse>('acp_save_config', { request }),

  acpCheckAdapter: () => invoke<AcpCheckResponse>('acp_check_adapter'),

  // The prompt queue. Adding one is also what may deliver it: an item queued
  // while a turn runs is a steer, and one queued with nothing running is a turn.
  // Nothing else moves the queue except a turn ending — see `agent::queue`.
  queueList: (conversationId: string) => invoke<QueuedPromptListResponse>('queue_list', { conversationId }),

  queueEnqueue: (request: QueuedPromptCreateRequest) => invoke<QueuedPromptInfoResponse>('queue_enqueue', { request }),

  /** Refuses an item that has already been sent, and says so. */
  queueRemove: (request: QueuedPromptRemoveRequest) => invoke<void>('queue_remove', { request }),

  queueReorder: (request: QueuedPromptReorderRequest) => invoke<void>('queue_reorder', { request }),

  queueSetDelivery: (request: QueuedPromptDeliveryUpdateRequest) => invoke<void>('queue_set_delivery', { request }),

  /** Let a queue held by a failed turn go again. Pumps, because a person just
   *  said to. */
  queueRelease: (conversationId: string) => invoke<void>('queue_release', { conversationId }),

  setSecret: (request: SecretUpsertRequest) => invoke<void>('set_secret', { request }),

  getSecret: (request: SecretReadRequest) => invoke<string | null>('get_secret', { request }),

  deleteSecret: (request: SecretDeleteRequest) => invoke<boolean>('delete_secret', { request }),

  listAssistants: () => invoke<AssistantListResponse>('list_assistants'),

  createAssistant: (request: AssistantCreateRequest) => invoke<AssistantInfoResponse>('create_assistant', { request }),

  updateAssistant: (request: AssistantUpdateRequest) => invoke<AssistantInfoResponse>('update_assistant', { request }),

  deleteAssistant: (id: string) => invoke<void>('delete_assistant', { id }),

  // Providers
  listProviders: () => invoke<ProviderListResponse>('list_providers'),

  /** The shipped vendor catalog. Compiled into the binary, so it never changes
   *  within a run — callers may cache it for the lifetime of the process. */
  listProviderCatalog: () => invoke<ProviderCatalogEntryListResponse>('list_provider_catalog'),

  /** Which ChatGPT account a Codex-backed provider is signed in as. Never
   *  refreshes the session: opening a settings page must not spend a token. */
  codexAuthStatus: () => invoke<CodexAuthStatusResponse>('codex_auth_status'),

  createProvider: (request: ProviderCreateRequest) => invoke<ProviderInfoResponse>('create_provider', { request }),

  updateProvider: (request: ProviderUpdateRequest) => invoke<ProviderInfoResponse>('update_provider', { request }),

  deleteProvider: (id: string) => invoke<void>('delete_provider', { id }),

  setProviderKey: (request: ProviderKeyUpdateRequest) => invoke<void>('set_provider_key', { request }),

  getProviderKeyExists: (providerId: string) => invoke<boolean>('get_provider_key_exists', { providerId }),

  fetchProviderModels: (request: ProviderModelListRequest) =>
    invoke<ProviderModelListResponse>('fetch_provider_models', { request }),

  getProviderCapabilities: (request: ProviderCapabilitiesReadRequest) =>
    invoke<ProviderCapabilitiesInfoResponse>('get_provider_capabilities', { request }),

  /**
   * What is left on the account. Never cached anywhere — a stale balance is the
   * number somebody decides not to top up on.
   *
   * `null` means this upstream publishes no balance, which is most of them and
   * is not an error to show.
   */
  getProviderBalance: (providerId: string) =>
    invoke<ProviderBalanceInfoResponse | null>('get_provider_balance', { providerId }),

  // All three address an `approval_id` the backend minted, not the provider's
  // tool call id, and all three reject when nothing is waiting on it any more —
  // the caller turns that into an `orphaned` card rather than spinning.
  approveToolCall: (approvalId: string) => invoke<void>('approve_tool_call', { approvalId }),

  denyToolCall: (request: ToolCallDenyRequest) => invoke<void>('deny_tool_call', { request }),

  respondToAsk: (request: AskResponseRequest) => invoke<void>('respond_to_ask', { request }),

  /** Everything waiting on the user, in every conversation — including ones this
   *  client has never opened. The stream announced each of these once and
   *  replays nothing, so this is the only way back for a window that reloaded or
   *  a phone that has just connected. One row per approval, already reduced to
   *  the view that can answer it. */
  allPendingApprovals: () => invoke<PendingApprovalListResponse>('all_pending_approvals'),

  // Plan reviews are durable documents rather than approval waiters. Every
  // mutation uses a generation or decision id so reloads and double presses
  // cannot silently overwrite another window.
  getPlanReview: (request: PlanReviewReadRequest) => invoke<PlanReviewInfoResponse>('get_plan_review', { request }),

  listPlanRevisions: (request: PlanRevisionListRequest) =>
    invoke<PlanRevisionListResponse>('list_plan_revisions', { request }),

  savePlanReviewDraft: (request: PlanReviewDraftSaveRequest) =>
    invoke<PlanReviewDraftSaveResponse>('save_plan_review_draft', { request }),

  discardPlanReviewDraft: (request: PlanReviewDraftDiscardRequest) =>
    invoke<PlanReviewInfoResponse>('discard_plan_review_draft', { request }),

  decidePlanReview: (request: PlanReviewDecisionRequest) =>
    invoke<PlanReviewDecisionResponse>('decide_plan_review', { request }),

  getPlanReviewDelivery: (request: PlanReviewDeliveryReadRequest) =>
    invoke<PlanReviewDeliveryInfoResponse | null>('get_plan_review_delivery', { request }),

  continuePlanReviewDelivery: (request: PlanReviewDeliveryContinueRequest) =>
    invoke<PlanReviewDeliveryInfoResponse>('continue_plan_review_delivery', { request }),

  resolvePlanFileConflict: (request: PlanFileConflictResolveRequest) =>
    invoke<PlanDocumentInfoResponse>('resolve_plan_file_conflict', { request }),

  // Projects
  listProjects: () => invoke<ProjectListResponse>('list_projects'),

  createProject: (request: ProjectCreateRequest) => invoke<ProjectInfoResponse>('create_project', { request }),

  updateProject: (request: ProjectUpdateRequest) => invoke<ProjectInfoResponse>('update_project', { request }),

  deleteProject: (id: string) => invoke<void>('delete_project', { id }),

  listConversationsByProject: (request: ConversationListByProjectRequest) =>
    invoke<ConversationListResponse>('list_conversations_by_project', { request }),

  // ---- The file panel. Read-only; `openInEditor` is local-only (it runs the
  // user's configured editor command on the host).
  workspaceRoot: (request: WorkspaceRootRequest) => invoke<WorkspaceRootResponse>('workspace_root', { request }),

  workspaceTree: (request: WorkspaceTreeRequest) =>
    invoke<WorkspaceTreeEntryListResponse>('workspace_tree', { request }),

  workspaceReadFile: (request: WorkspaceFileReadRequest) =>
    invoke<WorkspaceFileContentResponse>('workspace_read_file', { request }),

  workspaceSuggestRefs: (request: WorkspaceReferenceSuggestRequest) =>
    invoke<WorkspaceReferenceSuggestionListResponse>('workspace_suggest_refs', { request }),

  workspaceResolveRef: (request: WorkspaceReferenceResolveRequest) =>
    invoke<WorkspaceReferencePreviewResponse>('workspace_resolve_ref', { request }),

  workspaceProbeRef: (request: WorkspaceReferenceProbeRequest) =>
    invoke<WorkspaceReferenceProbeResponse>('workspace_probe_ref', { request }),

  workspaceGitStatus: (request: WorkspaceGitStatusRequest) =>
    invoke<WorkspaceGitStatusResponse>('workspace_git_status', { request }),

  workspaceGitDiff: (request: WorkspaceGitDiffRequest) =>
    invoke<WorkspaceGitDiffResponse>('workspace_git_diff', { request }),

  openInEditor: (request: WorkspaceEditorOpenRequest) => invoke<void>('open_in_editor', { request }),

  // ---- The journal's read side: per-line attribution and file history.
  journalBlame: (request: JournalBlameRequest) => invoke<JournalBlameResponse>('journal_blame', { request }),

  journalFileHistory: (request: JournalFileHistoryRequest) =>
    invoke<JournalVersionListResponse>('journal_file_history', { request }),

  journalVersionContent: (request: JournalVersionContentRequest) =>
    invoke<JournalVersionContentResponse>('journal_version_content', { request }),

  // Memories
  listMemories: (projectId: string) => invoke<MemoryListResponse>('list_memories', { projectId }),

  saveMemory: (request: MemoryUpsertRequest) => invoke<MemoryInfoResponse>('save_memory', { request }),

  updateMemory: (request: MemoryUpdateRequest) => invoke<MemoryInfoResponse>('update_memory', { request }),

  deleteMemory: (id: string) => invoke<void>('delete_memory', { id }),

  // Todos
  getActiveTodoList: (conversationId: string) =>
    invoke<TodoInfoResponse | null>('get_active_todo_list', { conversationId }),

  /** Layered write. `origin` is always `desktop`; the backend assigns it. */
  saveMemoryScoped: (request: MemoryScopedUpsertRequest) =>
    invoke<MemoryInfoResponse>('save_memory_scoped', { request }),

  deleteMemories: (ids: string[]) => invoke<number>('delete_memories', { ids }),

  /** Every live memory in one call — the browser needs all scopes, not just one project's. */
  listAllMemories: () => invoke<MemoryListResponse>('list_all_memories'),

  listMemorySubjects: () => invoke<MemorySubjectListResponse>('list_memory_subjects'),

  forgetMemorySubject: (subjectScopeId: string) => invoke<number>('forget_memory_subject', { subjectScopeId }),

  setMemorySubjectFlags: (request: MemorySubjectFlagsUpdateRequest) =>
    invoke<void>('set_memory_subject_flags', { request }),

  listMemoryTrash: (limit?: number) => invoke<MemoryListResponse>('list_memory_trash', { limit: limit ?? null }),

  restoreMemories: (ids: string[]) => invoke<number>('restore_memories', { ids }),

  purgeMemories: (ids: string[]) => invoke<number>('purge_memories', { ids }),

  memoryEnums: () => invoke<MemoryEnumsResponse>('memory_enums'),

  // Preferences
  getPreference: <K extends PreferenceKey>(request: PreferenceReadRequest<K>) =>
    invoke<PreferenceInfoResponse<K>>('get_preference', { request }),

  setPreference: (request: PreferenceUpdateRequest) => invoke<void>('set_preference', { request }),

  // Voice input (desktop only)
  /** Open the microphone early so the first word is not lost to device latency. */
  voicePrewarm: () => invoke<void>('voice_prewarm'),

  voiceReleasePrewarm: () => invoke<void>('voice_release_prewarm'),

  voiceStartRecording: () => invoke<void>('voice_start_recording'),

  voiceStopAndTranscribe: () => invoke<VoiceTranscriptResponse>('voice_stop_and_transcribe'),

  voiceCancelRecording: () => invoke<void>('voice_cancel_recording'),

  voiceModelStatus: () => invoke<VoiceModelStatusInfoResponse>('voice_model_status'),

  voiceDownloadModel: (request: VoiceModelDownloadRequest) => invoke<void>('voice_download_model', { request }),

  voiceCancelDownload: () => invoke<void>('voice_cancel_download'),

  voiceImportModel: (request: VoiceModelImportRequest) =>
    invoke<VoiceModelStatusInfoResponse>('voice_import_model', { request }),

  voiceDeleteModel: () => invoke<void>('voice_delete_model'),

  /** Decodes and counts the samples, nothing more. Measures what a base64 PCM
   *  payload actually costs over the bridge — Android has no raw IPC. */
  voiceProbeEcho: (request: VoiceProbeEchoRequest) => invoke<number>('voice_probe_echo', { request }),

  /** Android's transcription entry point: capture happens in the WebView, so
   *  the samples arrive as base64 16-bit PCM rather than from a Rust session. */
  voiceTranscribePcm: (request: VoicePcmTranscriptionRequest) =>
    invoke<VoiceTranscriptResponse>('voice_transcribe_pcm', { request }),

  // Platform / Android file access
  getPlatform: () => invoke<PlatformInfoResponse>('get_platform'),

  getWindowInsets: () => invoke<WindowInsetsInfoResponse>('get_window_insets'),

  getManageStorageStatus: () => invoke<boolean>('get_manage_storage_status'),

  requestManageStorage: () => invoke<void>('request_manage_storage'),

  pickSafDirectory: () => invoke<SafRootListResponse>('pick_saf_directory'),

  listSafRoots: () => invoke<SafRootListResponse>('list_saf_roots'),

  removeSafRoot: (uri: string) => invoke<SafRootListResponse>('remove_saf_root', { uri }),

  takePhoto: () => invoke<string | null>('take_photo'),

  pickGalleryImage: () => invoke<string | null>('pick_gallery_image'),

  resolveFileName: (path: string) => invoke<string>('resolve_file_name', { path }),

  // MCP servers
  listMcpServers: () => invoke<McpServerListResponse>('list_mcp_servers'),

  createMcpServer: (request: McpServerCreateRequest) => invoke<McpServerInfoResponse>('create_mcp_server', { request }),

  updateMcpServer: (request: McpServerUpdateRequest) => invoke<McpServerInfoResponse>('update_mcp_server', { request }),

  deleteMcpServer: (id: string) => invoke<void>('delete_mcp_server', { id }),

  connectMcpServer: (id: string) => invoke<void>('connect_mcp_server', { id }),

  disconnectMcpServer: (id: string) => invoke<void>('disconnect_mcp_server', { id }),

  listMcpTools: (serverId?: string) =>
    invoke<McpServerToolListResponse>('list_mcp_tools', { serverId: serverId ?? null }),

  // Only servers with a live entry come back. Anything absent is disconnected —
  // the caller already has the full list from the database.
  listMcpConnectionStatuses: () => invoke<McpConnectionStatusListResponse>('list_mcp_connection_statuses'),

  listAllToolNames: () => invoke<McpToolListResponse>('list_all_tool_names'),

  // OneBot
  getOneBotStatus: () => invoke<OneBotStatusInfoResponse>('get_onebot_status'),

  getOneBotConfig: () => invoke<OneBotConfigInfoResponse>('get_onebot_config'),

  saveOneBotConfig: (request: OneBotConfigUpdateRequest) => invoke<void>('save_onebot_config', { request }),

  /**
   * Which of the four outbound-voice settings are filled in.
   *
   * Missing one hides `send_voice` from the model entirely, which is the one
   * failure this feature has that announces itself nowhere: the switch is on,
   * the tool is absent, and the assistant cannot say why because it cannot see
   * the tool either. Asked, it answers that it has no voice tool.
   */
  getVoiceSendReadiness: () => invoke<VoiceSendReadinessInfoResponse>('get_voice_send_readiness'),

  // Voice corpus. A session is named by its pseudonym and by nothing else:
  // this list travels to a phone, `bot_self_id` is the bot's own QQ number and
  // a private chat's session id is the other person's. The same pseudonym is
  // what goes back to delete it, so neither ever leaves the host.
  listVoiceCorpus: () => invoke<VoiceCorpusSessionListResponse>('list_voice_corpus'),

  /**
   * Delete stored voice.
   *
   * The selector is a tagged union with no defaultable shape — a call that
   * loses a field fails to deserialize rather than falling through to "all",
   * which is how one mistyped remote request would erase every recording.
   */
  deleteVoiceCorpus: (request: VoiceCorpusDeleteRequest) =>
    invoke<VoiceCorpusDeleteResponse>('delete_voice_corpus', { request }),

  /** "Never record me again" — a different thing from deleting what exists. */
  setVoiceOptout: (request: VoiceCorpusOptoutUpdateRequest) => invoke<void>('set_voice_optout', { request }),

  /**
   * Delete someone's voice *and* refuse the future, in that order.
   *
   * One call rather than two: between a delete and a separate opt-out the
   * barrier is already down and the list is not yet in force, so a recording
   * landing in the gap is one nothing will ever go back for — while the button
   * has already reported success.
   */
  forgetVoiceSender: (request: VoiceCorpusForgetRequest) =>
    invoke<VoiceCorpusForgetResponse>('forget_voice_sender', { request }),

  exportVoiceCorpus: (request: VoiceCorpusExportRequest) =>
    invoke<VoiceCorpusExportResponse>('export_voice_corpus', { request }),

  startOneBot: () => invoke<void>('start_onebot'),

  stopOneBot: () => invoke<void>('stop_onebot'),

  // Claude Code hook endpoint
  getHooksStatus: () => invoke<HookStatusInfoResponse>('get_hooks_status'),

  getHooksConfig: () => invoke<HookConfigInfoResponse>('get_hooks_config'),

  // Returns the stored config, which is how the caller learns the token the
  // backend minted on first save.
  saveHooksConfig: (request: HookConfigUpdateRequest) =>
    invoke<HookConfigInfoResponse>('save_hooks_config', { request }),

  regenerateHooksToken: () => invoke<string>('regenerate_hooks_token'),

  startHooks: () => invoke<void>('start_hooks'),

  stopHooks: () => invoke<void>('stop_hooks'),

  // Remote access: serving this desktop to another device
  getListenStatus: () => invoke<ListenStatusResponse>('get_listen_status'),

  getListenConfig: () => invoke<ListenConfigInfoResponse>('get_listen_config'),

  // The four calls that change anything restart the server, so each answers
  // with the status it left behind rather than making the caller ask again.
  // The token is minted by the backend on first enable, so the config has to be
  // re-read after any of them that could have created one.
  saveListenConfig: (request: ListenConfigUpdateRequest) =>
    invoke<ListenStatusResponse>('save_listen_config', { request }),

  startListen: () => invoke<ListenStatusResponse>('start_listen'),

  stopListen: () => invoke<ListenStatusResponse>('stop_listen'),

  // Answers with the whole config, which is how the caller learns the new token.
  regenerateListenToken: () => invoke<ListenConfigInfoResponse>('regenerate_listen_token'),

  // The addresses another device could dial, so nobody has to read `ipconfig`.
  getListenAddresses: () => invoke<ListenAddressesResponse>('get_listen_addresses'),

  // Input method (Windows). All of it is local: it configures this machine's
  // keyboard, and a remote client is refused by the dispatcher.
  getImeStatus: () => invoke<ImeStatusInfoResponse>('get_ime_status'),

  getImeConfig: () => invoke<ImeConfigInfoResponse>('get_ime_config'),

  saveImeConfig: (request: ImeConfigUpdateRequest) => invoke<ImeConfigInfoResponse>('save_ime_config', { request }),

  listImeDictionaries: () => invoke<ImeDictionaryListResponse>('list_ime_dictionaries'),

  importImeDictionary: (request: ImeDictionaryImportRequest) =>
    invoke<ImeDictionaryImportReportResponse>('import_ime_dictionary', { request }),

  setImeDictionaryEnabled: (request: ImeDictionaryToggleRequest) =>
    invoke<ImeDictionaryListResponse>('set_ime_dictionary_enabled', { request }),

  removeImeDictionary: (request: ImeDictionaryRemoveRequest) =>
    invoke<ImeDictionaryListResponse>('remove_ime_dictionary', { request }),

  startImeHost: () => invoke<ImeStatusInfoResponse>('start_ime_host'),

  stopImeHost: () => invoke<ImeStatusInfoResponse>('stop_ime_host'),

  setImeProfileEnabled: (request: ImeProfileUpdateRequest) =>
    invoke<ImeStatusInfoResponse>('set_ime_profile_enabled', { request }),

  // One UAC prompt: `regsvr32` on the DLL.
  registerIme: () => invoke<ImeStatusInfoResponse>('register_ime'),

  // Prompt Templates
  listTemplateVariables: () => invoke<TemplateVariableListResponse>('list_template_variables'),

  // Emoji Packs
  listEmojiPacks: () => invoke<EmojiPackListResponse>('list_emoji_packs'),

  createEmojiPack: (request: EmojiPackCreateRequest) => invoke<EmojiPackInfoResponse>('create_emoji_pack', { request }),

  deleteEmojiPack: (id: string) => invoke<void>('delete_emoji_pack', { id }),

  listEmojis: (packId: string) => invoke<EmojiListResponse>('list_emojis', { packId }),

  importEmojis: (request: EmojiImportRequest) => invoke<EmojiListResponse>('import_emojis', { request }),

  deleteEmoji: (id: string) => invoke<void>('delete_emoji', { id }),

  renameEmoji: (request: EmojiRenameRequest) => invoke<EmojiInfoResponse>('rename_emoji', { request }),

  suggestStickerSemantics: (id: string) => invoke<EmojiInfoResponse>('suggest_sticker_semantics', { id }),

  confirmStickerSemantics: (request: EmojiSemanticsConfirmRequest) =>
    invoke<EmojiInfoResponse>('confirm_sticker_semantics', { request }),

  searchEmojis: (query: string) => invoke<EmojiListResponse>('search_emojis', { query }),

  assignEmojiPack: (request: AssistantEmojiPackAssignmentRequest) => invoke<void>('assign_emoji_pack', { request }),

  unassignEmojiPack: (request: AssistantEmojiPackAssignmentRequest) => invoke<void>('unassign_emoji_pack', { request }),

  listAssistantEmojiPacks: (assistantId: string) =>
    invoke<EmojiPackListResponse>('list_assistant_emoji_packs', { assistantId }),

  getEmojiFileUrl: (emojiId: string) => invoke<string>('get_emoji_file_url', { emojiId }),

  // Tool System
  listToolCategories: () => invoke<ToolCategoryListResponse>('list_tool_categories'),

  listCustomTools: () => invoke<CustomToolListResponse>('list_custom_tools'),

  createCustomTool: (request: CustomToolCreateRequest) =>
    invoke<CustomToolInfoResponse>('create_custom_tool', { request }),

  updateCustomTool: (request: CustomToolUpdateRequest) =>
    invoke<CustomToolInfoResponse>('update_custom_tool', { request }),

  deleteCustomTool: (id: string) => invoke<void>('delete_custom_tool', { id }),

  listToolPresets: () => invoke<ToolPresetListResponse>('list_tool_presets'),

  createToolPreset: (request: ToolPresetCreateRequest) =>
    invoke<ToolPresetInfoResponse>('create_tool_preset', { request }),

  updateToolPreset: (request: ToolPresetUpdateRequest) =>
    invoke<ToolPresetInfoResponse>('update_tool_preset', { request }),

  deleteToolPreset: (id: string) => invoke<void>('delete_tool_preset', { id }),

  // Skills
  listSkills: () => invoke<SkillListResponse>('list_skills'),

  rescanSkills: () => invoke<SkillListResponse>('rescan_skills'),

  getSkillBody: (dirName: string) => invoke<string>('get_skill_body', { dirName }),

  createSkill: (request: SkillCreateRequest) => invoke<SkillInfoResponse>('create_skill', { request }),

  updateSkill: (request: SkillUpdateRequest) => invoke<SkillInfoResponse>('update_skill', { request }),

  deleteSkill: (dirName: string) => invoke<void>('delete_skill', { dirName }),

  listSkillBindings: (request: SkillBindingListRequest) =>
    invoke<SkillBindingNamesResponse>('list_skill_bindings', { request }),

  setSkillBinding: (request: SkillBindingUpdateRequest) =>
    invoke<SkillBindingNamesResponse>('set_skill_binding', { request }),

  // Settings → About. Not `getVersion()` from `@tauri-apps/api/app`: that one
  // is answered by the shell this page may not be running in.
  getAppInfo: () => invoke<AppInfoResponse>('get_app_info'),

  // Application logs
  readLogs: (query: LogQueryRequest = {}) => {
    const request: LogQueryRequest = {
      minLevel: query.minLevel ?? null,
      limit: query.limit ?? null,
      contains: query.contains ?? null,
      targetPrefix: query.targetPrefix ?? null,
      conversationId: query.conversationId ?? null,
      sinceTsMs: query.sinceTsMs ?? null,
      untilTsMs: query.untilTsMs ?? null,
      cursor: query.cursor ?? null,
    }
    return invoke<LogPageResponse>('read_logs', { request })
  },

  listLogFiles: () => invoke<LogFileListResponse>('list_log_files'),

  getLogSettings: () => invoke<LogSettingsResponse>('get_log_settings'),

  setLogLevel: (request: LogLevelUpdateRequest) => invoke<void>('set_log_level', { request }),

  exportLogs: (request: LogExportRequest) => invoke<LogExportResponse>('export_logs', { request }),

  // Service Keys (for tool services like Tavily, Zhipu search)
  setServiceKey: (request: ServiceKeyUpdateRequest) => invoke<void>('set_service_key', { request }),

  getServiceKeyExists: (service: ServiceKey) => invoke<boolean>('get_service_key_exists', { service }),

  /**
   * Tokens and cost, grouped by `dimension`.
   *
   * One call per breakdown, including the headline figures — `total` is the same
   * query with a constant key, which is what makes a breakdown add up to the
   * summary above it rather than nearly add up to it. Never sum these in the
   * front end: the cost of a group is not the sum of its rows' costs, because a
   * cached token bills at the cache rate instead of the input rate.
   */
  usageReport: (request: UsageReportRequest) => invoke<UsageBucketListResponse>('usage_report', { request }),
}
