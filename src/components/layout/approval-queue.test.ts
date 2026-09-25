import { describe, expect, it } from 'vitest'
import { pending, visible } from './approval-queue'
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
    askedAt: 1_700_000_000_000,
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

  /** Three cards is what the stack draws. The rest wait their turn rather
   *  than covering the window with thirty copies of the same request. */
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

  /** Settings covers the transcript with `inert`, so the card on the active
   *  conversation cannot be clicked. The notification is then the only way in. */
  it('still offers the conversation being read when its transcript is inert', () => {
    const { attention, order } = queue(item('a', 'being-read'), item('b', 'elsewhere'))
    expect(visible(attention, order, 'being-read', true).map((i) => i.approvalId)).toEqual(['a', 'b'])
  })
})

describe('the plan review being read', () => {
  function reviewItem(reviewId: string, conversationId: string): AttentionItem {
    return {
      approvalId: reviewId,
      reviewId,
      conversationId,
      documentId: 'd1',
      revisionId: 'r1',
      turnId: 't1',
      stage: 'review',
      kind: 'plan_review',
      askedAt: null,
    }
  }

  /** The review page covers the transcript, so the inert rule alone would offer
   *  the very review the page is showing — a notification saying "review the plan" on
   *  top of the plan. */
  it('is left out even while the transcript under it is inert', () => {
    const { attention, order } = queue(reviewItem('review-1', 'c1'), reviewItem('review-2', 'c2'), item('a', 'c1'))
    expect(visible(attention, order, 'c1', true, 'review-1').map((i) => i.approvalId)).toEqual(['review-2', 'a'])
  })
})

/** The inbox lists everything the stack would, past its first three, and says
 *  of the conversation being read only that it is waiting. */
describe('the whole queue', () => {
  it('lists past the stack and keeps the conversation being read apart', () => {
    const { attention, order } = queue(
      item('a', 'c1'),
      item('b', 'being-read'),
      item('c', 'c3'),
      item('d', 'c4'),
      item('e', 'c5'),
    )
    const { listed, here } = pending(attention, order, 'being-read')
    expect(listed.map((i) => i.approvalId)).toEqual(['a', 'c', 'd', 'e'])
    expect(here.map((i) => i.approvalId)).toEqual(['b'])
  })

  it('lists the conversation being read while its transcript is inert', () => {
    const { attention, order } = queue(item('a', 'being-read'))
    const { listed, here } = pending(attention, order, 'being-read', true)
    expect(listed.map((i) => i.approvalId)).toEqual(['a'])
    expect(here).toEqual([])
  })
})
