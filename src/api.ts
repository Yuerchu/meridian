import { invoke } from '@tauri-apps/api/core'
import type { Assistant, Conversation, Emoji, EmojiPack, McpServer, McpToolDef, Message, ModelInfo, Project, PromptTemplate, Provider, SafRootEntry, TemplateVariable, ToolInfo } from './types'

export const api = {
  listConversations: (archived = false) =>
    invoke<Conversation[]>('list_conversations', { archived }),

  createConversation: (title?: string, projectId?: string) =>
    invoke<Conversation>('create_conversation', { title: title ?? null, projectId: projectId ?? null }),

  updateConversationTitle: (id: string, title: string) =>
    invoke<void>('update_conversation_title', { id, title }),

  togglePinConversation: (id: string) =>
    invoke<Conversation>('toggle_pin_conversation', { id }),

  deleteConversation: (id: string) =>
    invoke<void>('delete_conversation', { id }),

  loadMessages: (conversationId: string) =>
    invoke<Message[]>('load_messages', { conversationId }),

  deleteMessage: (id: string) =>
    invoke<void>('delete_message', { id }),

  deleteMessagesFrom: (conversationId: string, fromSortOrder: number) =>
    invoke<void>('delete_messages_from', { conversationId, fromSortOrder }),

  stopChat: (conversationId: string) =>
    invoke<void>('stop_chat', { conversationId }),

  chat: (conversationId: string, message: string, modelOverride?: string, providerOverride?: string, thinkingLevel?: string, assistantId?: string) =>
    invoke<void>('chat', {
      conversationId,
      message,
      modelOverride: modelOverride ?? null,
      providerOverride: providerOverride ?? null,
      thinkingLevel: thinkingLevel ?? null,
      assistantId: assistantId ?? null,
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
  }) =>
    invoke<Assistant>('update_assistant', {
      id,
      name: updates.name ?? null,
      systemPrompt: updates.systemPrompt ?? null,
      providerId: updates.providerId !== undefined ? updates.providerId : null,
      modelId: updates.modelId !== undefined ? updates.modelId : null,
      temperature: updates.temperature !== undefined ? updates.temperature : null,
      contextLimit: updates.contextLimit ?? null,
      enabledTools: updates.enabledTools !== undefined ? updates.enabledTools : null,
      thinkingEnabled: updates.thinkingEnabled ?? null,
      thinkingBudget: updates.thinkingBudget !== undefined ? updates.thinkingBudget : null,
    }),

  deleteAssistant: (id: string) =>
    invoke<void>('delete_assistant', { id }),

  // Providers
  listProviders: () =>
    invoke<Provider[]>('list_providers'),

  createProvider: (name: string, providerType: string, baseUrl: string) =>
    invoke<Provider>('create_provider', { name, providerType, baseUrl }),

  updateProvider: (id: string, updates: {
    name?: string
    providerType?: string
    baseUrl?: string
    isEnabled?: number
  }) =>
    invoke<Provider>('update_provider', {
      id,
      name: updates.name ?? null,
      providerType: updates.providerType ?? null,
      baseUrl: updates.baseUrl ?? null,
      isEnabled: updates.isEnabled ?? null,
    }),

  deleteProvider: (id: string) =>
    invoke<void>('delete_provider', { id }),

  setProviderKey: (providerId: string, apiKey: string) =>
    invoke<void>('set_provider_key', { providerId, apiKey }),

  getProviderKeyExists: (providerId: string) =>
    invoke<boolean>('get_provider_key_exists', { providerId }),

  fetchProviderModels: (providerId: string) =>
    invoke<ModelInfo[]>('fetch_provider_models', { providerId }),

  approveToolCall: (callId: string) =>
    invoke<void>('approve_tool_call', { callId }),

  denyToolCall: (callId: string, reason?: string) =>
    invoke<void>('deny_tool_call', { callId, reason: reason ?? null }),

  respondToAsk: (callId: string, response: string) =>
    invoke<void>('respond_to_ask', { callId, response }),

  // Projects
  listProjects: () =>
    invoke<Project[]>('list_projects'),

  createProject: (name: string, path: string) =>
    invoke<Project>('create_project', { name, path }),

  updateProject: (id: string, updates: { name?: string; path?: string }) =>
    invoke<Project>('update_project', {
      id,
      name: updates.name ?? null,
      path: updates.path ?? null,
    }),

  deleteProject: (id: string) =>
    invoke<void>('delete_project', { id }),

  listConversationsByProject: (projectId: string, archived = false) =>
    invoke<Conversation[]>('list_conversations_by_project', { projectId, archived }),

  // Preferences
  getPreference: (key: string) =>
    invoke<string | null>('get_preference', { key }),

  setPreference: (key: string, value: string) =>
    invoke<void>('set_preference', { key, value }),

  // Platform / Android file access
  getPlatform: () =>
    invoke<string>('get_platform'),

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

  // MCP servers
  listMcpServers: () =>
    invoke<McpServer[]>('list_mcp_servers'),

  createMcpServer: (name: string, transportType: string, command?: string, args?: string, env?: string) =>
    invoke<McpServer>('create_mcp_server', {
      name, transportType,
      command: command ?? null, args: args ?? null,
      env: env ?? null, url: null,
    }),

  updateMcpServer: (id: string, updates: {
    name?: string
    command?: string | null
    args?: string | null
    env?: string | null
    isEnabled?: number
  }) =>
    invoke<McpServer>('update_mcp_server', {
      id,
      name: updates.name ?? null,
      command: updates.command !== undefined ? updates.command : null,
      args: updates.args !== undefined ? updates.args : null,
      env: updates.env !== undefined ? updates.env : null,
      isEnabled: updates.isEnabled ?? null,
    }),

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
      admin_users: number[];
    }>('get_onebot_config'),

  saveOneBotConfig: (config: {
    enabled: boolean; host: string; port: number;
    access_token: string | null; assistant_id: string | null;
    admin_users: number[];
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
    invoke<PromptTemplate>('update_prompt_template', {
      id,
      name: updates.name ?? null,
      description: updates.description !== undefined ? updates.description : null,
      category: updates.category ?? null,
      templateText: updates.templateText ?? null,
    }),

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
}
