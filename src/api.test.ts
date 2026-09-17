import { invoke } from '@/lib/transport'
import { api } from './api'
import type { ChatRequest } from './types'

vi.mock('@/lib/transport')

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
      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', {
        request: { title: null, projectId: null },
      })
    })

    it('createConversation sends provided title', async () => {
      mockInvoke.mockResolvedValueOnce({ id: '1' })
      await api.createConversation({ title: 'My Chat', projectId: null })
      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', {
        request: { title: 'My Chat', projectId: null },
      })
    })

    it('updateConversationTitle sends id and title', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.updateConversationTitle({ id: 'abc', title: 'New Title' })
      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_title', {
        request: { id: 'abc', title: 'New Title' },
      })
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
      const request = { id: 'abc', projectId: 'p-1' }
      await api.setConversationProject(request)
      expect(mockInvoke).toHaveBeenCalledWith('set_conversation_project', { request })
    })

    // `null` is a destination, not an omission: it files the conversation
    // under no project at all.
    it('setConversationProject sends null to unfile', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { id: 'abc', projectId: null }
      await api.setConversationProject(request)
      expect(mockInvoke).toHaveBeenCalledWith('set_conversation_project', { request })
    })

    it('sends remaining multi-field actions through named requests', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const assistant = { id: 'abc', assistantId: null }
      const edits = { id: 'abc', acceptEdits: true }
      const compaction = { conversationId: 'abc', customInstructions: null }
      const byProject = { projectId: 'p-1', archived: false }

      await api.setConversationAssistant(assistant)
      await api.setConversationAcceptEdits(edits)
      await api.compact(compaction)
      await api.listConversationsByProject(byProject)

      expect(mockInvoke.mock.calls).toEqual([
        ['set_conversation_assistant', { request: assistant }],
        ['set_conversation_accept_edits', { request: edits }],
        ['compact', { request: compaction }],
        ['list_conversations_by_project', { request: byProject }],
      ])
    })

    it('searchConversations defaults the limit to the backend', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.searchConversations({ query: '锁', limit: null })
      expect(mockInvoke).toHaveBeenCalledWith('search_conversations', {
        request: { query: '锁', limit: null },
      })
    })
  })

  describe('workspace', () => {
    it('sends every operation through one named request DTO', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const root = { conversationId: 'conversation-1' }
      const tree = { conversationId: 'conversation-1', dir: null }
      const read = { conversationId: 'conversation-1', relPath: 'src/main.rs' }
      const suggest = {
        conversationId: 'conversation-1',
        projectId: null,
        query: 'main',
        limit: 15,
      }
      const resolve = {
        conversationId: 'conversation-1',
        projectId: null,
        path: 'src/main.rs',
        lineStart: null,
        lineEnd: null,
      }
      const probe = { conversationId: 'conversation-1', projectId: null, path: 'src/main.rs' }
      const status = { conversationId: 'conversation-1' }
      const diff = { conversationId: 'conversation-1', relPath: null }
      const editor = { conversationId: 'conversation-1', relPath: 'src/main.rs', line: null }

      await api.workspaceRoot(root)
      await api.workspaceTree(tree)
      await api.workspaceReadFile(read)
      await api.workspaceSuggestRefs(suggest)
      await api.workspaceResolveRef(resolve)
      await api.workspaceProbeRef(probe)
      await api.workspaceGitStatus(status)
      await api.workspaceGitDiff(diff)
      await api.openInEditor(editor)

      expect(mockInvoke.mock.calls).toEqual([
        ['workspace_root', { request: root }],
        ['workspace_tree', { request: tree }],
        ['workspace_read_file', { request: read }],
        ['workspace_suggest_refs', { request: suggest }],
        ['workspace_resolve_ref', { request: resolve }],
        ['workspace_probe_ref', { request: probe }],
        ['workspace_git_status', { request: status }],
        ['workspace_git_diff', { request: diff }],
        ['open_in_editor', { request: editor }],
      ])
    })
  })

  describe('preferences', () => {
    it('uses named typed request DTOs for reads and updates', async () => {
      mockInvoke.mockResolvedValueOnce({ key: 'sandbox.enabled', value: 'auto' })
      await api.getPreference({ key: 'sandbox.enabled' })
      expect(mockInvoke).toHaveBeenLastCalledWith('get_preference', {
        request: { key: 'sandbox.enabled' },
      })

      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setPreference({ key: 'approvals.ttl_minutes', value: 30 })
      expect(mockInvoke).toHaveBeenLastCalledWith('set_preference', {
        request: { key: 'approvals.ttl_minutes', value: 30 },
      })
    })
  })

  describe('memories', () => {
    it('saveMemory sends one named request DTO', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'memory-1' })
      const request = {
        projectId: 'project-1',
        key: 'style',
        content: 'Keep replies concise',
        memoryType: 'preference' as const,
      }
      await api.saveMemory(request)
      expect(mockInvoke).toHaveBeenCalledWith('save_memory', { request })
    })

    it('saveMemoryScoped sends one named request DTO', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'memory-1' })
      const request = {
        scope: 'onebot_user' as const,
        projectId: null,
        subjectScopeId: 'onebot:42',
        key: 'name',
        content: 'Ada',
        memoryType: 'fact' as const,
        ownerOnly: true,
      }
      await api.saveMemoryScoped(request)
      expect(mockInvoke).toHaveBeenCalledWith('save_memory_scoped', { request })
    })

    it('updates subject flags through one complete named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = {
        subjectScopeId: 'onebot:42',
        isPinned: true,
        optedOut: null,
      }

      await api.setMemorySubjectFlags(request)

      expect(mockInvoke).toHaveBeenCalledWith('set_memory_subject_flags', { request })
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
      const request = { conversationId: 'conv-1' }
      const snap = await api.conversationSnapshot(request)
      expect(mockInvoke).toHaveBeenCalledWith('conversation_snapshot', { request })
      // Four things, or it is not a snapshot of anything.
      expect(Object.keys(snap).sort()).toEqual(['conversation', 'pending_approvals', 'tree', 'turns'])
    })

    it('switchBranch moves the head and reports nothing back', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = {
        conversationId: 'conv-1',
        messageId: 'msg-1',
      }
      await api.switchBranch(request)
      expect(mockInvoke).toHaveBeenCalledWith('switch_branch', { request })
    })

    it('deleteMessage names the conversation the subtree belongs to', async () => {
      mockInvoke.mockResolvedValueOnce(null)
      const request = {
        conversationId: 'conv-1',
        id: 'msg-1',
      }
      await api.deleteMessage(request)
      expect(mockInvoke).toHaveBeenCalledWith('delete_message', { request })
    })

    it('sends queue mutations through named request DTOs', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const removeRequest = { conversationId: 'conv-1', id: 'queued-1' }
      const reorderRequest = { conversationId: 'conv-1', ids: ['queued-2', 'queued-1'] }

      await api.queueRemove(removeRequest)
      await api.queueReorder(reorderRequest)

      expect(mockInvoke.mock.calls).toEqual([
        ['queue_remove', { request: removeRequest }],
        ['queue_reorder', { request: reorderRequest }],
      ])
    })

    it('steers a delegated conversation through one named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { conversationId: 'conv-1', text: 'check the failing test' }
      await api.steerConversation(request)
      expect(mockInvoke).toHaveBeenCalledWith('steer_conversation', { request })
    })

    it('reads the active literal-command lease without exposing its output', async () => {
      mockInvoke.mockResolvedValueOnce('turn-shell')
      await expect(api.activeUserShellTurn('conv-1')).resolves.toBe('turn-shell')
      expect(mockInvoke).toHaveBeenCalledWith('active_user_shell_turn', { conversationId: 'conv-1' })
    })

    it('runs and reloads literal commands through named request DTOs', async () => {
      mockInvoke.mockResolvedValueOnce({ status: 'completed' })
      const runRequest = {
        conversationId: 'conv-1',
        turnId: '00000000-0000-0000-0000-000000000001',
        command: 'echo ok',
        retryWithoutSandbox: null,
      }
      await api.runUserCommand(runRequest)
      expect(mockInvoke).toHaveBeenLastCalledWith('run_user_command', { request: runRequest })

      mockInvoke.mockResolvedValueOnce(null)
      const readRequest = { conversationId: 'conv-1', messageId: 'message-1' }
      await api.getUserCommandResult(readRequest)
      expect(mockInvoke).toHaveBeenLastCalledWith('get_user_command_result', { request: readRequest })
    })

    const chatRequest = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
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
      contextRefs: null,
      ...overrides,
    })

    it('chat sends one complete named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = chatRequest()
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })

    it('stopChat sends a required nullable turn id inside one named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { conversationId: 'conv-1', turnId: null }
      await api.stopChat(request)
      expect(mockInvoke).toHaveBeenCalledWith('stop_chat', { request })
    })

    it('chat passes the collaboration mode', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = chatRequest({ message: 'Hi', mode: 'plan' as const })
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })

    it('chat passes model and provider overrides', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = chatRequest({
        message: 'Hi',
        modelOverride: 'gpt-4',
        providerOverride: 'openai',
      })
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })

    it('chat passes structured workspace references beside the visible message', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const contextRefs = [{ path: 'src/api.ts', lineStart: 10, lineEnd: 12 }]
      const request = chatRequest({ message: 'Inspect @src/api.ts#L10-12', contextRefs })
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })

    /// Regeneration carries no message of its own; the question it re-answers is
    /// already on record.
    it('chat regenerates by naming the answer being replaced', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = chatRequest({ message: null, replaces: 'msg-9' })
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })

    it('chat edits by sending new text alongside the message it replaces', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = chatRequest({ message: 'reworded', replaces: 'msg-3' })
      await api.chat(request)
      expect(mockInvoke).toHaveBeenCalledWith('chat', { request })
    })
  })

  describe('journal', () => {
    it('sends blame coordinates as one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ current_sha: 'sha', head_sha: null, truncated: false, spans: [] })
      const request = { conversationId: 'conversation-1', relPath: 'src/main.rs' }
      await api.journalBlame(request)
      expect(mockInvoke).toHaveBeenCalledWith('journal_blame', { request })
    })

    it('sends version lookup as one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ content: 'fn main() {}' })
      const request = { versionId: 'version-1' }
      await api.journalVersionContent(request)
      expect(mockInvoke).toHaveBeenCalledWith('journal_version_content', { request })
    })
  })

  describe('secrets', () => {
    it('setSecret sends key and value', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { key: 'REMOTE_TOKEN' as const, value: 'my_value' }
      await api.setSecret(request)
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', { request })
    })

    it('getSecret sends key', async () => {
      mockInvoke.mockResolvedValueOnce('my_value')
      const request = { key: 'REMOTE_TOKEN' as const }
      const result = await api.getSecret(request)
      expect(mockInvoke).toHaveBeenCalledWith('get_secret', { request })
      expect(result).toBe('my_value')
    })

    it('deleteSecret sends key', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      const request = { key: 'REMOTE_TOKEN' as const }
      const result = await api.deleteSecret(request)
      expect(mockInvoke).toHaveBeenCalledWith('delete_secret', { request })
      expect(result).toBe(true)
    })
  })

  describe('assistants', () => {
    it('listAssistants calls without args', async () => {
      mockInvoke.mockResolvedValueOnce([])
      await api.listAssistants()
      expect(mockInvoke).toHaveBeenCalledWith('list_assistants')
    })

    it('createAssistant sends one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'a1' })
      await api.createAssistant({
        name: 'Helper',
        systemPrompt: 'You are helpful',
        modelId: null,
        temperature: null,
        topP: null,
        maxTokens: null,
      })
      expect(mockInvoke).toHaveBeenCalledWith('create_assistant', {
        request: {
          name: 'Helper',
          systemPrompt: 'You are helpful',
          modelId: null,
          temperature: null,
          topP: null,
          maxTokens: null,
        },
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
      await api.createProvider({
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com',
        apiFormat: null,
        catalogId: null,
        authOption: null,
      })
      expect(mockInvoke).toHaveBeenCalledWith('create_provider', {
        request: {
          name: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'https://api.openai.com',
          apiFormat: null,
          catalogId: null,
          authOption: null,
        },
      })
    })

    // Naming a vendor is a statement by the user, and it has to reach the
    // backend as one: inference from the address cannot survive them pointing
    // the row at a relay afterwards.
    it('createProvider passes the chosen vendor through', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'p1' })
      await api.createProvider({
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://relay.example',
        apiFormat: 'responses',
        catalogId: 'openai',
        authOption: null,
      })
      expect(mockInvoke).toHaveBeenCalledWith('create_provider', {
        request: {
          name: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'https://relay.example',
          apiFormat: 'responses',
          catalogId: 'openai',
          authOption: null,
        },
      })
    })

    it('updateProvider sends one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'p1' })
      await api.updateProvider({ id: 'p1', name: 'New Name' })
      expect(mockInvoke).toHaveBeenCalledWith('update_provider', {
        request: {
          id: 'p1',
          name: 'New Name',
        },
      })
    })

    it('setProviderKey sends providerId and apiKey', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { providerId: 'p1', apiKey: 'sk-xxx' }
      await api.setProviderKey(request)
      expect(mockInvoke).toHaveBeenCalledWith('set_provider_key', { request })
    })

    it('getProviderKeyExists sends providerId', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      const result = await api.getProviderKeyExists('p1')
      expect(mockInvoke).toHaveBeenCalledWith('get_provider_key_exists', { providerId: 'p1' })
      expect(result).toBe(true)
    })

    it('fetchProviderModels sends providerId', async () => {
      mockInvoke.mockResolvedValueOnce([])
      const request = { providerId: 'p1', forceRefresh: null }
      await api.fetchProviderModels(request)
      expect(mockInvoke).toHaveBeenCalledWith('fetch_provider_models', { request })
    })

    it('uses named requests for provider capabilities and model config reads', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const capabilities = { providerId: 'p1', modelId: 'm1' }
      const modelConfig = { providerId: 'p1', modelId: 'm1' }

      await api.getProviderCapabilities(capabilities)
      await api.getModelConfig(modelConfig)

      expect(mockInvoke.mock.calls).toEqual([
        ['get_provider_capabilities', { request: capabilities }],
        ['get_model_config', { request: modelConfig }],
      ])
    })
  })

  describe('named update requests', () => {
    it('sends MCP server updates as one request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'mcp-1' })
      const request = { id: 'mcp-1', isEnabled: true }
      await api.updateMcpServer(request)
      expect(mockInvoke).toHaveBeenCalledWith('update_mcp_server', { request })
    })

    it('sends assistant updates as one request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'assistant-1' })
      const request = { id: 'assistant-1', name: 'Researcher' }
      await api.updateAssistant(request)
      expect(mockInvoke).toHaveBeenCalledWith('update_assistant', { request })
    })

    it('sends skill updates as one request', async () => {
      mockInvoke.mockResolvedValueOnce({ dir_name: 'review' })
      const request = { dirName: 'review', isEnabled: false }
      await api.updateSkill(request)
      expect(mockInvoke).toHaveBeenCalledWith('update_skill', { request })
    })

    it('sends custom tool updates as one request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'tool-1' })
      const request = { id: 'tool-1', permission: 'ask' as const }
      await api.updateCustomTool(request)
      expect(mockInvoke).toHaveBeenCalledWith('update_custom_tool', { request })
    })

    it('sends tool preset updates as one request', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'preset-1' })
      const request = { id: 'preset-1', toolNames: ['read_file'] }
      await api.updateToolPreset(request)
      expect(mockInvoke).toHaveBeenCalledWith('update_tool_preset', { request })
    })
  })

  describe('ACP session contracts', () => {
    it('sends open, prompt, and attach through strict named requests', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const openRequest = { cwd: 'C:/work/project' }
      const promptRequest = {
        conversationId: 'conversation-1',
        message: 'inspect it',
        turnId: null,
        contextRefs: null,
      }
      const attachRequest = {
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        cwd: 'C:/work/project',
      }

      await api.acpOpenSession(openRequest)
      await api.acpSend(promptRequest)
      await api.acpAttachSession(attachRequest)

      expect(mockInvoke.mock.calls).toEqual([
        ['acp_open_session', { request: openRequest }],
        ['acp_send', { request: promptRequest }],
        ['acp_attach_session', { request: attachRequest }],
      ])
    })

    it('sends discovery and import through strict named requests', async () => {
      mockInvoke.mockResolvedValue([])
      const listRequest = { cwd: null }
      const importRequest = {
        sessionId: 'session-1',
        cwd: 'C:/work/project',
        title: null,
        updatedAt: null,
      }

      await api.acpListSessions(listRequest)
      await api.acpImportSession(importRequest)

      expect(mockInvoke.mock.calls).toEqual([
        ['acp_list_sessions', { request: listRequest }],
        ['acp_import_session', { request: importRequest }],
      ])
    })

    it('maps session config reads and updates through named requests', async () => {
      mockInvoke.mockResolvedValue([])
      const readRequest = { conversationId: 'conversation-1' }
      const updateRequest = {
        conversationId: 'conversation-1',
        configId: 'model',
        value: 'sonnet',
      }

      await api.acpSessionConfig(readRequest)
      await api.acpSetSessionConfig(updateRequest)

      expect(mockInvoke.mock.calls).toEqual([
        ['acp_session_config', { request: readRequest }],
        ['acp_set_session_config', { request: updateRequest }],
      ])
    })
  })

  describe('strict action requests', () => {
    it('wraps emoji actions in named requests', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const imported = { packId: 'pack-1', filePaths: ['C:/stickers/one.png'] }
      const renamed = { id: 'emoji-1', newName: 'wave' }
      const semantics = { id: 'emoji-1', name: 'wave', tags: null }
      const assignment = { assistantId: 'assistant-1', packId: 'pack-1' }

      await api.importEmojis(imported)
      await api.renameEmoji(renamed)
      await api.confirmStickerSemantics(semantics)
      await api.assignEmojiPack(assignment)
      await api.unassignEmojiPack(assignment)

      expect(mockInvoke.mock.calls).toEqual([
        ['import_emojis', { request: imported }],
        ['rename_emoji', { request: renamed }],
        ['confirm_sticker_semantics', { request: semantics }],
        ['assign_emoji_pack', { request: assignment }],
        ['unassign_emoji_pack', { request: assignment }],
      ])
    })

    it('wraps service-key writes and voice probes in named requests', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const keyRequest = { service: 'TAVILY' as const, key: 'secret' }
      const probeRequest = { sampleRate: 16_000, pcm: 'AAAAAA==' }

      await api.setServiceKey(keyRequest)
      await api.voiceProbeEcho(probeRequest)

      expect(mockInvoke.mock.calls).toEqual([
        ['set_service_key', { request: keyRequest }],
        ['voice_probe_echo', { request: probeRequest }],
      ])
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

    it('denyToolCall sends one complete named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { approvalId: 'appr-2', reason: null }
      await api.denyToolCall(request)
      expect(mockInvoke).toHaveBeenCalledWith('deny_tool_call', { request })
    })

    it('respondToAsk sends one named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { approvalId: 'appr-3', response: 'my answer' }
      await api.respondToAsk(request)
      expect(mockInvoke).toHaveBeenCalledWith('respond_to_ask', { request })
    })
  })

  describe('plan review', () => {
    it('sends every document operation through its strict named request', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const read = { reviewId: 'review-1' }
      const revisions = { documentId: 'document-1' }
      const save = {
        reviewId: 'review-1',
        expectedGeneration: 2,
        mode: 'source' as const,
        baseEditorJson: null,
        baseNormalizedMarkdown: '# Plan\n',
        editorJson: null,
        sourceText: '# Edited\n',
        normalizedMarkdown: '# Edited\n',
        comments: [],
        globalNote: null,
        selection: null,
        editorSchemaVersion: null,
        editorSchemaHash: null,
        editorSchemaFallback: { fromVersion: 9, fromHash: 'old-schema' },
      }
      const discard = { reviewId: 'review-1', expectedGeneration: 3 }
      const decision = {
        reviewId: 'review-1',
        decisionId: 'decision-1',
        expectedGeneration: 3,
        expectedDraftHash: 'draft-hash',
        action: 'request_changes' as const,
      }
      const delivery = { reviewId: 'review-1' }
      const continueDelivery = { deliveryId: 'delivery-1' }
      const conflict = { documentId: 'document-1', action: 'restore_db' as const }

      await api.getPlanReview(read)
      await api.listPlanRevisions(revisions)
      await api.savePlanReviewDraft(save)
      await api.discardPlanReviewDraft(discard)
      await api.decidePlanReview(decision)
      await api.getPlanReviewDelivery(delivery)
      await api.continuePlanReviewDelivery(continueDelivery)
      await api.resolvePlanFileConflict(conflict)

      expect(mockInvoke.mock.calls).toEqual([
        ['get_plan_review', { request: read }],
        ['list_plan_revisions', { request: revisions }],
        ['save_plan_review_draft', { request: save }],
        ['discard_plan_review_draft', { request: discard }],
        ['decide_plan_review', { request: decision }],
        ['get_plan_review_delivery', { request: delivery }],
        ['continue_plan_review_delivery', { request: continueDelivery }],
        ['resolve_plan_file_conflict', { request: conflict }],
      ])
    })
  })

  describe('voice corpus', () => {
    it('sends a deletion as one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ clips: 1, files: 1, bytes: 16, failures: [] })
      const request = { selector: { kind: 'sender' as const, id: 'alice' } }
      await api.deleteVoiceCorpus(request)
      expect(mockInvoke).toHaveBeenCalledWith('delete_voice_corpus', { request })
    })

    it('sends opt-out changes as one named request', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      const request = { senderId: 'alice', enabled: true }
      await api.setVoiceOptout(request)
      expect(mockInvoke).toHaveBeenCalledWith('set_voice_optout', { request })
    })

    it('sends export options as one named request', async () => {
      mockInvoke.mockResolvedValueOnce({ clips: 1, skipped: 0, bytes: 16, path: 'voice-corpus' })
      const request = {
        outputDir: 'voice-corpus',
        includeSender: false,
        includeUntranscribed: false,
      }
      await api.exportVoiceCorpus(request)
      expect(mockInvoke).toHaveBeenCalledWith('export_voice_corpus', { request })
    })
  })

  describe('logs', () => {
    it('readLogs sends an explicit null for every unset filter', async () => {
      mockInvoke.mockResolvedValueOnce({ entries: [], nextCursor: null })
      await api.readLogs()
      expect(mockInvoke).toHaveBeenCalledWith('read_logs', {
        request: {
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
        request: expect.objectContaining({
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
        request: expect.objectContaining({ cursor }),
      })
    })

    it('exportLogs sends the chosen path', async () => {
      mockInvoke.mockResolvedValueOnce({ bytesWritten: 1024 })
      const request = { outputPath: '/tmp/logs.jsonl' }
      await api.exportLogs(request)
      expect(mockInvoke).toHaveBeenCalledWith('export_logs', { request })
    })

    it('setLogLevel sends the level', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await api.setLogLevel({ level: 'debug' })
      expect(mockInvoke).toHaveBeenCalledWith('set_log_level', { request: { level: 'debug' } })
    })
  })
})
