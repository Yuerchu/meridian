import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import { approveFromCard, planExcerpt, sendBackFromCard } from './plan-card'
import { PlanDecisionAttempt, PlanDecisionInDoubtError } from './plan-review-draft'
import { planReviewProjection, receivePlanReview } from './plan-review-sync'
import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanReviewInfoResponse, PlanReviewStatus } from '@/types'

vi.mock('@/api', () => ({
  api: {
    getPlanReview: vi.fn(),
    savePlanReviewDraft: vi.fn(),
    decidePlanReview: vi.fn(),
  },
}))

const getPlanReview = vi.mocked(api.getPlanReview)
const saveDraft = vi.mocked(api.savePlanReviewDraft)
const decide = vi.mocked(api.decidePlanReview)

const PLAN = '# Fix the scroller\n\n1. Track reader scroll\n2. Change the pin check\n'

function info(
  over: { state?: PlanReviewStatus; generation?: number; note?: string | null; draft?: string; lock?: number } = {},
): PlanReviewInfoResponse {
  return {
    document: {
      id: 'document-1',
      conversation_id: 'conversation-1',
      state: 'reviewing',
      head_revision_id: 'revision-1',
      approved_revision_id: null,
      working_generation: 0,
      file_rel_path: '.meridian/plans/plan.md',
      file_sync_state: 'applied',
      created_at: 1,
      updated_at: 1,
    },
    review: {
      id: 'review-1',
      document_id: 'document-1',
      submitted_revision_id: 'revision-1',
      state: over.state ?? 'pending',
      decision_id: null,
      suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      turn_id: 'turn-1',
      lock_version: over.lock ?? 0,
      created_at: 1,
      updated_at: 1,
    },
    submitted_revision: {
      id: 'revision-1',
      document_id: 'document-1',
      revision_no: 2,
      parent_revision_id: null,
      author_kind: 'assistant',
      content_markdown: PLAN,
      content_sha256: 'revision-hash',
      patch: null,
      responding_to_suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      editor_json: null,
      created_at: 1,
    },
    parent_revision: null,
    draft: {
      review_id: 'review-1',
      base_revision_id: 'revision-1',
      generation: over.generation ?? 3,
      mode: 'source',
      base_editor_json: null,
      draft_editor_json: null,
      source_text: over.draft ?? PLAN,
      base_normalized_markdown: PLAN,
      draft_normalized_markdown: over.draft ?? PLAN,
      draft_sha256: 'draft-hash-3',
      global_note: over.note ?? null,
      selection: null,
      editor_schema_version: null,
      editor_schema_hash: null,
      created_at: 1,
      updated_at: 1,
    },
    comments: [],
    delivery: null,
  }
}

const DECIDED = {
  review_id: 'review-1',
  state: 'approved' as const,
  delivery_state: 'queued' as const,
  continuation_turn_id: 't2',
}

beforeEach(() => {
  vi.resetAllMocks()
  decide.mockResolvedValue(DECIDED)
})

describe('planExcerpt', () => {
  it('takes the first heading as the title and the lines after it', () => {
    expect(planExcerpt(PLAN)).toEqual({
      title: 'Fix the scroller',
      lines: ['1. Track reader scroll', '2. Change the pin check'],
    })
  })

  it('keeps three lines, drops heading markers below the title, and stops at a fence', () => {
    expect(planExcerpt('Intro\n## Steps\n- a\n- b\n- c')).toEqual({ title: null, lines: ['Intro', 'Steps', '- a'] })
    expect(planExcerpt('# T\nfirst\n```ts\nconst x = 1\n```\nafter')).toEqual({ title: 'T', lines: ['first'] })
  })
})

describe('approveFromCard', () => {
  /** Decided against the draft as read at the press, not a copy from earlier:
   *  the page may have saved since the card first looked. */
  it('decides with the generation and hash of a read taken at the press', async () => {
    getPlanReview.mockResolvedValue(info({ generation: 7 }))
    const outcome = await approveFromCard('review-1', new PlanDecisionAttempt())
    expect(outcome).toEqual({ kind: 'decided', result: DECIDED })
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: 'review-1',
        expectedGeneration: 7,
        expectedDraftHash: 'draft-hash-3',
        action: 'approve',
      }),
    )
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['an edited body', { draft: `${PLAN}\n3. Something new\n` }],
    ['a note', { note: 'Keep the tests focused.' }],
  ])('leaves %s to the review page', async (_, over) => {
    getPlanReview.mockResolvedValue(info(over))
    expect(await approveFromCard('review-1', new PlanDecisionAttempt())).toEqual({ kind: 'draft_in_progress' })
    expect(decide).not.toHaveBeenCalled()
  })

  it('does nothing once the review is settled', async () => {
    getPlanReview.mockResolvedValue(info({ state: 'approved' }))
    expect(await approveFromCard('review-1', new PlanDecisionAttempt())).toEqual({ kind: 'settled' })
    expect(decide).not.toHaveBeenCalled()
  })

  /** A lost reply is retried under the same decision id, which the backend
   *  answers idempotently instead of as a second decision. */
  it('retries a lost reply under the same decision id', async () => {
    getPlanReview.mockResolvedValue(info())
    const attempt = new PlanDecisionAttempt()
    decide.mockRejectedValueOnce(new Error('connection reset'))
    await expect(approveFromCard('review-1', attempt)).rejects.toThrow('connection reset')
    await approveFromCard('review-1', attempt)
    expect(decide.mock.calls[0][0].decisionId).toBe(decide.mock.calls[1][0].decisionId)
  })

  it('refuses the other decision while the first is in doubt', async () => {
    getPlanReview.mockResolvedValue(info())
    const attempt = new PlanDecisionAttempt()
    decide.mockRejectedValueOnce(new Error('connection reset'))
    await expect(approveFromCard('review-1', attempt)).rejects.toThrow()
    await expect(sendBackFromCard('review-1', 'no', attempt)).rejects.toBeInstanceOf(PlanDecisionInDoubtError)
  })
})

describe('sendBackFromCard', () => {
  it('saves the note into the draft, then requests changes against what the save returned', async () => {
    getPlanReview.mockResolvedValue(info({ generation: 3 }))
    saveDraft.mockResolvedValue({ review_id: 'review-1', generation: 4, draft_sha256: 'draft-hash-4', updated_at: 2 })
    await sendBackFromCard('review-1', 'Add verification.', new PlanDecisionAttempt())
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'review-1', expectedGeneration: 3, globalNote: 'Add verification.' }),
    )
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ expectedGeneration: 4, expectedDraftHash: 'draft-hash-4', action: 'request_changes' }),
    )
  })

  it('does not write over a note the reviewer is still writing', async () => {
    getPlanReview.mockResolvedValue(info({ note: 'Half a thought' }))
    expect(await sendBackFromCard('review-1', 'Add verification.', new PlanDecisionAttempt())).toEqual({
      kind: 'draft_in_progress',
    })
    expect(saveDraft).not.toHaveBeenCalled()
  })

  /** The first attempt saved the note and lost the decision's reply: the retry
   *  finds its own note in the draft and decides without saving it twice. */
  it('finds its own note on a retry and decides without saving again', async () => {
    getPlanReview.mockResolvedValue(info({ note: 'Add verification.', generation: 4 }))
    await sendBackFromCard('review-1', 'Add verification.', new PlanDecisionAttempt())
    expect(saveDraft).not.toHaveBeenCalled()
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ expectedGeneration: 4, action: 'request_changes' }))
  })
})

/**
 * The card used to rely on `plan-review-updated` alone to learn how its own
 * decision went. That event is best-effort: when it was lost, the card kept
 * offering Approve on a decided plan and the sidebar and inbox kept a
 * question already answered. These run with no event at all.
 */
describe('taking the outcome in without the event', () => {
  beforeEach(() => {
    usePlanReviewStore.setState({ summaries: {}, activeReviewId: null })
    useConversationStore.setState({ attention: {}, attentionOrder: [] })
    // The review as submitted: pending, and so in the attention queue.
    receivePlanReview(planReviewProjection(info()))
    expect(useConversationStore.getState().attention['review-1']).toBeDefined()
  })

  it('a decision of its own settles the summary and retires the question', async () => {
    getPlanReview.mockResolvedValueOnce(info()).mockResolvedValueOnce(info({ state: 'approved', lock: 1 }))
    await approveFromCard('review-1', new PlanDecisionAttempt())
    expect(usePlanReviewStore.getState().summaries['review-1']?.status).toBe('approved')
    expect(useConversationStore.getState().attention['review-1']).toBeUndefined()
  })

  it('a review someone else settled is taken in from the read that found it', async () => {
    getPlanReview.mockResolvedValue(info({ state: 'changes_requested', lock: 1 }))
    expect(await approveFromCard('review-1', new PlanDecisionAttempt())).toEqual({ kind: 'settled' })
    expect(usePlanReviewStore.getState().summaries['review-1']?.status).toBe('changes_requested')
    expect(useConversationStore.getState().attention['review-1']).toBeUndefined()
    expect(decide).not.toHaveBeenCalled()
  })

  it('a failed read-back is not a failed decision', async () => {
    getPlanReview.mockResolvedValueOnce(info()).mockRejectedValueOnce(new Error('connection reset'))
    expect(await approveFromCard('review-1', new PlanDecisionAttempt())).toEqual({ kind: 'decided', result: DECIDED })
  })
})

/**
 * A send-back that failed while saving its note had decided nothing, so it
 * must not hold `request_changes` in doubt: an Approve after it used to be
 * refused until the card was remounted.
 */
it('a send-back whose save failed leaves Approve free', async () => {
  getPlanReview.mockResolvedValue(info())
  saveDraft.mockRejectedValueOnce(new Error('generation conflict'))
  const attempt = new PlanDecisionAttempt()
  await expect(sendBackFromCard('review-1', 'Add verification.', attempt)).rejects.toThrow('generation conflict')
  await expect(approveFromCard('review-1', attempt)).resolves.toMatchObject({ kind: 'decided' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve' }))
})
