import { beforeEach, describe, expect, it } from 'vitest'

import { usePlanReviewStore } from './plan-review-store'

const event = {
  review_id: 'review-1',
  conversation_id: 'conversation-1',
  document_id: 'document-1',
  revision_id: 'revision-1',
  turn_id: 'turn-1',
  status: 'approved' as const,
  lock_version: 2,
}

describe('plan review invalidation projection', () => {
  beforeEach(() => usePlanReviewStore.setState({ activeReviewId: null, summaries: {} }))

  it('projects the status carried by the event', () => {
    usePlanReviewStore.getState().receiveReviewEvent(event)
    expect(usePlanReviewStore.getState().summaries['review-1']).toMatchObject({
      status: 'approved',
      lock_version: 2,
    })
  })

  it('advances status when lock_version increases', () => {
    usePlanReviewStore.getState().receiveReviewEvent({ ...event, status: 'pending', lock_version: 1 })
    expect(usePlanReviewStore.getState().summaries['review-1'].status).toBe('pending')
    usePlanReviewStore.getState().receiveReviewEvent({ ...event, status: 'orphaned', lock_version: 3 })
    expect(usePlanReviewStore.getState().summaries['review-1'].status).toBe('orphaned')
  })

  it('rejects an older projection and an equal-version state rollback', () => {
    expect(usePlanReviewStore.getState().receiveReviewEvent(event)).toBe(true)
    expect(usePlanReviewStore.getState().receiveReviewEvent({ ...event, status: 'pending', lock_version: 1 })).toBe(
      false,
    )
    expect(
      usePlanReviewStore.getState().receiveReviewEvent({ ...event, status: 'changes_requested', lock_version: 2 }),
    ).toBe(false)
    expect(usePlanReviewStore.getState().summaries['review-1']).toMatchObject(event)
  })
})
