import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnItem } from './turn-item'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import { decimal } from '@/lib/decimal'
import { buildTurns } from '@/lib/turns'
import { useConversationStore } from '@/stores/conversation-store'
import i18n from '@/i18n'
import type { ContentBlock, MessageViewModel, ToolCallDisplay, TurnUsageInfoResponse } from '@/types'

// Resolved rather than bare: the cards attach a `.catch` to turn a rejected
// decision into an orphaned card, and `undefined.catch` would throw.
vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
    respondToAsk: vi.fn().mockResolvedValue(undefined),
  },
}))

const CONV = 'conv-1'
let seq = 0

function msg(role: MessageViewModel['role'], over: Partial<MessageViewModel> = {}): MessageViewModel {
  seq += 1
  return {
    id: `m${seq}`,
    conversation_id: CONV,
    role,
    content: '',
    provider_id: null,
    model_id: null,
    input_tokens: null,
    output_tokens: null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: seq,
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
    context_items: [],
    ...over,
  }
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const toolBlock = (name: string, status: ToolCallDisplay['status'] = 'completed'): ContentBlock => ({
  type: 'tool_call',
  data: {
    call_id: `${name}-1`,
    tool_name: name,
    arguments: '{}',
    status,
    // A pending call needs something for its buttons to answer, or it is
    // rendered as orphaned instead.
    ...(status === 'pending' ? { approval_id: `${name}-appr-1` } : {}),
  },
})

function usage(over: Partial<TurnUsageInfoResponse> = {}): TurnUsageInfoResponse {
  return {
    messages: 1,
    missing_token_usage_messages: 0,
    incomplete_token_usage_messages: 0,
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 40,
    cache_write_tokens: 0,
    server_tool_calls: 1,
    input_cost: decimal('0.2'),
    output_cost: decimal('0.3'),
    cache_cost: decimal('0.04'),
    tool_cost: decimal('0.005'),
    total_cost: decimal('0.545'),
    unpriced_token_messages: 0,
    unpriced_input_messages: 0,
    unpriced_output_messages: 0,
    unpriced_cache_messages: 0,
    unpriced_tool_messages: 0,
    estimated_token_messages: 0,
    estimated_tool_messages: 0,
    estimated_messages: 0,
    unpriced_messages: 0,
    metered_messages: 1,
    subscription_messages: 0,
    external_messages: 0,
    pricing_status: 'exact',
    ...over,
  }
}

/** A turn with a tool call that stays a key: a write is never folded into a
 *  badge, whatever its state, so the keyboard is always there to look at. */
function toolTurn(over: { status?: ToolCallDisplay['status']; conclusion?: boolean } = {}) {
  const u = msg('user', { content: 'q', created_at: 1000 })
  const blocks: ContentBlock[] = [text('let me check'), toolBlock('write_file', over.status ?? 'completed')]
  if (over.conclusion !== false) blocks.push(text('the answer'))
  const a = msg('assistant', { _blocks: blocks, content: 'the answer', created_at: 10_000 })
  return buildTurns([u, a])[0]
}

describe('TurnItem', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    // The keyboard keeps its panel choices on the active session.
    useConversationStore.setState({ sessions: {}, activeId: CONV })
    // ChatView calls ensureSession on mount, so the session always exists by the
    // time a turn renders.
    useConversationStore.getState().ensureSession(CONV)
  })

  it('renders the question and every answer row in the turn', () => {
    const u = msg('user', { content: 'what changed?' })
    const a1 = msg('assistant', { _blocks: [text('let me check')], content: 'let me check' })
    const a2 = msg('assistant', { _blocks: [text('three files did')], content: 'three files did' })
    const turn = buildTurns([u, a1, a2])[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)

    expect(screen.getByText('what changed?')).toBeInTheDocument()
    expect(screen.getByText('let me check')).toBeInTheDocument()
    expect(screen.getByText('three files did')).toBeInTheDocument()
  })

  it('carries the turn status onto the container', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
    const turn = buildTurns([u, a])[0]

    const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
    expect(container.querySelector('[data-slot="turn"]')).toHaveAttribute('data-status', 'complete')
  })

  it('renders a headless turn without a question bubble', () => {
    const a = msg('assistant', { _blocks: [text('unprompted')], content: 'unprompted' })
    const turn = buildTurns([a])[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    expect(screen.getByText('unprompted')).toBeInTheDocument()
  })

  it('gives the run one footer, not one per row', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('let me check')], content: 'let me check' })
    const a2 = msg('assistant', { _blocks: [text('the answer')], content: 'the answer' })
    const turn = buildTurns([u, a1, a2])[0]

    const { container } = render(
      <TurnItem turn={turn} conversationId={CONV} onDelete={vi.fn()} onRegenerate={vi.fn()} onRate={vi.fn()} />,
    )

    const footers = container.querySelectorAll('[data-slot="message-group-footer"]')
    // One for the question, one for the whole run of answers.
    expect(footers).toHaveLength(2)
  })

  it('keeps the actions reachable when the turn was cut short', () => {
    const turn = toolTurn({ conclusion: false })
    expect(turn.status).toBe('interrupted')

    const { container } = render(
      <TurnItem turn={turn} conversationId={CONV} onDelete={vi.fn()} onRegenerate={vi.fn()} />,
    )
    // Still reachable: an interrupted turn with no way to retry would be a trap.
    expect(container.querySelectorAll('[data-slot="message-group-footer"]')).toHaveLength(2)
  })

  it('aims deletion at the turn, not the row that was clicked', async () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('step')], content: 'step' })
    const a2 = msg('assistant', { _blocks: [text('answer')], content: 'answer' })
    const turn = buildTurns([u, a1, a2])[0]
    const onDelete = vi.fn()

    const { container } = render(<TurnItem turn={turn} conversationId={CONV} onDelete={onDelete} />)

    // The conclusion's footer carries the action, but it must still name the
    // question: the backend removes the whole subtree beneath whatever it is given.
    const buttons = Array.from(container.querySelectorAll('[data-slot="action-button"]'))
    await userEvent.click(buttons[buttons.length - 1])
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onDelete).toHaveBeenCalledWith(u.id)
  })

  it('reports usage summed over the whole turn', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('step')], content: 'step', input_tokens: 100, output_tokens: 20 })
    const a2 = msg('assistant', { _blocks: [text('done')], content: 'done', input_tokens: 300, output_tokens: 50 })
    const turn = buildTurns([u, a1, a2])[0]

    expect(turn.tokens).toEqual({ input: 400, output: 70 })
    render(<TurnItem turn={turn} conversationId={CONV} />)
    expect(screen.getByText(/tokens/)).toBeInTheDocument()
  })

  it('shows the backend-priced turn total and reveals its components by press as well as hover', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-priced',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: 100,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      // Persisted usage also contains billed side requests that do not have a
      // transcript row. The footer must use the same population as its cost.
      usageByTurnId: new Map([['turn-priced', usage({ input_tokens: 130, output_tokens: 30 })]]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', { name: 'Turn usage: 130 + 30 tokens · 0.545' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)

    const details = await screen.findByRole('dialog', { name: 'Turn usage' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const controlled = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(controlled).toContainElement(details)
    expect(within(details).getByText('0.20')).toBeInTheDocument()
    expect(within(details).getByText('0.04')).toBeInTheDocument()
    expect(within(details).getByText('0.30')).toBeInTheDocument()
    expect(within(details).getByText('0.005')).toBeInTheDocument()
    expect(within(details).getByText('0.545')).toBeInTheDocument()
  })

  it('marks only a partial total as a lower bound, not its known components', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-partial',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: 100,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      usageByTurnId: new Map([
        [
          'turn-partial',
          usage({
            pricing_status: 'lower_bound',
            tool_cost: null,
            total_cost: decimal('0.54'),
            unpriced_tool_messages: 1,
            unpriced_messages: 1,
          }),
        ],
      ]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', { name: 'Turn usage: 100 + 20 tokens · ≥ 0.54' })
    await userEvent.hover(trigger)

    const details = await screen.findByRole('dialog', { name: 'Turn usage' })
    expect(within(details).getByText('0.20')).toBeInTheDocument()
    expect(within(details).queryByText('≥ 0.20')).not.toBeInTheDocument()
    expect(within(details).getByText('Unknown')).toBeInTheDocument()
    expect(within(details).getByText('≥ 0.54')).toBeInTheDocument()
    expect(within(details).getByText('Only the priced portion is included; the total is a lower bound.')).toBeVisible()
  })

  it('uses current-price markers for estimates and never calls a partial estimate a lower bound', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-estimated-partial',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: 100,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      usageByTurnId: new Map([
        [
          'turn-estimated-partial',
          usage({
            pricing_status: 'estimated',
            tool_cost: null,
            total_cost: decimal('0.54'),
            estimated_token_messages: 1,
            estimated_messages: 1,
            unpriced_tool_messages: 1,
            unpriced_messages: 1,
          }),
        ],
      ]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', {
      name: 'Turn usage: 100 + 20 tokens · ≈ 0.54 (incomplete)',
    })
    expect(trigger).not.toHaveAccessibleName(/\u2265/)
    await userEvent.hover(trigger)

    const details = await screen.findByRole('dialog', { name: 'Turn usage' })
    expect(within(details).getByText('≈ 0.20')).toBeInTheDocument()
    expect(within(details).getByText('Unknown')).toBeInTheDocument()
    expect(within(details).getByText('≈ 0.54 (incomplete)')).toBeInTheDocument()
    expect(
      within(details).getByText(
        'Historical price snapshots were missing and some costs still cannot be determined. This is an incomplete estimate.',
      ),
    ).toBeVisible()
    expect(within(details).queryByText(/≥/)).not.toBeInTheDocument()
  })

  it('explains a complete historical-price fallback as an estimate', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-estimated',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: 100,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      usageByTurnId: new Map([
        ['turn-estimated', usage({ pricing_status: 'estimated', estimated_token_messages: 1, estimated_messages: 1 })],
      ]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', { name: 'Turn usage: 100 + 20 tokens · ≈ 0.545' })
    await userEvent.hover(trigger)

    const details = await screen.findByRole('dialog', { name: 'Turn usage' })
    expect(
      within(details).getByText(
        'Historical price snapshots were missing; this turn is estimated from current prices for the same provider and model.',
      ),
    ).toBeVisible()
  })

  it('distinguishes explicit zero usage from missing usage and external billing', () => {
    const u1 = msg('user', { content: 'first' })
    const a1 = msg('assistant', {
      turn_id: 'turn-free',
      _blocks: [text('free')],
      content: 'free',
      input_tokens: 1,
      output_tokens: 1,
    })
    const u2 = msg('user', { content: 'second' })
    const a2 = msg('assistant', {
      turn_id: 'turn-external',
      _blocks: [text('external')],
      content: 'external',
      input_tokens: 2,
      output_tokens: 1,
    })
    const u3 = msg('user', { content: 'third' })
    const a3 = msg('assistant', {
      turn_id: 'turn-missing',
      _blocks: [text('missing')],
      content: 'missing',
      input_tokens: null,
      output_tokens: null,
    })
    const turns = buildTurns([u1, a1, u2, a2, u3, a3], {
      usageByTurnId: new Map([
        [
          'turn-free',
          usage({
            input_tokens: 0,
            output_tokens: 0,
            input_cost: decimal('0'),
            output_cost: decimal('0'),
            cache_cost: decimal('0'),
            tool_cost: decimal('0'),
            total_cost: decimal('0'),
          }),
        ],
        [
          'turn-external',
          usage({
            input_tokens: 0,
            output_tokens: 0,
            missing_token_usage_messages: 1,
            incomplete_token_usage_messages: 1,
            input_cost: null,
            output_cost: null,
            cache_cost: null,
            tool_cost: null,
            total_cost: null,
            metered_messages: 0,
            external_messages: 1,
            pricing_status: 'external',
          }),
        ],
        [
          'turn-missing',
          usage({
            input_tokens: 0,
            output_tokens: 0,
            missing_token_usage_messages: 1,
            incomplete_token_usage_messages: 1,
            input_cost: null,
            output_cost: null,
            cache_cost: null,
            tool_cost: null,
            total_cost: null,
            unpriced_token_messages: 1,
            unpriced_messages: 1,
            pricing_status: 'unavailable',
          }),
        ],
      ]),
    })

    render(
      <>
        <TurnItem turn={turns[0]} conversationId={CONV} />
        <TurnItem turn={turns[1]} conversationId={CONV} />
        <TurnItem turn={turns[2]} conversationId={CONV} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Turn usage: 0 + 0 tokens · 0.00' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Turn usage: Token usage unavailable · External billing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Turn usage: Token usage unavailable · Cost unavailable' }),
    ).toBeInTheDocument()
  })

  it('marks a partially reported token total as a lower bound', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-partial-tokens',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: 100,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      usageByTurnId: new Map([
        [
          'turn-partial-tokens',
          usage({
            messages: 2,
            missing_token_usage_messages: 1,
            incomplete_token_usage_messages: 1,
            pricing_status: 'lower_bound',
            unpriced_token_messages: 1,
            unpriced_messages: 1,
          }),
        ],
      ]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', {
      name: 'Turn usage: ≥ 100 + 20 tokens · ≥ 0.545',
    })
    await userEvent.hover(trigger)

    expect(
      await screen.findByText(
        'Some requests did not report complete input/output usage; the displayed token total is a lower bound.',
      ),
    ).toBeVisible()
  })

  it('keeps a reported cost component exact when the other token side is missing', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      turn_id: 'turn-input-missing',
      _blocks: [text('done')],
      content: 'done',
      input_tokens: null,
      output_tokens: 20,
    })
    const turn = buildTurns([u, a], {
      usageByTurnId: new Map([
        [
          'turn-input-missing',
          usage({
            input_tokens: 900,
            output_tokens: 20,
            cache_read_tokens: 900,
            missing_token_usage_messages: 0,
            incomplete_token_usage_messages: 1,
            input_cost: null,
            cache_cost: decimal('9'),
            output_cost: decimal('2'),
            tool_cost: decimal('0'),
            total_cost: decimal('11'),
            unpriced_token_messages: 1,
            unpriced_input_messages: 1,
            unpriced_output_messages: 0,
            unpriced_cache_messages: 0,
            unpriced_messages: 1,
            pricing_status: 'lower_bound',
          }),
        ],
      ]),
    })[0]

    render(<TurnItem turn={turn} conversationId={CONV} />)
    const trigger = screen.getByRole('button', {
      name: 'Turn usage: ≥ 900 + 20 tokens · ≥ 11.00',
    })
    await userEvent.hover(trigger)

    const details = await screen.findByRole('dialog', { name: 'Turn usage' })
    const inputRow = within(details).getByText('Input').closest('div') as HTMLElement
    const outputRow = within(details).getByText('Output').closest('div') as HTMLElement
    expect(within(inputRow).getByText('Unknown')).toBeInTheDocument()
    expect(within(outputRow).getByText('2.00')).toBeInTheDocument()
    expect(within(outputRow).queryByText('≥ 2.00')).not.toBeInTheDocument()
    expect(within(details).getByText('≥ 11.00')).toBeInTheDocument()
  })

  describe('working bubble', () => {
    const streamingTurn = (blocks: ContentBlock[]) => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', { _blocks: blocks, created_at: 10_000 })
      return buildTurns([u, a], { streaming: true })[0]
    }
    const marker = (root: HTMLElement) => root.querySelector('[data-slot="bubble"][role="status"]')

    it('draws the wait between a tool returning and the model speaking as the next bubble', () => {
      const turn = streamingTurn([text('let me check'), toolBlock('read_file')])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      // Where the answer will land: inside the run, after the last bubble,
      // with the avatar beside it — the typing indicator, not a footnote.
      const working = marker(container)!
      expect(working).toBeInTheDocument()
      expect(container.querySelector('[data-slot="message-group-bubbles"]')).toContainElement(working)
      expect(working).toHaveAttribute('data-position', 'last')
      // A dotted key that resolves to nothing renders as itself, which would
      // put "chat.turn.working.thinking" on screen and still pass the check above.
      expect(working.textContent).not.toContain('chat.turn')
      // The sentence before the call was finished before the call was made:
      // no cursor blinks in it, and it already carries its time.
      expect(container.querySelector('[data-slot="markdown-cursor"]')).toBeNull()
      expect(container.querySelector('[data-slot="bubble-time"]')).not.toBeNull()
    })

    it('draws it in a group of its own for a turn that has produced nothing yet', () => {
      const turn = streamingTurn([])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      expect(marker(container)).toBeInTheDocument()
      expect(container.querySelectorAll('[data-slot="message-group-avatar"]')).toHaveLength(1)
    })

    it('gets out of the way once the answer starts arriving', () => {
      const turn = streamingTurn([text('let me check'), toolBlock('read_file'), text('here it is')])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      expect(marker(container)).not.toBeInTheDocument()
    })

    it('leaves a turn waiting on the user alone', () => {
      // That turn is not working, it is blocked — and the approval card it is
      // blocked on is the last thing on screen already.
      const turn = streamingTurn([text('need approval'), toolBlock('run_command', 'pending')])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      expect(turn.status).toBe('awaiting-input')
      expect(marker(container)).not.toBeInTheDocument()
    })
  })

  describe('attribution', () => {
    /** True when `later` comes after `earlier` in document order. */
    const follows = (earlier: Element, later: Element) =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING)

    it('names the model once, at the top of the run, with one avatar beside it', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        model_id: 'gpt-5.6-sol',
        _blocks: [text('let me check'), toolBlock('read_file'), text('the answer')],
        content: 'the answer',
        created_at: 10_000,
      })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} onRegenerate={vi.fn()} />)

      // One speaker, one avatar: the two bubbles are the same turn talking,
      // not two speakers.
      expect(container.querySelectorAll('[data-slot="message-group-avatar"]')).toHaveLength(1)
      const header = container.querySelector('[data-slot="message-group-header"]')!
      expect(header).toHaveTextContent('gpt-5.6-sol')
      // In the first bubble, above everything the run said.
      expect(follows(header, screen.getByText('let me check'))).toBe(true)
      expect(follows(header, screen.getByText('the answer'))).toBe(true)
    })

    it('draws one avatar for a run of answers from the same model', () => {
      const u = msg('user', { content: 'q' })
      const a1 = msg('assistant', { model_id: 'm', _blocks: [text('one')], content: 'one' })
      const a2 = msg('assistant', { model_id: 'm', _blocks: [text('two')], content: 'two' })
      const turn = buildTurns([u, a1, a2])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)

      expect(container.querySelectorAll('[data-slot="message-group-avatar"]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-slot="message-group-header"]')).toHaveLength(1)
    })

    it('cuts the run where the model changes', () => {
      const u = msg('user', { content: 'q' })
      const a1 = msg('assistant', { model_id: 'a', _blocks: [text('one')], content: 'one' })
      const a2 = msg('assistant', { model_id: 'b', _blocks: [text('two')], content: 'two' })
      const turn = buildTurns([u, a1, a2])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)

      expect(container.querySelectorAll('[data-slot="message-group-avatar"]')).toHaveLength(2)
      const headers = Array.from(container.querySelectorAll('[data-slot="message-group-header"]'))
      expect(headers.map((h) => h.textContent)).toEqual(['a', 'b'])
    })

    it('draws the date above a turn that opens a new day', () => {
      const day = 24 * 3600 * 1000
      const u = msg('user', { content: 'q', created_at: 10 * day + 1000 })
      const a = msg('assistant', { _blocks: [text('one')], content: 'one', created_at: 10 * day + 2000 })
      const turn = buildTurns([u, a])[0]

      const sameDay = render(<TurnItem turn={turn} conversationId={CONV} previousTurnEndedAt={10 * day + 500} />)
      expect(sameDay.container.querySelector('[data-slot="turn-date"]')).toBeNull()
      sameDay.unmount()

      const nextDay = render(<TurnItem turn={turn} conversationId={CONV} previousTurnEndedAt={9 * day + 500} />)
      expect(nextDay.container.querySelector('[data-slot="turn-date"]')).toBeInTheDocument()
    })
  })

  it('offers editing only when no stream is in flight', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
    const turn = buildTurns([u, a])[0]
    const onEdit = vi.fn()

    // Named rather than counted: ActionButton labels its button through
    // `aria-label`, so any other icon showing up in the footer cannot stand in
    // for the edit affordance.
    const { rerender } = render(<TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming />)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    rerender(<TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming={false} />)
    const edit = screen.getByRole('button', { name: 'Edit' })
    expect(edit).toHaveAttribute('data-slot', 'action-button')

    await userEvent.click(edit)
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('q')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })

  it('exposes the current rating as a pressed toggle state', async () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('a')], content: 'a', rating: 1 })
    const turn = buildTurns([u, a])[0]
    const onRate = vi.fn()
    render(<TurnItem turn={turn} conversationId={CONV} onRate={onRate} />)

    expect(screen.getByRole('button', { name: 'Good response' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Bad response' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Good response' }))
    expect(onRate).toHaveBeenCalledWith(a.id, null)
  })

  describe('branch pager', () => {
    it('stays hidden for a turn that was only answered once', () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      expect(container.querySelector('[data-slot="turn-branch-pager"]')).not.toBeInTheDocument()
    })

    it('shows which version of the answer is on screen', () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
      const turn = buildTurns([u, a])[0]
      useConversationStore.setState((s) => ({
        sessions: {
          ...s.sessions,
          [CONV]: {
            ...s.sessions[CONV],
            branches: {
              [a.id]: { message_id: a.id, index: 1, total: 3, sibling_ids: ['x', a.id, 'y'] },
            },
          },
        },
      }))

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      expect(screen.getByText('2/3')).toBeVisible()
      // Pins the slot the "stays hidden" test queries: without this the pager
      // could lose the attribute and both tests would still pass.
      expect(container.querySelector('[data-slot="turn-branch-pager"]')).toBeInTheDocument()
    })

    it('switches to the neighbouring version', async () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
      const turn = buildTurns([u, a])[0]
      const switchBranch = vi.fn()
      useConversationStore.setState((s) => ({
        switchBranch,
        sessions: {
          ...s.sessions,
          [CONV]: {
            ...s.sessions[CONV],
            branches: {
              [a.id]: { message_id: a.id, index: 1, total: 3, sibling_ids: ['x', a.id, 'y'] },
            },
          },
        },
      }))

      render(<TurnItem turn={turn} conversationId={CONV} />)
      await userEvent.click(screen.getByLabelText('Previous version'))
      expect(switchBranch).toHaveBeenCalledWith(CONV, 'x')

      await userEvent.click(screen.getByLabelText('Next version'))
      expect(switchBranch).toHaveBeenCalledWith(CONV, 'y')
    })

    /// Switching mid-stream would leave the running turn writing into a path
    /// that is no longer on screen.
    it('goes inert while a stream is in flight', () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
      const turn = buildTurns([u, a])[0]
      useConversationStore.setState((s) => ({
        sessions: {
          ...s.sessions,
          [CONV]: {
            ...s.sessions[CONV],
            branches: {
              [a.id]: { message_id: a.id, index: 1, total: 3, sibling_ids: ['x', a.id, 'y'] },
            },
          },
        },
      }))

      render(<TurnItem turn={turn} conversationId={CONV} streaming isLastTurn />)
      expect(screen.getByLabelText('Previous version')).toBeDisabled()
      expect(screen.getByLabelText('Next version')).toBeDisabled()
    })
  })

  describe('keyboard', () => {
    const key = (name: RegExp) => screen.getByRole('button', { name })

    it('draws a tool as a key under the bubble that introduced it, shut once it has returned', () => {
      render(<TurnItem turn={toolTurn()} conversationId={CONV} />)

      const k = key(/Write File/)
      expectCollapsed(k)
      // Nothing is folded away any more: both what the model said on the way
      // and what it concluded are on screen.
      expect(screen.getByText('let me check')).toBeVisible()
      expect(screen.getByText('the answer')).toBeVisible()

      // The key sits in the keyboard's row and its panel in the stack below —
      // two layers, so the Tab order runs every key before any panel.
      const keyboard = k.closest('[data-slot="bubble-keyboard"]')!
      expect(keyboard.querySelector('[data-slot="bubble-keyboard-row"]')).toContainElement(k)
      const panel = document.getElementById(k.getAttribute('aria-controls')!)!
      expect(keyboard.querySelector('[data-slot="bubble-keyboard-stack"]')).toContainElement(panel)
      expect(keyboard.querySelector('[data-slot="bubble-keyboard-row"]')).not.toContainElement(panel)
    })

    it('shows the duration in the footer rather than as a headline', () => {
      const { container } = render(<TurnItem turn={toolTurn()} conversationId={CONV} />)
      expect(container.querySelector('[data-slot="turn-duration"]')).toHaveTextContent('9s')
      expect(screen.queryByRole('button', { name: /Worked for/ })).toBeNull()
    })

    it('says nothing about duration when the clock reads nothing', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', { _blocks: [toolBlock('read_file'), text('done')], content: 'done', created_at: 1000 })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      // Never "0s" — equal timestamps mean unknown, not instant.
      expect(container.querySelector('[data-slot="turn-duration"]')).toBeNull()
    })

    it('opens the panel while the tool runs', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', { _blocks: [text('working'), toolBlock('read_file', 'running')], created_at: 5000 })
      const turn = buildTurns([u, a], { streaming: true })[0]

      render(<TurnItem turn={turn} conversationId={CONV} streaming isLastTurn />)
      expectExpanded(key(/Read File/))
      expect(screen.getByText('working')).toBeVisible()
    })

    it('opens the decision row for a call waiting on the user, one press from anywhere', async () => {
      const turn = toolTurn({ status: 'pending', conclusion: false })
      expect(turn.status).toBe('awaiting-input')

      render(<TurnItem turn={turn} conversationId={CONV} />)
      const k = key(/Write File/)
      expectExpanded(k)
      expect(screen.getByText('Allow')).toBeVisible()
      expect(screen.getByText('Deny')).toBeVisible()

      // Closing the panel by hand is allowed — and reopening it is the same
      // key, which stays marked as waiting the whole time.
      await userEvent.click(k)
      expectCollapsed(k)
      expect(k).toHaveAttribute('data-state', 'requires-action')
      await userEvent.click(k)
      expectExpanded(k)
      expect(screen.getByText('Allow')).toBeVisible()
    })

    it('closes the panel as soon as the tool returns', async () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const running = msg('assistant', {
        _blocks: [text('working'), toolBlock('write_file', 'running')],
        created_at: 5000,
      })
      const done = { ...running, _blocks: [text('working'), toolBlock('write_file'), text('done')], content: 'done' }

      const live = buildTurns([u, running], { streaming: true })[0]
      const settled = buildTurns([u, done])[0]

      const { rerender } = render(<TurnItem turn={live} conversationId={CONV} streaming isLastTurn />)
      expectExpanded(key(/Write File/))

      rerender(<TurnItem turn={settled} conversationId={CONV} isLastTurn />)
      // Not on a timer of its own: the reload that follows a turn re-keys
      // nothing here, so there is no second reflow to wait out. The wait is
      // React Aria's, which marks the panel hidden once its animation settles.
      await waitFor(() => expectCollapsed(key(/Write File/)))
      expect(screen.getByText('done')).toBeVisible()
    })

    /// A read that has returned is folded into a badge on the bubble's last
    /// line, and nothing of it — not the key, not the highlighted file behind
    /// it — is in the DOM until the badge is opened. That is what keeps a turn
    /// that read sixty files from being sixty closed panels each holding one.
    it('folds a finished read into a badge, and draws nothing of it until asked', async () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const running = msg('assistant', {
        _blocks: [text('working'), toolBlock('read_file', 'running')],
        created_at: 5000,
      })
      const finished: ContentBlock = {
        ...toolBlock('read_file'),
        data: { ...toolBlock('read_file').data, result: 'fn main() {}' },
      }
      const done = { ...running, _blocks: [text('working'), finished, text('done')], content: 'done' }

      const { rerender, container } = render(
        <TurnItem turn={buildTurns([u, running], { streaming: true })[0]} conversationId={CONV} streaming isLastTurn />,
      )
      expectExpanded(key(/Read File/))

      rerender(<TurnItem turn={buildTurns([u, done])[0]} conversationId={CONV} isLastTurn />)
      expect(screen.queryByRole('button', { name: /Read File/ })).toBeNull()
      expect(screen.queryByText('fn main() {}')).toBeNull()
      const badge = screen.getByRole('button', { name: 'Viewed 1 file' })
      expect(badge).toHaveAttribute('aria-expanded', 'false')
      // On the bubble's last line, with the time at the other end of it.
      const row = badge.closest('[data-slot="bubble-fold-row"]')!
      expect(row.querySelector('[data-slot="bubble-time"]')).not.toBeNull()
      expect(container.querySelector('[data-slot="bubble-fold-panel"]')).toBeNull()

      await userEvent.click(badge)
      expect(badge).toHaveAttribute('aria-expanded', 'true')
      const k = key(/Read File/)
      expectCollapsed(k)
      expect(container.querySelector('[data-slot="bubble-fold-panel"]')).toContainElement(k)
      await userEvent.click(k)
      expectExpanded(k)
      expect(screen.getByText('fn main() {}')).toBeVisible()

      // The choice is the reader's, kept where the panel choices are kept, so
      // the reload that follows a turn cannot snap it shut.
      expect(useConversationStore.getState().sessions[CONV]?.expandedPanels['fold:files:read_file-1']).toBe(true)
      await userEvent.click(badge)
      expect(screen.queryByRole('button', { name: /Read File/ })).toBeNull()
    })

    /// A sandbox escalation: the call ran, was refused, and comes back asking
    /// whether to retry without the sandbox. A reader who had closed the panel
    /// while it ran is not a reader who chose to ignore that question.
    it('reopens a panel the reader had closed when the call comes back asking', async () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const running = msg('assistant', {
        _blocks: [text('working'), toolBlock('run_command', 'running')],
        created_at: 5000,
      })
      const asking = { ...running, _blocks: [text('working'), toolBlock('run_command', 'pending')] }

      const { rerender } = render(
        <TurnItem turn={buildTurns([u, running], { streaming: true })[0]} conversationId={CONV} streaming isLastTurn />,
      )
      const k = key(/Run Command/)
      expectExpanded(k)
      await userEvent.click(k)
      expectCollapsed(k)

      rerender(
        <TurnItem turn={buildTurns([u, asking], { streaming: true })[0]} conversationId={CONV} streaming isLastTurn />,
      )
      expectExpanded(key(/Run Command/))
      expect(screen.getByText('Allow')).toBeVisible()
    })

    it('remembers a panel the user opened by hand', async () => {
      render(<TurnItem turn={toolTurn()} conversationId={CONV} />)

      const k = key(/Write File/)
      await userEvent.click(k)

      expectExpanded(k)
      expect(useConversationStore.getState().sessions[CONV]?.expandedPanels['write_file-1']).toBe(true)
    })

    it('says a crashed turn was cut off, in words of its own', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        turn_id: 't-dead',
        _blocks: [text('editing the file'), toolBlock('edit_file', 'orphaned')],
        created_at: 5000,
      })
      const turn = buildTurns([u, a], { crashedTurnIds: new Set(['t-dead']) })[0]
      expect(turn.status).toBe('crashed')

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)

      // Its own line, not the one a turn the user stopped gets: nobody stopped
      // this, and saying "stopped" about it is how a half-written file goes
      // unnoticed. Everything it was doing stays on screen above it.
      const status = container.querySelector('[data-slot="turn-status"]')!
      expect(status).toHaveAttribute('data-status', 'crashed')
      expect(status).toHaveTextContent('Cut off before it finished')
      expect(screen.getByText('editing the file')).toBeVisible()
    })

    /// The same turn without the record behind it. The transcript alone cannot
    /// tell this apart from a turn that simply ended on a tool call, which is
    /// why the record has to reach the front end for the case above to work.
    it('cannot tell a crashed turn from an ordinary one without the record', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        turn_id: 't-dead',
        _blocks: [text('editing the file'), toolBlock('edit_file', 'orphaned')],
        created_at: 5000,
      })
      const turn = buildTurns([u, a])[0]

      expect(turn.status).toBe('interrupted')
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      const status = container.querySelector('[data-slot="turn-status"]')!
      expect(status).toHaveAttribute('data-status', 'interrupted')
      expect(status).toHaveTextContent('Stopped')
    })

    it('says nothing about how a finished turn ended', () => {
      const { container } = render(<TurnItem turn={toolTurn()} conversationId={CONV} />)
      expect(container.querySelector('[data-slot="turn-status"]')).toBeNull()
    })
  })
})
