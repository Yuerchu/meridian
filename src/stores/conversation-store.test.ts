import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateBlocks, reconcileMessages, useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { api } from '@/api'
import type {
  UserCommandResultResponse,
  ContentBlock,
  ConversationSnapshotResponse,
  MessageInfoResponse,
  MessageViewModel,
  MessageTreeResponse,
  PlanReviewSummaryInfoResponse,
  ToolCallDisplay,
  TurnInfoResponse,
  TurnStatus,
} from '@/types'

vi.mock('@tauri-apps/api/core')
vi.mock('@/api', () => ({
  api: {
    // One request per load. The transcript, the approvals still outstanding and
    // the turn records only mean anything together: a tool call with no result
    // row is waiting, running, or abandoned, and the row alone says none of it.
    conversationSnapshot: vi.fn(),
    activeUserShellTurn: vi.fn(() => Promise.resolve(null)),
    switchBranch: vi.fn(),
    allPendingApprovals: vi.fn(),
  },
}))

/** A snapshot with nothing outstanding, which is what most tests want. */
function snapshotOf(
  tree: MessageTreeResponse,
  over: Partial<ConversationSnapshotResponse> = {},
): ConversationSnapshotResponse {
  return {
    conversation: {} as ConversationSnapshotResponse['conversation'],
    tree,
    turns: [],
    pending_approvals: [],
    plan_reviews: [],
    plan_review_barrier: false,
    sub_agent_runs: [],
    acp_notices: [],
    ...over,
  }
}

function turnRecord(id: string, status: TurnStatus): TurnInfoResponse {
  return {
    id,
    status,
    phase: null,
    phase_tool: null,
    error: null,
    started_at: 0,
    ended_at: null,
    usage: null,
  }
}

function msg(id: string, over: Partial<MessageViewModel> = {}): MessageViewModel {
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
    is_compact_summary: false,
    cache_read_tokens: null,
    cache_write_tokens: null,
    provider_name: null,
    sender_id: null,
    parent_id: null,
    compact_anchor_id: null,
    source: null,
    turn_id: null,
    tool_outcome: null,
    auto_review: null,
    tool_diffs: null,
    context_items: [],
    ...over,
  }
}

describe('plan review snapshot monotonicity', () => {
  const CONV = 'plan-race'
  const store = () => useConversationStore.getState()
  const pendingEvent = {
    review_id: 'review-race',
    conversation_id: CONV,
    document_id: 'document-race',
    revision_id: 'revision-race',
    turn_id: 'turn-race',
    status: 'pending' as const,
    delivery_state: null,
    lock_version: 1,
  }
  const settledEvent = {
    ...pendingEvent,
    status: 'approved' as const,
    delivery_state: 'acknowledged' as const,
    lock_version: 3,
  }
  const summary = {
    ...pendingEvent,
    assistant_message_id: 'assistant-race',
    provider_call_id: 'call-race',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {}, attention: {}, attentionOrder: [] })
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
    store().ensureSession(CONV)
    vi.mocked(api.activeUserShellTurn).mockResolvedValue(null)
    expect(usePlanReviewStore.getState().receiveReviewEvent(pendingEvent)).toBe(true)
    store().handlePlanReviewEvent(pendingEvent)
  })

  it.each(['loadMessages', 'turn-stop', 'compact', 'switch'] as const)(
    'does not let a delayed pending snapshot roll back an acknowledged event through %s',
    async (path) => {
      let resolveStale!: (snapshot: ConversationSnapshotResponse) => void
      const stalePromise = new Promise<ConversationSnapshotResponse>((resolve) => {
        resolveStale = resolve
      })
      const fresh = snapshotOf(
        { messages: [], head_message_id: null, branches: [] },
        {
          plan_reviews: [{ ...summary, ...settledEvent }],
          plan_review_barrier: false,
        },
      )
      vi.mocked(api.conversationSnapshot).mockReturnValueOnce(stalePromise).mockResolvedValue(fresh)
      vi.mocked(api.switchBranch).mockResolvedValue(undefined)

      let operation: Promise<unknown> | null = null
      if (path === 'loadMessages') operation = store().loadMessages(CONV)
      else if (path === 'turn-stop') store().handleStop(CONV)
      else if (path === 'compact') {
        store().handleCompactStart(CONV)
        store().handleCompactDone(CONV)
      } else operation = store().switchBranch(CONV, 'message-other')

      await vi.waitFor(() => expect(api.conversationSnapshot).toHaveBeenCalled())
      expect(usePlanReviewStore.getState().receiveReviewEvent(settledEvent)).toBe(true)
      store().handlePlanReviewEvent(settledEvent)
      resolveStale(
        snapshotOf(
          { messages: [msg('stale')], head_message_id: 'stale', branches: [] },
          { plan_reviews: [summary], plan_review_barrier: true },
        ),
      )

      if (operation) await operation
      else {
        await stalePromise
        await Promise.resolve()
      }

      expect(usePlanReviewStore.getState().summaries['review-race']).toMatchObject(settledEvent)
      expect(store().sessions[CONV]?.planReviewBarrier).toBe(false)
      expect(store().attention['review-race']).toBeUndefined()
      expect(store().sessions[CONV]?.messages.map((message) => message.id)).not.toContain('stale')
    },
  )
})

describe('plan review global attention', () => {
  const CONV = 'plan-attention'
  const REVIEW = 'review-attention'
  const store = () => useConversationStore.getState()
  const summary = (
    deliveryState: PlanReviewSummaryInfoResponse['delivery_state'],
    lockVersion = 1,
  ): PlanReviewSummaryInfoResponse => ({
    review_id: REVIEW,
    conversation_id: CONV,
    document_id: 'document-attention',
    revision_id: 'revision-attention',
    assistant_message_id: 'assistant-attention',
    provider_call_id: 'call-attention',
    turn_id: 'turn-attention',
    status: 'approved',
    delivery_state: deliveryState,
    lock_version: lockVersion,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ sessions: {}, attention: {}, attentionOrder: [] })
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
    store().ensureSession(CONV)
    vi.mocked(api.activeUserShellTurn).mockResolvedValue(null)
  })

  it.each([
    ['queued', 'delivery_queued', true],
    ['held', 'delivery_attention', true],
    ['in_doubt', 'delivery_attention', true],
    ['dispatched', null, true],
    ['acknowledged', null, false],
  ] as const)('restores a %s settled delivery consistently from a snapshot', async (deliveryState, stage, barrier) => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf(
        { messages: [], head_message_id: null, branches: [] },
        { plan_reviews: [summary(deliveryState)], plan_review_barrier: barrier },
      ),
    )

    await store().loadMessages(CONV)

    if (stage === null) expect(store().attention[REVIEW]).toBeUndefined()
    else expect(store().attention[REVIEW]).toMatchObject({ kind: 'plan_review', stage })
    expect(store().sessions[CONV]?.planReviewBarrier).toBe(barrier)
  })

  it('updates realtime attention without confusing it with the dispatched barrier', () => {
    const apply = (review: PlanReviewSummaryInfoResponse) => {
      expect(usePlanReviewStore.getState().receiveReviewEvent(review)).toBe(true)
      store().handlePlanReviewEvent(review)
    }

    apply({ ...summary(null, 1), status: 'pending' })
    expect(store().attention[REVIEW]).toMatchObject({ kind: 'plan_review', stage: 'review' })

    apply(summary('queued', 2))
    expect(store().attention[REVIEW]).toMatchObject({ kind: 'plan_review', stage: 'delivery_queued' })

    apply(summary('dispatched', 3))
    expect(store().attention[REVIEW]).toBeUndefined()
    expect(store().sessions[CONV]?.planReviewBarrier).toBe(true)

    apply(summary('held', 4))
    expect(store().attention[REVIEW]).toMatchObject({ kind: 'plan_review', stage: 'delivery_attention' })

    apply(summary('acknowledged', 5))
    expect(store().attention[REVIEW]).toBeUndefined()
    expect(store().sessions[CONV]?.planReviewBarrier).toBe(false)
  })
})

describe('hydrateBlocks', () => {
  /** An assistant row that made one tool call. */
  function caller(id: string, callId: string, name = 'read_file'): MessageInfoResponse {
    return msg(id, {
      tool_calls: [{ id: callId, type: 'function', function: { name, arguments: '{}' } }],
    })
  }

  /** The tool row that answered one. */
  function answer(id: string, callId: string, content = 'done'): MessageInfoResponse {
    return msg(id, { role: 'tool', tool_call_id: callId, content })
  }

  function callBlocks(out: MessageViewModel[], messageId: string): ToolCallDisplay[] {
    const row = out.find((m) => m.id === messageId)
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  it('reads a call with a matching tool row as completed', () => {
    const out = hydrateBlocks([caller('a', 'c1'), answer('t', 'c1', 'the result')])
    expect(callBlocks(out, 'a')[0]).toMatchObject({ status: 'completed', result: 'the result' })
  })

  it.each([
    'not an array',
    {},
    [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' }, future: true }],
    [{ id: 'c1', type: 'future', function: { name: 'read_file', arguments: '{}' } }],
    [{ id: 'c1', type: 'function', function: { name: 'read_file' } }],
  ])('rejects malformed stored tool calls: %j', (toolCalls) => {
    expect(() =>
      hydrateBlocks([msg('a', { tool_calls: toolCalls as unknown as MessageInfoResponse['tool_calls'] })]),
    ).toThrow(/message\.tool_calls/)
  })

  // A stream cut mid-argument leaves a fragment on the row. The transcript
  // still opens, with the fragment shown as recorded.
  it('keeps a truncated argument string verbatim instead of refusing the row', () => {
    const out = hydrateBlocks(
      [caller('a', 'c1', 'run_command')].map((m) => ({
        ...m,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{"command":"echo half' } },
        ],
      })),
    )
    expect(callBlocks(out, 'a')[0]).toMatchObject({ arguments: '{"command":"echo half' })
  })

  it('rejects malformed and extended automatic-review verdicts', () => {
    const base = caller('a', 'c1')
    for (const autoReview of [
      'not an object',
      [],
      { c1: { outcome: 'future' } },
      { c1: { outcome: 'allow', future: true } },
      { c1: { outcome: 'allow', evidence: [{ tool: 'read_file' }] } },
    ]) {
      expect(() =>
        hydrateBlocks([{ ...base, auto_review: autoReview as unknown as MessageInfoResponse['auto_review'] }]),
      ).toThrow(/message\.auto_review/)
    }
  })

  // Compaction summaries sit at sort_order -1 by design. Refusing them blanked
  // every conversation that had ever compacted.
  it('accepts a compaction summary at a negative sort_order', () => {
    const summary = msg('s', { is_compact_summary: true, sort_order: -1 })
    expect(() => hydrateBlocks([summary])).not.toThrow()
  })

  // A verdict for a call the row no longer names is orphaned metadata, not a
  // broken row: dropped, not fatal.
  it('drops an automatic-review verdict for a call the row does not name', () => {
    const base = caller('a', 'kept')
    const verdict = {
      outcome: 'allow',
      risk: null,
      authorization: null,
      rationale: null,
      stage: null,
      model: null,
      evidence: [],
    }
    const row = { ...base, auto_review: { kept: verdict, gone: verdict } } as unknown as MessageInfoResponse
    expect(() => hydrateBlocks([row])).not.toThrow()
  })

  it('rejects unknown message roles', () => {
    const unknownRole = { ...msg('a'), role: 'future_role' } as unknown as MessageInfoResponse
    expect(() => hydrateBlocks([unknownRole])).toThrow(/unknown message role/)
  })

  it('rejects front-end-only blocks in a wire snapshot', () => {
    const derived = msg('a', { _blocks: [{ type: 'text', text: 'must not cross IPC' }] })
    expect(() => hydrateBlocks([derived])).toThrow(/unknown field.*_blocks/)
  })

  it('rejects unknown sources and extended context descriptors', () => {
    const unknownSource = { ...msg('u', { role: 'user' }), source: 'future_source' } as unknown as MessageInfoResponse
    expect(() => hydrateBlocks([unknownSource])).toThrow(/unknown message source/)

    const extendedContext = msg('u', {
      role: 'user',
      context_items: [
        {
          id: 'ctx',
          position: 0,
          kind: 'project_file',
          display_path: 'src/main.ts',
          line_start: null,
          line_end: null,
          byte_count: 1,
          line_count: 1,
          token_count: 1,
          truncated: false,
          metadata: 'must not cross IPC',
        } as unknown as MessageInfoResponse['context_items'][number],
      ],
    })
    expect(() => hydrateBlocks([extendedContext])).toThrow(/must contain exactly/)
  })

  it('accepts a conversation reference descriptor and holds its shape', () => {
    const descriptor = {
      id: 'ctx',
      position: 0,
      kind: 'conversation',
      display_path: '被引线程',
      line_start: null,
      line_end: null,
      byte_count: 1,
      line_count: 1,
      token_count: 1,
      truncated: false,
    }
    expect(() => hydrateBlocks([msg('u', { role: 'user', context_items: [descriptor] })])).not.toThrow()

    // The title is load-bearing (the chip and the hosted prompt both read it),
    // and a line range means nothing on a thread.
    const untitled = { ...descriptor, display_path: null }
    expect(() =>
      hydrateBlocks([
        msg('u', {
          role: 'user',
          context_items: [untitled as unknown as MessageInfoResponse['context_items'][number]],
        }),
      ]),
    ).toThrow(/display_path is required/)
    const ranged = { ...descriptor, line_start: 1, line_end: 2 }
    expect(() =>
      hydrateBlocks([
        msg('u', { role: 'user', context_items: [ranged as unknown as MessageInfoResponse['context_items'][number]] }),
      ]),
    ).toThrow(/conversation reference has a line range/)
  })

  it('rejects unknown turn phases and sub-agent kinds', () => {
    const unknownPhase = { ...turnRecord('t1', 'running'), phase: 'future_phase' } as unknown as TurnInfoResponse
    expect(() => hydrateBlocks([], [], [unknownPhase])).toThrow(/unknown turn phase/)
    const unknownKind = {
      conversation_id: 'child',
      spawned_by_message_id: 'a',
      spawned_by_call_id: 'c1',
      spawned_turn_id: 't1',
      agent_kind: 'future_kind',
      title: null,
      steps: 0,
      status: 'running',
    } as unknown as ConversationSnapshotResponse['sub_agent_runs'][number]
    expect(() => hydrateBlocks([], [], [], [unknownKind])).toThrow(/unknown sub-agent kind/)
  })

  it('projects a successful send_sticker result as an independent sticker block', () => {
    const assistant = msg('a', {
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'send_sticker', arguments: JSON.stringify({ sticker_id: 's1' }) },
        },
      ],
    })
    const out = hydrateBlocks([assistant, answer('t', 'c1', JSON.stringify({ sticker_id: 's1', name: 'wave' }))])
    expect(out[0]._blocks).toContainEqual({ type: 'sticker', sticker_id: 's1', name: 'wave' })
  })

  it('reads an unanswered call the backend is still holding as pending', () => {
    const out = hydrateBlocks(
      [caller('a', 'c1')],
      [
        {
          approval_id: 'appr-1',
          conversation_id: 'c',
          assistant_message_id: 'a',
          provider_call_id: 'c1',
          origin_call_id: null,
          tool_name: 'read_file',
          arguments: '{}',
          retry_reason: null,
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
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
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }],
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
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }],
          }),
        ],
        [],
        [turnRecord('t1', ended)],
      )
      expect(callBlocks(out, 'a')[0], ended).toMatchObject({ status: 'orphaned' })
    }
  })

  it('keeps a missing turn record live but rejects an unknown stored status', () => {
    const row = msg('a', {
      turn_id: 't1',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }],
    })
    expect(callBlocks(hydrateBlocks([row], [], []), 'a')[0]).toMatchObject({ status: 'running' })
    const malformed = { ...turnRecord('t1', 'running'), status: 'from_the_future' } as unknown as TurnInfoResponse
    expect(() => hydrateBlocks([row], [], [malformed])).toThrow(/unknown turn status/)
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
          conversation_id: 'c',
          assistant_message_id: 'a',
          provider_call_id: 'c1',
          origin_call_id: 'c1',
          tool_name: 'run_command',
          arguments: '{}',
          retry_reason: 'sandbox denied',
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
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
      tool_calls: [
        { id: '0', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        { id: '0', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ],
    })
    const out = hydrateBlocks(
      [both],
      [
        {
          approval_id: 'appr-1',
          conversation_id: 'c',
          assistant_message_id: 'a',
          provider_call_id: '0',
          origin_call_id: null,
          tool_name: 'read_file',
          arguments: '{}',
          retry_reason: null,
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
        },
        {
          approval_id: 'appr-2',
          conversation_id: 'c',
          assistant_message_id: 'a',
          provider_call_id: '0',
          origin_call_id: null,
          tool_name: 'read_file',
          arguments: '{}',
          retry_reason: null,
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
        },
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
          conversation_id: 'c',
          assistant_message_id: 'a2',
          provider_call_id: 'c1',
          origin_call_id: null,
          tool_name: 'read_file',
          arguments: '{}',
          retry_reason: null,
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
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

    store().handleToolApproval(CONV, 'a1', 'appr-1', '0', 'read_file', '{}')
    expect(cards().map((c) => c.status)).toEqual(['pending', 'running'])
    expect(cards().map((c) => c.approval_id)).toEqual(['appr-1', undefined])

    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'read_file', '{}')
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
    store().handleToolApproval(CONV, 'a1', 'appr-1', '0', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'read_file', '{}')

    store().handleToolResult(CONV, 'a1', '0', 'done')

    expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual(['appr-2'])
  })

  // A card whose deadline passed. The turn is still running — this is not a
  // stop — so nothing else would ever take it down, and its buttons already
  // reach a receiver that has gone.
  it('settles the card when a question expires, rather than only the queue', () => {
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    expect(cards()[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })

    store().handleApprovalExpired(CONV, 'appr-1')

    // Both halves. Clearing the id and leaving `pending` would draw as
    // `requires-action`: a demand for an answer with nowhere to send one.
    expect(cards()[0]!.status).toBe('orphaned')
    expect(cards()[0]!.approval_id).toBeUndefined()
    expect(store().sessions[CONV]!.pendingApprovals).toEqual({})
    expect(store().attention['appr-1']).toBeUndefined()
    expect(store().attentionOrder).not.toContain('appr-1')
  })

  // Only the one that went. A conversation can have several cards up, and the
  // others are still owed an answer.
  it('leaves the other outstanding questions alone', () => {
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolCall(CONV, 'a1', 'c2', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-2', 'c2', 'read_file', '{}')

    store().handleApprovalExpired(CONV, 'appr-1')

    expect(cards().map((c) => c.status)).toEqual(['orphaned', 'pending'])
    expect(Object.keys(store().sessions[CONV]!.pendingApprovals)).toEqual(['appr-2'])
    expect(store().attention['appr-2']).toBeDefined()
  })

  // The queue is written for conversations nobody has opened, which is most of
  // the ones that reach a deadline — so the retirement cannot sit behind a
  // session lookup.
  it('clears the queue for a conversation with no session', () => {
    store().handleToolApproval('never-opened', 'x1', 'appr-9', 'c1', 'run_command', '{}')
    expect(store().attention['appr-9']).toBeDefined()

    store().handleApprovalExpired('never-opened', 'appr-9')
    expect(store().attention['appr-9']).toBeUndefined()
    expect(store().attentionOrder).not.toContain('appr-9')
  })

  it('carries the escalation details onto the card', () => {
    store().handleToolCall(CONV, 'a1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}', 'sandbox denied', 'c1')

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
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    expect(cards()[0]).toMatchObject({ status: 'pending', approval_id: 'appr-1' })

    // The user says yes, the command runs, the sandbox blocks it.
    store().handleToolApproval(CONV, 'a1', 'appr-2', 'c1', 'run_command', '{}', 'sandbox denied', 'c1')

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

    store().handleToolApproval(CONV, 'a1', 'appr-2', '0', 'run_command', '{}', 'sandbox denied', '0')

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
  function reloadPausedMidRound(): [Promise<void>, (snap: ConversationSnapshotResponse) => void] {
    let land: (snap: ConversationSnapshotResponse) => void = () => {}
    vi.mocked(api.conversationSnapshot).mockReturnValueOnce(
      new Promise<ConversationSnapshotResponse>((resolve) => {
        land = resolve
      }),
    )
    return [store().loadMessages(CONV), (snap) => land(snap)]
  }

  /** What the database has once the round's calls are written and none of its
   *  tool rows are. */
  function roundWritten(ids: string[]): ConversationSnapshotResponse {
    return snapshotOf(
      {
        messages: [
          msg('a1', {
            turn_id: 'turn-1',
            content: 'on it',
            tool_calls: ids.map((id) => ({
              id,
              type: 'function',
              function: { name: 'run_command', arguments: '{}' },
            })),
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

describe('literal shell command lifecycle', () => {
  const store = () => useConversationStore.getState()
  const result = (conversationId: string, turnId: string, messageId: string): UserCommandResultResponse => ({
    conversation_id: conversationId,
    turn_id: turnId,
    message_id: messageId,
    status: 'completed',
    stdout: 'done',
    stderr: '',
    exit_code: 0,
    timed_out: false,
    truncated: false,
    sandbox: 'windows_restricted_token',
    duration_ms: 12,
    cwd: 'C:/repo',
    host: 'desktop',
    error: null,
    can_retry_without_sandbox: false,
    retry_without_sandbox: false,
  })

  beforeEach(() => {
    vi.mocked(api.activeUserShellTurn).mockResolvedValue(null)
    useConversationStore.setState({ sessions: {} })
  })

  it('keeps active commands scoped to their conversation and refreshes the finished message', () => {
    store().beginShellCommand('c1', 'turn-1')
    store().beginShellCommand('c2', 'turn-2')

    store().finishShellCommand(result('c1', 'turn-1', 'message-1'))

    expect(store().sessions.c1.activeShellTurnId).toBeNull()
    expect(store().sessions.c1.shellResultKeys['message-1']).toContain('turn-1')
    expect(store().sessions.c2.activeShellTurnId).toBe('turn-2')
  })

  it('does not let a late finish clear the command that replaced it', () => {
    store().beginShellCommand('c1', 'turn-old')
    store().beginShellCommand('c1', 'turn-live')

    store().finishShellCommand(result('c1', 'turn-old', 'message-old'))

    expect(store().sessions.c1.activeShellTurnId).toBe('turn-live')
  })

  it('rehydrates a live command when a conversation is loaded after reload', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({
        messages: [
          msg('message-shell', {
            conversation_id: 'c1',
            role: 'user',
            source: 'shell',
            turn_id: 'turn-live',
          }),
        ],
        head_message_id: 'message-shell',
        branches: [],
      }),
    )
    vi.mocked(api.activeUserShellTurn).mockResolvedValue('turn-live')

    expect(await store().loadMessages('c1')).toBe(true)

    expect(store().sessions.c1.activeShellTurnId).toBe('turn-live')
    expect(store().sessions.c1.messages).toEqual([
      expect.objectContaining({ id: 'message-shell', source: 'shell', turn_id: 'turn-live' }),
    ])
  })

  it('does not let an in-flight hydrate resurrect a command after its finish event', async () => {
    let resolveActive!: (turnId: string | null) => void
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({ messages: [], head_message_id: null, branches: [] }),
    )
    vi.mocked(api.activeUserShellTurn).mockReturnValue(
      new Promise((resolve) => {
        resolveActive = resolve
      }),
    )
    store().beginShellCommand('c1', 'turn-live')
    const loading = store().loadMessages('c1')

    store().finishShellCommand(result('c1', 'turn-live', 'message-shell'))
    resolveActive('turn-live')

    expect(await loading).toBe(false)
    expect(store().sessions.c1.activeShellTurnId).toBeNull()
  })

  it('invalidates a pre-reload active query when finish arrives before the session knew the turn', async () => {
    let resolveActive!: (turnId: string | null) => void
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({ messages: [], head_message_id: null, branches: [] }),
    )
    vi.mocked(api.activeUserShellTurn).mockReturnValue(
      new Promise((resolve) => {
        resolveActive = resolve
      }),
    )
    const loading = store().loadMessages('c1')

    // A fresh page has no activeShellTurnId yet. The result event is still
    // newer than the query that is about to return the old live id.
    store().finishShellCommand(result('c1', 'turn-live', 'message-shell'))
    resolveActive('turn-live')

    expect(await loading).toBe(false)
    expect(store().sessions.c1.activeShellTurnId).toBeNull()
    expect(store().sessions.c1.shellResultKeys['message-shell']).toContain('turn-live')
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
          turns: [turnRecord('turn-1', 'interrupted'), turnRecord('turn-2', 'failed'), turnRecord('turn-3', 'done')],
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
    let land: (snap: ConversationSnapshotResponse) => void = () => {}
    vi.mocked(api.conversationSnapshot).mockReturnValueOnce(
      new Promise<ConversationSnapshotResponse>((resolve) => {
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
      expect(api.conversationSnapshot).toHaveBeenCalledWith({ conversationId: CONV })
    })
    expect(session().streaming).toBe(true)
  })

  /// Stopping is what strands an approval: the turn is gone, so nothing is
  /// left to answer the card. It must not do that to a turn that is still
  /// running.
  it('orphans a card hydrated from a snapshot, with no live approval event', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf(
        {
          messages: [
            msg('a1', {
              turn_id: 'turn-1',
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{}' } }],
            }),
          ],
          head_message_id: 'a1',
          branches: [],
        },
        {
          pending_approvals: [
            {
              approval_id: 'appr-1',
              conversation_id: CONV,
              assistant_message_id: 'a1',
              provider_call_id: 'c1',
              origin_call_id: null,
              tool_name: 'run_command',
              arguments: '{}',
              retry_reason: null,
              bubbled: false,
              parent_call_id: null,
              sub_conversation_id: null,
            },
          ],
          turns: [turnRecord('turn-1', 'running')],
        },
      ),
    )
    await store().loadMessages(CONV)
    expect(session().pendingApprovals['appr-1']).toBeDefined()

    store().handleStop(CONV, 'turn-1')
    const row = session().messages.find((m) => m.id === 'a1')
    const card = (row?._blocks ?? []).find((b) => b.type === 'tool_call')
    expect(card?.type === 'tool_call' && card.data.status).toBe('orphaned')
  })

  it("leaves another run's approvals alone", () => {
    store().handleMessageStart(CONV, 'a1', 'turn-2')
    store().handleToolCall(CONV, 'a1', 'c1', 'read_file', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'read_file', '{}')

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
      expect(api.conversationSnapshot).toHaveBeenCalledWith({ conversationId: CONV })
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

  it('rejects inconsistent and extended branch responses', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({
        messages: [msg('a2')],
        head_message_id: 'a2',
        branches: [
          {
            message_id: 'a2',
            index: 1,
            total: 3,
            sibling_ids: ['a1', 'a2'],
            future: true,
          } as unknown as MessageTreeResponse['branches'][number],
        ],
      }),
    )

    await expect(useConversationStore.getState().loadMessages(CONV)).rejects.toThrow(/message tree\.branches/)
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

  it('clears the switching flag and surfaces error when the request fails', async () => {
    vi.mocked(api.switchBranch).mockRejectedValue(new Error('nope'))

    await useConversationStore.getState().switchBranch(CONV, 'a2')
    expect(useConversationStore.getState().sessions[CONV]?.switchingBranch).toBe(false)
    expect(useConversationStore.getState().sessions[CONV]?.error).toBe('Error: nope')
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

    let land: (snap: ConversationSnapshotResponse) => void = () => {}
    vi.mocked(api.conversationSnapshot)
      .mockReturnValueOnce(
        new Promise<ConversationSnapshotResponse>((resolve) => {
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

  function callBlocks(msgs: MessageViewModel[], messageId: string): ToolCallDisplay[] {
    const row = msgs.find((m) => m.id === messageId)
    return (row?._blocks ?? [])
      .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
      .map((b) => b.data)
  }

  function delegator(id: string, callId: string): MessageInfoResponse {
    return msg(id, {
      turn_id: 't1',
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: { name: 'run_agent', arguments: '{"agent":"agent","description":"fix the test"}' },
        },
      ],
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
          conversation_id: 'c',
          assistant_message_id: 'a1',
          provider_call_id: 'child-call',
          origin_call_id: null,
          tool_name: 'run_command',
          arguments: '{"command":"cargo test --all"}',
          retry_reason: null,
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
      tool_calls: [{ id: 'child-call', type: 'function', function: { name: 'run_command', arguments: '{}' } }],
    })
    const out = hydrateBlocks(
      [caller],
      [
        {
          approval_id: 'appr-1',
          conversation_id: 'c',
          assistant_message_id: 'a1',
          provider_call_id: 'child-call',
          origin_call_id: null,
          tool_name: 'run_command',
          arguments: '{}',
          retry_reason: null,
          bubbled: true,
          parent_call_id: null,
          sub_conversation_id: null,
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
      store().handleToolApproval(
        CONV,
        'a1',
        'appr-1',
        'child-call',
        'run_command',
        '{"command":"ls"}',
        undefined,
        undefined,
        {
          parentCallId: '0',
          subConversationId: 'sub-1',
        },
      )

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
    it('clears a nested question when the sub-agent stops', () => {
      store().handleToolApproval(CONV, 'a1', 'appr-1', 'child-call', 'run_command', '{}', undefined, undefined, {
        parentCallId: '0',
        subConversationId: 'sub-1',
      })
      expect(card().nested_approval?.approval_id).toBe('appr-1')
      store().handleStop('sub-1')
      expect(store().attentionOrder).toEqual([])
      expect(card().nested_approval).toBeUndefined()
    })

    it('drops a lost question without writing off the run', () => {
      store().handleToolApproval(CONV, 'a1', 'appr-1', 'child-call', 'run_command', '{}', undefined, undefined, {
        parentCallId: '0',
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

/**
 * The queue of questions waiting on a person.
 *
 * Every test here uses a conversation with no session, because that is the case
 * the queue exists for and the case that used to be silently dropped: with
 * several conversations working at once, the ones that stop for permission are
 * mostly ones nobody has opened, and `ensureSession` only runs when `ChatView`
 * mounts. Each of these paths returns early without a session.
 */
describe('the waiting-on-you queue', () => {
  const CONV = 'conv-never-opened'
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.conversationSnapshot).mockResolvedValue(
      snapshotOf({ messages: [], head_message_id: null, branches: [] }),
    )
    useConversationStore.setState({ sessions: {}, attention: {}, attentionOrder: [], activeId: null })
  })

  it('records a question from a conversation that was never opened', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{"command":"ls"}')

    expect(store().sessions[CONV]).toBeUndefined()
    expect(store().attention['appr-1']).toMatchObject({
      conversationId: CONV,
      messageId: 'a1',
      providerCallId: 'c1',
      toolName: 'run_command',
      // Carried rather than read off the transcript: there is no transcript.
      arguments: '{"command":"ls"}',
      kind: 'approval',
    })
    expect(store().attentionOrder).toEqual(['appr-1'])
  })

  /** A question with a form behind it. It cannot be answered from a queue row,
   *  but it stops a turn exactly as an approval does, so it is queued and
   *  marked rather than dropped. */
  it('tells a question apart from a permission', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'ask_user', '{}')
    expect(store().attention['appr-1']!.kind).toBe('ask')
    store().handleToolApproval(CONV, 'a1', 'appr-2', 'c2', 'AskUserQuestion', '{}')
    expect(store().attention['appr-2']!.kind).toBe('ask')
  })

  it('does not queue the same approval twice', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    expect(store().attentionOrder).toEqual(['appr-1'])
  })

  it('retires a question when its result arrives', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().handleToolResult(CONV, 'a1', 'c1', 'ok')

    expect(store().attention).toEqual({})
    expect(store().attentionOrder).toEqual([])
  })

  /** Results are matched on the row *and* the call, because provider call ids
   *  repeat across the rows of one conversation. */
  it('leaves a sibling call alone when one of them finishes', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', '0', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a2', 'appr-2', '0', 'run_command', '{}')
    store().handleToolResult(CONV, 'a1', '0', 'ok')

    expect(store().attentionOrder).toEqual(['appr-2'])
  })

  /** Nothing is listening for an answer once the turn is over, and no result
   *  will arrive to say so. Without this the queue keeps offering buttons that
   *  the backend has already stopped waiting on. */
  it('retires everything a stopped turn was holding', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().handleToolApproval(CONV, 'a1', 'appr-2', 'c2', 'read_file', '{}')
    store().handleToolApproval('other-conv', 'b1', 'appr-3', 'c3', 'read_file', '{}')

    store().handleStop(CONV)

    expect(store().attentionOrder).toEqual(['appr-3'])
  })

  it('retires a question the backend has forgotten', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().markApprovalOrphaned('appr-1')
    expect(store().attentionOrder).toEqual([])
  })

  it('retires a question the moment an answer is sent', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
    store().retireAnsweredApproval('appr-1')
    expect(store().attentionOrder).toEqual([])
  })

  /**
   * Answering takes the question out of the queue and leaves the card holding
   * it exactly as it was.
   *
   * Both halves matter. Clearing the card's `approval_id` would leave it at
   * `status: 'pending'`, which `mapChatToolState` draws as `requires-action` —
   * a card demanding an answer with no way to give one — and `handleStop` reads
   * `pendingApprovals` to write off a call whose turn died before its result
   * arrived. The card's ledger is retired by the result; only the queue's needs
   * help.
   */
  it('leaves the card that is showing the question alone', () => {
    const OPEN = 'conv-open'
    store().ensureSession(OPEN)
    store().handleMessageStart(OPEN, 'a1')
    store().handleToolCall(OPEN, 'a1', 'c1', 'run_command', '{}')
    store().handleToolApproval(OPEN, 'a1', 'appr-1', 'c1', 'run_command', '{}')

    store().retireAnsweredApproval('appr-1')

    expect(store().attentionOrder).toEqual([])
    expect(store().sessions[OPEN]!.pendingApprovals['appr-1']).toBeDefined()
    const row = store().sessions[OPEN]!.messages.find((m) => m.id === 'a1')!
    const card = (row._blocks ?? []).find((b) => b.type === 'tool_call')
    expect(card?.type === 'tool_call' && card.data.approval_id).toBe('appr-1')
  })

  /**
   * The same hole on the question path.
   *
   * `AskUserBlock.handleSubmit` posts the form and nothing else finds out. An
   * ordinary question would be re-offered as "go and answer this" for a form
   * already submitted; a delegated one is filed under the parent it was asked
   * in, so no result or stop can ever name it. Both are retired by id, and the
   * kind does not enter into it.
   */
  it('retires an answered question, delegated or not', () => {
    store().handleToolApproval(CONV, 'a1', 'ask-1', 'c1', 'ask_user', '{"questions":[]}')
    store().handleToolApproval(
      'parent-conv',
      'parent-row',
      'ask-2',
      'child-call',
      'ask_user',
      '{}',
      undefined,
      undefined,
      {
        parentCallId: 'run-agent-call',
        subConversationId: 'sub-conv',
      },
    )
    expect(store().attention['ask-1']!.kind).toBe('ask')
    expect(store().attention['ask-2']!.kind).toBe('ask')

    store().retireAnsweredApproval('ask-1')
    store().retireAnsweredApproval('ask-2')

    expect(store().attentionOrder).toEqual([])
  })

  /**
   * The case no event can close.
   *
   * A delegated run's question is *asked* on the parent — `approval_adapter.rs`
   * routes the event there, because nobody is necessarily watching the
   * sub-agent — while the call itself, its result and its stop all belong to the
   * sub-agent's own conversation. Both retiring paths compare conversation ids,
   * so neither can ever match, and the entry would outlive the turn: a
   * permanent dot on the parent and a dead row at the back of the queue.
   */
  it("retires a delegated question when the sub-agent's turn ends", () => {
    const PARENT = 'parent-conv'
    const SUB = 'sub-conv'
    store().handleToolApproval(
      PARENT,
      'parent-row',
      'appr-1',
      'child-call',
      'run_command',
      '{}',
      undefined,
      undefined,
      {
        parentCallId: 'run-agent-call',
        subConversationId: SUB,
      },
    )
    expect(store().attentionOrder).toEqual(['appr-1'])

    store().handleToolResult(SUB, 'child-row', 'child-call', 'ok')
    expect(store().attentionOrder).toEqual([])
  })

  it('retires a delegated question when the sub-agent is stopped', () => {
    const PARENT = 'parent-conv'
    const SUB = 'sub-conv'
    store().handleToolApproval(
      PARENT,
      'parent-row',
      'appr-1',
      'child-call',
      'run_command',
      '{}',
      undefined,
      undefined,
      {
        parentCallId: 'run-agent-call',
        subConversationId: SUB,
      },
    )
    store().handleStop(SUB)
    expect(store().attentionOrder).toEqual([])
  })

  /** Deferring is a reordering and nothing else: the question is still owed,
   *  and going round the queue brings it back. */
  it('moves a deferred question to the end without dropping it', () => {
    for (const id of ['appr-1', 'appr-2', 'appr-3']) {
      store().handleToolApproval(CONV, 'a1', id, `c-${id}`, 'read_file', '{}')
    }

    store().deferAttention('appr-1')

    expect(store().attentionOrder).toEqual(['appr-2', 'appr-3', 'appr-1'])
    expect(store().attention['appr-1']).toBeDefined()
  })

  it('ignores a defer for something that is no longer queued', () => {
    store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'read_file', '{}')
    store().deferAttention('gone')
    expect(store().attentionOrder).toEqual(['appr-1'])
  })

  describe('rebuilding from the backend', () => {
    /** A window that reloaded, or a phone that has just connected: the events
     *  that announced these went out to nobody and are never replayed. */
    it('adopts questions it never saw announced', async () => {
      vi.mocked(api.allPendingApprovals).mockResolvedValue([
        {
          approval_id: 'appr-1',
          conversation_id: CONV,
          assistant_message_id: 'a1',
          provider_call_id: 'c1',
          origin_call_id: null,
          tool_name: 'run_command',
          arguments: '{"command":"ls"}',
          retry_reason: null,
          bubbled: false,
          parent_call_id: null,
          sub_conversation_id: null,
        },
      ])

      await store().loadAllPending()

      expect(store().attention['appr-1']).toMatchObject({ conversationId: CONV, toolName: 'run_command' })
      expect(store().attentionOrder).toEqual(['appr-1'])
    })

    /** The answer is the register itself, so an entry it does not mention has
     *  no turn behind it — its turn ended while nothing was listening. */
    it('drops what the register no longer holds', async () => {
      store().handleToolApproval(CONV, 'a1', 'appr-dead', 'c1', 'run_command', '{}')
      vi.mocked(api.allPendingApprovals).mockResolvedValue([])

      await store().loadAllPending()

      expect(store().attentionOrder).toEqual([])
    })

    /** An approval that arrives while the request is in flight is younger than
     *  the answer. Judging it by that answer would drop a live question every
     *  time a reconnect raced an event. */
    it('does not drop a question that arrived while it was asking', async () => {
      let release: (rows: never[]) => void = () => {}
      vi.mocked(api.allPendingApprovals).mockReturnValue(
        new Promise((resolve) => {
          release = resolve
        }),
      )

      const inFlight = store().loadAllPending()
      store().handleToolApproval(CONV, 'a1', 'appr-new', 'c1', 'run_command', '{}')
      release([])
      await inFlight

      expect(store().attentionOrder).toEqual(['appr-new'])
    })

    /** A failed call is not evidence about anything. Emptying the queue here
     *  would turn one dropped request into a set of questions nobody is told
     *  about. */
    it('leaves the queue alone when the call fails', async () => {
      store().handleToolApproval(CONV, 'a1', 'appr-1', 'c1', 'run_command', '{}')
      vi.mocked(api.allPendingApprovals).mockRejectedValue(new Error('no'))

      await store().loadAllPending()

      expect(store().attentionOrder).toEqual(['appr-1'])
    })
  })
})

describe('hydrateBlocks with agent-reported diffs', () => {
  const hunk = { path: 'src/lib.rs', old_text: 'a', new_text: 'b', line: 3 }
  const withCall = (toolDiffs: unknown) =>
    msg('a', {
      role: 'assistant',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Write', arguments: '{}' } }],
      tool_diffs: toolDiffs as MessageInfoResponse['tool_diffs'],
    })

  /** The reload path: a stored diff reaches the card the same way a live
   *  `tool_call_diff` would, keyed by the call it belongs to. */
  it('puts the stored diff on its call and nothing on the others', () => {
    const [row] = hydrateBlocks([withCall({ toolu_1: [hunk], toolu_9: [hunk] })])
    const card = (row._blocks ?? []).find((b) => b.type === 'tool_call')
    expect(card?.type === 'tool_call' && card.data.diffs).toEqual([hunk])
  })

  it('refuses a diff that does not have the wire shape', () => {
    expect(() => hydrateBlocks([withCall({ toolu_1: [{ path: 'x', new_text: 'b', line: null }] })])).toThrow(
      /tool_diffs\.toolu_1\[0\] is missing required field: old_text/,
    )
    expect(() => hydrateBlocks([msg('u', { role: 'user', tool_diffs: {} })])).toThrow(
      'non-assistant message has tool_diffs',
    )
  })
})
