import { describe, expect, it } from 'vitest'
import { buildTurns, formatDuration, hasCollapsibleProcess } from '@/lib/turns'
import { reconcileTurns } from '@/hooks/use-turns'
import type { ContentBlock, Message, ToolCallDisplay } from '@/types'

let seq = 0

function msg(role: Message['role'], over: Partial<Message> = {}): Message {
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
    schema_version: 2,
    is_compact_summary: 0,
    ...over,
  }
}

function tool(name: string, status: ToolCallDisplay['status'] = 'completed'): ContentBlock {
  return { type: 'tool_call', data: { call_id: `${name}-1`, tool_name: name, arguments: '{}', status } }
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const thinking = (t: string): ContentBlock => ({ type: 'thinking', text: t })

describe('buildTurns — grouping', () => {
  it('returns nothing for an empty conversation', () => {
    expect(buildTurns([])).toEqual([])
  })

  it('groups every assistant row under the preceding user row', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('looking'), tool('read_file')] })
    const a2 = msg('assistant', { _blocks: [text('done')] })
    const turns = buildTurns([u, a1, a2])
    expect(turns).toHaveLength(1)
    expect(turns[0].id).toBe(u.id)
    expect(turns[0].assistantMessages).toHaveLength(2)
  })

  it('opens a headless turn when the conversation starts with an assistant row', () => {
    const a = msg('assistant', { _blocks: [text('hello')] })
    const turns = buildTurns([a])
    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage).toBeNull()
    expect(turns[0].id).toBe(a.id)
  })

  it('gives consecutive user rows a turn each', () => {
    const u1 = msg('user', { content: 'first' })
    const u2 = msg('user', { content: 'second' })
    const a = msg('assistant', { _blocks: [text('answering both')] })
    const turns = buildTurns([u1, u2, a])
    expect(turns).toHaveLength(2)
    expect(turns[0].assistantMessages).toHaveLength(0)
    expect(turns[0].status).toBe('empty')
    expect(turns[1].assistantMessages).toHaveLength(1)
  })

  it('ignores tool rows, which live inside _blocks', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('done')] })
    const t = msg('tool', { content: 'result', tool_call_id: 'x' })
    const turns = buildTurns([u, a, t])
    expect(turns[0].assistantMessages).toHaveLength(1)
  })
})

describe('buildTurns — result', () => {
  it('takes the text after the last tool call as the conclusion', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      _blocks: [thinking('hmm'), text('let me look'), tool('read_file'), text('here is the answer')],
      content: 'let me look\nhere is the answer',
    })
    const turn = buildTurns([u, a])[0]
    expect(turn.result?.text).toBe('here is the answer')
    expect(turn.result?.messageId).toBe(a.id)
    expect(turn.steps.map((s) => s.kind)).toEqual(['thinking', 'text', 'tool'])
    expect(turn.status).toBe('complete')
  })

  it('treats a turn with no tool calls as all conclusion', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [thinking('brief'), text('short answer')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.result?.text).toBe('short answer')
    expect(turn.summary.toolCount).toBe(0)
    // Reasoning alone is not a process worth collapsing — it collapses itself.
    expect(hasCollapsibleProcess(turn)).toBe(false)
  })

  it('collapses a turn whose only tool is still awaiting approval', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('need to run this'), tool('run_command', 'pending')] })
    const turn = buildTurns([u, a])[0]
    // The pending call moves to `pinned`, so a toolCount-only test would miss it.
    expect(turn.summary.toolCount).toBe(0)
    expect(hasCollapsibleProcess(turn)).toBe(true)
  })

  it('keeps mid-turn narration in the collapsed region', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('first, some context'), tool('read_file')] })
    const a2 = msg('assistant', { _blocks: [text('and here is the answer')] })
    const turn = buildTurns([u, a1, a2])[0]
    expect(turn.summary.textCount).toBe(1)
    expect(turn.result?.text).toBe('and here is the answer')
    expect(hasCollapsibleProcess(turn)).toBe(true)
  })

  it('reports interrupted when the turn ends on a tool call', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('working'), tool('run_command')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.result).toBeNull()
    expect(turn.status).toBe('interrupted')
    expect(hasCollapsibleProcess(turn)).toBe(true)
  })

  it('reports empty when the turn produced no text at all', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {})
    const turn = buildTurns([u, a])[0]
    expect(turn.result).toBeNull()
    expect(turn.status).toBe('empty')
  })

  it('pins a pending tool outside the collapsed region', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('need approval'), tool('run_command', 'pending')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('awaiting-input')
    expect(turn.pinned).toHaveLength(1)
    expect(turn.steps.some((s) => s.kind === 'tool')).toBe(false)
  })

  it('pins ask_user while it is still running', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('ask_user', 'running')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('awaiting-input')
    expect(turn.pinned).toHaveLength(1)
  })

  it('lets a resolved ask_user fall back into the collapsed region', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('ask_user', 'completed'), text('thanks')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.pinned).toHaveLength(0)
    expect(turn.steps.some((s) => s.kind === 'tool')).toBe(true)
    expect(turn.status).toBe('complete')
  })

  it('keeps update_todos in the collapsed region', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('update_todos'), text('on it')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.pinned).toHaveLength(0)
    expect(turn.summary.toolCount).toBe(1)
  })

  it('marks only the last turn as streaming', () => {
    const u1 = msg('user', { content: 'a' })
    const a1 = msg('assistant', { _blocks: [text('one')] })
    const u2 = msg('user', { content: 'b' })
    const a2 = msg('assistant', { _blocks: [text('two')] })
    const turns = buildTurns([u1, a1, u2, a2], { streaming: true })
    expect(turns[0].status).toBe('complete')
    expect(turns[1].status).toBe('streaming')
  })

  it('falls back to content when a row has no _blocks', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { content: 'plain answer' })
    const turn = buildTurns([u, a])[0]
    expect(turn.result?.text).toBe('plain answer')
  })
})

describe('buildTurns — duration', () => {
  it('is null when every row shares one timestamp', () => {
    const u = msg('user', { content: 'q', created_at: 1000 })
    const a = msg('assistant', { content: 'a', created_at: 1000 })
    expect(buildTurns([u, a])[0].durationMs).toBeNull()
  })

  it('measures from the user row to the last assistant row', () => {
    const u = msg('user', { content: 'q', created_at: 1000 })
    const a1 = msg('assistant', { content: 'x', created_at: 3000 })
    const a2 = msg('assistant', { content: 'y', created_at: 9000 })
    expect(buildTurns([u, a1, a2])[0].durationMs).toBe(8000)
  })

  it('is null for a headless turn with nothing to measure from', () => {
    const a = msg('assistant', { content: 'x', created_at: 5000 })
    expect(buildTurns([a])[0].durationMs).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formats sub-second, seconds, minutes and hours', () => {
    expect(formatDuration(400)).toBe('400ms')
    expect(formatDuration(46_000)).toBe('46s')
    expect(formatDuration(586_000)).toBe('9m 46s')
    expect(formatDuration(120_000)).toBe('2m')
    expect(formatDuration(3_720_000)).toBe('1h 2m')
    expect(formatDuration(3_600_000)).toBe('1h')
  })
})

describe('reconcileTurns', () => {
  it('keeps earlier turns stable when only the last one grows', () => {
    const u1 = msg('user', { content: 'a' })
    const a1 = msg('assistant', { _blocks: [text('one')] })
    const u2 = msg('user', { content: 'b' })
    const a2 = msg('assistant', { _blocks: [text('two')] })

    const first = buildTurns([u1, a1, u2, a2])
    // Same rows by reference except the last assistant, as immer would produce.
    const a2b = { ...a2, _blocks: [text('two, extended')] }
    const second = reconcileTurns(first, buildTurns([u1, a1, u2, a2b]))

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1].result?.text).toBe('two, extended')
  })

  it('returns the previous array when nothing moved', () => {
    const u = msg('user', { content: 'a' })
    const a = msg('assistant', { _blocks: [text('one')] })
    const first = buildTurns([u, a])
    expect(reconcileTurns(first, buildTurns([u, a]))).toBe(first)
  })

  it('rebuilds a turn whose streaming status flipped', () => {
    const u = msg('user', { content: 'a' })
    const a = msg('assistant', { _blocks: [text('one')] })
    const streaming = buildTurns([u, a], { streaming: true })
    const settled = reconcileTurns(streaming, buildTurns([u, a]))
    expect(settled[0]).not.toBe(streaming[0])
    expect(settled[0].status).toBe('complete')
  })
})
