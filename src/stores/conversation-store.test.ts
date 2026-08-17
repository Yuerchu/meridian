import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateBlocks, reconcileMessages, useConversationStore } from '@/stores/conversation-store'
import { api } from '@/api'
import type { ContentBlock, ConversationSnapshot, Message, MessageTree, ToolCallDisplay, TurnRecord } from '@/types'

vi.mock('@tauri-apps/api/core')
vi.mock('@/api', () => ({
  api: {
    // One request per load. The transcript, the approvals still outstanding and
    // the turn records only mean anything together: a tool call with no result
    // row is waiting, running, or abandoned, and the row alone says none of it.
    conversationSnapshot: vi.fn(),
    switchBranch: vi.fn(),
  },
}))

/** A snapshot with nothing outstanding, which is what most tests want. */
function snapshotOf(tree: MessageTree, over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    conversation: { compact_cursor: null } as ConversationSnapshot['conversation'],
    tree,
    turns: [],
    pending_approvals: [],
    sub_agent_runs: [],
    ...over,
  }
}

function turnRecord(id: string, status: string): TurnRecord {
  return {
    id,
    status,
    phase: null,
    phase_tool: null,
    error: null,
    started_at: 0,
    ended_at: null,
  }
}

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
      tool_calls: JSON.stringify([{ id: callId, type: 'function', function: { name, arguments: '{}' } }]),
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
    const out = hydrateBlocks(
      [caller('a', 'c1')],
      [
        {
          approval_id: 'appr-1',
          assistant_message_id: 'a',
          provider_call_id: 'c1',
          tool_name: 'read_file',
        },
      ],
    )
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })
  })

  // The whole point of the three-way split: this used to be reported as
  // completed, which erased the buttons and stranded the turn.
  it('reads an unanswered call nobody is waiting on as orphaned', () => {
    const out = hydrateBlocks([caller('a', 'c1')])
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'orphaned' })
    expect(callBlocks(out, 'a')[0].approval_id).toBeUndefined()
  })

  /// The window reading the approvals last cannot close. A decision removes the
  /// registry entry immediately, and the tool then runs — for as long as it
  /// takes — before its row exists. Neither an approval nor a result, on a call
  /// that is at that moment editing a file.
  it("does not call a live turn's unanswered call orphaned", () => {
    const out = hydrateBlocks(
      [caller('a', 'c1', 'edit_file')],
      [],
      [turnRecord('t1', 'running')],
      // The row has to name its turn for any of this to apply.
    )
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'orphaned' })

    const owned = hydrateBlocks(
      [
        msg('a', {
          turn_id: 't1',
          tool_calls: JSON.stringify([
            { id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } },
          ]),
        }),
      ],
      [],
      [turnRecord('t1', 'running')],
    )
    expect(callBlocks(owned, 'a')[0]).toMatchObject({ status: 'running' })
  })

  /// And the other side of it: once the turn has an ending, an unanswered call
  /// means nobody is coming back for it.
  it('calls an unanswered call orphaned once its turn has ended', () => {
    for (const ended of ['done', 'cancelled', 'failed', 'interrupted']) {
      const out = hydrateBlocks(
        [
          msg('a', {
            turn_id: 't1',
            tool_calls: JSON.stringify([
              { id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } },
            ]),
          }),
        ],
        [],
        [turnRecord('t1', ended)],
      )
      expect(callBlocks(out, 'a')[0], ended).toMatchObject({ status: 'orphaned' })
    }
  })

  /// Only a turn that positively says it ended earns `orphaned`. A record this
  /// build cannot find, or a status a later one invented, is not evidence of
  /// anything — and the two mistakes are not the same size: a live call drawn
  /// as dead sits there with no buttons, while a dead one drawn as live is
  /// corrected by the next reload.
  it('does not read a missing or unrecognised turn record as an ending', () => {
    const row = msg('a', {
      turn_id: 't1',
      tool_calls: JSON.stringify([{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }]),
    })
    expect(callBlocks(hydrateBlocks([row], [], []), 'a')[0]).toMatchObject({ status: 'running' })
    expect(callBlocks(hydrateBlocks([row], [], [turnRecord('t1', 'from_the_future')]), 'a')[0]).toMatchObject({
      status: 'running',
    })
  })

  /// Reloading used to turn every refusal into a green tick, with the refusal
  /// itself displayed as the tool's output.
  it('reads how the tool went off the row rather than assuming it went well', () => {
    for (const [outcome, status] of [
      ['denied', 'denied'],
      ['error', 'error'],
      ['success', 'completed'],
      [null, 'completed'],
    ] as const) {
      const out = hydrateBlocks([
        caller('a', 'c1'),
        msg('t', { role: 'tool', tool_call_id: 'c1', content: 'x', tool_outcome: outcome }),
      ])
      expect(callBlocks(out, 'a')[0], String(outcome)).toMatchObject({ status })
    }
  })

  it('carries the escalation reason onto the card it belongs to', () => {
    const out = hydrateBlocks(
      [caller('a', 'c1', 'run_command')],
      [
        {
          approval_id: 'appr-1',
          assistant_message_id: 'a',
          provider_call_id: 'c1',
          tool_name: 'run_command',
          retry_reason: 'sandbox denied',
        },
      ],
    )
    expect(callBlocks(out, 'a')[0]).toMatchObject({
      status: 'pending',
      retry_reason: 'sandbox denied',
    })
  })

  // Gateways that number their tool calls from zero every request make this the
  // normal case, not a corner one. A transcript-wide lookup would hand the
  // second round's pending call the first round's result.
  it("does not let a later call claim an earlier round's result when ids repeat", () => {
    const out = hydrateBlocks([caller('a1', '0'), answer('t1', '0', 'first round'), caller('a2', '0')])
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
    const out = hydrateBlocks(
      [both],
      [
        { approval_id: 'appr-1', assistant_message_id: 'a', provider_call_id: '0', tool_name: 'read_file' },
        { approval_id: 'appr-2', assistant_message_id: 'a', provider_call_id: '0', tool_name: 'read_file' },
      ],
    )
    expect(callBlocks(out, 'a').map((b) => b.approval_id)).toEqual(['appr-1', 'appr-2'])
  })

  it('keeps an approval from another assistant row off this one', () => {
    const out = hydrateBlocks(
      [caller('a1', 'c1'), caller('a2', 'c1')],
      [
        {
          approval_id: 'appr-1',
          assistant_message_id: 'a2',
          provider_call_id: 'c1',
          tool_name: 'read_file',
        },
      ],
    )
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
        _blocks: [
          { type: 'tool_call', data: { call_id: 'c1', tool_name: 'run', arguments: '{}', status: 'completed' } },
        ],
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
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', 'sandbox denied', 'c1')

    expect(cards()[0]).toMatchObject({ status: 'pending', retry_reason: 'sandbox denied' })
    expect(store().sessions[CONV]!.pendingApprovals['appr-1']).toMatchObject({
      originCallId: 'c1',
      retryReason: 'sandbox denied',
    })
  })

  /// The sequence a sandbox escalation actually arrives in, which is not the
  /// one above: the call is approved, it runs, the sandbox refuses it, and only
  /// then is the second question asked. By that point the card is already
  /// holding the first approval — so matching it the way a first ask is matched
  /// finds nothing, and the card sits on "running" while the backend waits for
  /// an answer nobody can give it. Reopening the conversation fixed it, because
  /// hydration matches on the call id and does not care who claimed it.
  it('offers the retry on a card that was already approved once', () => {
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command')
    expect(cards()[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })

    // The user says yes, the command runs, the sandbox blocks it.
    store().handleToolApproval(CONV, 'a1', 'appr-2', 'c1', 'run_command', 'sandbox denied', 'c1')

    expect(cards()[0]).toMatchObject({
      status: 'pending',
      approval_id: 'appr-2',
      retry_reason: 'sandbox denied',
    })
    // And the answer the user already gave is not still on the books.
    expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual(['appr-2'])
  })

  /// A retry belongs to the call that is still in flight. An earlier card that
  /// already has its answer is behind it and must keep it.
  it('does not reopen a call that already finished', () => {
    store().handleToolCall(CONV, 'a1', '0', 'run_command', '{}')
    store().handleToolCall(CONV, 'a1', '0', 'run_command', '{}')
    store().handleToolResult(CONV, 'a1', '0', 'the first one is done')

    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'run_command', 'sandbox denied', '0')

    expect(cards().map((c) => c.status)).toEqual(['completed', 'pending'])
    expect(cards()[0].result).toBe('the first one is done')
    expect(cards()[1].retry_reason).toBe('sandbox denied')
  })
})

/// A reload racing the round it describes. The snapshot's DB read happens at
/// one moment, its application at another, and tool events for the round in
/// flight land in between — nothing bumps the generation for them, so the
/// guard lets the stale snapshot through. Hydration then rebuilds the round's
/// cards from what the database said *before* those events: a result that had
/// already arrived is reverted to `running` and its event is never coming
/// again, and a `tool_call` delivered after the apply pushes a second copy of
/// a card hydration already materialised — whose result then answers the first
/// copy and leaves the duplicate unfinished for good. On screen that is a
/// finished command sitting above two "queued" ones in a turn that ended.
describe('a reload racing the live round', () => {
  const CONV = 'conv-1'
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {} })
    store().ensureSession(CONV)
  })

  function cards(): ToolCallDisplay[] {
    const row = store().sessions[CONV]!.messages.find((m) => m.id === 'a1')
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  /** A reload whose response lands only when the test says so. */
  function reloadPausedMidRound(): [Promise<void>, (snap: ConversationSnapshot) => void] {
    let land: (snap: ConversationSnapshot) => void = () => {}
    vi.mocked(api.conversationSnapshot).mockReturnValueOnce(
      new Promise<ConversationSnapshot>((resolve) => {
        land = resolve
      }),
    )
    return [store().loadMessages(CONV), (snap) => land(snap)]
  }

  /** What the database has once the round's calls are written and none of its
   *  tool rows are. */
  function roundWritten(ids: string[]): ConversationSnapshot {
    return snapshotOf(
      {
        messages: [
          msg('a1', {
            turn_id: 'turn-1',
            content: 'on it',
            tool_calls: JSON.stringify(
              ids.map((id) => ({
                id,
                type: 'function',
                function: { name: 'run_command', arguments: '{}' },
              })),
            ),
          }),
        ],
        head_message_id: 'a1',
        branches: [],
      },
      { turns: [turnRecord('turn-1', 'running')] },
    )
  }

  it('does not lose a result, or double a card, to a snapshot read mid-round', async () => {
    store().beginTurn(CONV, 'turn-1')
    store().handleMessageStart(CONV, 'a1', 'turn-1')

    // The user switches back to this conversation mid-round: the reload's DB
    // read sees the round's calls written but none of its tool rows yet.
    const [reloading, land] = reloadPausedMidRound()

    // While the response is in flight, the first call is announced and answered.
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolResult(CONV, 'a1', 'c1', 'first result', 'success')

    land(roundWritten(['c1', 'c2']))
    await reloading

    // The second call is announced and answered after the stale apply.
    store().handleToolCall(CONV, 'a1', 'c2', 'run_command', '{}')
    store().handleToolResult(CONV, 'a1', 'c2', 'second result', 'success')

    // One card per call the model made — the event delivered after the apply
    // must not add a second copy of a card the snapshot already carries.
    expect(cards().map((c) => c.call_id)).toEqual(['c1', 'c2'])
    // And a result that arrived before the apply is still an outcome. Losing
    // it here is permanent: its event was consumed, and every later reload
    // reuses this object because the row's stored columns never change again.
    expect(cards().map((c) => c.status)).toEqual(['completed', 'completed'])
  })

  /// A round the gateway numbered from zero, going through the same race. Both
  /// cards come from the column and both stay answerable one at a time — the
  /// live events that follow add nothing, and must not, but neither may the
  /// rule that stops them be a lookup by id.
  it('keeps both cards of a repeated id answerable through the same race', async () => {
    store().beginTurn(CONV, 'turn-1')
    store().handleMessageStart(CONV, 'a1', 'turn-1')

    const [reloading, land] = reloadPausedMidRound()
    store().handleToolCall(CONV, 'a1', '0', 'run_command', '{}')
    land(roundWritten(['0', '0']))
    await reloading

    store().handleToolCall(CONV, 'a1', '0', 'run_command', '{}')
    expect(cards()).toHaveLength(2)

    store().handleToolResult(CONV, 'a1', '0', 'first result', 'success')
    expect(cards().map((c) => c.status)).toEqual(['completed', 'running'])
    store().handleToolResult(CONV, 'a1', '0', 'second result', 'success')
    expect(cards().map((c) => c.result)).toEqual(['first result', 'second result'])
  })
})

describe('stops are scoped to a turn', () => {
  const CONV = 'conv-1'
  const store = () => useConversationStore.getState()
  const session = () => store().sessions[CONV]!

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({ messages: [], head_message_id: null, branches: [] }),
    )
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

  /// The backoff is announced before it is waited out, so the header has
  /// something to say for its whole length. It stays up through the request
  /// that follows — that one can take a while too — and goes as soon as the new
  /// attempt produces anything.
  it('shows which retry is in flight until the new attempt says something', () => {
    store().beginTurn(CONV, 'turn-1')
    store().handleMessageStart(CONV, 'a1', 'turn-1')

    store().handleRetry(CONV, 2, 3, 4000)
    expect(session().retry).toEqual({ attempt: 2, max: 3, delayMs: 4000 })

    // The reset only marks the end of the wait; the request is still out.
    store().handleStreamReset(CONV, 'a1')
    expect(session().retry).not.toBeNull()

    store().handleText(CONV, 'a1', 'here we go')
    expect(session().retry).toBeNull()
  })

  it('does not leave a retry showing on a turn that ended', () => {
    store().beginTurn(CONV, 'turn-1')
    store().handleMessageStart(CONV, 'a1', 'turn-1')
    store().handleRetry(CONV, 3, 3, 8000)

    store().handleStop(CONV, 'turn-1')

    expect(session().retry).toBeNull()
  })

  /// A session built while somebody is already answering — a reload mid-answer,
  /// or opening a conversation a QQ session has. Without this the composer is
  /// unlocked, the turn renders as a finished empty answer, and the send it
  /// invites comes back "this conversation is already answering".
  it('follows a turn that was already running when the snapshot was read', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf(
        { messages: [msg('a1', { turn_id: 'turn-live' })], head_message_id: 'a1', branches: [] },
        { turns: [turnRecord('turn-done', 'done'), turnRecord('turn-live', 'running')] },
      ),
    )

    await store().loadMessages(CONV)

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-live')
    // And the stop for it is accepted, which is the point of naming it.
    store().handleStop(CONV, 'turn-live')
    expect(session().streaming).toBe(false)
  })

  /// `running` is not the stored column: the backend rewrites it to
  /// `interrupted` for any turn its coordinator is not holding. So nothing a
  /// dead process left behind reaches this code — but a turn that ended
  /// normally must not lock the composer either.
  it('does not follow a turn that has already ended', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf(
        { messages: [], head_message_id: null, branches: [] },
        {
          turns: [turnRecord('turn-1', 'interrupted'), turnRecord('turn-2', 'crashed'), turnRecord('turn-3', 'done')],
        },
      ),
    )

    await store().loadMessages(CONV)

    expect(session().streaming).toBe(false)
    expect(session().activeTurnId).toBeNull()
  })

  /// Adopting has to be one-way. Between `beginTurn` and the backend writing
  /// the turn record there is a window where a snapshot shows nothing running,
  /// and releasing on that would undo the lock the send had just taken — and
  /// hand the user a composer the backend is about to refuse.
  it('never unlocks a composer that a send had already locked', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({ messages: [], head_message_id: null, branches: [] }),
    )

    store().beginTurn(CONV, 'turn-1')
    await store().loadMessages(CONV)

    expect(session().streaming).toBe(true)
    expect(session().activeTurnId).toBe('turn-1')
  })

  /// The same ambiguity `handleMessageStart` refuses to resolve: this window's
  /// id was minted before its request went out, so a snapshot naming somebody
  /// else's turn is not evidence that the local one lost. Taking it would hand
  /// that turn's stop the power to unlock a composer this one still owns.
  it('does not hand the session to another turn a snapshot happens to name', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf(
        { messages: [], head_message_id: null, branches: [] },
        { turns: [turnRecord('turn-theirs', 'running')] },
      ),
    )

    store().beginTurn(CONV, 'turn-mine')
    await store().loadMessages(CONV)

    expect(session().activeTurnId).toBe('turn-mine')
    // And the other one's stop does not end this session.
    store().handleStop(CONV, 'turn-theirs')
    expect(session().streaming).toBe(true)
  })

  /// The generation guard means "a turn started while your request was in
  /// flight", and this is where a turn starts. Advancing it only at the first
  /// `message_start` leaves the whole start-up stretch uncovered: a reload
  /// fetched before the user sent — the one the previous turn's stop kicks off
  /// — still passes the check and lands on top of the bubble they just added.
  it('discards a reload that was already in flight when the turn started', async () => {
    let land: (snap: ConversationSnapshot) => void = () => {}
    vi.mocked(api.conversationSnapshot).mockReturnValueOnce(
      new Promise<ConversationSnapshot>((resolve) => {
        land = resolve
      }),
    )

    const reloading = store().loadMessages(CONV)
    store().beginTurn(CONV, 'turn-1')
    land(snapshotOf({ messages: [msg('stale')], head_message_id: 'stale', branches: [] }))
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
  it('does not let a late message start take the session from the run that replaced it', () => {
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
      expect(api.conversationSnapshot).toHaveBeenCalledWith(CONV)
    })
    expect(session().streaming).toBe(true)
  })

  /// Stopping is what strands an approval: the turn is gone, so nothing is
  /// left to answer the card. It must not do that to a turn that is still
  /// running.
  it("leaves another run's approvals alone", () => {
    store().handleMessageStart(CONV, 'a1', 'turn-2')
    store().handleToolCall(CONV, 'a1', 'c1', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'read_file')

    store().handleStop(CONV, 'turn-1')
    expect(Object.keys(session().pendingApprovals)).toEqual(['appr-1'])

    store().handleStop(CONV, 'turn-2')
    expect(session().pendingApprovals).toEqual({})
  })
})

describe('compaction state', () => {
  const CONV = 'conv-1'
  const store = () => useConversationStore.getState()
  const session = () => store().sessions[CONV]!

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {} })
    store().ensureSession(CONV)
    vi.mocked(api.conversationSnapshot).mockResolvedValue(snapshotOf({ messages: [], branches: [] }))
  })

  /// A mid-turn pass rewrites the request the engine is holding and writes
  /// nothing. Re-reading would return the transcript already on screen, and it
  /// would do it in the middle of a stream, over a conversation large enough to
  /// have needed compacting in the first place.
  it('does not re-read the transcript for a compaction that wrote nothing', () => {
    store().handleCompactStart(CONV)
    store().handleCompactDone(CONV, true)

    expect(session().compacting).toBe(false)
    expect(api.conversationSnapshot).not.toHaveBeenCalled()
  })

  /// The pre-turn and manual passes do write: a summary row, and a head that
  /// moved past it. Nothing on screen is true until it is read back.
  it('re-reads the transcript for a compaction that moved the head', async () => {
    store().handleCompactStart(CONV)
    store().handleCompactDone(CONV)

    await vi.waitFor(() => {
      expect(api.conversationSnapshot).toHaveBeenCalledWith(CONV)
    })
    expect(session().compacting).toBe(false)
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
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({
        messages: [msg('q'), msg('a2')],
        head_message_id: 'a2',
        branches: [{ message_id: 'a2', index: 1, total: 2, sibling_ids: ['a1', 'a2'] }],
      }),
    )

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
    // The switch moves the head and says nothing; the snapshot after it is
    // where the new path comes from.
    vi.mocked(api.switchBranch).mockResolvedValue(undefined)
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({
        messages: [msg('q'), msg('a2', { content: 'second' })],
        head_message_id: 'a2',
        branches: [{ message_id: 'a2', index: 1, total: 2, sibling_ids: ['a1', 'a2'] }],
      }),
    )

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

  /// Two round trips, and this path assigns the message list outright instead
  /// of merging into it. A turn that starts in between has already streamed
  /// rows in, and applying a snapshot taken before it existed would not merely
  /// be stale — it would delete them.
  ///
  /// The whole sequence, because each half is wrong on its own: refusing the
  /// stale snapshot leaves the screen showing a path the backend has moved off,
  /// and reading again without refusing it first loses the turn.
  it('does not let a switch started before a turn overwrite that turn', async () => {
    const store = () => useConversationStore.getState()
    const session = () => store().sessions[CONV]!
    vi.mocked(api.switchBranch).mockResolvedValue(undefined)

    let land: (snap: ConversationSnapshot) => void = () => {}
    vi.mocked(api.conversationSnapshot)
      .mockReturnValueOnce(
        new Promise<ConversationSnapshot>((resolve) => {
          land = resolve
        }),
      )
      // The re-read this is expected to trigger afterwards: the switch really
      // did move the head, so the new path has to be picked up under whatever
      // generation is current by then.
      .mockResolvedValue(
        snapshotOf({
          messages: [msg('q'), msg('a2', { content: 'the other version' })],
          head_message_id: 'a2',
          branches: [{ message_id: 'a2', index: 1, total: 2, sibling_ids: ['a1', 'a2'] }],
        }),
      )

    const switching = store().switchBranch(CONV, 'a2')
    expect(session().switchingBranch).toBe(true)

    // A turn starts while the switch is still in the air, and writes.
    store().beginTurn(CONV, 'turn-1')
    store().handleMessageStart(CONV, 'live', 'turn-1')
    store().handleText(CONV, 'live', 'half a sentence')

    land(snapshotOf({ messages: [msg('stale')], head_message_id: 'stale', branches: [] }))
    await switching

    const ids = session().messages.map((m) => m.id)
    // The stale snapshot never lands...
    expect(ids).not.toContain('stale')
    // ...but the conversation is read again rather than left as it was.
    expect(api.conversationSnapshot).toHaveBeenCalledTimes(2)
    expect(ids).toEqual(['q', 'a2', 'live'])
    // The branch that was switched to is the one on screen.
    expect(session().branches.a2?.total).toBe(2)
    // And the turn that started mid-switch still has everything it streamed.
    const live = session().messages.find((m) => m.id === 'live')!
    expect(live._blocks).toEqual([{ type: 'text', text: 'half a sentence' }])
    expect(session().switchingBranch).toBe(false)
  })
})

describe('delegated runs', () => {
  const store = () => useConversationStore.getState()

  function callBlocks(msgs: Message[], messageId: string): ToolCallDisplay[] {
    const row = msgs.find((m) => m.id === messageId)
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  function delegator(id: string, callId: string): Message {
    return msg(id, {
      turn_id: 't1',
      tool_calls: JSON.stringify([
        {
          id: callId,
          type: 'function',
          function: { name: 'run_agent', arguments: '{"agent":"agent","description":"fix the test"}' },
        },
      ]),
    })
  }

  // The card is named by the row *and* the call. A gateway that restarts its
  // call ids at "0" makes two delegations share one, and matching on the call
  // alone would put the second one's transcript on the first one's card.
  it('attaches each run to the call that started it', () => {
    const out = hydrateBlocks(
      [delegator('a1', '0'), delegator('a2', '0')],
      [],
      [turnRecord('t1', 'running')],
      [
        {
          conversation_id: 'sub-1',
          spawned_by_message_id: 'a1',
          spawned_by_call_id: '0',
          spawned_turn_id: 'run-1',
          agent_kind: 'agent',
          title: 'first',
          steps: 3,
          status: 'done',
        },
        {
          conversation_id: 'sub-2',
          spawned_by_message_id: 'a2',
          spawned_by_call_id: '0',
          spawned_turn_id: 'run-2',
          agent_kind: 'explore',
          title: 'second',
          steps: 1,
          status: 'running',
        },
      ],
    )

    expect(callBlocks(out, 'a1')[0].sub_agent).toMatchObject({
      conversation_id: 'sub-1',
      turn_id: 'run-1',
      steps: 3,
    })
    expect(callBlocks(out, 'a2')[0].sub_agent).toMatchObject({
      conversation_id: 'sub-2',
      turn_id: 'run-2',
      steps: 1,
    })
  })

  // The question happened inside the sub-agent, so the parent's own transcript
  // has no row for it. It arrives whole and goes inside the `run_agent` card,
  // which itself is still only running.
  it('puts a delegated question inside the card that spawned the run', () => {
    const out = hydrateBlocks(
      [delegator('a1', '0')],
      [
        {
          approval_id: 'appr-1',
          assistant_message_id: 'a1',
          provider_call_id: 'child-call',
          tool_name: 'run_command',
          arguments: '{"command":"cargo test --all"}',
          bubbled: false,
          parent_call_id: '0',
          sub_conversation_id: 'sub-1',
        },
      ],
      [turnRecord('t1', 'running')],
    )

    const card = callBlocks(out, 'a1')[0]
    expect(card.status).toBe('running')
    expect(card.nested_approval).toMatchObject({
      approval_id: 'appr-1',
      tool_name: 'run_command',
      // The reason it is stored rather than read back off the transcript.
      arguments: '{"command":"cargo test --all"}',
      sub_conversation_id: 'sub-1',
    })
  })

  // Seen from inside the sub-agent, the same approval is real but unanswerable:
  // it was put to whoever is watching the parent.
  it('shows the call as waiting on the conversation above, with no way to answer', () => {
    const caller = msg('a1', {
      turn_id: 't1',
      tool_calls: JSON.stringify([
        { id: 'child-call', type: 'function', function: { name: 'run_command', arguments: '{}' } },
      ]),
    })
    const out = hydrateBlocks(
      [caller],
      [
        {
          approval_id: 'appr-1',
          assistant_message_id: 'a1',
          provider_call_id: 'child-call',
          tool_name: 'run_command',
          arguments: '{}',
          bubbled: true,
        },
      ],
      [turnRecord('t1', 'running')],
    )

    const card = callBlocks(out, 'a1')[0]
    expect(card.status).toBe('awaiting_parent')
    // Having an id and being answerable here are the same thing, so it has none.
    expect(card.approval_id).toBeUndefined()
  })

  describe('live', () => {
    const CONV = 'conv-1'

    beforeEach(() => {
      vi.clearAllMocks()
      useConversationStore.setState({ sessions: {}, subAgentSteps: {} })
      store().ensureSession(CONV)
      store().handleMessageStart(CONV, 'a1', 'parent-turn')
      store().handleToolCall(CONV, 'a1', '0', 'run_agent', '{"agent":"agent","description":"fix it"}')
    })

    function card(): ToolCallDisplay {
      const row = store().sessions[CONV]!.messages.find((m) => m.id === 'a1')
      const block = (row?._blocks ?? []).find((b) => b.type === 'tool_call')
      return (block as Extract<ContentBlock, { type: 'tool_call' }>).data
    }

    it('counts only the runs that announced themselves', () => {
      store().handleSubAgentStarted(CONV, 'a1', '0', {
        conversationId: 'sub-1',
        turnId: 'run-1',
        kind: 'agent',
      })
      expect(card().sub_agent).toMatchObject({ conversation_id: 'sub-1', turn_id: 'run-1' })

      store().handleMessageStart('sub-1', 'm1', 'run-1')
      store().handleMessageStart('sub-1', 'm2', 'run-1')
      expect(store().subAgentSteps['run-1']).toBe(2)

      // An ordinary turn is not a delegation and never gets a key.
      store().handleMessageStart(CONV, 'a2', 'parent-turn')
      expect(store().subAgentSteps['parent-turn']).toBeUndefined()
    })

    it('nests a delegated question instead of inventing a card for it', () => {
      store().handleToolApproval(CONV, 'a1', 'appr-1', 'child-call', 'run_command', undefined, undefined, {
        parentCallId: '0',
        arguments: '{"command":"ls"}',
        subConversationId: 'sub-1',
      })

      const row = store().sessions[CONV]!.messages.find((m) => m.id === 'a1')!
      const calls = (row._blocks ?? []).filter((b) => b.type === 'tool_call')
      expect(calls).toHaveLength(1)
      expect(card().status).toBe('running')
      expect(card().nested_approval?.approval_id).toBe('appr-1')
      // It still counts as something this conversation needs a person for.
      expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual(['appr-1'])

      store().resolveNestedApproval(CONV, 'appr-1')
      expect(card().nested_approval).toBeUndefined()
      expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual([])
    })

    // The run is not what failed — only its question was lost.
    it('drops a lost question without writing off the run', () => {
      store().handleToolApproval(CONV, 'a1', 'appr-1', 'child-call', 'run_command', undefined, undefined, {
        parentCallId: '0',
        arguments: '{}',
      })
      store().markApprovalOrphaned('appr-1')

      expect(card().nested_approval).toBeUndefined()
      expect(card().status).toBe('running')
    })
  })

  describe('navigation', () => {
    beforeEach(() => {
      useConversationStore.setState({ sessions: {}, activeId: null, navigationStack: [] })
    })

    it('remembers the way back, and forgets it on a sideways move', () => {
      store().setActiveId('parent')
      store().openConversation('sub-1')
      expect(store().activeId).toBe('sub-1')
      expect(store().navigationStack).toEqual(['parent'])

      store().goBack()
      expect(store().activeId).toBe('parent')
      expect(store().navigationStack).toEqual([])

      // Picking something from the sidebar is not a step back up.
      store().openConversation('sub-1')
      store().setActiveId('elsewhere')
      expect(store().navigationStack).toEqual([])
    })
  })
})
