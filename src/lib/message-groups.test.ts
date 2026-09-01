import { describe, expect, it } from 'vitest'
import { awaitingModel, buildAssistantGroups, groupsPlainText } from '@/lib/message-groups'
import { buildTurns } from '@/lib/turns'
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
    context_items: [],
    ...over,
  }
}

function tool(name: string, status: ToolCallDisplay['status'] = 'completed'): ContentBlock {
  seq += 1
  return { type: 'tool_call', data: { call_id: `${name}-${seq}`, tool_name: name, arguments: '{}', status } }
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const thinking = (t: string): ContentBlock => ({ type: 'thinking', text: t })
const sticker = (id: string): ContentBlock => ({ type: 'sticker', sticker_id: id, name: 'wave' })

function groupsOf(rows: MessageViewModel[], opts?: { streaming?: boolean; oneBot?: boolean }) {
  const turn = buildTurns([msg('user', { content: 'q' }), ...rows], { streaming: opts?.streaming })[0]
  return { turn, groups: buildAssistantGroups(turn, { oneBot: opts?.oneBot }) }
}

describe('buildAssistantGroups — cutting a turn into bubbles', () => {
  it('returns nothing for a turn with no answer', () => {
    const turn = buildTurns([msg('user', { content: 'q' })])[0]
    expect(buildAssistantGroups(turn)).toEqual([])
  })

  /// The engine's rhythm: one row is prose then calls, so one row is one
  /// bubble with those calls on its keyboard.
  it('hangs a row’s calls off the prose that introduced them', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('let me look'), tool('read_file')] })])
    expect(groups).toHaveLength(1)
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('text')
    if (bubble.kind !== 'text') return
    expect(bubble.text).toBe('let me look')
    expect(bubble.tools.map((t) => t.tool_name)).toEqual(['read_file'])
  })

  it('opens a new bubble for prose that follows a call', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('first'), tool('read_file'), text('second')] })])
    const kinds = groups[0].bubbles.map((b) => (b.kind === 'text' ? b.text : b.kind))
    expect(kinds).toEqual(['first', 'second'])
  })

  it('joins consecutive text blocks into one bubble', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('one'), text('two')] })])
    expect(groups[0].bubbles).toHaveLength(1)
    const [bubble] = groups[0].bubbles
    expect(bubble.kind === 'text' && bubble.text).toBe('one\n\ntwo')
  })

  /// Reasoning is looked up from the keyboard under the answer it produced.
  it('attaches reasoning written before the prose to that prose’s bubble', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('hmm'), text('answer')] })])
    expect(groups[0].bubbles).toHaveLength(1)
    const [bubble] = groups[0].bubbles
    expect(bubble.kind === 'text' && bubble.thinking).toEqual(['hmm'])
  })

  /// A row that never got to prose: the model thought, then called. There is
  /// nothing to draw a rectangle around, so the keyboard stands alone.
  it('draws a call with no prose as a keyboard with nothing above it', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('hmm'), tool('read_file')] })])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('keyboard-only')
    if (bubble.kind !== 'keyboard-only') return
    expect(bubble.thinking).toEqual(['hmm'])
    expect(bubble.tools).toHaveLength(1)
  })

  it('gives reasoning with nothing after it a keyboard of its own', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('still thinking')] })], {
      streaming: true,
    })
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('keyboard-only')
    expect(bubble.isStreaming).toBe(true)
  })

  it('does not carry reasoning across a row boundary', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('a'), tool('read_file')] }),
      msg('assistant', { _blocks: [thinking('later'), text('b')] }),
    ])
    const [first, second] = groups[0].bubbles
    expect(first.kind === 'text' && first.thinking).toEqual([])
    expect(second.kind === 'text' && second.thinking).toEqual(['later'])
  })

  it('puts a sticker outside the bubbles', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [tool('send_sticker'), sticker('s1')] })])
    const kinds = groups[0].bubbles.map((b) => b.kind)
    expect(kinds).toEqual(['keyboard-only', 'sticker'])
    const s = groups[0].bubbles[1]
    expect(s.kind === 'sticker' && s.stickerId).toBe('s1')
  })
})

describe('buildAssistantGroups — groups', () => {
  it('cuts a group where the model changes', () => {
    const { groups } = groupsOf([
      msg('assistant', { model_id: 'a', _blocks: [text('one')] }),
      msg('assistant', { model_id: 'a', _blocks: [text('two')] }),
      msg('assistant', { model_id: 'b', _blocks: [text('three')] }),
    ])
    expect(groups.map((g) => g.modelId)).toEqual(['a', 'b'])
    expect(groups[0].bubbles).toHaveLength(2)
    expect(groups[0].messageIds).toHaveLength(2)
  })

  /// The corner treatment reads off these, and a sticker in the middle of a
  /// run breaks it: the picture is not a bubble, so the rectangles either side
  /// of it are not adjacent.
  it('assigns positions along each run of bubbles, skipping stickers', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('a'), tool('x'), text('b'), tool('y'), text('c')] }),
      msg('assistant', { _blocks: [sticker('s')] }),
      msg('assistant', { _blocks: [text('d')] }),
    ])
    expect(groups[0].bubbles.map((b) => b.position)).toEqual(['first', 'middle', 'last', 'single', 'single'])
  })

  it('marks only the last bubble of a streaming turn as the one being written', () => {
    const { groups } = groupsOf(
      [msg('assistant', { _blocks: [text('one'), tool('read_file')] }), msg('assistant', { _blocks: [text('two')] })],
      { streaming: true },
    )
    expect(groups[0].bubbles.map((b) => b.isStreaming)).toEqual([false, true])
  })

  it('marks nothing as streaming once the turn has settled', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('one')] })])
    expect(groups[0].bubbles[0].isStreaming).toBe(false)
  })
})

describe('buildAssistantGroups — queued calls', () => {
  /// `markQueued` is a fact about the turn's whole sequence, so the second
  /// bubble's first call is queued behind the first bubble's running one.
  it('queues across bubble boundaries', () => {
    const { groups } = groupsOf(
      [msg('assistant', { _blocks: [text('a'), tool('x', 'running'), text('b'), tool('y', 'running')] })],
      { streaming: true },
    )
    const [first, second] = groups[0].bubbles
    expect(first.kind === 'text' && first.queued).toEqual([false])
    expect(second.kind === 'text' && second.queued).toEqual([true])
  })
})

describe('buildAssistantGroups — OneBot', () => {
  it('splits a reply on the bubble protocol, and only there', () => {
    const rows = [msg('assistant', { _blocks: [text('one\n---\ntwo'), tool('x')] })]
    const plain = groupsOf(rows).groups[0].bubbles
    expect(plain).toHaveLength(1)
    const split = groupsOf(rows, { oneBot: true }).groups[0].bubbles
    expect(split.map((b) => (b.kind === 'text' ? b.text : b.kind))).toEqual(['one', 'two'])
    // The calls follow the last segment.
    expect(split[1].kind === 'text' && split[1].tools).toHaveLength(1)
    expect(split[0].kind === 'text' && split[0].tools).toHaveLength(0)
  })
})

describe('buildAssistantGroups — a search-only row', () => {
  /// Its summary text is the answer; the reasoning behind it would be a second
  /// one.
  it('hides the reasoning of a row that only searched', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('where'), tool('web_search')] })])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind === 'keyboard-only' && bubble.thinking).toEqual([])
  })

  it('keeps the reasoning when the row also spoke', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [thinking('where'), text('searching'), tool('web_search')] }),
    ])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind === 'text' && bubble.thinking).toEqual(['where'])
  })
})

describe('awaitingModel', () => {
  it('marks the wait between a tool returning and the model speaking', () => {
    const { turn } = groupsOf([msg('assistant', { _blocks: [text('a'), tool('x', 'running')] })], {
      streaming: true,
    })
    expect(awaitingModel(turn)).toBe(true)
  })

  it('marks a turn that has produced nothing yet', () => {
    const turn = buildTurns([msg('user', { content: 'q' })], { streaming: true })[0]
    expect(awaitingModel(turn)).toBe(true)
  })

  it('gets out of the way once the answer starts arriving', () => {
    const { turn } = groupsOf([msg('assistant', { _blocks: [tool('x'), text('here')] })], { streaming: true })
    expect(awaitingModel(turn)).toBe(false)
  })

  it('leaves visible reasoning to speak for itself', () => {
    const { turn } = groupsOf([msg('assistant', { _blocks: [tool('x'), thinking('hmm')] })], { streaming: true })
    expect(awaitingModel(turn)).toBe(false)
  })

  it('leaves a turn waiting on the user alone', () => {
    const { turn } = groupsOf([msg('assistant', { _blocks: [tool('x', 'pending')] })], { streaming: true })
    expect(awaitingModel(turn)).toBe(false)
  })

  it('is silent for a settled turn', () => {
    const { turn } = groupsOf([msg('assistant', { _blocks: [text('a'), tool('x')] })])
    expect(awaitingModel(turn)).toBe(false)
  })
})

describe('groupsPlainText', () => {
  it('joins every bubble’s prose and nothing else', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [thinking('t'), text('one'), tool('x'), text('two')] }),
      msg('assistant', { _blocks: [sticker('s'), text('three')] }),
    ])
    expect(groupsPlainText(groups)).toBe('one\n\ntwo\n\nthree')
  })
})
