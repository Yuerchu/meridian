import { beforeEach, describe, expect, it } from 'vitest'

import { usePlanReviewStore } from './plan-review-store'

const event = {
  review_id: 'review-1',
  conversation_id: 'conversation-1',
  document_id: 'document-1',
  revision_id: 'revision-1',
  turn_id: 'turn-1',
  status: 'approved' as const,
  delivery_state: 'held' as const,
  lock_version: 2,
}

describe('plan review invalidation projection', () => {
  beforeEach(() => usePlanReviewStore.setState({ activeReviewId: null, summaries: {} }))

  it('projects the exact durable delivery state carried by the event', () => {
    usePlanReviewStore.getState().receiveReviewEvent(event)
    expect(usePlanReviewStore.getState().summaries['review-1']).toMatchObject({
      status: 'approved',
      delivery_state: 'held',
    })
  })

  it('does not invent a delivery barrier for pending or orphaned review events', () => {
    usePlanReviewStore.getState().receiveReviewEvent({ ...event, status: 'pending', delivery_state: null })
    expect(usePlanReviewStore.getState().summaries['review-1'].delivery_state).toBeNull()
    usePlanReviewStore
      .getState()
      .receiveReviewEvent({ ...event, status: 'orphaned', delivery_state: null, lock_version: 3 })
    expect(usePlanReviewStore.getState().summaries['review-1'].delivery_state).toBeNull()
  })

  it('rejects an older projection and an equal-version state rollback', () => {
    expect(usePlanReviewStore.getState().receiveReviewEvent(event)).toBe(true)
    expect(
      usePlanReviewStore
        .getState()
        .receiveReviewEvent({ ...event, status: 'pending', delivery_state: null, lock_version: 1 }),
    ).toBe(false)
    expect(
      usePlanReviewStore
        .getState()
        .receiveReviewEvent({ ...event, status: 'approved', delivery_state: 'acknowledged' }),
    ).toBe(false)
    expect(usePlanReviewStore.getState().summaries['review-1']).toMatchObject(event)
  })
})
