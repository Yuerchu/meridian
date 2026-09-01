import { describe, expect, it } from 'vitest'
import { buildTurns, formatDuration, isBlockingCall, markQueued } from '@/lib/turns'
import { reconcileTurns } from '@/hooks/use-turns'
import type { ContentBlock, MessageViewModel, ToolCallDisplay } from '@/types'

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

function tool(name: string, status: ToolCallDisplay['status'] = 'completed'): ContentBlock {
  return { type: 'tool_call', data: { call_id: `${name}-1`, tool_name: name, arguments: '{}', status } }
}

const NESTED = { approval_id: 'n1', call_id: 'inner', tool_name: 'run_command', arguments: '{}' }

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const thinking = (t: string): ContentBlock => ({ type: 'thinking', text: t })
const sticker = (id: string): ContentBlock => ({ type: 'sticker', sticker_id: id, name: 'wave' })

describe('markQueued', () => {
  /// The whole reason it exists. All of a reply's calls are written into the
  /// assistant row before any of them runs, so a snapshot taken partway through
  /// hydrates every unanswered one as `running` — identical spinners, only one
  /// of them true.
  it('leaves the first unanswered call alone and queues the rest', () => {
    expect(markQueued(['running', 'running', 'running'])).toEqual([false, true, true])
  })

  it('does not count a call that already has an outcome', () => {
    expect(markQueued(['completed', 'error', 'denied', 'running', 'running'])).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
  })

  /// A call sitting in front of the user is the one holding everything up, so it
  /// is not queued — and it keeps its buttons, which a queued card has no use
  /// for.
  it('treats a call waiting on the user as the one in flight', () => {
    expect(markQueued(['pending', 'running'])).toEqual([false, true])
    expect(markQueued(['approved', 'running'])).toEqual([false, true])
  })

  /// Indexes have to line up with what the caller is rendering, which is a mix
  /// of text, thinking and tool steps.
  it('keeps its place past everything that is not a tool call', () => {
    expect(markQueued([null, 'running', null, 'running', null])).toEqual([false, false, false, true, false])
  })

  /// Nothing outstanding means nothing waiting, however many calls ran.
  it('queues nothing when every call has finished', () => {
    expect(markQueued(['completed', 'completed'])).toEqual([false, false])
    expect(markQueued([])).toEqual([])
  })

  /// A tool row that failed to write leaves its call unanswered while a later
  /// one has a result. Reading the earlier one as the live one is wrong — it
  /// already ran — but it is what the transcript says, and inventing a better
  /// answer here would mean guessing which of two unanswered calls is real.
  it('follows the transcript when a result went missing', () => {
    expect(markQueued(['running', 'completed', 'running'])).toEqual([false, false, true])
  })
})

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
  it('treats a successful sticker after its tool call as a complete sticker-only result', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('send_sticker'), sticker('s1')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('complete')
    expect(turn.result?.text).toBe('')
    expect(turn.result?.messageId).toBe(a.id)
    expect(turn.summary.toolCount).toBe(1)
  })

  it('takes the text after the last tool call as the conclusion', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      _blocks: [thinking('hmm'), text('let me look'), tool('read_file'), text('here is the answer')],
      content: 'let me look\nhere is the answer',
    })
    const turn = buildTurns([u, a])[0]
    expect(turn.result?.text).toBe('here is the answer')
    expect(turn.result?.messageId).toBe(a.id)
    expect(turn.summary).toEqual({ toolCount: 1, thinkingCount: 1, textCount: 2 })
    expect(turn.status).toBe('complete')
  })

  it('treats a turn with no tool calls as all conclusion', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [thinking('brief'), text('short answer')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.result?.text).toBe('short answer')
    expect(turn.summary.toolCount).toBe(0)
  })

  it('counts a tool that is still awaiting approval', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('need to run this'), tool('run_command', 'pending')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.summary.toolCount).toBe(1)
    expect(turn.status).toBe('awaiting-input')
  })

  it('takes only the last row as the conclusion when narration came before a call', () => {
    const u = msg('user', { content: 'q' })
    const a1 = msg('assistant', { _blocks: [text('first, some context'), tool('read_file')] })
    const a2 = msg('assistant', { _blocks: [text('and here is the answer')] })
    const turn = buildTurns([u, a1, a2])[0]
    expect(turn.summary.textCount).toBe(2)
    expect(turn.result?.text).toBe('and here is the answer')
  })

  it('reports interrupted when the turn ends on a tool call', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('working'), tool('run_command')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.result).toBeNull()
    expect(turn.status).toBe('interrupted')
  })

  it('reports empty when the turn produced no text at all', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {})
    const turn = buildTurns([u, a])[0]
    expect(turn.result).toBeNull()
    expect(turn.status).toBe('empty')
  })

  it('reads a pending tool as the turn waiting on the user', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [text('need approval'), tool('run_command', 'pending')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('awaiting-input')
    expect(turn.result).toBeNull()
  })

  /** The reported bug: "看下 main.py" rendered below the approval it announced.
   *  Pinning the blocked call left the narration as the text after the last
   *  remaining tool, which is exactly the shape of a conclusion. */
  it('keeps text that introduces a blocked call above it', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      _blocks: [
        text('let me look around'),
        tool('run_command'),
        text('now let me read main.py'),
        tool('read_file', 'pending'),
      ],
    })
    const turn = buildTurns([u, a])[0]

    // Nothing has concluded while the turn is blocked: the second line is
    // introducing the call, not answering the question.
    expect(turn.result).toBeNull()
    expect(turn.status).toBe('awaiting-input')
  })

  it('treats a running ask_user as waiting on the user', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('ask_user', 'running')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('awaiting-input')
  })

  it('stops waiting once ask_user has been answered', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('ask_user', 'completed'), text('thanks')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('complete')
    expect(turn.result?.text).toBe('thanks')
  })

  it('does not hold the turn open for update_todos', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('update_todos', 'running'), text('on it')] })
    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('complete')
    expect(turn.summary.toolCount).toBe(1)
  })

  it('names the three shapes of a call that blocks the turn', () => {
    const call = (over: Partial<ToolCallDisplay>): ToolCallDisplay => ({
      call_id: 'c',
      tool_name: 'run_command',
      arguments: '{}',
      status: 'running',
      ...over,
    })
    expect(isBlockingCall(call({ status: 'pending' }))).toBe(true)
    expect(isBlockingCall(call({ tool_name: 'run_agent', nested_approval: NESTED }))).toBe(true)
    expect(isBlockingCall(call({ tool_name: 'ask_user' }))).toBe(true)
    expect(isBlockingCall(call({}))).toBe(false)
    expect(isBlockingCall(call({ tool_name: 'ask_user', status: 'completed' }))).toBe(false)
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

/// A hosted ACP turn is written by `acp/session.rs`, and these are the two
/// shapes it can produce. They are here rather than in the Rust because what
/// went wrong was never visible from that side: the rows were well-formed and
/// the turn record said `done`, and the mistake only became a mistake when this
/// function read them.
describe('buildTurns — a hosted session writes rounds, not one row', () => {
  /// What flattening produced, and what it cost.
  ///
  /// Every round of a Claude Code turn landed on one assistant row, so the
  /// closing sentence sat *before* the tool calls instead of after them. There
  /// is no text past the last tool call, so there is no conclusion — and a turn
  /// with tools and no conclusion is `interrupted`. Every finished hosted turn
  /// with a single tool call in it was drawn as stopped, with its whole answer
  /// folded away as process.
  it('reads a flattened turn as interrupted, which is why it is not written that way', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', {
      _blocks: [text('Let me look.'), text('Here is the answer.'), tool('read_file')],
      content: 'Let me look.\nHere is the answer.',
    })

    const turn = buildTurns([u, a])[0]
    expect(turn.status).toBe('interrupted')
    expect(turn.result).toBeNull()
  })

  /// The shape it writes now: the prose that introduced a call stays with the
  /// call, the result is its own row, and what the agent said afterwards opens
  /// the next round. Identical to what a native turn produces.
  it('reads the round-per-row shape as a finished answer', () => {
    const u = msg('user', { content: 'q' })
    const first = msg('assistant', { _blocks: [text('Let me look.'), tool('read_file')] })
    const result = msg('tool', { content: 'file contents', tool_call_id: 'read_file-1' })
    const last = msg('assistant', { _blocks: [text('Here is the answer.')] })

    const turn = buildTurns([u, first, result, last])[0]
    expect(turn.status).toBe('complete')
    expect(turn.result?.text).toBe('Here is the answer.')
    expect(turn.summary.toolCount).toBe(1)
  })
})

describe('buildTurns — turns that never finished', () => {
  const crashed = (...ids: string[]) => ({ crashedTurnIds: new Set(ids) })

  /// The reading this status exists to prevent. A turn killed a moment after
  /// writing a paragraph leaves text sitting past its last tool call, which is
  /// indistinguishable from an answer — so it would collapse itself with a tick
  /// beside it and say nothing about the tool that may have run.
  it('outranks the trailing text that would otherwise read as an answer', () => {
    const u = msg('user', { content: 'q', turn_id: 't1' })
    const a = msg('assistant', {
      turn_id: 't1',
      _blocks: [tool('edit_file'), text('Done — I updated the file.')],
    })

    expect(buildTurns([u, a]).at(-1)!.status).toBe('complete')
    expect(buildTurns([u, a], crashed('t1')).at(-1)!.status).toBe('crashed')
  })

  /// Regenerating writes a new answer under the *same* question row, so the
  /// group ends up holding a question belonging to the turn that died and an
  /// answer belonging to the one that worked. Judging the group by any row that
  /// crashed marks the good answer as crashed, permanently.
  it('does not inherit a crash from the answer that was regenerated away', () => {
    const u = msg('user', { content: 'q', turn_id: 'dead' })
    const fresh = msg('assistant', { turn_id: 'good', _blocks: [text('this one worked')] })

    const turns = buildTurns([u, fresh], crashed('dead'))
    expect(turns.at(-1)!.status).toBe('complete')
  })

  /// And the case the question really does have to speak for: killed before the
  /// model said anything at all, so there is no answer row to ask.
  it('falls back to the question when the turn died before answering', () => {
    const u = msg('user', { content: 'q', turn_id: 'dead' })
    expect(buildTurns([u], crashed('dead')).at(-1)!.status).toBe('crashed')
  })

  /// A live stream is being watched right now; turn records are read when a
  /// conversation is opened or a turn ends. The fresher signal wins.
  it('yields to a stream that is actually in flight', () => {
    const u = msg('user', { content: 'q', turn_id: 't1' })
    const a = msg('assistant', { turn_id: 't1', _blocks: [text('...')] })
    const ctx = { streaming: true, ...crashed('t1') }
    expect(buildTurns([u, a], ctx).at(-1)!.status).toBe('streaming')
  })

  /// A turn cut off part way through a sentence has no tool calls, so the
  /// ordinary rule would read it as a finished answer that simply stops.
  it('outranks a text-only answer too', () => {
    const u = msg('user', { content: 'q', turn_id: 't1' })
    const a = msg('assistant', { turn_id: 't1', _blocks: [text('half a sen')] })

    expect(buildTurns([u, a]).at(-1)!.status).toBe('complete')
    expect(buildTurns([u, a], crashed('t1')).at(-1)!.status).toBe('crashed')
  })

  /// Rows written before turns were recorded carry no id, and inventing an
  /// answer about them is exactly what this feature is meant to stop.
  it('says nothing about rows that name no turn', () => {
    const u = msg('user', { content: 'q' })
    const a = msg('assistant', { _blocks: [tool('read_file')] })
    expect(buildTurns([u, a], crashed('t1')).at(-1)!.status).toBe('interrupted')
  })
})
