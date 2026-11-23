import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TurnItem } from '@/components/chat/turn-item'
import { BUBBLE_RUN_GAP } from '@/components/ui/bubble'
import { buildTurns } from '@/lib/turns'
import i18n from '@/i18n'
import type { ContentBlock, MessageViewModel, ToolCallDisplay } from '@/types'

vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
    respondToAsk: vi.fn().mockResolvedValue(undefined),
  },
}))

/**
 * One distance between any two adjacent blocks of a run.
 *
 * jsdom has no layout, so this measures the thing that decides the layout:
 * every container that stacks the members of a run — the run itself, each
 * bubble, a bare keyboard — spaces them with `BUBBLE_RUN_GAP` and nothing
 * else, and nothing it stacks carries a vertical margin that would add to it.
 * Two spacings were the bug: `gap-1` inside a bubble beside `gap-0.5` between
 * bubbles. The real-browser measurement is in the playground (see the report
 * of the change that added this); this is the part that can fail in CI.
 */

let seq = 0
function msg(role: MessageViewModel['role'], over: Partial<MessageViewModel> = {}): MessageViewModel {
  seq += 1
  return {
    id: `s${seq}`,
    conversation_id: 'c',
    role,
    content: '',
    provider_id: null,
    model_id: 'gpt',
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
    tool_diffs: null,
    context_items: [],
    tool_media: [],
    ttft_ms: null,
    generation_ms: null,
    ...over,
  }
}

function call(name: string, args: object, result = 'ok'): ContentBlock {
  seq += 1
  const data: ToolCallDisplay = {
    call_id: `${name}-${seq}`,
    tool_name: name,
    arguments: JSON.stringify(args),
    status: 'completed',
    result,
  }
  return { type: 'tool_call', data }
}
const text = (t: string): ContentBlock => ({ type: 'text', text: t })

/** Every combination the report asked about: prose → its call (inside one
 *  bubble), call → the next bubble's prose, a bare keyboard, an answered
 *  question, a summary of folded reads, prose → prose. */
function mixedTurn() {
  return buildTurns([
    msg('user', { content: 'q' }),
    msg('assistant', { _blocks: [text('剪一下。'), call('write_file', { path: 'a.ts', content: 'x' })] }),
    msg('assistant', { _blocks: [call('ask_user', { questions: [{ id: 'a', question: 'ok?' }] }, '{"a":"yes"}')] }),
    msg('assistant', { _blocks: [call('read_file', { path: 'b.ts' }, 'b')] }),
    msg('assistant', {
      _blocks: [text('中间。'), call('edit_file', { file_path: 'c.ts', old_string: 'a', new_string: 'b' })],
    }),
    msg('assistant', { _blocks: [text('清完了。')] }),
  ])[0]
}

const GAP = /^(?:[a-z-]+:)*gap-/
const VERTICAL_MARGIN = /^(?:[a-z-]+:)*-?(?:m|my|mt|mb)-(?:\d|auto|px|\[)/

function classes(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('spacing inside a run', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('stacks every member of a run with the one run gap', () => {
    const { container } = render(<TurnItem turn={mixedTurn()} conversationId="c" />)
    const stacks = [
      ...container.querySelectorAll(
        '[data-slot="message-group-bubbles"], [data-slot="bubble"], [data-slot="message-group"][data-align="end"]',
      ),
    ]
    // The run, the user's column, and at least one bubble of each shape.
    expect(stacks.length).toBeGreaterThan(5)
    expect(container.querySelector('[data-slot="bubble"][data-variant="tools-only"]')).not.toBeNull()
    for (const stack of stacks) {
      const cls = classes(stack)
      const gaps = cls.filter((c) => GAP.test(c))
      expect({ slot: stack.getAttribute('data-slot'), hasRunGap: cls.includes(BUBBLE_RUN_GAP), gaps }).toEqual({
        slot: stack.getAttribute('data-slot'),
        hasRunGap: true,
        gaps: [],
      })
    }
  })

  it('lets nothing in a run add a vertical margin to that gap', () => {
    const { container } = render(<TurnItem turn={mixedTurn()} conversationId="c" />)
    const members = [
      ...container.querySelectorAll('[data-slot="message-group-bubbles"] > *, [data-slot="bubble"] > *'),
    ].filter((el) => el.getAttribute('data-slot') !== 'assistant-sticker')
    expect(members.length).toBeGreaterThan(5)
    for (const el of members) {
      const margins = classes(el).filter((c) => VERTICAL_MARGIN.test(c))
      expect({ slot: el.getAttribute('data-slot'), margins }).toEqual({
        slot: el.getAttribute('data-slot'),
        margins: [],
      })
    }
  })

  it('closes a run of questions up to the same gap', () => {
    // `--space-6` (24px) between the parts of a turn, `-22px` taken
    // back for a continuing question: 2px, matching `.m-bubble-run-gap`.
    const turn = buildTurns([msg('user', { content: 'again' })])[0]
    const { container } = render(<TurnItem turn={turn} conversationId="c" questionPosition="last" />)
    const question = container.querySelector('[data-slot="turn-question"]')
    const turnRoot = container.querySelector('[data-slot="turn"]')
    expect(turnRoot).toHaveClass('m-turn')
    expect(question).toHaveClass('m-turn__question')
    expect(question).toHaveAttribute('data-continues-run', 'true')

    const tokensCss = readFileSync(resolve(__dirname, '../yuerchu-ui/styles/tokens.css'), 'utf8')
    const space6Match = /--space-6:\s*(\d+)px/.exec(tokensCss)
    expect(space6Match).not.toBeNull()
    const turnCss = readFileSync(resolve(__dirname, '../chat/turn-item.css'), 'utf8')
    expect(turnCss).toMatch(/\.m-turn\s*\{[^}]*gap:\s*var\(--space-6\)/)
    const pullMatch = /\.m-turn__question\[data-continues-run='true'\]\s*\{[^}]*margin-top:\s*-(\d+)px/.exec(turnCss)
    expect(pullMatch).not.toBeNull()
    const bubbleCss = readFileSync(resolve(__dirname, 'bubble.css'), 'utf8')
    const runGapMatch = new RegExp(`\\.${BUBBLE_RUN_GAP}\\s*\\{[^}]*gap:\\s*(\\d+)px`).exec(bubbleCss)
    expect(runGapMatch).not.toBeNull()
    expect(Number(space6Match![1]) - Number(pullMatch![1])).toBe(Number(runGapMatch![1]))
  })
})
