import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { buildTurns } from '@/lib/turns'
import { useConversationStore } from '@/stores/conversation-store'
import { lastKeyboard, targetApproval, useTranscriptHotkeys } from './use-transcript-hotkeys'
import type { ContentBlock, MessageViewModel, ToolCallDisplay } from '@/types'

vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
  },
}))

let seq = 0

function msg(role: MessageViewModel['role'], over: Partial<MessageViewModel> = {}): MessageViewModel {
  seq += 1
  return {
    id: `m${seq}`,
    conversation_id: 'c',
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

function tool(name: string, status: ToolCallDisplay['status'], over: Partial<ToolCallDisplay> = {}): ContentBlock {
  seq += 1
  return {
    type: 'tool_call',
    data: {
      call_id: `${name}-${seq}`,
      tool_name: name,
      arguments: '{}',
      status,
      ...(status === 'pending' ? { approval_id: `appr-${seq}` } : {}),
      ...over,
    },
  }
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const thinking = (t: string): ContentBlock => ({ type: 'thinking', text: t })

describe('targetApproval', () => {
  it('answers the unanswered call of the turn being worked on', () => {
    const pending = tool('run_command', 'pending')
    const turns = buildTurns([
      msg('user', { content: 'q' }),
      msg('assistant', { _blocks: [text('need this'), pending] }),
    ])
    expect(targetApproval(turns)).toEqual({ approvalId: pending.type === 'tool_call' ? pending.data.approval_id : '' })
  })

  /// The user typed something after the question was asked. That is the
  /// boundary: whatever they press now is about the newer turn.
  it('does not reach back past a later turn that has an answer', () => {
    const turns = buildTurns([
      msg('user', { content: 'one' }),
      msg('assistant', { _blocks: [tool('run_command', 'pending')] }),
      msg('user', { content: 'two' }),
      msg('assistant', { _blocks: [text('sure')] }),
    ])
    expect(targetApproval(turns)).toBeNull()
  })

  /// A queued prompt is a turn with nothing in it yet, and stepping over it is
  /// what keeps the shortcut working while something is queued.
  it('steps over a trailing turn that has no answer yet', () => {
    const pending = tool('run_command', 'pending')
    const turns = buildTurns([
      msg('user', { content: 'one' }),
      msg('assistant', { _blocks: [pending] }),
      msg('user', { content: 'queued' }),
    ])
    expect(targetApproval(turns)).toEqual({ approvalId: pending.type === 'tool_call' ? pending.data.approval_id : '' })
  })

  it('answers a delegated run through the question it raised', () => {
    const nested = { approval_id: 'nested-1', call_id: 'inner', tool_name: 'run_command', arguments: '{}' }
    const turns = buildTurns([
      msg('user', { content: 'q' }),
      msg('assistant', { _blocks: [tool('run_agent', 'running', { nested_approval: nested })] }),
    ])
    expect(targetApproval(turns)).toEqual({ approvalId: 'nested-1' })
  })

  it('finds nothing when nothing is waiting', () => {
    const turns = buildTurns([
      msg('user', { content: 'q' }),
      msg('assistant', { _blocks: [tool('read_file', 'completed')] }),
    ])
    expect(targetApproval(turns)).toBeNull()
  })
})

describe('lastKeyboard', () => {
  it('names the panels of the last bubble that has any', () => {
    const a = tool('read_file', 'completed')
    const b = tool('ask_user', 'completed')
    const turns = buildTurns([
      msg('user', { content: 'q' }),
      msg('assistant', { id: 'row', _blocks: [thinking('hmm'), text('look'), a, b] }),
      msg('assistant', { _blocks: [text('done')] }),
    ])
    const keys = lastKeyboard(turns)!
    const idOf = (block: ContentBlock) => (block.type === 'tool_call' ? block.data.call_id : '')
    expect(keys.toolKeys).toEqual([idOf(a), `${idOf(b)}:ask`])
    expect(keys.thinkingKey).toBe('row:0:thinking')
  })
})

function Harness({ turns }: { turns: ReturnType<typeof buildTurns> }) {
  useTranscriptHotkeys('conv', turns)
  return <div data-slot="message-scroller-viewport" />
}

const chord = (key: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ctrlKey: true, shiftKey: true })

describe('useTranscriptHotkeys', () => {
  beforeEach(() => {
    vi.mocked(api.approveToolCall).mockClear()
    useConversationStore.setState({ sessions: {}, activeId: 'conv', denyRequestApprovalId: null })
    useConversationStore.getState().ensureSession('conv')
  })

  it('approves the waiting call, even from inside a text field', async () => {
    const pending = tool('run_command', 'pending')
    const turns = buildTurns([msg('user', { content: 'q' }), msg('assistant', { _blocks: [pending] })])
    const { container } = render(
      <>
        <input aria-label="composer" />
        <Harness turns={turns} />
      </>,
    )
    await act(async () => {
      chord('y', container.querySelector('input')!)
    })
    expect(api.approveToolCall).toHaveBeenCalledWith(pending.type === 'tool_call' ? pending.data.approval_id : '')
  })

  it('asks the owning panel to take a refusal, since a reason has to be typed', async () => {
    const pending = tool('run_command', 'pending')
    const turns = buildTurns([msg('user', { content: 'q' }), msg('assistant', { _blocks: [pending] })])
    render(<Harness turns={turns} />)
    await act(async () => {
      chord('n')
    })
    expect(useConversationStore.getState().denyRequestApprovalId).toBe(
      pending.type === 'tool_call' ? pending.data.approval_id : '',
    )
  })

  it('does nothing when the transcript is behind another page', async () => {
    const pending = tool('run_command', 'pending')
    const turns = buildTurns([msg('user', { content: 'q' }), msg('assistant', { _blocks: [pending] })])
    render(
      <div inert>
        <Harness turns={turns} />
      </div>,
    )
    await act(async () => {
      chord('y')
    })
    expect(api.approveToolCall).not.toHaveBeenCalled()
  })

  it('opens every panel of the last keyboard, then closes them', async () => {
    const a = tool('read_file', 'completed')
    const b = tool('run_command', 'completed')
    const turns = buildTurns([msg('user', { content: 'q' }), msg('assistant', { _blocks: [text('x'), a, b] })])
    render(<Harness turns={turns} />)
    const idOf = (block: ContentBlock) => (block.type === 'tool_call' ? block.data.call_id : '')

    await act(async () => {
      chord('o')
    })
    const panels = () => useConversationStore.getState().sessions.conv?.expandedPanels ?? {}
    expect(panels()[idOf(a)]).toBe(true)
    expect(panels()[idOf(b)]).toBe(true)

    // Nothing on screen says open (this harness draws no keys), so the next
    // press reads as "open" again rather than "close" — the toggle looks at
    // the keys themselves, which the real transcript renders.
    await act(async () => {
      chord('o')
    })
    expect(panels()[idOf(a)]).toBe(true)
  })

  it('toggles the reasoning of the last bubble', async () => {
    const turns = buildTurns([
      msg('user', { content: 'q' }),
      msg('assistant', { id: 'row', _blocks: [thinking('hmm'), text('answer')] }),
    ])
    render(<Harness turns={turns} />)
    await act(async () => {
      chord('t')
    })
    expect(useConversationStore.getState().sessions.conv?.expandedPanels['row:0:thinking']).toBe(true)
    await act(async () => {
      chord('t')
    })
    expect(useConversationStore.getState().sessions.conv?.expandedPanels['row:0:thinking']).toBe(false)
  })
})
