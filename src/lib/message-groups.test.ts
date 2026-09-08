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
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('let me look'), tool('write_file')] })])
    expect(groups).toHaveLength(1)
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('text')
    if (bubble.kind !== 'text') return
    expect(bubble.text).toBe('let me look')
    expect(bubble.tools.map((t) => t.tool_name)).toEqual(['write_file'])
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
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('hmm'), tool('write_file')] })])
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

describe('buildAssistantGroups — folding the low-risk calls into badges', () => {
  const read = (path: string): ContentBlock => {
    seq += 1
    return {
      type: 'tool_call',
      data: {
        call_id: `read-${seq}`,
        tool_name: 'read_file',
        arguments: JSON.stringify({ path }),
        status: 'completed',
      },
    }
  }
  const foldsOf = (b: ReturnType<typeof buildAssistantGroups>[number]['bubbles'][number]) =>
    'folded' in b ? b.folded.map((f) => `${f.kind}:${f.count}`) : null

  /// A finished read, search or command is not something the reader has to
  /// see one by one. It comes off the keyboard and on to a badge, in a fixed
  /// order: commands, then files, then searches.
  it('folds finished reads, searches and commands off the keyboard', () => {
    const { groups } = groupsOf([
      msg('assistant', {
        _blocks: [text('look'), tool('search_files'), tool('read_file'), tool('run_command'), tool('read_file')],
      }),
    ])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('text')
    expect(bubble.kind === 'text' && bubble.tools).toEqual([])
    expect(foldsOf(bubble)).toEqual(['commands:1', 'files:2', 'searches:1'])
  })

  /// Anything still waiting, running, refused or failed stays a key — each of
  /// those is something to look at or act on, and a badge hides exactly that.
  it('keeps every unfinished or failed call as a key', () => {
    const { groups } = groupsOf([
      msg('assistant', {
        _blocks: [
          text('look'),
          tool('read_file', 'running'),
          tool('run_command', 'pending'),
          tool('run_command', 'error'),
          tool('read_file', 'denied'),
          tool('write_file'),
          tool('web_search'),
        ],
      }),
    ])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind === 'text' && bubble.tools.map((t) => t.tool_name)).toEqual([
      'read_file',
      'run_command',
      'run_command',
      'read_file',
      'write_file',
      'web_search',
    ])
    expect(foldsOf(bubble)).toEqual([])
  })

  it('counts files, not reads', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('look'), read('a.rs'), read('a.rs'), read('b.rs'), tool('read_file')] }),
    ])
    // Two distinct paths, plus one read whose path cannot be made out.
    expect(foldsOf(groups[0].bubbles[0])).toEqual(['files:3'])
  })

  /// A row that was nothing but reads joins the bubble before it: the reads
  /// were made after that prose, and a bubble of badges alone says less than
  /// a badge under the sentence that led to them.
  it('joins a row of nothing but folded calls to the prose before it', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('look')] }),
      msg('assistant', { _blocks: [read('a.rs'), tool('run_command')] }),
      msg('assistant', { _blocks: [read('b.rs')] }),
      msg('assistant', { _blocks: [text('done')] }),
    ])
    const kinds = groups[0].bubbles.map((b) => b.kind)
    expect(kinds).toEqual(['text', 'text'])
    expect(foldsOf(groups[0].bubbles[0])).toEqual(['commands:1', 'files:2'])
  })

  /// Badges sit under the prose and keys sit under the badges. Folding a
  /// later row's reads into a bubble that already has a key would draw them
  /// above a call they were made after — so they stand on their own instead.
  it('does not join reads to a bubble that has keys of its own', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('look'), tool('write_file')] }),
      msg('assistant', { _blocks: [read('a.rs')] }),
    ])
    const kinds = groups[0].bubbles.map((b) => b.kind)
    expect(kinds).toEqual(['text', 'summary'])
    expect(foldsOf(groups[0].bubbles[1])).toEqual(['files:1'])
  })

  /// The thought at the head of the bubble, the reads it led to at its foot:
  /// a fold-only row after a reasoning-only row is that bubble's badge line,
  /// not a bubble of its own.
  it('joins reads to a bubble that is only reasoning', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [thinking('where is it')] }),
      msg('assistant', { _blocks: [read('a.rs'), read('b.rs')] }),
    ])
    const kinds = groups[0].bubbles.map((b) => b.kind)
    expect(kinds).toEqual(['keyboard-only'])
    expect(foldsOf(groups[0].bubbles[0])).toEqual(['files:2'])
  })

  it('opens a run of reads with no prose before it as a summary bubble', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [read('a.rs'), read('b.rs')] }),
      msg('assistant', { _blocks: [text('found it')] }),
    ])
    expect(groups[0].bubbles.map((b) => b.kind)).toEqual(['summary', 'text'])
    expect(groups[0].bubbles.map((b) => b.position)).toEqual(['first', 'last'])
  })

  /// A keyboard that keeps a key — reasoning, a write — keeps its badges too,
  /// beside that key, rather than moving them to another bubble.
  it('keeps badges on a keyboard that still has keys', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [thinking('hmm'), read('a.rs'), tool('write_file')] })])
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('keyboard-only')
    expect(bubble.kind === 'keyboard-only' && bubble.tools.map((t) => t.tool_name)).toEqual(['write_file'])
    expect(foldsOf(bubble)).toEqual(['files:1'])
  })

  it('names a fold after its first call, so the badge keeps its identity as more land', () => {
    const { groups } = groupsOf([
      msg('assistant', { _blocks: [text('look'), read('a.rs')] }),
      msg('assistant', { _blocks: [read('b.rs')] }),
    ])
    const b = groups[0].bubbles[0]
    if (b.kind !== 'text') throw new Error('expected a text bubble')
    expect(b.folded[0].key).toBe(`fold:files:${b.folded[0].tools[0].call_id}`)
  })
})

describe('buildAssistantGroups — the stream and the sign of life', () => {
  /// A call after the prose means the prose was finished before the call was
  /// made. The cursor belongs only to a bubble nothing has followed yet.
  it('stops treating prose as being written once a call follows it', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('look'), tool('write_file', 'running')] })], {
      streaming: true,
    })
    expect(groups[0].bubbles[0].isStreaming).toBe(false)
  })

  it('stops treating prose as being written once a folded call follows it', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('look'), tool('read_file')] })], {
      streaming: true,
    })
    const [bubble] = groups[0].bubbles
    expect(bubble.kind).toBe('text')
    expect(bubble.isStreaming).toBe(false)
  })

  /// The wait between a tool returning and the model speaking again is drawn
  /// as the next bubble of the run — the typing indicator — so it is where
  /// the answer will land and takes the run's last corner.
  it('ends the run on a working bubble while the model is between calls', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('look'), tool('read_file')] })], {
      streaming: true,
    })
    expect(groups[0].bubbles.map((b) => b.kind)).toEqual(['text', 'working'])
    expect(groups[0].bubbles.map((b) => b.position)).toEqual(['first', 'last'])
  })

  it('draws a working bubble in a group of its own before the first row lands', () => {
    const turn = buildTurns([msg('user', { content: 'q' })], { streaming: true })[0]
    const groups = buildAssistantGroups(turn)
    expect(groups).toHaveLength(1)
    expect(groups[0].bubbles.map((b) => b.kind)).toEqual(['working'])
    expect(groups[0].messageIds).toEqual([])
  })

  it('draws no working bubble once the answer is being written', () => {
    const { groups } = groupsOf([msg('assistant', { _blocks: [text('look'), tool('read_file'), text('so')] })], {
      streaming: true,
    })
    expect(groups[0].bubbles.map((b) => b.kind)).toEqual(['text', 'text'])
    expect(groups[0].bubbles[1].isStreaming).toBe(true)
  })

  it('draws no working bubble for a turn waiting on the user', () => {
    const { turn, groups } = groupsOf(
      [msg('assistant', { _blocks: [text('may I'), tool('run_command', 'pending')] })],
      {
        streaming: true,
      },
    )
    expect(turn.status).toBe('awaiting-input')
    expect(groups[0].bubbles.map((b) => b.kind)).toEqual(['text'])
  })
})
