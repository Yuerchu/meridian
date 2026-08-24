// Not `@tauri-apps/api/core`. Every method below is unchanged by that: the
// transport keeps Tauri's signature and answers locally unless this session was
// pointed at another machine. See `lib/transport.ts`.
import { invoke } from '@/lib/transport'
import type {
  AcpCheck,
  AcpConfig,
  AcpConfigOption,
  AcpConversationSession,
  AcpDiscoveredSession,
  AcpImportOutcome,
  AppInfo,
  Assistant,
  ChatMode,
  ContextInfo,
  Conversation,
  ConversationSnapshot,
  CustomTool,
  Emoji,
  EmojiPack,
  HooksConfig,
  HooksStatus,
  ListenConfig,
  ListenStatus,
  LogFileInfo,
  LogPage,
  LogQuery,
  LogSettings,
  McpConnectionStatus,
  McpServer,
  McpToolDef,
  Memory,
  MemoryEnums,
  MemorySubject,
  ModelConfig,
  ModelConfigInput,
  ModelInfo,
  PendingApprovalInfo,
  Project,
  PromptTemplate,
  Provider,
  ProviderBalance,
  ProviderCapabilities,
  QueueDelivery,
  QueuedPrompt,
  SafRootEntry,
  Skill,
  SkillLayer,
  TemplateVariable,
  TodoListView,
  ToolCategory,
  ToolInfo,
  ToolPreset,
  UsageBucket,
  UsageDimension,
  UsageFilter,
  VoiceModelStatus,
  VoiceTranscript,
} from './types'

export const api = {
  listConversations: (archived = false) => invoke<Conversation[]>('list_conversations', { archived }),

  createConversation: (title?: string, projectId?: string) =>
    invoke<Conversation>('create_conversation', { title: title ?? null, projectId: projectId ?? null }),

  updateConversationTitle: (id: string, title: string) => invoke<void>('update_conversation_title', { id, title }),

  setConversationAssistant: (id: string, assistantId: string | null) =>
    invoke<void>('set_conversation_assistant', { id, assistantId }),

  setConversationReasoningPrefs: (id: string, thinkingLevel: string | null, fastMode: boolean) =>
    invoke<void>('set_conversation_reasoning_prefs', { id, thinkingLevel, fastMode }),

  // Its own setter rather than another field on the one above: that one writes
  // two columns at once, so every caller has to pass the other's current value.
  setConversationMode: (id: string, mode: ChatMode | null) => invoke<void>('set_conversation_mode', { id, mode }),

  // Also its own setter, and kept apart from the mode for a second reason: a
  // mode narrows what the assistant may do, this widens what it may do without
  // asking. One call writing both would suggest they are the same kind of thing.
  setConversationAcceptEdits: (id: string, acceptEdits: boolean) =>
    invoke<void>('set_conversation_accept_edits', { id, acceptEdits }),

  togglePinConversation: (id: string) => invoke<Conversation>('toggle_pin_conversation', { id }),

  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  compact: (conversationId: string, customInstructions?: string) =>
    invoke<void>('compact', {
      conversationId,
      customInstructions: customInstructions ?? null,
    }),

  getContextInfo: (conversationId: string) => invoke<ContextInfo>('get_context_info', { conversationId }),

  listModelConfigs: (providerId: string) => invoke<ModelConfig[]>('list_model_configs', { providerId }),

  getModelConfig: (providerId: string, modelId: string) =>
    invoke<ModelConfig | null>('get_model_config', { providerId, modelId }),

  saveModelConfig: (input: ModelConfigInput) => invoke<ModelConfig>('save_model_config', { input }),

  deleteModelConfig: (id: string) => invoke<void>('delete_model_config', { id }),

  /** Everything needed to draw a conversation, read as one state.
   *
   *  The only way to read a transcript. Fetching the tree, the row, the turns
   *  and the approvals separately is what this replaced: a running turn writes
   *  between such requests, and what came back described no moment that ever
   *  existed. */
  conversationSnapshot: (conversationId: string) =>
    invoke<ConversationSnapshot>('conversation_snapshot', { conversationId }),

  /** Makes that message's branch active, landing on its most recent tip. Read
   *  the result back with `conversationSnapshot`. */
  switchBranch: (conversationId: string, messageId: string) =>
    invoke<void>('switch_branch', { conversationId, messageId }),

  /** Deletes the message and everything descended from it. Read the result back
   *  with `conversationSnapshot`, same as a branch switch. */
  deleteMessage: (conversationId: string, id: string) => invoke<void>('delete_message', { conversationId, id }),

  rateMessage: (id: string, rating: number | null) => invoke<void>('rate_message', { id, rating }),

  exportConversation: (conversationId: string, format: string, outputPath?: string) =>
    invoke<string>('export_conversation', { conversationId, format, outputPath: outputPath ?? null }),

  uploadFile: (conversationId: string, filePath: string) =>
    invoke<unknown>('upload_file', { conversationId, filePath }),

  // `turnId` says which run to stop. Without it the backend stops whatever is
  // running, which is what a reloaded window has to fall back on — but sending
  // it means "stop, then send again" can no longer cancel the new turn instead
  // of the old one.
  stopChat: (conversationId: string, turnId?: string | null) =>
    invoke<void>('stop_chat', { conversationId, turnId: turnId ?? null }),

  // Says something to a run already going, rather than starting one: the text
  // goes into the run's inbox and the loop takes it between rounds. Rejects
  // when nobody is reading — the run has ended, or there never was one — and
  // nothing is written down in that case, which is why the caller has to keep
  // hold of the text until this resolves.
  steerConversation: (conversationId: string, text: string) =>
    invoke<void>('steer_conversation', { conversationId, text }),

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
  chat: (
    conversationId: string,
    message: string | null,
    opts: {
      turnId?: string
      replaces?: string
      modelOverride?: string
      providerOverride?: string
      thinkingLevel?: string
      assistantId?: string
      fast?: boolean
      mode?: ChatMode
      voice?: boolean
    } = {},
  ) =>
    invoke<void>('chat', {
      conversationId,
      message,
      turnId: opts.turnId ?? null,
      replaces: opts.replaces ?? null,
      modelOverride: opts.modelOverride ?? null,
      providerOverride: opts.providerOverride ?? null,
      thinkingLevel: opts.thinkingLevel ?? null,
      assistantId: opts.assistantId ?? null,
      fast: opts.fast ?? null,
      mode: opts.mode ?? null,
      voice: opts.voice ?? null,
    }),

  // A hosted Claude Code session, over ACP. `acpSend` is the `chat` of these
  // conversations: it takes the same caller-minted `turnId`, for the same
  // reason — the composer locks on it before the backend has been reached, and
  // the stop event it waits for has to carry it back.
  acpOpenSession: (cwd: string) => invoke<string>('acp_open_session', { cwd }),

  // Sessions that already exist on this machine, including every one started
  // from a terminal. Starts a short-lived adapter, so it takes a second or two.
  // `cwd` narrows it to one directory; omitted means every project.
  acpListSessions: (cwd?: string | null) => invoke<AcpDiscoveredSession[]>('acp_list_sessions', { cwd: cwd ?? null }),

  // Take one over. The transcript comes with it — `session/load` recites the
  // whole history and this is the one path that writes the recital down.
  // Resolves to the new conversation's id.
  acpImportSession: (session: Pick<AcpDiscoveredSession, 'sessionId' | 'cwd' | 'title' | 'updatedAt'>) =>
    invoke<AcpImportOutcome>('acp_import_session', { session }),

  // Point a conversation that already exists at a session on disk. Writes the
  // id and nothing else: the rows are here already and came from that session,
  // so replaying them would double the transcript.
  acpAttachSession: (conversationId: string, sessionId: string, cwd: string) =>
    invoke<void>('acp_attach_session', { conversationId, sessionId, cwd }),

  acpConversationSession: (conversationId: string) =>
    invoke<AcpConversationSession | null>('acp_conversation_session', { conversationId }),

  acpSend: (conversationId: string, message: string, turnId?: string) =>
    invoke<void>('acp_send', { conversationId, message, turnId: turnId ?? null }),

  acpCancel: (conversationId: string) => invoke<void>('acp_cancel', { conversationId }),

  acpClose: (conversationId: string) => invoke<void>('acp_close', { conversationId }),

  acpLiveSessions: () => invoke<string[]>('acp_live_sessions'),

  // The knobs the *agent* exposes for one session — model, mode, effort —
  // as opposed to `acpGetConfig`, which is how this app launches the adapter.
  // Empty when nothing is running there: the composer falls back to the model
  // recorded on the transcript, because there is no session to change.
  acpSessionConfig: (conversationId: string) => invoke<AcpConfigOption[]>('acp_session_config', { conversationId }),

  // Hands back the whole set, not just the option that changed: picking a model
  // re-derives which modes exist.
  acpSetSessionConfig: (conversationId: string, configId: string, value: unknown) =>
    invoke<AcpConfigOption[]>('acp_set_session_config', { conversationId, configId, value }),

  acpGetConfig: () => invoke<AcpConfig>('acp_get_config'),

  acpSaveConfig: (config: AcpConfig) => invoke<AcpConfig>('acp_save_config', { config }),

  acpCheckAdapter: () => invoke<AcpCheck>('acp_check_adapter'),

  // The prompt queue. Adding one is also what may deliver it: an item queued
  // while a turn runs is a steer, and one queued with nothing running is a turn.
  // Nothing else moves the queue except a turn ending — see `agent::queue`.
  queueList: (conversationId: string) => invoke<QueuedPrompt[]>('queue_list', { conversationId }),

  queueEnqueue: (conversationId: string, content: string, delivery: QueueDelivery) =>
    invoke<QueuedPrompt>('queue_enqueue', { conversationId, content, delivery }),

  /** Refuses an item that has already been sent, and says so. */
  queueRemove: (conversationId: string, id: string) => invoke<void>('queue_remove', { conversationId, id }),

  queueReorder: (conversationId: string, ids: string[]) => invoke<void>('queue_reorder', { conversationId, ids }),

  queueSetDelivery: (conversationId: string, id: string, delivery: QueueDelivery) =>
    invoke<void>('queue_set_delivery', { conversationId, id, delivery }),

  /** Let a queue held by a failed turn go again. Pumps, because a person just
   *  said to. */
  queueRelease: (conversationId: string) => invoke<void>('queue_release', { conversationId }),

  setSecret: (key: string, value: string) => invoke<void>('set_secret', { key, value }),

  getSecret: (key: string) => invoke<string | null>('get_secret', { key }),

  deleteSecret: (key: string) => invoke<boolean>('delete_secret', { key }),

  listAssistants: () => invoke<Assistant[]>('list_assistants'),

  createAssistant: (name: string, systemPrompt: string, modelId?: string) =>
    invoke<Assistant>('create_assistant', {
      name,
      systemPrompt,
      modelId: modelId ?? null,
      temperature: null,
      topP: null,
      maxTokens: null,
    }),

  updateAssistant: (
    id: string,
    updates: {
      name?: string
      systemPrompt?: string
      providerId?: string | null
      modelId?: string | null
      temperature?: number | null
      contextLimit?: number | null
      enabledTools?: string | null
      thinkingEnabled?: number
      thinkingBudget?: number | null
      toolPresetId?: string | null
      autoCompactEnabled?: number
    },
  ) => invoke<Assistant>('update_assistant', { id, updates }),

  deleteAssistant: (id: string) => invoke<void>('delete_assistant', { id }),

  // Providers
  listProviders: () => invoke<Provider[]>('list_providers'),

  createProvider: (name: string, providerType: string, baseUrl: string, apiFormat?: string) =>
    invoke<Provider>('create_provider', { name, providerType, baseUrl, apiFormat: apiFormat ?? null }),

  updateProvider: (
    id: string,
    updates: {
      name?: string
      providerType?: string
      baseUrl?: string
      isEnabled?: number
      apiFormat?: string
    },
  ) =>
    invoke<Provider>('update_provider', {
      id,
      name: updates.name ?? null,
      providerType: updates.providerType ?? null,
      baseUrl: updates.baseUrl ?? null,
      isEnabled: updates.isEnabled ?? null,
      apiFormat: updates.apiFormat ?? null,
    }),

  deleteProvider: (id: string) => invoke<void>('delete_provider', { id }),

  setProviderKey: (providerId: string, apiKey: string) => invoke<void>('set_provider_key', { providerId, apiKey }),

  getProviderKeyExists: (providerId: string) => invoke<boolean>('get_provider_key_exists', { providerId }),

  fetchProviderModels: (providerId: string, forceRefresh?: boolean) =>
    invoke<ModelInfo[]>('fetch_provider_models', { providerId, forceRefresh: forceRefresh ?? null }),

  getProviderCapabilities: (providerId: string, modelId: string) =>
    invoke<ProviderCapabilities>('get_provider_capabilities', { providerId, modelId }),

  /**
   * What is left on the account. Never cached anywhere — a stale balance is the
   * number somebody decides not to top up on.
   *
   * `null` means this upstream publishes no balance, which is most of them and
   * is not an error to show.
   */
  getProviderBalance: (providerId: string) => invoke<ProviderBalance | null>('get_provider_balance', { providerId }),

  // All three address an `approval_id` the backend minted, not the provider's
  // tool call id, and all three reject when nothing is waiting on it any more —
  // the caller turns that into an `orphaned` card rather than spinning.
  approveToolCall: (approvalId: string) => invoke<void>('approve_tool_call', { approvalId }),

  denyToolCall: (approvalId: string, reason?: string) =>
    invoke<void>('deny_tool_call', { approvalId, reason: reason ?? null }),

  respondToAsk: (approvalId: string, response: string) => invoke<void>('respond_to_ask', { approvalId, response }),

  /** Everything waiting on the user, in every conversation — including ones this
   *  client has never opened. The stream announced each of these once and
   *  replays nothing, so this is the only way back for a window that reloaded or
   *  a phone that has just connected. One row per approval, already reduced to
   *  the view that can answer it. */
  allPendingApprovals: () => invoke<PendingApprovalInfo[]>('all_pending_approvals'),

  // Projects
  listProjects: () => invoke<Project[]>('list_projects'),

  createProject: (
    name: string,
    path?: string,
    sourceType?: string,
    sourceId?: string,
    assistantId?: string,
    description?: string,
  ) =>
    invoke<Project>('create_project', {
      name,
      path: path ?? null,
      sourceType: sourceType ?? null,
      sourceId: sourceId ?? null,
      assistantId: assistantId ?? null,
      description: description ?? null,
    }),

  updateProject: (id: string, updates: { name?: string; path?: string; assistantId?: string; description?: string }) =>
    invoke<Project>('update_project', {
      id,
      name: updates.name ?? null,
      path: updates.path ?? null,
      assistantId: updates.assistantId ?? null,
      description: updates.description ?? null,
    }),

  deleteProject: (id: string) => invoke<void>('delete_project', { id }),

  listConversationsByProject: (projectId: string, archived = false) =>
    invoke<Conversation[]>('list_conversations_by_project', { projectId, archived }),

  // Memories
  listMemories: (projectId: string) => invoke<Memory[]>('list_memories', { projectId }),

  saveMemory: (projectId: string, key: string, content: string, memoryType?: string) =>
    invoke<Memory>('save_memory', { projectId, key, content, memoryType: memoryType ?? null }),

  updateMemory: (id: string, content?: string, memoryType?: string, ownerOnly?: boolean) =>
    invoke<Memory>('update_memory', {
      id,
      content: content ?? null,
      memoryType: memoryType ?? null,
      ownerOnly: ownerOnly ?? null,
    }),

  deleteMemory: (id: string) => invoke<void>('delete_memory', { id }),

  // Todos
  getActiveTodoList: (conversationId: string) =>
    invoke<TodoListView | null>('get_active_todo_list', { conversationId }),

  /** Layered write. `origin` is always `desktop`; the backend assigns it. */
  saveMemoryScoped: (args: {
    scope: string
    projectId?: string | null
    subjectScopeId?: string | null
    key: string
    content: string
    memoryType?: string | null
    ownerOnly?: boolean
  }) =>
    invoke<Memory>('save_memory_scoped', {
      scope: args.scope,
      projectId: args.projectId ?? null,
      subjectScopeId: args.subjectScopeId ?? null,
      key: args.key,
      content: args.content,
      memoryType: args.memoryType ?? null,
      ownerOnly: args.ownerOnly ?? null,
    }),

  deleteMemories: (ids: string[]) => invoke<number>('delete_memories', { ids }),

  /** Every live memory in one call — the browser needs all scopes, not just one project's. */
  listAllMemories: () => invoke<Memory[]>('list_all_memories'),

  listMemorySubjects: () => invoke<MemorySubject[]>('list_memory_subjects'),

  forgetMemorySubject: (subjectScopeId: string) => invoke<number>('forget_memory_subject', { subjectScopeId }),

  setMemorySubjectFlags: (subjectScopeId: string, isPinned?: boolean, optedOut?: boolean) =>
    invoke<void>('set_memory_subject_flags', {
      subjectScopeId,
      isPinned: isPinned ?? null,
      optedOut: optedOut ?? null,
    }),

  listMemoryTrash: (limit?: number) => invoke<Memory[]>('list_memory_trash', { limit: limit ?? null }),

  restoreMemories: (ids: string[]) => invoke<number>('restore_memories', { ids }),

  purgeMemories: (ids: string[]) => invoke<number>('purge_memories', { ids }),

  memoryEnums: () => invoke<MemoryEnums>('memory_enums'),

  // Preferences
  getPreference: (key: string) => invoke<string | null>('get_preference', { key }),

  setPreference: (key: string, value: string) => invoke<void>('set_preference', { key, value }),

  // Voice input (desktop only)
  /** Open the microphone early so the first word is not lost to device latency. */
  voicePrewarm: () => invoke<void>('voice_prewarm'),

  voiceReleasePrewarm: () => invoke<void>('voice_release_prewarm'),

  voiceStartRecording: () => invoke<void>('voice_start_recording'),

  voiceStopAndTranscribe: () => invoke<VoiceTranscript>('voice_stop_and_transcribe'),

  voiceCancelRecording: () => invoke<void>('voice_cancel_recording'),

  voiceModelStatus: () => invoke<VoiceModelStatus>('voice_model_status'),

  voiceDownloadModel: (url?: string) => invoke<void>('voice_download_model', { url: url ?? null }),

  voiceCancelDownload: () => invoke<void>('voice_cancel_download'),

  voiceImportModel: (archivePath: string) => invoke<VoiceModelStatus>('voice_import_model', { archivePath }),

  voiceDeleteModel: () => invoke<void>('voice_delete_model'),

  /** Decodes and counts the samples, nothing more. Measures what a base64 PCM
   *  payload actually costs over the bridge — Android has no raw IPC. */
  voiceProbeEcho: (sampleRate: number, pcm: string) => invoke<number>('voice_probe_echo', { sampleRate, pcm }),

  /** Android's transcription entry point: capture happens in the WebView, so
   *  the samples arrive as base64 16-bit PCM rather than from a Rust session. */
  voiceTranscribePcm: (sampleRate: number, pcm: string) =>
    invoke<VoiceTranscript>('voice_transcribe_pcm', { sampleRate, pcm }),

  // Platform / Android file access
  getPlatform: () => invoke<string>('get_platform'),

  getWindowInsets: () =>
    invoke<{ top: number; bottom: number; left: number; right: number; imeBottom: number }>('get_window_insets'),

  getManageStorageStatus: () => invoke<boolean>('get_manage_storage_status'),

  requestManageStorage: () => invoke<void>('request_manage_storage'),

  pickSafDirectory: () => invoke<SafRootEntry[]>('pick_saf_directory'),

  listSafRoots: () => invoke<SafRootEntry[]>('list_saf_roots'),

  removeSafRoot: (uri: string) => invoke<SafRootEntry[]>('remove_saf_root', { uri }),

  takePhoto: () => invoke<string | null>('take_photo'),

  pickGalleryImage: () => invoke<string | null>('pick_gallery_image'),

  resolveFileName: (path: string) => invoke<string>('resolve_file_name', { path }),

  // MCP servers
  listMcpServers: () => invoke<McpServer[]>('list_mcp_servers'),

  createMcpServer: (
    name: string,
    transportType: string,
    opts?: {
      command?: string
      args?: string
      env?: string
      url?: string
      headers?: string
    },
  ) =>
    invoke<McpServer>('create_mcp_server', {
      name,
      transportType,
      command: opts?.command ?? null,
      args: opts?.args ?? null,
      env: opts?.env ?? null,
      url: opts?.url ?? null,
      headers: opts?.headers ?? null,
    }),

  updateMcpServer: (
    id: string,
    updates: {
      name?: string
      transportType?: string
      command?: string | null
      args?: string | null
      env?: string | null
      url?: string | null
      headers?: string | null
      isEnabled?: number
    },
  ) => invoke<McpServer>('update_mcp_server', { id, updates }),

  deleteMcpServer: (id: string) => invoke<void>('delete_mcp_server', { id }),

  connectMcpServer: (id: string) => invoke<void>('connect_mcp_server', { id }),

  disconnectMcpServer: (id: string) => invoke<void>('disconnect_mcp_server', { id }),

  listMcpTools: (serverId?: string) => invoke<McpToolDef[]>('list_mcp_tools', { serverId: serverId ?? null }),

  // Only servers with a live entry come back. Anything absent is disconnected —
  // the caller already has the full list from the database.
  listMcpConnectionStatuses: () => invoke<McpConnectionStatus[]>('list_mcp_connection_statuses'),

  listAllToolNames: () => invoke<ToolInfo[]>('list_all_tool_names'),

  // OneBot
  getOneBotStatus: () =>
    invoke<{ enabled: boolean; running: boolean; connected_clients: number; host: string; port: number }>(
      'get_onebot_status',
    ),

  getOneBotConfig: () =>
    invoke<{
      enabled: boolean
      host: string
      port: number
      access_token: string | null
      assistant_id: string | null
      admin_users: number[]
      ack_emoji_id: string
      balance_alert_threshold: number | null
      voice_capture_sessions: string[]
      voice_send_enabled: boolean
      voice_send_groups: string[]
      voice_tts_model: string
      voice_tts_reference_id: string
    }>('get_onebot_config'),

  saveOneBotConfig: (config: {
    enabled: boolean
    host: string
    port: number
    access_token: string | null
    assistant_id: string | null
    admin_users: number[]
    ack_emoji_id: string
    balance_alert_threshold: number | null
    voice_capture_sessions: string[]
    voice_send_enabled: boolean
    voice_send_groups: string[]
    voice_tts_model: string
    voice_tts_reference_id: string
  }) => invoke<void>('save_onebot_config', { config }),

  // Voice corpus. Sessions are identified by a pseudonym rather than a group
  // number: this list travels to a phone, and what it answers is "how much is
  // stored, do I want to clear it" — not which group.
  listVoiceCorpus: () =>
    invoke<
      {
        label: string
        bot_self_id: number
        session: string
        clips: number
        bytes: number
        untranscribed: number
        last_captured_at: number
      }[]
    >('list_voice_corpus'),

  /**
   * Delete stored voice.
   *
   * The selector is a tagged union with no defaultable shape — a call that
   * loses a field fails to deserialize rather than falling through to "all",
   * which is how one mistyped remote request would erase every recording.
   */
  deleteVoiceCorpus: (
    selector:
      | { kind: 'bot_session'; bot_self_id: number; session: string }
      | { kind: 'sender'; id: string }
      | { kind: 'all'; confirmation: string },
  ) => invoke<{ clips: number; files: number; bytes: number; failures: string[] }>('delete_voice_corpus', { selector }),

  /** "Never record me again" — a different thing from deleting what exists. */
  setVoiceOptout: (senderId: string, enabled: boolean) => invoke<void>('set_voice_optout', { senderId, enabled }),

  exportVoiceCorpus: (outputDir: string, includeSender: boolean, includeUntranscribed: boolean) =>
    invoke<{ clips: number; skipped: number; bytes: number; path: string }>('export_voice_corpus', {
      outputDir,
      includeSender,
      includeUntranscribed,
    }),

  startOneBot: () => invoke<void>('start_onebot'),

  stopOneBot: () => invoke<void>('stop_onebot'),

  // Claude Code hook endpoint
  getHooksStatus: () => invoke<HooksStatus>('get_hooks_status'),

  getHooksConfig: () => invoke<HooksConfig>('get_hooks_config'),

  // Returns the stored config, which is how the caller learns the token the
  // backend minted on first save.
  saveHooksConfig: (config: HooksConfig) => invoke<HooksConfig>('save_hooks_config', { config }),

  regenerateHooksToken: () => invoke<string>('regenerate_hooks_token'),

  startHooks: () => invoke<void>('start_hooks'),

  stopHooks: () => invoke<void>('stop_hooks'),

  // Remote access: serving this desktop to another device
  getListenStatus: () => invoke<ListenStatus>('get_listen_status'),

  getListenConfig: () => invoke<ListenConfig>('get_listen_config'),

  // The four calls that change anything restart the server, so each answers
  // with the status it left behind rather than making the caller ask again.
  // The token is minted by the backend on first enable, so the config has to be
  // re-read after any of them that could have created one.
  saveListenConfig: (config: ListenConfig) => invoke<ListenStatus>('save_listen_config', { config }),

  startListen: () => invoke<ListenStatus>('start_listen'),

  stopListen: () => invoke<ListenStatus>('stop_listen'),

  // Answers with the whole config, which is how the caller learns the new token.
  regenerateListenToken: () => invoke<ListenConfig>('regenerate_listen_token'),

  // The addresses another device could dial, so nobody has to read `ipconfig`.
  getListenAddresses: () => invoke<string[]>('get_listen_addresses'),

  // Prompt Templates
  listPromptTemplates: () => invoke<PromptTemplate[]>('list_prompt_templates'),

  createPromptTemplate: (name: string, category: string, templateText: string, description?: string) =>
    invoke<PromptTemplate>('create_prompt_template', {
      name,
      category,
      templateText,
      description: description ?? null,
    }),

  updatePromptTemplate: (
    id: string,
    updates: {
      name?: string
      description?: string | null
      category?: string
      templateText?: string
    },
  ) => invoke<PromptTemplate>('update_prompt_template', { id, updates }),

  deletePromptTemplate: (id: string) => invoke<void>('delete_prompt_template', { id }),

  listTemplateVariables: () => invoke<TemplateVariable[]>('list_template_variables'),

  // Emoji Packs
  listEmojiPacks: () => invoke<EmojiPack[]>('list_emoji_packs'),

  createEmojiPack: (name: string, description?: string) =>
    invoke<EmojiPack>('create_emoji_pack', {
      name,
      description: description ?? null,
    }),

  deleteEmojiPack: (id: string) => invoke<void>('delete_emoji_pack', { id }),

  listEmojis: (packId: string) => invoke<Emoji[]>('list_emojis', { packId }),

  importEmojis: (packId: string, filePaths: string[]) => invoke<Emoji[]>('import_emojis', { packId, filePaths }),

  deleteEmoji: (id: string) => invoke<void>('delete_emoji', { id }),

  renameEmoji: (id: string, newName: string) => invoke<Emoji>('rename_emoji', { id, newName }),

  suggestStickerSemantics: (id: string) => invoke<Emoji>('suggest_sticker_semantics', { id }),

  confirmStickerSemantics: (id: string, name: string, tags?: string) =>
    invoke<Emoji>('confirm_sticker_semantics', { id, name, tags: tags ?? null }),

  searchEmojis: (query: string) => invoke<Emoji[]>('search_emojis', { query }),

  assignEmojiPack: (assistantId: string, packId: string) => invoke<void>('assign_emoji_pack', { assistantId, packId }),

  unassignEmojiPack: (assistantId: string, packId: string) =>
    invoke<void>('unassign_emoji_pack', { assistantId, packId }),

  listAssistantEmojiPacks: (assistantId: string) => invoke<EmojiPack[]>('list_assistant_emoji_packs', { assistantId }),

  getEmojiFileUrl: (emojiId: string) => invoke<string>('get_emoji_file_url', { emojiId }),

  // Tool System
  listToolCategories: () => invoke<ToolCategory[]>('list_tool_categories'),

  listCustomTools: () => invoke<CustomTool[]>('list_custom_tools'),

  createCustomTool: (params: {
    name: string
    description: string
    command: string
    categoryId?: string
    parametersSchema?: string
    argsTemplate?: string
    workingDirectory?: string
    timeoutMs?: number
    permission?: string
  }) =>
    invoke<CustomTool>('create_custom_tool', {
      name: params.name,
      description: params.description,
      command: params.command,
      categoryId: params.categoryId ?? null,
      parametersSchema: params.parametersSchema ?? null,
      argsTemplate: params.argsTemplate ?? null,
      workingDirectory: params.workingDirectory ?? null,
      timeoutMs: params.timeoutMs ?? null,
      permission: params.permission ?? null,
    }),

  updateCustomTool: (
    id: string,
    updates: {
      name?: string
      description?: string
      command?: string
      categoryId?: string | null
      parametersSchema?: string
      argsTemplate?: string | null
      workingDirectory?: string | null
      timeoutMs?: number | null
      permission?: string
      isEnabled?: number
    },
  ) => invoke<CustomTool>('update_custom_tool', { id, updates }),

  deleteCustomTool: (id: string) => invoke<void>('delete_custom_tool', { id }),

  listToolPresets: () => invoke<ToolPreset[]>('list_tool_presets'),

  createToolPreset: (name: string, toolNames: string, description?: string) =>
    invoke<ToolPreset>('create_tool_preset', {
      name,
      toolNames,
      description: description ?? null,
    }),

  updateToolPreset: (
    id: string,
    updates: {
      name?: string
      description?: string | null
      toolNames?: string
    },
  ) => invoke<ToolPreset>('update_tool_preset', { id, updates }),

  deleteToolPreset: (id: string) => invoke<void>('delete_tool_preset', { id }),

  // Skills
  listSkills: () => invoke<Skill[]>('list_skills'),

  rescanSkills: () => invoke<Skill[]>('rescan_skills'),

  getSkillBody: (dirName: string) => invoke<string>('get_skill_body', { dirName }),

  createSkill: (dirName: string, llmDescription: string, body: string, displayName?: string) =>
    invoke<Skill>('create_skill', {
      dirName,
      llmDescription,
      body,
      displayName: displayName ?? null,
    }),

  updateSkill: (
    dirName: string,
    updates: {
      displayName?: string
      llmDescription?: string
      body?: string
      isEnabled?: boolean
    },
  ) => invoke<Skill>('update_skill', { dirName, updates }),

  deleteSkill: (dirName: string) => invoke<void>('delete_skill', { dirName }),

  listSkillBindings: (layer: SkillLayer, anchorId?: string) =>
    invoke<string[]>('list_skill_bindings', { layer, anchorId: anchorId ?? null }),

  setSkillBinding: (layer: SkillLayer, anchorId: string | null, dirName: string, bound: boolean) =>
    invoke<string[]>('set_skill_binding', { layer, anchorId: anchorId ?? null, dirName, bound }),

  // Settings → About. Not `getVersion()` from `@tauri-apps/api/app`: that one
  // is answered by the shell this page may not be running in.
  getAppInfo: () => invoke<AppInfo>('get_app_info'),

  // Application logs
  readLogs: (query: LogQuery = {}) =>
    invoke<LogPage>('read_logs', {
      query: {
        minLevel: query.minLevel ?? null,
        limit: query.limit ?? null,
        contains: query.contains ?? null,
        targetPrefix: query.targetPrefix ?? null,
        conversationId: query.conversationId ?? null,
        sinceTsMs: query.sinceTsMs ?? null,
        untilTsMs: query.untilTsMs ?? null,
        cursor: query.cursor ?? null,
      },
    }),

  listLogFiles: () => invoke<LogFileInfo[]>('list_log_files'),

  getLogSettings: () => invoke<LogSettings>('get_log_settings'),

  setLogLevel: (level: string) => invoke<void>('set_log_level', { level }),

  /** Returns the number of bytes written. */
  exportLogs: (outputPath: string) => invoke<number>('export_logs', { outputPath }),

  // Service Keys (for tool services like Tavily, Zhipu search)
  setServiceKey: (service: string, key: string) => invoke<void>('set_service_key', { service, key }),

  getServiceKeyExists: (service: string) => invoke<boolean>('get_service_key_exists', { service }),

  /**
   * Tokens and cost, grouped by `dimension`.
   *
   * One call per breakdown, including the headline figures — `total` is the same
   * query with a constant key, which is what makes a breakdown add up to the
   * summary above it rather than nearly add up to it. Never sum these in the
   * front end: the cost of a group is not the sum of its rows' costs, because a
   * cached token bills at the cache rate instead of the input rate.
   */
  usageReport: (dimension: UsageDimension, filter?: UsageFilter) =>
    invoke<UsageBucket[]>('usage_report', { dimension, filter: filter ?? null }),
}
