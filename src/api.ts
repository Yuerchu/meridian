import { invoke } from '@tauri-apps/api/core'
import type { Assistant, ChatMode, ContextInfo, Conversation, ConversationSnapshot, CustomTool, Emoji, EmojiPack, LogFileInfo, LogPage, LogQuery, LogSettings, McpConnectionStatus, McpServer, McpToolDef, Memory, MemoryEnums, MemorySubject, ModelConfig, ModelConfigInput, ModelInfo, Project, PromptTemplate, Provider, ProviderCapabilities, SafRootEntry, Skill, SkillLayer, TemplateVariable, TodoListView, ToolCategory, ToolInfo, ToolPreset, VoiceModelStatus, VoiceTranscript } from './types'

export const api = {
  listConversations: (archived = false) =>
    invoke<Conversation[]>('list_conversations', { archived }),

  createConversation: (title?: string, projectId?: string) =>
    invoke<Conversation>('create_conversation', { title: title ?? null, projectId: projectId ?? null }),

  updateConversationTitle: (id: string, title: string) =>
    invoke<void>('update_conversation_title', { id, title }),

  setConversationAssistant: (id: string, assistantId: string | null) =>
    invoke<void>('set_conversation_assistant', { id, assistantId }),

  setConversationReasoningPrefs: (id: string, thinkingLevel: string | null, fastMode: boolean) =>
    invoke<void>('set_conversation_reasoning_prefs', { id, thinkingLevel, fastMode }),

  // Its own setter rather than another field on the one above: that one writes
  // two columns at once, so every caller has to pass the other's current value.
  setConversationMode: (id: string, mode: ChatMode | null) =>
    invoke<void>('set_conversation_mode', { id, mode }),

  // Also its own setter, and kept apart from the mode for a second reason: a
  // mode narrows what the assistant may do, this widens what it may do without
  // asking. One call writing both would suggest they are the same kind of thing.
  setConversationAcceptEdits: (id: string, acceptEdits: boolean) =>
    invoke<void>('set_conversation_accept_edits', { id, acceptEdits }),

  togglePinConversation: (id: string) =>
    invoke<Conversation>('toggle_pin_conversation', { id }),

  deleteConversation: (id: string) =>
    invoke<void>('delete_conversation', { id }),

  compact: (conversationId: string, customInstructions?: string) =>
    invoke<void>('compact', {
      conversationId,
      customInstructions: customInstructions ?? null,
    }),

  getContextInfo: (conversationId: string) =>
    invoke<ContextInfo>('get_context_info', { conversationId }),

  listModelConfigs: (providerId: string) =>
    invoke<ModelConfig[]>('list_model_configs', { providerId }),

  getModelConfig: (providerId: string, modelId: string) =>
    invoke<ModelConfig | null>('get_model_config', { providerId, modelId }),

  saveModelConfig: (input: ModelConfigInput) =>
    invoke<ModelConfig>('save_model_config', { input }),

  deleteModelConfig: (id: string) =>
    invoke<void>('delete_model_config', { id }),

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
  deleteMessage: (conversationId: string, id: string) =>
    invoke<void>('delete_message', { conversationId, id }),

  rateMessage: (id: string, rating: number | null) =>
    invoke<void>('rate_message', { id, rating }),

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

  setSecret: (key: string, value: string) =>
    invoke<void>('set_secret', { key, value }),

  getSecret: (key: string) =>
    invoke<string | null>('get_secret', { key }),

  deleteSecret: (key: string) =>
    invoke<boolean>('delete_secret', { key }),

  listAssistants: () =>
    invoke<Assistant[]>('list_assistants'),

  createAssistant: (name: string, systemPrompt: string, modelId?: string) =>
    invoke<Assistant>('create_assistant', {
      name,
      systemPrompt,
      modelId: modelId ?? null,
      temperature: null,
      topP: null,
      maxTokens: null,
    }),

  updateAssistant: (id: string, updates: {
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
  }) =>
    invoke<Assistant>('update_assistant', { id, updates }),

  deleteAssistant: (id: string) =>
    invoke<void>('delete_assistant', { id }),

  // Providers
  listProviders: () =>
    invoke<Provider[]>('list_providers'),

  createProvider: (name: string, providerType: string, baseUrl: string, apiFormat?: string) =>
    invoke<Provider>('create_provider', { name, providerType, baseUrl, apiFormat: apiFormat ?? null }),

  updateProvider: (id: string, updates: {
    name?: string
    providerType?: string
    baseUrl?: string
    isEnabled?: number
    apiFormat?: string
  }) =>
    invoke<Provider>('update_provider', {
      id,
      name: updates.name ?? null,
      providerType: updates.providerType ?? null,
      baseUrl: updates.baseUrl ?? null,
      isEnabled: updates.isEnabled ?? null,
      apiFormat: updates.apiFormat ?? null,
    }),

  deleteProvider: (id: string) =>
    invoke<void>('delete_provider', { id }),

  setProviderKey: (providerId: string, apiKey: string) =>
    invoke<void>('set_provider_key', { providerId, apiKey }),

  getProviderKeyExists: (providerId: string) =>
    invoke<boolean>('get_provider_key_exists', { providerId }),

  fetchProviderModels: (providerId: string, forceRefresh?: boolean) =>
    invoke<ModelInfo[]>('fetch_provider_models', { providerId, forceRefresh: forceRefresh ?? null }),

  getProviderCapabilities: (providerId: string, modelId: string) =>
    invoke<ProviderCapabilities>('get_provider_capabilities', { providerId, modelId }),

  // All three address an `approval_id` the backend minted, not the provider's
  // tool call id, and all three reject when nothing is waiting on it any more —
  // the caller turns that into an `orphaned` card rather than spinning.
  approveToolCall: (approvalId: string) =>
    invoke<void>('approve_tool_call', { approvalId }),

  denyToolCall: (approvalId: string, reason?: string) =>
    invoke<void>('deny_tool_call', { approvalId, reason: reason ?? null }),

  respondToAsk: (approvalId: string, response: string) =>
    invoke<void>('respond_to_ask', { approvalId, response }),

  listStagedEdits: (conversationId: string) =>
    invoke<Array<{ path: string; diff: string; tool_name: string }>>('list_staged_edits', { conversationId }),

  approveStagedEdit: (conversationId: string, path: string) =>
    invoke<void>('approve_staged_edit', { conversationId, path }),

  approveAllStagedEdits: (conversationId: string) =>
    invoke<number>('approve_all_staged_edits', { conversationId }),

  rejectStagedEdit: (conversationId: string, path: string) =>
    invoke<void>('reject_staged_edit', { conversationId, path }),

  // Projects
  listProjects: () =>
    invoke<Project[]>('list_projects'),

  createProject: (name: string, path?: string, sourceType?: string, sourceId?: string, assistantId?: string, description?: string) =>
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

  deleteProject: (id: string) =>
    invoke<void>('delete_project', { id }),

  listConversationsByProject: (projectId: string, archived = false) =>
    invoke<Conversation[]>('list_conversations_by_project', { projectId, archived }),

  // Memories
  listMemories: (projectId: string) =>
    invoke<Memory[]>('list_memories', { projectId }),

  saveMemory: (projectId: string, key: string, content: string, memoryType?: string) =>
    invoke<Memory>('save_memory', { projectId, key, content, memoryType: memoryType ?? null }),

  updateMemory: (id: string, content?: string, memoryType?: string, ownerOnly?: boolean) =>
    invoke<Memory>('update_memory', {
      id,
      content: content ?? null,
      memoryType: memoryType ?? null,
      ownerOnly: ownerOnly ?? null,
    }),

  deleteMemory: (id: string) =>
    invoke<void>('delete_memory', { id }),

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

  forgetMemorySubject: (subjectScopeId: string) =>
    invoke<number>('forget_memory_subject', { subjectScopeId }),

  setMemorySubjectFlags: (subjectScopeId: string, isPinned?: boolean, optedOut?: boolean) =>
    invoke<void>('set_memory_subject_flags', {
      subjectScopeId,
      isPinned: isPinned ?? null,
      optedOut: optedOut ?? null,
    }),

  listMemoryTrash: (limit?: number) =>
    invoke<Memory[]>('list_memory_trash', { limit: limit ?? null }),

  restoreMemories: (ids: string[]) => invoke<number>('restore_memories', { ids }),

  purgeMemories: (ids: string[]) => invoke<number>('purge_memories', { ids }),

  memoryEnums: () => invoke<MemoryEnums>('memory_enums'),

  // Preferences
  getPreference: (key: string) =>
    invoke<string | null>('get_preference', { key }),

  setPreference: (key: string, value: string) =>
    invoke<void>('set_preference', { key, value }),

  // Voice input (desktop only)
  /** Open the microphone early so the first word is not lost to device latency. */
  voicePrewarm: () =>
    invoke<void>('voice_prewarm'),

  voiceReleasePrewarm: () =>
    invoke<void>('voice_release_prewarm'),

  voiceStartRecording: () =>
    invoke<void>('voice_start_recording'),

  voiceStopAndTranscribe: () =>
    invoke<VoiceTranscript>('voice_stop_and_transcribe'),

  voiceCancelRecording: () =>
    invoke<void>('voice_cancel_recording'),

  voiceModelStatus: () =>
    invoke<VoiceModelStatus>('voice_model_status'),

  voiceDownloadModel: (url?: string) =>
    invoke<void>('voice_download_model', { url: url ?? null }),

  voiceCancelDownload: () =>
    invoke<void>('voice_cancel_download'),

  voiceImportModel: (archivePath: string) =>
    invoke<VoiceModelStatus>('voice_import_model', { archivePath }),

  voiceDeleteModel: () =>
    invoke<void>('voice_delete_model'),

  /** Decodes and counts the samples, nothing more. Measures what a base64 PCM
   *  payload actually costs over the bridge — Android has no raw IPC. */
  voiceProbeEcho: (sampleRate: number, pcm: string) =>
    invoke<number>('voice_probe_echo', { sampleRate, pcm }),

  /** Android's transcription entry point: capture happens in the WebView, so
   *  the samples arrive as base64 16-bit PCM rather than from a Rust session. */
  voiceTranscribePcm: (sampleRate: number, pcm: string) =>
    invoke<VoiceTranscript>('voice_transcribe_pcm', { sampleRate, pcm }),

  // Platform / Android file access
  getPlatform: () =>
    invoke<string>('get_platform'),

  getWindowInsets: () =>
    invoke<{ top: number; bottom: number; left: number; right: number; imeBottom: number }>('get_window_insets'),

  getManageStorageStatus: () =>
    invoke<boolean>('get_manage_storage_status'),

  requestManageStorage: () =>
    invoke<void>('request_manage_storage'),

  pickSafDirectory: () =>
    invoke<SafRootEntry[]>('pick_saf_directory'),

  listSafRoots: () =>
    invoke<SafRootEntry[]>('list_saf_roots'),

  removeSafRoot: (uri: string) =>
    invoke<SafRootEntry[]>('remove_saf_root', { uri }),

  takePhoto: () =>
    invoke<string | null>('take_photo'),

  pickGalleryImage: () =>
    invoke<string | null>('pick_gallery_image'),

  resolveFileName: (path: string) =>
    invoke<string>('resolve_file_name', { path }),

  // MCP servers
  listMcpServers: () =>
    invoke<McpServer[]>('list_mcp_servers'),

  createMcpServer: (name: string, transportType: string, opts?: {
    command?: string, args?: string, env?: string, url?: string, headers?: string
  }) =>
    invoke<McpServer>('create_mcp_server', {
      name, transportType,
      command: opts?.command ?? null, args: opts?.args ?? null,
      env: opts?.env ?? null, url: opts?.url ?? null,
      headers: opts?.headers ?? null,
    }),

  updateMcpServer: (id: string, updates: {
    name?: string
    transportType?: string
    command?: string | null
    args?: string | null
    env?: string | null
    url?: string | null
    headers?: string | null
    isEnabled?: number
  }) =>
    invoke<McpServer>('update_mcp_server', { id, updates }),

  deleteMcpServer: (id: string) =>
    invoke<void>('delete_mcp_server', { id }),

  connectMcpServer: (id: string) =>
    invoke<void>('connect_mcp_server', { id }),

  disconnectMcpServer: (id: string) =>
    invoke<void>('disconnect_mcp_server', { id }),

  listMcpTools: (serverId?: string) =>
    invoke<McpToolDef[]>('list_mcp_tools', { serverId: serverId ?? null }),

  // Only servers with a live entry come back. Anything absent is disconnected —
  // the caller already has the full list from the database.
  listMcpConnectionStatuses: () =>
    invoke<McpConnectionStatus[]>('list_mcp_connection_statuses'),

  listAllToolNames: () =>
    invoke<ToolInfo[]>('list_all_tool_names'),

  // OneBot
  getOneBotStatus: () =>
    invoke<{ enabled: boolean; running: boolean; connected_clients: number; host: string; port: number }>('get_onebot_status'),

  getOneBotConfig: () =>
    invoke<{
      enabled: boolean; host: string; port: number;
      access_token: string | null; assistant_id: string | null;
      admin_users: number[]; ack_emoji_id: string;
    }>('get_onebot_config'),

  saveOneBotConfig: (config: {
    enabled: boolean; host: string; port: number;
    access_token: string | null; assistant_id: string | null;
    admin_users: number[]; ack_emoji_id: string;
  }) =>
    invoke<void>('save_onebot_config', { config }),

  startOneBot: () =>
    invoke<void>('start_onebot'),

  stopOneBot: () =>
    invoke<void>('stop_onebot'),

  // Prompt Templates
  listPromptTemplates: () =>
    invoke<PromptTemplate[]>('list_prompt_templates'),

  createPromptTemplate: (name: string, category: string, templateText: string, description?: string) =>
    invoke<PromptTemplate>('create_prompt_template', {
      name, category, templateText,
      description: description ?? null,
    }),

  updatePromptTemplate: (id: string, updates: {
    name?: string
    description?: string | null
    category?: string
    templateText?: string
  }) =>
    invoke<PromptTemplate>('update_prompt_template', { id, updates }),

  deletePromptTemplate: (id: string) =>
    invoke<void>('delete_prompt_template', { id }),

  listTemplateVariables: () =>
    invoke<TemplateVariable[]>('list_template_variables'),

  // Emoji Packs
  listEmojiPacks: () =>
    invoke<EmojiPack[]>('list_emoji_packs'),

  createEmojiPack: (name: string, description?: string) =>
    invoke<EmojiPack>('create_emoji_pack', {
      name,
      description: description ?? null,
    }),

  deleteEmojiPack: (id: string) =>
    invoke<void>('delete_emoji_pack', { id }),

  listEmojis: (packId: string) =>
    invoke<Emoji[]>('list_emojis', { packId }),

  importEmojis: (packId: string, filePaths: string[]) =>
    invoke<Emoji[]>('import_emojis', { packId, filePaths }),

  deleteEmoji: (id: string) =>
    invoke<void>('delete_emoji', { id }),

  renameEmoji: (id: string, newName: string) =>
    invoke<Emoji>('rename_emoji', { id, newName }),

  searchEmojis: (query: string) =>
    invoke<Emoji[]>('search_emojis', { query }),

  assignEmojiPack: (assistantId: string, packId: string) =>
    invoke<void>('assign_emoji_pack', { assistantId, packId }),

  unassignEmojiPack: (assistantId: string, packId: string) =>
    invoke<void>('unassign_emoji_pack', { assistantId, packId }),

  listAssistantEmojiPacks: (assistantId: string) =>
    invoke<EmojiPack[]>('list_assistant_emoji_packs', { assistantId }),

  getEmojiFileUrl: (emojiId: string) =>
    invoke<string>('get_emoji_file_url', { emojiId }),

  // Tool System
  listToolCategories: () =>
    invoke<ToolCategory[]>('list_tool_categories'),

  listCustomTools: () =>
    invoke<CustomTool[]>('list_custom_tools'),

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

  updateCustomTool: (id: string, updates: {
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
  }) =>
    invoke<CustomTool>('update_custom_tool', { id, updates }),

  deleteCustomTool: (id: string) =>
    invoke<void>('delete_custom_tool', { id }),

  listToolPresets: () =>
    invoke<ToolPreset[]>('list_tool_presets'),

  createToolPreset: (name: string, toolNames: string, description?: string) =>
    invoke<ToolPreset>('create_tool_preset', {
      name,
      toolNames,
      description: description ?? null,
    }),

  updateToolPreset: (id: string, updates: {
    name?: string
    description?: string | null
    toolNames?: string
  }) =>
    invoke<ToolPreset>('update_tool_preset', { id, updates }),

  deleteToolPreset: (id: string) =>
    invoke<void>('delete_tool_preset', { id }),

  // Skills
  listSkills: () =>
    invoke<Skill[]>('list_skills'),

  rescanSkills: () =>
    invoke<Skill[]>('rescan_skills'),

  getSkillBody: (dirName: string) =>
    invoke<string>('get_skill_body', { dirName }),

  createSkill: (dirName: string, llmDescription: string, body: string, displayName?: string) =>
    invoke<Skill>('create_skill', {
      dirName,
      llmDescription,
      body,
      displayName: displayName ?? null,
    }),

  updateSkill: (dirName: string, updates: {
    displayName?: string
    llmDescription?: string
    body?: string
    isEnabled?: boolean
  }) =>
    invoke<Skill>('update_skill', { dirName, updates }),

  deleteSkill: (dirName: string) =>
    invoke<void>('delete_skill', { dirName }),

  listSkillBindings: (layer: SkillLayer, anchorId?: string) =>
    invoke<string[]>('list_skill_bindings', { layer, anchorId: anchorId ?? null }),

  setSkillBinding: (layer: SkillLayer, anchorId: string | null, dirName: string, bound: boolean) =>
    invoke<string[]>('set_skill_binding', { layer, anchorId: anchorId ?? null, dirName, bound }),

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
  setServiceKey: (service: string, key: string) =>
    invoke<void>('set_service_key', { service, key }),

  getServiceKeyExists: (service: string) =>
    invoke<boolean>('get_service_key_exists', { service }),
}
