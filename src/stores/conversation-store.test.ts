import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateBlocks, reconcileMessages, useConversationStore } from '@/stores/conversation-store'
import { api } from '@/api'
import type { ContentBlock, Message, ToolCallDisplay } from '@/types'

vi.mock('@tauri-apps/api/core')
vi.mock('@/api', () => ({
  api: {
    loadMessageTree: vi.fn(),
    getConversation: vi.fn(),
    switchBranch: vi.fn(),
    // Fetched alongside every transcript load: without it a tool call with no
    // result row cannot be told apart from one still waiting on the user.
    listPendingApprovals: vi.fn().mockResolvedValue([]),
  },
}))

function msg(id: string, over: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: 'c',
    role: 'assistant',
    content: '',
    provider_id: null,
    model_id: null,
    input_tokens: null,
    output_tokens: null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: 0,
    created_at: 0,
    reasoning_content: null,
    rating: null,
    schema_version: 2,
    is_compact_summary: 0,
    ...over,
  }
}

describe('hydrateBlocks', () => {
  /** An assistant row that made one tool call. */
  function caller(id: string, callId: string, name = 'read_file'): Message {
    return msg(id, {
      tool_calls: JSON.stringify([
        { id: callId, type: 'function', function: { name, arguments: '{}' } },
      ]),
    })
  }

  /** The tool row that answered one. */
  function answer(id: string, callId: string, content = 'done'): Message {
    return msg(id, { role: 'tool', tool_call_id: callId, content })
  }

  function callBlocks(out: Message[], messageId: string): ToolCallDisplay[] {
    const row = out.find((m) => m.id === messageId)
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  it('reads a call with a matching tool row as completed', () => {
    const out = hydrateBlocks([caller('a', 'c1'), answer('t', 'c1', 'the result')])
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'completed', result: 'the result' })
  })

  it('reads an unanswered call the backend is still holding as pending', () => {
    const out = hydrateBlocks([caller('a', 'c1')], [{
      approval_id: 'appr-1',
      assistant_message_id: 'a',
      provider_call_id: 'c1',
      tool_name: 'read_file',
    }])
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })
  })

  // The whole point of the three-way split: this used to be reported as
  // completed, which erased the buttons and stranded the turn.
  it('reads an unanswered call nobody is waiting on as orphaned', () => {
    const out = hydrateBlocks([caller('a', 'c1')])
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'orphaned' })
    expect(callBlocks(out, 'a')[0].approval_id).toBeUndefined()
  })

  it('carries the escalation reason onto the card it belongs to', () => {
    const out = hydrateBlocks([caller('a', 'c1', 'run_command')], [{
      approval_id: 'appr-1',
      assistant_message_id: 'a',
      provider_call_id: 'c1',
      tool_name: 'run_command',
      retry_reason: 'sandbox denied',
    }])
    expect(callBlocks(out, 'a')[0]).toMatchObject({
      status: 'pending',
      retry_reason: 'sandbox denied',
    })
  })

  // Gateways that number their tool calls from zero every request make this the
  // normal case, not a corner one. A transcript-wide lookup would hand the
  // second round's pending call the first round's result.
  it('does not let a later call claim an earlier round\'s result when ids repeat', () => {
    const out = hydrateBlocks([
      caller('a1', '0'),
      answer('t1', '0', 'first round'),
      caller('a2', '0'),
    ])
    expect(callBlocks(out, 'a1')[0]).toMatchObject({ status: 'completed', result: 'first round' })
    expect(callBlocks(out, 'a2')[0]).toMatchObject({ status: 'orphaned' })
    expect(callBlocks(out, 'a2')[0].result).toBeUndefined()
  })

  it('gives two calls sharing an id their own approvals', () => {
    const both = msg('a', {
      tool_calls: JSON.stringify([
        { id: '0', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        { id: '0', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ]),
    })
    const out = hydrateBlocks([both], [
      { approval_id: 'appr-1', assistant_message_id: 'a', provider_call_id: '0', tool_name: 'read_file' },
      { approval_id: 'appr-2', assistant_message_id: 'a', provider_call_id: '0', tool_name: 'read_file' },
    ])
    expect(callBlocks(out, 'a').map((b) => b.approval_id)).toEqual(['appr-1', 'appr-2'])
  })

  it('keeps an approval from another assistant row off this one', () => {
    const out = hydrateBlocks([caller('a1', 'c1'), caller('a2', 'c1')], [{
      approval_id: 'appr-1',
      assistant_message_id: 'a2',
      provider_call_id: 'c1',
      tool_name: 'read_file',
    }])
    expect(callBlocks(out, 'a1')[0]).toMatchObject({ status: 'orphaned' })
    expect(callBlocks(out, 'a2')[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })
  })
})

describe('reconcileMessages', () => {
  it('returns the snapshot when there is nothing to reconcile against', () => {
    const next = [msg('a')]
    expect(reconcileMessages([], next)).toBe(next)
  })

  it('returns the previous array when every row is unchanged', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    expect(reconcileMessages(prev, next)).toBe(prev)
  })

  it('keeps references for unchanged rows and takes the new object for changed ones', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two, edited' })]
    const out = reconcileMessages(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
  })

  it('keeps references for the history when a row is appended', () => {
    const prev = [msg('a', { content: 'one' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const out = reconcileMessages(prev, next)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
  })

  it('keeps references for survivors when a row is removed', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('b', { content: 'two' })]
    const out = reconcileMessages(prev, next)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(prev[1])
  })

  it('preserves the streamed _blocks when the stored columns match', () => {
    // The stream builds `_blocks` with real tool status; hydrateBlocks rebuilds
    // them from columns and hardcodes 'completed'. Reusing the old object keeps
    // the truthful one.
    const prev = [
      msg('a', {
        content: 'done',
        _blocks: [{ type: 'tool_call', data: { call_id: 'c1', tool_name: 'run', arguments: '{}', status: 'error' } }],
      }),
    ]
    const next = [
      msg('a', {
        content: 'done',
        _blocks: [{ type: 'tool_call', data: { call_id: 'c1', tool_name: 'run', arguments: '{}', status: 'completed' } }],
      }),
    ]
    const out = reconcileMessages(prev, next)
    expect(out[0]).toBe(prev[0])
    expect(out[0]._blocks?.[0]).toMatchObject({ data: { status: 'error' } })
  })

  it('treats a row as changed when only its position moved', () => {
    const prev = [msg('a'), msg('b')]
    const next = [msg('b'), msg('a')]
    const out = reconcileMessages(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[1])
    expect(out[1]).toBe(prev[0])
  })
})

describe('live approval events', () => {
  const CONV = 'conv-1'
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {} })
    store().ensureSession(CONV)
    store().handleMessageStart(CONV, 'a1')
  })

  function cards(): ToolCallDisplay[] {
    const row = store().sessions[CONV]!.messages.find((m) => m.id === 'a1')
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  // Hydration claims each approval once; the streaming path has to do the same
  // or the first request lights up every card that happens to share the id.
  it('lights up one card at a time when a row reuses a call id', () => {
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')

    store().handleToolApproval(CONV, 'a1', 'appr-1', '0', 'read_file')
    expect(cards().map((c) => c.status)).toEqual(['pending', 'running'])
    expect(cards().map((c) => c.approval_id)).toEqual(['appr-1', undefined])

    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'read_file')
    expect(cards().map((c) => c.approval_id)).toEqual(['appr-1', 'appr-2'])
  })

  it('completes one card at a time when a row reuses a call id', () => {
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')

    store().handleToolResult(CONV, 'a1', '0', 'first result')
    expect(cards().map((c) => c.status)).toEqual(['completed', 'running'])
    expect(cards().map((c) => c.result)).toEqual(['first result', undefined])

    store().handleToolResult(CONV, 'a1', '0', 'second result')
    expect(cards().map((c) => c.result)).toEqual(['first result', 'second result'])
  })

  it('retires only the approval the answered card was holding', () => {
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')
    store().handleToolCall(CONV, 'a1', '0', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', '0', 'read_file')
    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'read_file')

    store().handleToolResult(CONV, 'a1', '0', 'done')

    expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual(['appr-2'])
  })

  it('carries the escalation details onto the card', () => {
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolApproval(
      CONV, 'a1', 'appr-1', 'c1', 'run_command', 'sandbox denied', 'c1',
    )

    expect(cards()[0]).toMatchObject({ status: 'pending', retry_reason: 'sandbox denied' })
    expect(store().sessions[CONV]!.pendingApprovals['appr-1']).toMatchObject({
      originCallId: 'c1',
      retryReason: 'sandbox denied',
    })
  })
})

describe('branch state', () => {
  const CONV = 'conv-1'

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {} })
    useConversationStore.getState().ensureSession(CONV)
  })

  /// Without this the pager only shows up the next time the conversation is
  /// opened, since the turn that created the branch point ends with this reload.
  it('picks up a new branch point when a turn ends', async () => {
    vi.mocked(api.loadMessageTree).mockResolvedValue({
      messages: [msg('q'), msg('a2')],
      head_message_id: 'a2',
      branches: [{ message_id: 'a2', index: 1, total: 2, sibling_ids: ['a1', 'a2'] }],
    })

    useConversationStore.getState().handleStop(CONV)
    await vi.waitFor(() => {
      expect(useConversationStore.getState().sessions[CONV]?.branches.a2).toBeDefined()
    })
    expect(useConversationStore.getState().sessions[CONV]?.branches.a2.total).toBe(2)
  })

  it('replaces the message list outright when switching branches', async () => {
    useConversationStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        [CONV]: { ...s.sessions[CONV], messages: [msg('q'), msg('a1', { content: 'first' })] },
      },
    }))
    vi.mocked(api.switchBranch).mockResolvedValue({
      messages: [msg('q'), msg('a2', { content: 'second' })],
      head_message_id: 'a2',
      branches: [{ message_id: 'a2', index: 1, total: 2, sibling_ids: ['a1', 'a2'] }],
    })

    await useConversationStore.getState().switchBranch(CONV, 'a2')

    const ids = useConversationStore.getState().sessions[CONV]!.messages.map((m) => m.id)
    // a1 belongs to the branch being left; carrying it over would show two
    // answers to the same question.
    expect(ids).toEqual(['q', 'a2'])
  })

  it('clears the switching flag even when the request fails', async () => {
    vi.mocked(api.switchBranch).mockRejectedValue(new Error('nope'))

    await expect(useConversationStore.getState().switchBranch(CONV, 'a2')).rejects.toThrow()
    expect(useConversationStore.getState().sessions[CONV]?.switchingBranch).toBe(false)
  })
})
