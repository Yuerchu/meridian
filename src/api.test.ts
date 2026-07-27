import { invoke } from '@tauri-apps/api/core'
import { api } from './api'

vi.mock('@tauri-apps/api/core')

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('api', () => {
  describe('conversations', () => {
    it('listConversations defaults archived to false', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.listConversations()
      expect(mockInvoke).toHaveBeenCalledWith('list_conversations', { archived: false })
    })

    it('listConversations passes archived flag', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.listConversations(true)
      expect(mockInvoke).toHaveBeenCalledWith('list_conversations', { archived: true })
    })

    it('createConversation sends null title by default', async () => {
      mockInvoke.mockResolvedValueOnce({ id: '1' })
      await api.createConversation()
      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', { title: null, projectId: null })
    })

    it('createConversation sends provided title', async () => {
      mockInvoke.mockResolvedValueOnce({ id: '1' })
      await api.createConversation('My Chat')
      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', { title: 'My Chat', projectId: null })
    })

    it('updateConversationTitle sends id and title', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.updateConversationTitle('abc', 'New Title')
      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_title', { id: 'abc', title: 'New Title' })
    })

    it('togglePinConversation sends id', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'abc' })
      await api.togglePinConversation('abc')
      expect(mockInvoke).toHaveBeenCalledWith('toggle_pin_conversation', { id: 'abc' })
    })

    it('deleteConversation sends id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.deleteConversation('abc')
      expect(mockInvoke).toHaveBeenCalledWith('delete_conversation', { id: 'abc' })
    })
  })

  describe('messages', () => {
    it('loadMessages sends conversationId', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.loadMessages('conv-1')
      expect(mockInvoke).toHaveBeenCalledWith('load_messages', { conversationId: 'conv-1' })
    })

    it('deleteMessage sends id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.deleteMessage('msg-1')
      expect(mockInvoke).toHaveBeenCalledWith('delete_message', { id: 'msg-1' })
    })

    it('chat sends defaults for optional params', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'Hello')
      expect(mockInvoke).toHaveBeenCalledWith('chat', {
        conversationId: 'conv-1',
        message: 'Hello',
        modelOverride: null,
        providerOverride: null,
        thinkingLevel: null,
        assistantId: null,
        fast: null,
      })
    })

    it('chat passes model and provider overrides', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'Hi', 'gpt-4', 'openai')
      expect(mockInvoke).toHaveBeenCalledWith('chat', {
        conversationId: 'conv-1',
        message: 'Hi',
        modelOverride: 'gpt-4',
        providerOverride: 'openai',
        thinkingLevel: null,
        assistantId: null,
        fast: null,
      })
    })
  })

  describe('secrets', () => {
    it('setSecret sends key and value', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setSecret('MY_KEY', 'my_value')
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', { key: 'MY_KEY', value: 'my_value' })
    })

    it('getSecret sends key', async () => {
      mockInvoke.mockResolvedValueOnce('my_value')
      const result = await api.getSecret('MY_KEY')
      expect(mockInvoke).toHaveBeenCalledWith('get_secret', { key: 'MY_KEY' })
      expect(result).toBe('my_value')
    })

    it('deleteSecret sends key', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      const result = await api.deleteSecret('MY_KEY')
      expect(mockInvoke).toHaveBeenCalledWith('delete_secret', { key: 'MY_KEY' })
      expect(result).toBe(true)
    })
  })

  describe('assistants', () => {
    it('listAssistants calls without args', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.listAssistants()
      expect(mockInvoke).toHaveBeenCalledWith('list_assistants')
    })

    it('createAssistant sends defaults for optional params', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'a1' })
      await api.createAssistant('Helper', 'You are helpful')
      expect(mockInvoke).toHaveBeenCalledWith('create_assistant', {
        name: 'Helper',
        systemPrompt: 'You are helpful',
        modelId: null,
        temperature: null,
        topP: null,
        maxTokens: null,
      })
    })

    it('deleteAssistant sends id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.deleteAssistant('a1')
      expect(mockInvoke).toHaveBeenCalledWith('delete_assistant', { id: 'a1' })
    })
  })

  describe('providers', () => {
    it('createProvider sends correct shape', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'p1' })
      await api.createProvider('OpenAI', 'openai', 'https://api.openai.com')
      expect(mockInvoke).toHaveBeenCalledWith('create_provider', {
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com',
        apiFormat: null,
      })
    })

    it('updateProvider fills null for missing fields', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'p1' })
      await api.updateProvider('p1', { name: 'New Name' })
      expect(mockInvoke).toHaveBeenCalledWith('update_provider', {
        id: 'p1',
        name: 'New Name',
        providerType: null,
        baseUrl: null,
        isEnabled: null,
        apiFormat: null,
      })
    })

    it('setProviderKey sends providerId and apiKey', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setProviderKey('p1', 'sk-xxx')
      expect(mockInvoke).toHaveBeenCalledWith('set_provider_key', { providerId: 'p1', apiKey: 'sk-xxx' })
    })

    it('getProviderKeyExists sends providerId', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      const result = await api.getProviderKeyExists('p1')
      expect(mockInvoke).toHaveBeenCalledWith('get_provider_key_exists', { providerId: 'p1' })
      expect(result).toBe(true)
    })

    it('fetchProviderModels sends providerId', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.fetchProviderModels('p1')
      expect(mockInvoke).toHaveBeenCalledWith('fetch_provider_models', { providerId: 'p1', forceRefresh: null })
    })
  })

  describe('tool calls', () => {
    it('approveToolCall sends callId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.approveToolCall('call-1')
      expect(mockInvoke).toHaveBeenCalledWith('approve_tool_call', { callId: 'call-1' })
    })

    it('denyToolCall sends callId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.denyToolCall('call-2')
      expect(mockInvoke).toHaveBeenCalledWith('deny_tool_call', { callId: 'call-2', reason: null })
    })

    it('respondToAsk sends callId and response', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.respondToAsk('ask-1', 'my answer')
      expect(mockInvoke).toHaveBeenCalledWith('respond_to_ask', { callId: 'ask-1', response: 'my answer' })
    })
  })
})
