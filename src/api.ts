import { invoke } from '@tauri-apps/api/core'
import type { Assistant, Conversation, Message } from './types'

export const api = {
  listConversations: (archived = false) =>
    invoke<Conversation[]>('list_conversations', { archived }),

  createConversation: (title?: string) =>
    invoke<Conversation>('create_conversation', { title: title ?? null }),

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

  chat: (conversationId: string, message: string) =>
    invoke<void>('chat', { conversationId, message }),

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
}
