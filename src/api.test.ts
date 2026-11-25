import { invoke } from '@/lib/transport'
import { api } from './api'
import type { ChatStartRequest } from './types'

vi.mock('@/lib/transport')

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('api (API_REV 4 resource namespaces)', () => {
  describe('conversations', () => {
    it('routes list, create, update, search, delete, compact, context, snapshot, and export through single request payloads', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const listReq = { archived: false, project_id: null }
      const byProjectReq = { archived: false, project_id: 'p-1' }
      const createReq = { title: 'My Chat', project_id: null }
      const updateReq = {
        id: 'abc',
        title: 'New Title',
        is_pinned: true,
        assistant_id: null,
        thinking_level: 'high' as const,
        fast_mode: true,
        accept_edits: true,
        project_id: 'p-1',
      }
      const searchReq = { query: '锁', limit: null }
      const deleteReq = { id: 'abc' }
      const compactReq = { conversation_id: 'abc', custom_instructions: null }
      const contextReq = { conversation_id: 'abc' }
      const snapshotReq = { conversation_id: 'abc' }
      const exportReq = { conversation_id: 'abc', format: 'sft' as const, output_path: null }

      await api.conversations.list(listReq)
      await api.conversations.list(byProjectReq)
      await api.conversations.create(createReq)
      await api.conversations.update(updateReq)
      await api.conversations.search(searchReq)
      await api.conversations.delete(deleteReq)
      await api.conversations.compact(compactReq)
      await api.conversations.getContext(contextReq)
      await api.conversations.getSnapshot(snapshotReq)
      await api.conversations.export(exportReq)

      expect(mockInvoke.mock.calls).toEqual([
        ['list_conversations', { request: listReq }],
        ['list_conversations', { request: byProjectReq }],
        ['create_conversation', { request: createReq }],
        ['update_conversation', { request: updateReq }],
        ['search_conversations', { request: searchReq }],
        ['delete_conversation', { request: deleteReq }],
        ['invoke_conversation_compaction', { request: compactReq }],
        ['get_conversation_context', { request: contextReq }],
        ['get_conversation_snapshot', { request: snapshotReq }],
        ['export_conversation', { request: exportReq }],
      ])
    })
  })

  describe('chat & messages', () => {
    it('passes snake_case ChatStartRequest and ChatStopRequest', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const startReq: ChatStartRequest = {
        conversation_id: 'c1',
        message: 'hello',
        turn_id: 't1',
        replaces: null,
        model_override: null,
        provider_override: null,
        thinking_level: null,
        assistant_id: null,
        fast: null,
        mode: null,
        voice: null,
        context_refs: [{ path: 'src/main.rs', line_start: 1, line_end: 10 }],
        conversation_refs: null,
      }
      const stopReq = { conversation_id: 'c1', turn_id: null }

      await api.chat.start(startReq)
      await api.chat.stop(stopReq)

      expect(mockInvoke.mock.calls).toEqual([
        ['start_chat', { request: startReq }],
        ['stop_chat', { request: stopReq }],
      ])
    })

    it('uses unified upload_message_file with tagged source', async () => {
      mockInvoke.mockResolvedValue({ type: 'image_url', image_url: { url: 'file:///a.png' } })
      const pathReq = { conversation_id: 'c1', source: { kind: 'path' as const, file_path: '/tmp/a.png' } }
      const bytesReq = {
        conversation_id: 'c1',
        source: { kind: 'bytes' as const, file_name: 'a.png', data_base64: 'AA==' },
      }

      await api.messages.uploadFile(pathReq)
      await api.messages.uploadFile(bytesReq)

      expect(mockInvoke.mock.calls).toEqual([
        ['upload_message_file', { request: pathReq }],
        ['upload_message_file', { request: bytesReq }],
      ])
    })
  })

  describe('workspace & journal', () => {
    it('routes all workspace and journal operations through Verb-Noun commands', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const root = { conversation_id: 'c1' }
      const tree = { conversation_id: 'c1', dir: null }
      const read = { conversation_id: 'c1', rel_path: 'src/main.rs' }
      const search = { conversation_id: 'c1', project_id: null, query: 'main', limit: 15 }
      const resolve = { conversation_id: 'c1', project_id: null, path: 'src/main.rs', line_start: null, line_end: null }
      const probe = { conversation_id: 'c1', project_id: null, path: 'src/main.rs' }
      const status = { conversation_id: 'c1' }
      const diff = { conversation_id: 'c1', rel_path: null }
      const editor = { conversation_id: 'c1', rel_path: 'src/main.rs', line: null }

      await api.workspace.getRoot(root)
      await api.workspace.listEntries(tree)
      await api.workspace.readFile(read)
      await api.workspace.searchRefs(search)
      await api.workspace.resolveRef(resolve)
      await api.workspace.testRef(probe)
      await api.workspace.getGitStatus(status)
      await api.workspace.getGitDiff(diff)
      await api.workspace.openEditor(editor)

      expect(mockInvoke.mock.calls).toEqual([
        ['get_workspace_root', { request: root }],
        ['list_workspace_entries', { request: tree }],
        ['read_workspace_file', { request: read }],
        ['search_workspace_refs', { request: search }],
        ['resolve_workspace_ref', { request: resolve }],
        ['test_workspace_ref', { request: probe }],
        ['get_workspace_git_status', { request: status }],
        ['get_workspace_git_diff', { request: diff }],
        ['open_workspace_editor', { request: editor }],
      ])
    })
  })

  describe('consolidated domains (providers, approvals, memories, emojis, board, ime, remote, tools)', () => {
    it('routes consolidated commands with exact snake_case DTOs', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const modelsReq = { provider_id: 'p1', fetch_policy: 'force_remote' as const }
      const approveReq = { approval_id: 'a1', decision: { kind: 'approve' as const } }
      const denyReq = { approval_id: 'a2', decision: { kind: 'deny' as const, reason: 'no' } }
      const respondReq = { approval_id: 'a3', decision: { kind: 'respond' as const, response: 'yes' } }
      const memListReq = { filter: { kind: 'all' as const } }
      const memDeleteReq = { ids: ['m1'], permanent: false }
      const emojiListReq = { filter: { kind: 'pack' as const, pack_id: 'pk1' } }
      const emojiUpdateReq = { id: 'e1', action: { kind: 'rename' as const, name: 'smile' } }
      const emojiAssignReq = { assistant_id: 'as1', pack_id: 'pk1', assigned: true }
      const boardUpdateReq = { id: 'b1', position: { stage: 'running' as const, index: 0 } }
      const imeDeleteReq = { word: null }

      await api.providers.listModels(modelsReq)
      await api.approvals.submitDecision(approveReq)
      await api.approvals.submitDecision(denyReq)
      await api.approvals.submitDecision(respondReq)
      await api.memories.list(memListReq)
      await api.memories.delete(memDeleteReq)
      await api.emojis.list(emojiListReq)
      await api.emojis.update(emojiUpdateReq)
      await api.emojis.setPackAssignment(emojiAssignReq)
      await api.board.updateTask(boardUpdateReq)
      await api.ime.deleteLearning(imeDeleteReq)
      await api.remote.getStatus()
      await api.preferences.get({ key: 'sandbox.enabled' })
      await api.preferences.set({ key: 'sandbox.enabled', value: 'auto' })

      expect(mockInvoke.mock.calls).toEqual([
        ['list_provider_models', { request: modelsReq }],
        ['submit_approval_decision', { request: approveReq }],
        ['submit_approval_decision', { request: denyReq }],
        ['submit_approval_decision', { request: respondReq }],
        ['list_memories', { request: memListReq }],
        ['delete_memories', { request: memDeleteReq }],
        ['list_emojis', { request: emojiListReq }],
        ['update_emoji', { request: emojiUpdateReq }],
        ['set_emoji_pack_assignment', { request: emojiAssignReq }],
        ['update_board_task', { request: boardUpdateReq }],
        ['delete_ime_learning', { request: imeDeleteReq }],
        ['get_remote_status'],
        ['get_preference', { request: { key: 'sandbox.enabled' } }],
        ['set_preference', { request: { key: 'sandbox.enabled', value: 'auto' } }],
      ])
    })
  })
})
