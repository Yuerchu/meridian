import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnItem } from './turn-item'
import { buildTurns } from '@/lib/turns'
import { useConversationStore } from '@/stores/conversation-store'
import i18n from '@/i18n'
import type { ContentBlock, Message, ToolCallDisplay } from '@/types'

vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn(),
    denyToolCall: vi.fn(),
    respondToAsk: vi.fn(),
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
  ({ type: 'tool_call', data: { call_id: `${name}-1`, tool_name: name, arguments: '{}', status } })

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

  it('reports usage summed over the whole turn', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('step')], content: 'step', input_tokens: 100, output_tokens: 20 })
    const a2 = msg('assistant', { _blocks: [text('done')], content: 'done', input_tokens: 300, output_tokens: 50 })
    const turn = buildTurns([u, a1, a2])[0]

    expect(turn.tokens).toEqual({ input: 400, output: 70 })
    render(<TurnItem turn={turn} conversationId={CONV} />)
    expect(screen.getByText(/tokens/)).toBeInTheDocument()
  })

  it('offers editing only when no stream is in flight', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('a')], content: 'a' })
    const turn = buildTurns([u, a])[0]
    const onEdit = vi.fn()

    // ActionButton puts its label in a tooltip that is absent until hover, so
    // the edit affordance is counted rather than queried by name.
    const countActions = (root: HTMLElement) =>
      root.querySelectorAll('[data-slot="action-button"]').length

    const { container, rerender } = render(
      <TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming />,
    )
    const whileStreaming = countActions(container)

    rerender(<TurnItem turn={turn} conversationId={CONV} onEdit={onEdit} streaming={false} />)
    expect(countActions(container)).toBe(whileStreaming + 1)
  })

  describe('collapsing', () => {
    it('leaves a tool-free turn uncollapsed', () => {
      const u = msg('user', { content: 'q' })
      const a = msg('assistant', { _blocks: [text('short answer')], content: 'short answer' })
      const turn = buildTurns([u, a])[0]

      const { container } = render(<TurnItem turn={turn} conversationId={CONV} />)
      expect(container.querySelector('[data-slot="turn-trigger"]')).not.toBeInTheDocument()
    })

    it('collapses a turn that used tools, showing its duration', () => {
      const turn = toolTurn()
      render(<TurnItem turn={turn} conversationId={CONV} />)

      const trigger = screen.getByRole('button', { name: /Worked for 9s/ })
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      // The conclusion stays outside the collapsed region.
      expect(screen.getByText('the answer')).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: /Working/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('stays open while waiting on the user, so the prompt is reachable', () => {
      const turn = toolTurn({ status: 'pending', conclusion: false })
      expect(turn.status).toBe('awaiting-input')

      render(<TurnItem turn={turn} conversationId={CONV} />)
      expect(screen.getByRole('button', { name: /Waiting for you/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('remembers a turn the user opened by hand', async () => {
      const turn = toolTurn()
      render(<TurnItem turn={turn} conversationId={CONV} />)

      await userEvent.click(screen.getByRole('button', { name: /Worked for/ }))

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
        expect(screen.getByRole('button', { name: /Working/ })).toHaveAttribute('aria-expanded', 'true')

        rerender(<TurnItem turn={settled} conversationId={CONV} isLastTurn />)
        // Deliberately not immediate: the post-stop reload lands first, so
        // collapsing right away would reflow twice.
        expect(screen.getByRole('button', { name: /Worked for/ })).toHaveAttribute('aria-expanded', 'true')

        await act(async () => { vi.advanceTimersByTime(400) })
        expect(screen.getByRole('button', { name: /Worked for/ })).toHaveAttribute('aria-expanded', 'false')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
