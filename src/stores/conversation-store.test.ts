import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateBlocks, reconcileMessages, useConversationStore } from '@/stores/conversation-store'
import { api } from '@/api'
import type { ContentBlock, Message, MessageTree, ToolCallDisplay } from '@/types'

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

describe('stops are scoped to a turn', () => {
  const CONV = 'conv-1'
  const store = () => useConversationStore.getState()
  const session = () => store().sessions[CONV]!

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.loadMessageTree).mockResolvedValue({
      messages: [], head_message_id: null, branches: [],
    })
    useConversationStore.setState({ sessions: {} })
    store().ensureSession(CONV)
  })

  it('records which run is streaming', () => {
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-1')
  })

  it('names the turn from the moment the composer locks', () => {
    store().beginTurn(CONV, 'turn-1')
    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-1')
  })

  /// The generation guard means "a turn started while your request was in
  /// flight", and this is where a turn starts. Advancing it only at the first
  /// `message_start` leaves the whole start-up stretch uncovered: a reload
  /// fetched before the user sent — the one the previous turn's stop kicks off
  /// — still passes the check and lands on top of the bubble they just added.
  it('discards a reload that was already in flight when the turn started', async () => {
    let land: (tree: MessageTree) => void = () => {}
    vi.mocked(api.loadMessageTree).mockReturnValueOnce(
      new Promise<MessageTree>((resolve) => { land = resolve }),
    )

    const reloading = store().loadMessages(CONV)
    store().beginTurn(CONV, 'turn-1')
    land({ messages: [msg('stale')], head_message_id: 'stale', branches: [] })
    await reloading

    expect(session().messages.map((m) => m.id)).not.toContain('stale')
  })

  /// The window a front-end-minted id exists to close. A turn's failure comes
  /// back down two channels — the command's rejection and its stop event — and
  /// they race. If the rejection wins, the composer unlocks, the user resends,
  /// and the stop then arrives for a turn that is already over. Between the
  /// resend and its first `message_start` the new turn still has a lease to
  /// take, an assistant to load, a provider to resolve and possibly a whole
  /// compaction to run, so the gap is not a narrow one — and with the id minted
  /// backend-side there would be nothing to measure the stale stop against.
  it("ignores the previous run's stop while the new one is still starting up", () => {
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    // The old turn's rejection lands first and unlocks the composer.
    store().abortTurn(CONV, 'turn-1')
    expect(session().streaming).toBe(false)

    // The user resends. No assistant row exists yet — only the id.
    store().beginTurn(CONV, 'turn-2')

    // And now the old turn's stop finally arrives.
    store().handleStop(CONV, 'turn-1')

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-2')
  })

  /// The same race one event earlier, and the mirror of the stale stop above.
  /// A late `message_start` used to take the session back, and the stop
  /// following it then cleared the turn that was really running.
  it("does not let a late message start take the session from the run that replaced it", () => {
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    store().abortTurn(CONV, 'turn-1')
    store().beginTurn(CONV, 'turn-2')

    // Queued behind the rejection, delivered now.
    store().handleMessageStart(CONV, 'a2', 'turn-1')

    expect(session().activeTurnId).toBe('turn-2')
    // The row is still recorded: text for it may be behind it in the queue,
    // and with nowhere to land it would be appended to another turn's row.
    expect(session().messages.map((m) => m.id)).toContain('a2')

    // Which is the whole point — the stop that follows must not land either.
    store().handleStop(CONV, 'turn-1')
    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-2')
  })

  /// The other half. The new turn's own failure also arrives before it has
  /// written anything, and that one must still unlock the composer — refusing
  /// every stop that cannot be matched to a message would strand it instead.
  it("accepts the new run's own stop before it has written a message", () => {
    store().beginTurn(CONV, 'turn-2')
    store().handleStop(CONV, 'turn-2')

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// Same discipline on the rejection path, which is how a Busy refusal comes
  /// back.
  it('ignores a rejection belonging to a run that has been replaced', () => {
    store().beginTurn(CONV, 'turn-1')
    store().abortTurn(CONV, 'turn-1')
    store().beginTurn(CONV, 'turn-2')

    store().abortTurn(CONV, 'turn-1')

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-2')
  })

  /// The assumption that a different id must be a *stale* one does not hold
  /// while the local turn is still optimistic. A QQ session can have taken the
  /// conversation before this window ever sent: its first message arrives with
  /// the local request still unanswered, and only the refusal that comes back
  /// says which of the two owns it. Dropping the foreign start on the floor
  /// left the window idle with the composer open while an answer streamed in.
  it('follows the foreign turn when the local one is refused', () => {
    store().beginTurn(CONV, 'turn-local')
    store().handleMessageStart(CONV, 'a1', 'turn-foreign')
    // Still unresolved: the local request may yet turn out to be the live one.
    expect(session().activeTurnId).toBe('turn-local')

    store().abortTurn(CONV, 'turn-local', 'This conversation is already answering.')

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-foreign')
    // The refusal is still reported — the user's message did not go anywhere.
    expect(session().error).toBe('This conversation is already answering.')
  })

  /// The same handover when the local turn dies before writing anything, which
  /// arrives as a stop rather than a rejection.
  it('follows the foreign turn when the local one stops without ever starting', () => {
    store().beginTurn(CONV, 'turn-local')
    store().handleMessageStart(CONV, 'a1', 'turn-foreign')

    store().handleStop(CONV, 'turn-local')

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-foreign')
  })

  it('releases the session when the foreign turn it followed ends', () => {
    store().beginTurn(CONV, 'turn-local')
    store().handleMessageStart(CONV, 'a1', 'turn-foreign')
    store().abortTurn(CONV, 'turn-local', 'busy')

    store().handleStop(CONV, 'turn-foreign')

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// The foreign turn ended before the local request came back, so there is
  /// nothing left to hand over to.
  it('has nothing to hand over to when the foreign turn ended first', () => {
    store().beginTurn(CONV, 'turn-local')
    store().handleMessageStart(CONV, 'a1', 'turn-foreign')
    store().handleStop(CONV, 'turn-foreign')

    store().abortTurn(CONV, 'turn-local', 'no api key')

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// The local turn was the real one after all. Its own first message says so,
  /// and whatever was being held was stale.
  it('discards what it was holding once the local turn writes its first message', () => {
    store().beginTurn(CONV, 'turn-local')
    store().handleMessageStart(CONV, 'a1', 'turn-stale')
    store().handleMessageStart(CONV, 'a2', 'turn-local')

    store().handleStop(CONV, 'turn-local')

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// The message travels with the abort rather than being written first,
  /// because a rejection that has lost its turn has lost the right to report
  /// anything: the red bubble would sit under a reply that is still arriving.
  it("does not report a stale run's failure against the turn that replaced it", () => {
    store().beginTurn(CONV, 'turn-1')
    store().abortTurn(CONV, 'turn-1', 'the first failure')
    expect(session().error).toBe('the first failure')

    // Sending again clears the slate.
    store().beginTurn(CONV, 'turn-2')
    expect(session().error).toBeNull()

    store().abortTurn(CONV, 'turn-1', 'a late failure')

    expect(session().error).toBeNull()
    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-2')
  })

  /// The regression: stop then immediately send again. The old turn's stop
  /// arrives after the new one has started, and used to clear the new turn's
  /// streaming flag — the answer then streamed into a UI that thought it was
  /// idle, with the composer enabled and the stop button gone.
  it('ignores a stop belonging to a run that has already been replaced', () => {
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    // A replacement registers before it sends, so by the time its own first
    // message arrives the session is already showing it. (A turn arriving with
    // a different id and no `beginTurn` behind it is a late event — see below.)
    store().beginTurn(CONV, 'turn-2')
    store().handleMessageStart(CONV, 'a2', 'turn-2')

    store().handleStop(CONV, 'turn-1')

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-2')
  })

  it('clears the session when the stop is for the run it is showing', () => {
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    store().handleStop(CONV, 'turn-1')

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// A turn that fails before writing its first message never sends a
  /// `message_start`, so there is no id to match — and the front end is
  /// already sitting on the `streaming` flag its optimistic send set. Refusing
  /// this stop would leave the composer disabled until a reload.
  it('accepts a stop with no id at all', () => {
    store().setStreaming(CONV, true)
    store().handleStop(CONV)

    expect(session().streaming).toBe(false)
  })

  /// Same situation from the other side: the session has no id to compare
  /// against, so whatever arrives is the only candidate.
  it('accepts an identified stop when the session never saw a message start', () => {
    store().setStreaming(CONV, true)
    store().handleStop(CONV, 'turn-1')

    expect(session().streaming).toBe(false)
  })

  /// Somebody else's turn still changed the transcript — a QQ session open in
  /// this window, say. The reload has to happen; the streaming state must not.
  it('still reloads for a stop it decided was not its own', async () => {
    store().handleMessageStart(CONV, 'a1', 'turn-2')
    store().handleStop(CONV, 'turn-1')

    await vi.waitFor(() => {
      expect(api.loadMessageTree).toHaveBeenCalledWith(CONV)
    })
    expect(session().streaming).toBe(true)
  })

  /// Stopping is what strands an approval: the turn is gone, so nothing is
  /// left to answer the card. It must not do that to a turn that is still
  /// running.
  it('leaves another run\'s approvals alone', () => {
    store().handleMessageStart(CONV, 'a1', 'turn-2')
    store().handleToolCall(CONV, 'a1', 'c1', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'read_file')

    store().handleStop(CONV, 'turn-1')
    expect(Object.keys(session().pendingApprovals)).toEqual(['appr-1'])

    store().handleStop(CONV, 'turn-2')
    expect(session().pendingApprovals).toEqual({})
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
