import { invoke } from '@tauri-apps/api/core'
import type { Assistant, ContextInfo, Conversation, CustomTool, Emoji, EmojiPack, McpServer, McpToolDef, Memory, Message, ModelConfig, ModelConfigInput, ModelInfo, Project, PromptTemplate, Provider, ProviderCapabilities, SafRootEntry, Skill, SkillLayer, TemplateVariable, ToolCategory, ToolInfo, ToolPreset } from './types'

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

  togglePinConversation: (id: string) =>
    invoke<Conversation>('toggle_pin_conversation', { id }),

  deleteConversation: (id: string) =>
    invoke<void>('delete_conversation', { id }),

  getConversation: (id: string) =>
    invoke<Conversation>('get_conversation', { id }),

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

  loadMessages: (conversationId: string) =>
    invoke<Message[]>('load_messages', { conversationId }),

  updateMessageContent: (id: string, content: string) =>
    invoke<void>('update_message_content', { id, content }),

  deleteMessage: (id: string) =>
    invoke<void>('delete_message', { id }),

  deleteMessagesFrom: (conversationId: string, fromSortOrder: number) =>
    invoke<void>('delete_messages_from', { conversationId, fromSortOrder }),

  rateMessage: (id: string, rating: number | null) =>
    invoke<void>('rate_message', { id, rating }),

  exportConversation: (conversationId: string, format: string, outputPath?: string) =>
    invoke<string>('export_conversation', { conversationId, format, outputPath: outputPath ?? null }),

  uploadFile: (conversationId: string, filePath: string) =>
    invoke<unknown>('upload_file', { conversationId, filePath }),

  stopChat: (conversationId: string) =>
    invoke<void>('stop_chat', { conversationId }),

  chat: (conversationId: string, message: string, modelOverride?: string, providerOverride?: string, thinkingLevel?: string, assistantId?: string, fast?: boolean) =>
    invoke<void>('chat', {
      conversationId,
      message,
      modelOverride: modelOverride ?? null,
      providerOverride: providerOverride ?? null,
      thinkingLevel: thinkingLevel ?? null,
      assistantId: assistantId ?? null,
      fast: fast ?? null,
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

  approveToolCall: (callId: string) =>
    invoke<void>('approve_tool_call', { callId }),

  denyToolCall: (callId: string, reason?: string) =>
    invoke<void>('deny_tool_call', { callId, reason: reason ?? null }),

  respondToAsk: (callId: string, response: string) =>
    invoke<void>('respond_to_ask', { callId, response }),

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

  updateMemory: (id: string, content?: string, memoryType?: string) =>
    invoke<Memory>('update_memory', { id, content: content ?? null, memoryType: memoryType ?? null }),

  deleteMemory: (id: string) =>
    invoke<void>('delete_memory', { id }),

  // Preferences
  getPreference: (key: string) =>
    invoke<string | null>('get_preference', { key }),

  setPreference: (key: string, value: string) =>
    invoke<void>('set_preference', { key, value }),

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

  // Service Keys (for tool services like Tavily, Zhipu search)
  setServiceKey: (service: string, key: string) =>
    invoke<void>('set_service_key', { service, key }),

  getServiceKeyExists: (service: string) =>
    invoke<boolean>('get_service_key_exists', { service }),
}
