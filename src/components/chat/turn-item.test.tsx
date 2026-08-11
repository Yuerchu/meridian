import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnItem } from './turn-item'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import { buildTurns } from '@/lib/turns'
import { useConversationStore } from '@/stores/conversation-store'
import i18n from '@/i18n'
import type { ContentBlock, Message, ToolCallDisplay } from '@/types'

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

function msg(role: Message['role'], over: Partial<Message> = {}): Message {
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
    schema_version: 2,
    is_compact_summary: 0,
    ...over,
  }
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const toolBlock = (name: string, status: ToolCallDisplay['status'] = 'completed'): ContentBlock =>
  ({
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

/** A turn with tool calls, which is what gets the collapse treatment. */
function toolTurn(over: { status?: ToolCallDisplay['status']; conclusion?: boolean } = {}) {
  const u = msg('user', { content: 'q', created_at: 1000 })
  const blocks: ContentBlock[] = [
    text('let me check'),
    toolBlock('read_file', over.status ?? 'completed'),
  ]
  if (over.conclusion !== false) blocks.push(text('the answer'))
  const a = msg('assistant', { _blocks: blocks, content: 'the answer', created_at: 10_000 })
  return buildTurns([u, a])[0]
}

describe('TurnItem', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    useConversationStore.setState({ sessions: {} })
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

  it('gives the intermediate rows no actions of their own', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('let me check')], content: 'let me check' })
    const a2 = msg('assistant', { _blocks: [text('the answer')], content: 'the answer' })
    const turn = buildTurns([u, a1, a2])[0]

    const { container } = render(
      <TurnItem turn={turn} conversationId={CONV} onDelete={vi.fn()} onRegenerate={vi.fn()} onRate={vi.fn()} />,
    )

    const footers = container.querySelectorAll('[data-slot="message-footer"]')
    // One for the question bubble, one for the conclusion — nothing on the step.
    expect(footers).toHaveLength(2)
  })

  it('moves the actions to the last row when the turn was cut short', () => {
    const turn = toolTurn({ conclusion: false })
    expect(turn.status).toBe('interrupted')

    const { container } = render(
      <TurnItem turn={turn} conversationId={CONV} onDelete={vi.fn()} onRegenerate={vi.fn()} />,
    )
    // Still reachable: an interrupted turn with no way to retry would be a trap.
    expect(container.querySelectorAll('[data-slot="message-footer"]')).toHaveLength(2)
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

  describe('activity marker', () => {
    const streamingTurn = (blocks: ContentBlock[]) => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', { _blocks: blocks, created_at: 10_000 })
      return buildTurns([u, a], { streaming: true })[0]
    }
    const marker = (root: HTMLElement) => root.querySelector('[data-slot="marker"][role="status"]')

    it('marks the wait between a tool returning and the model speaking', () => {
      const turn = streamingTurn([text('let me check'), toolBlock('read_file')])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      // Where the user is looking. The headline saying the same thing is at the
      // top of the turn, which by now is far above the viewport.
      expect(marker(container)).toBeInTheDocument()
      // A dotted key that resolves to nothing renders as itself, which would
      // put "chat.turn.working.thinking" on screen and still pass the check above.
      expect(marker(container)!.textContent).not.toContain('chat.turn')
    })

    it('marks a turn that has produced nothing yet', () => {
      const turn = streamingTurn([])
      const { container } = render(<TurnItem turn={turn} conversationId={CONV} isLastTurn streaming />)
      expect(marker(container)).toBeInTheDocument()
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

    it('opens a collapsed turn with the avatar and the model that answered', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        model_id: 'gpt-5.6-sol',
        _blocks: [text('let me check'), toolBlock('read_file'), text('the answer')],
        content: 'the answer',
        created_at: 10_000,
      })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} onRegenerate={vi.fn()} />)

      // One speaker, one avatar: the conclusion below the collapsed steps is the
      // same turn talking, not a second one.
      const avatars = container.querySelectorAll('[data-slot="message-avatar"]')
      expect(avatars).toHaveLength(1)

      // Both sit above the process line, so the avatar has something to name.
      const trigger = container.querySelector('[data-slot="turn-trigger"]')!
      expect(follows(avatars[0], trigger)).toBe(true)
      expect(follows(screen.getByText('gpt-5.6-sol'), trigger)).toBe(true)
    })

    it('draws one avatar for a run of answers from the same model', () => {
      const u = msg('user', { content: 'q' })
      const a1 = msg('assistant', { model_id: 'm', _blocks: [text('one')], content: 'one' })
      const a2 = msg('assistant', { model_id: 'm', _blocks: [text('two')], content: 'two' })
      const turn = buildTurns([u, a1, a2])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)

      const avatars = container.querySelectorAll('[data-slot="message-avatar"]')
      expect(avatars).toHaveLength(1)
      expect(follows(avatars[0], screen.getByText('two'))).toBe(true)
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
    const { rerender } = render(
      <TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming />,
    )
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    rerender(<TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming={false} />)
    const edit = screen.getByRole('button', { name: 'Edit' })
    expect(edit).toHaveAttribute('data-slot', 'action-button')

    await userEvent.click(edit)
    expect(screen.getByDisplayValue('q')).toBeVisible()
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

  describe('collapsing', () => {
    it('leaves a tool-free turn uncollapsed', () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('short answer')], content: 'short answer' })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      expect(container.querySelector('[data-slot="turn-trigger"]')).not.toBeInTheDocument()
      // The other half of that claim: a turn that does collapse is found by the
      // same selector, so renaming the slot cannot quietly retire the check above.
      const { container: withTools } = render(<TurnItem turn={toolTurn()} conversationId={CONV} />)
      expect(withTools.querySelector('[data-slot="turn-trigger"]')).toBeInTheDocument()
    })

    it('collapses a turn that used tools, showing its duration', () => {
      const turn = toolTurn()
      render(<TurnItem turn={turn} conversationId={CONV} />)

      const trigger = screen.getByRole('button', { name: /Worked for 9s/ })
      expectCollapsed(trigger)
      // The narration that introduced the tool call is inside the collapsed
      // region — rendered, but not on screen.
      expect(screen.getByText('let me check')).not.toBeVisible()
      // The conclusion stays outside it.
      expect(screen.getByText('the answer')).toBeVisible()
    })

    it('falls back to a step count when timestamps carry no duration', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        _blocks: [toolBlock('read_file'), text('done')],
        content: 'done',
        created_at: 1000,
      })
      const turn = buildTurns([u, a])[0]

      render(<TurnItem turn={turn} conversationId={CONV} />)
      // Never "0s" — equal timestamps mean unknown, not instant.
      expect(screen.getByRole('button', { name: /steps/ })).toBeInTheDocument()
    })

    it('holds itself open while the turn is still running', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', { _blocks: [text('working'), toolBlock('read_file', 'running')], created_at: 5000 })
      const turn = buildTurns([u, a], { streaming: true })[0]

      render(<TurnItem turn={turn} conversationId={CONV} streaming isLastTurn />)
      expectExpanded(screen.getByRole('button', { name: /Working/ }))
      expect(screen.getByText('working')).toBeVisible()
    })

    it('stays open while waiting on the user, so the prompt is reachable', async () => {
      const turn = toolTurn({ status: 'pending', conclusion: false })
      expect(turn.status).toBe('awaiting-input')

      render(<TurnItem turn={turn} conversationId={CONV} />)
      const trigger = screen.getByRole('button', { name: /Waiting for you/ })
      expectExpanded(trigger)

      // What actually makes the prompt reachable is that the blocked call sits
      // outside the panel: collapsing the turn by hand must not take the
      // approval buttons with it.
      await userEvent.click(trigger)
      expectCollapsed(trigger)
      expect(screen.getByText('Allow')).toBeVisible()
      expect(screen.getByText('Deny')).toBeVisible()
    })

    /// A turn that stopped without ever reaching an ending. Collapsed it looks
    /// like a short answer, and what it was doing when it stopped — which may be
    /// a half-written file — is exactly what is inside the panel.
    it('holds a crashed turn open, and says so in words of its own', () => {
      const u = msg('user', { content: 'q', created_at: 1000 })
      const a = msg('assistant', {
        turn_id: 't-dead',
        _blocks: [text('editing the file'), toolBlock('edit_file', 'orphaned')],
        created_at: 5000,
      })
      const turn = buildTurns([u, a], { crashedTurnIds: new Set(['t-dead']) })[0]
      expect(turn.status).toBe('crashed')

      render(<TurnItem turn={turn} conversationId={CONV} />)

      // Its own headline, not the one a turn the user stopped gets: nobody
      // stopped this, and saying "stopped" about it is how a half-written file
      // goes unnoticed.
      const trigger = screen.getByRole('button', { name: /Cut off before it finished/ })
      expectExpanded(trigger)
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
    })

    it('remembers a turn the user opened by hand', async () => {
      const turn = toolTurn()
      render(<TurnItem turn={turn} conversationId={CONV} />)

      const trigger = screen.getByRole('button', { name: /Worked for/ })
      await userEvent.click(trigger)

      expectExpanded(trigger)
      expect(screen.getByText('let me check')).toBeVisible()
      expect(useConversationStore.getState().sessions[CONV]?.expandedTurns[turn.id]).toBe(true)
    })

    it('collapses shortly after the stream ends', async () => {
      vi.useFakeTimers()
      try {
        const streamingTurn = (() => {
          const u = msg('user', { content: 'q', created_at: 1000 })
          const a = msg('assistant', {
            _blocks: [text('working'), toolBlock('read_file'), text('done')],
            content: 'done',
            created_at: 9000,
          })
          return { u, a }
        })()

        const live = buildTurns([streamingTurn.u, streamingTurn.a], { streaming: true })[0]
        const settled = buildTurns([streamingTurn.u, streamingTurn.a])[0]

        const { rerender } = render(
          <TurnItem turn={live} conversationId={CONV} streaming isLastTurn />,
        )
        expectExpanded(screen.getByRole('button', { name: /Working/ }))

        rerender(<TurnItem turn={settled} conversationId={CONV} isLastTurn />)
        // Deliberately not immediate: the post-stop reload lands first, so
        // collapsing right away would reflow twice.
        expectExpanded(screen.getByRole('button', { name: /Worked for/ }))

        await act(async () => { vi.advanceTimersByTime(400) })
        expectCollapsed(screen.getByRole('button', { name: /Worked for/ }))
        expect(screen.getByText('working')).not.toBeVisible()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
