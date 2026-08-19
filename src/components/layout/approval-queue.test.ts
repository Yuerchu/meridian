import { describe, expect, it } from 'vitest'
import { visible } from './approval-queue'
import type { AttentionItem } from '@/stores/conversation-store'

function item(approvalId: string, conversationId: string): AttentionItem {
  return {
    approvalId,
    conversationId,
    providerCallId: 'c1',
    messageId: 'a1',
    toolName: 'run_command',
    arguments: '{}',
    kind: 'approval',
  }
}

function queue(...items: AttentionItem[]) {
  return {
    attention: Object.fromEntries(items.map((i) => [i.approvalId, i])),
    order: items.map((i) => i.approvalId),
  }
}

describe('which questions the queue offers', () => {
  it('follows the order it is given', () => {
    const { attention, order } = queue(item('a', 'c1'), item('b', 'c2'))
    expect(visible(attention, order, null).map((i) => i.approvalId)).toEqual(['a', 'b'])
  })

  /** The conversation being read already has this question in its transcript,
   *  at the live edge the scroller follows. Two places to click for one
   *  decision is worse than one. */
  it('leaves out the conversation being read', () => {
    const { attention, order } = queue(item('a', 'being-read'), item('b', 'elsewhere'))
    expect(visible(attention, order, 'being-read').map((i) => i.approvalId)).toEqual(['b'])
  })

  /** Three is what HeroUI stacks, and everything but the frontmost is
   *  `pointer-events-none` — so this is a depth cue, not three things to
   *  answer. The rest wait their turn rather than becoming live toasts. */
  it('offers no more than the stack can show', () => {
    const { attention, order } = queue(...['a', 'b', 'c', 'd', 'e'].map((id) => item(id, `conv-${id}`)))
    expect(visible(attention, order, null).map((i) => i.approvalId)).toEqual(['a', 'b', 'c'])
  })

  /** The case a set-based diff cannot see. Deferring the front of a full stack
   *  leaves the same three ids on screen in a different order, so anything
   *  comparing membership finds nothing to do and the button does nothing. */
  it('reorders within a full stack when the front is deferred', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => item(id, `conv-${id}`))
    const attention = Object.fromEntries(items.map((i) => [i.approvalId, i]))

    const before = visible(attention, ['a', 'b', 'c', 'd'], null).map((i) => i.approvalId)
    const after = visible(attention, ['b', 'c', 'a', 'd'], null).map((i) => i.approvalId)

    expect(before).toEqual(['a', 'b', 'c'])
    expect(after).toEqual(['b', 'c', 'a'])
    // Same three questions, different order — which is the whole point.
    expect(new Set(after)).toEqual(new Set(before))
  })

  /** The order is written independently of the map, so an id can outlive the
   *  entry it names for the span of one update. */
  it('skips an id whose question is already gone', () => {
    const { attention } = queue(item('b', 'c2'))
    expect(visible(attention, ['a', 'b'], null).map((i) => i.approvalId)).toEqual(['b'])
  })
})
