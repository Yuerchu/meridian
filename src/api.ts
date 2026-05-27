import { invoke } from '@tauri-apps/api/core'
import type { Assistant, Conversation, Message, ModelInfo, Project, Provider } from './types'

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

  chat: (conversationId: string, message: string, modelOverride?: string, providerOverride?: string) =>
    invoke<void>('chat', {
      conversationId,
      message,
      modelOverride: modelOverride ?? null,
      providerOverride: providerOverride ?? null,
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
    modelId?: string | null
    temperature?: number | null
  }) =>
    invoke<Assistant>('update_assistant', {
      id,
      name: updates.name ?? null,
      systemPrompt: updates.systemPrompt ?? null,
      modelId: updates.modelId !== undefined ? updates.modelId : null,
      temperature: updates.temperature !== undefined ? updates.temperature : null,
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

  denyToolCall: (callId: string) =>
    invoke<void>('deny_tool_call', { callId }),

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
}
