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

    it('setConversationProject sends the target project', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setConversationProject('abc', 'p-1')
      expect(mockInvoke).toHaveBeenCalledWith('set_conversation_project', { id: 'abc', projectId: 'p-1' })
    })

    // `null` is a destination, not an omission: it files the conversation
    // under no project at all.
    it('setConversationProject sends null to unfile', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setConversationProject('abc', null)
      expect(mockInvoke).toHaveBeenCalledWith('set_conversation_project', { id: 'abc', projectId: null })
    })

    it('searchConversations defaults the limit to the backend', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.searchConversations('锁')
      expect(mockInvoke).toHaveBeenCalledWith('search_conversations', { query: '锁', limit: null })
    })
  })

  describe('messages', () => {
    // The only way in. The three requests it replaced could interleave with a
    // running turn, and what came back described no moment that ever existed.
    it('conversationSnapshot reads the whole conversation at once', async () => {
      mockInvoke.mockResolvedValueOnce({
        conversation: {},
        tree: { messages: [], head_message_id: null, branches: [] },
        turns: [],
        pending_approvals: [],
      })
      const snap = await api.conversationSnapshot('conv-1')
      expect(mockInvoke).toHaveBeenCalledWith('conversation_snapshot', { conversationId: 'conv-1' })
      // Four things, or it is not a snapshot of anything.
      expect(Object.keys(snap).sort()).toEqual(['conversation', 'pending_approvals', 'tree', 'turns'])
    })

    it('switchBranch moves the head and reports nothing back', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.switchBranch('conv-1', 'msg-1')
      expect(mockInvoke).toHaveBeenCalledWith('switch_branch', {
        conversationId: 'conv-1',
        messageId: 'msg-1',
      })
    })

    it('deleteMessage names the conversation the subtree belongs to', async () => {
      mockInvoke.mockResolvedValueOnce(null)
      await api.deleteMessage('conv-1', 'msg-1')
      expect(mockInvoke).toHaveBeenCalledWith('delete_message', {
        conversationId: 'conv-1',
        id: 'msg-1',
      })
    })

    it('chat sends defaults for optional params', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'Hello')
      expect(mockInvoke).toHaveBeenCalledWith('chat', {
        conversationId: 'conv-1',
        message: 'Hello',
        turnId: null,
        replaces: null,
        modelOverride: null,
        providerOverride: null,
        thinkingLevel: null,
        assistantId: null,
        fast: null,
        mode: null,
        voice: null,
      })
    })

    it('chat passes the collaboration mode', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'Hi', { mode: 'plan' })
      expect(mockInvoke).toHaveBeenCalledWith('chat', expect.objectContaining({ mode: 'plan' }))
    })

    it('chat passes model and provider overrides', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'Hi', { modelOverride: 'gpt-4', providerOverride: 'openai' })
      expect(mockInvoke).toHaveBeenCalledWith('chat', {
        conversationId: 'conv-1',
        message: 'Hi',
        turnId: null,
        replaces: null,
        modelOverride: 'gpt-4',
        providerOverride: 'openai',
        thinkingLevel: null,
        assistantId: null,
        fast: null,
        mode: null,
        voice: null,
      })
    })

    /// Regeneration carries no message of its own; the question it re-answers is
    /// already on record.
    it('chat regenerates by naming the answer being replaced', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', null, { replaces: 'msg-9' })
      expect(mockInvoke).toHaveBeenCalledWith(
        'chat',
        expect.objectContaining({
          message: null,
          replaces: 'msg-9',
        }),
      )
    })

    it('chat edits by sending new text alongside the message it replaces', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.chat('conv-1', 'reworded', { replaces: 'msg-3' })
      expect(mockInvoke).toHaveBeenCalledWith(
        'chat',
        expect.objectContaining({
          message: 'reworded',
          replaces: 'msg-3',
        }),
      )
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
        catalogId: null,
        authOption: null,
      })
    })

    // Naming a vendor is a statement by the user, and it has to reach the
    // backend as one: inference from the address cannot survive them pointing
    // the row at a relay afterwards.
    it('createProvider passes the chosen vendor through', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'p1' })
      await api.createProvider('OpenAI', 'openai', 'https://relay.example', 'responses', 'openai')
      expect(mockInvoke).toHaveBeenCalledWith('create_provider', {
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://relay.example',
        apiFormat: 'responses',
        catalogId: 'openai',
        authOption: null,
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
        credentialKind: null,
        transportProfile: null,
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
    // The approval id, never the provider's call id: gateways reuse those, and
    // answering by one would land on whichever call happened to share it.
    it('approveToolCall sends approvalId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.approveToolCall('appr-1')
      expect(mockInvoke).toHaveBeenCalledWith('approve_tool_call', { approvalId: 'appr-1' })
    })

    it('denyToolCall sends approvalId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.denyToolCall('appr-2')
      expect(mockInvoke).toHaveBeenCalledWith('deny_tool_call', { approvalId: 'appr-2', reason: null })
    })

    it('respondToAsk sends approvalId and response', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.respondToAsk('appr-3', 'my answer')
      expect(mockInvoke).toHaveBeenCalledWith('respond_to_ask', { approvalId: 'appr-3', response: 'my answer' })
    })
  })

  describe('logs', () => {
    it('readLogs sends an explicit null for every unset filter', async () => {
      mockInvoke.mockResolvedValueOnce({ entries: [], nextCursor: null })
      await api.readLogs()
      expect(mockInvoke).toHaveBeenCalledWith('read_logs', {
        query: {
          minLevel: null,
          limit: null,
          contains: null,
          targetPrefix: null,
          conversationId: null,
          sinceTsMs: null,
          untilTsMs: null,
          cursor: null,
        },
      })
    })

    it('readLogs passes the filters it was given', async () => {
      mockInvoke.mockResolvedValueOnce({ entries: [], nextCursor: null })
      await api.readLogs({ minLevel: 'warn', limit: 50, contains: '401', sinceTsMs: 1000 })
      expect(mockInvoke).toHaveBeenCalledWith('read_logs', {
        query: expect.objectContaining({
          minLevel: 'warn',
          limit: 50,
          contains: '401',
          sinceTsMs: 1000,
        }),
      })
    })

    // Paging is only correct if the cursor survives the round trip untouched;
    // reconstructing it from a timestamp would drop or repeat records.
    it('readLogs forwards the paging cursor unchanged', async () => {
      mockInvoke.mockResolvedValueOnce({ entries: [], nextCursor: null })
      const cursor = { fileIndex: 1, byteOffset: 4096 }
      await api.readLogs({ cursor })
      expect(mockInvoke).toHaveBeenCalledWith('read_logs', {
        query: expect.objectContaining({ cursor }),
      })
    })

    it('exportLogs sends the chosen path', async () => {
      mockInvoke.mockResolvedValueOnce(1024)
      await api.exportLogs('/tmp/logs.jsonl')
      expect(mockInvoke).toHaveBeenCalledWith('export_logs', { outputPath: '/tmp/logs.jsonl' })
    })

    it('setLogLevel sends the level', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setLogLevel('debug')
      expect(mockInvoke).toHaveBeenCalledWith('set_log_level', { level: 'debug' })
    })
  })
})
