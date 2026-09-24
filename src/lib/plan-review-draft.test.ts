import { describe, expect, it, vi } from 'vitest'

import { parsePlanMarkdown } from './plan-markdown'
import {
  isPlanStateConflict,
  PlanDecisionAttempt,
  PlanDecisionInDoubtError,
  PlanDraftSaveQueue,
  planDraftUnsavedParts,
  planReviewActionRules,
  type PlanDraftPayload,
} from './plan-review-draft'
import type { PlanReviewDraftSaveRequest } from '@/types'

function payload(markdown: string, baseMarkdown = '# Plan\n'): PlanDraftPayload {
  return {
    mode: 'rich',
    baseEditorJson: {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] }],
    },
    baseNormalizedMarkdown: baseMarkdown,
    editorJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }] },
    sourceText: null,
    normalizedMarkdown: markdown,
    comments: [],
    globalNote: null,
    selection: null,
    editorSchemaVersion: 1,
    editorSchemaHash: 'meridian-plan-markdown-v1',
    editorSchemaFallback: null,
  }
}

describe('plan draft CAS writer', () => {
  it('freezes the projected baseline when the first rich save already contains an edit', async () => {
    const requests: PlanReviewDraftSaveRequest[] = []
    const save = vi.fn(async (request: PlanReviewDraftSaveRequest) => {
      requests.push(request)
      return {
        review_id: request.reviewId,
        generation: request.expectedGeneration + 1,
        draft_sha256: `hash-${request.expectedGeneration + 1}`,
        updated_at: 1,
      }
    })
    const queue = new PlanDraftSaveQueue('review-1', save, 0, 'hash-0', vi.fn())

    queue.enqueue(payload('# Edited\n'))
    await queue.flush()
    queue.enqueue(payload('# Edited again\n'))
    await queue.flush()

    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.baseNormalizedMarkdown)).toEqual(['# Plan\n', '# Plan\n'])
    expect(requests[0].normalizedMarkdown).toBe('# Edited\n')
    expect(requests[1].expectedGeneration).toBe(1)
  })

  it('coalesces only the pending snapshot while preserving in-flight CAS order', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const requests: PlanReviewDraftSaveRequest[] = []
    const save = vi.fn(async (request: PlanReviewDraftSaveRequest) => {
      requests.push(request)
      if (requests.length === 1) await first
      return {
        review_id: 'review-1',
        generation: request.expectedGeneration + 1,
        draft_sha256: `hash-${request.expectedGeneration + 1}`,
        updated_at: 1,
      }
    })
    const queue = new PlanDraftSaveQueue('review-1', save, 3, 'hash-3', vi.fn())
    queue.enqueue(payload('first'))
    const flushing = queue.flush()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    queue.enqueue(payload('superseded'))
    queue.enqueue(payload('latest'))
    releaseFirst()
    await flushing

    expect(requests.map((request) => request.normalizedMarkdown)).toEqual(['first', 'latest'])
    expect(requests.map((request) => request.expectedGeneration)).toEqual([3, 4])
  })
})

describe('plan draft save failures', () => {
  function answer(request: PlanReviewDraftSaveRequest) {
    return {
      review_id: request.reviewId,
      generation: request.expectedGeneration + 1,
      draft_sha256: `hash-${request.expectedGeneration + 1}`,
      updated_at: 1,
    }
  }

  it('keeps the draft a failed save could not write, and sends it again on retry', async () => {
    const requests: PlanReviewDraftSaveRequest[] = []
    const save = vi.fn(async (request: PlanReviewDraftSaveRequest) => {
      requests.push(request)
      if (requests.length === 1) throw new Error('disk full')
      return answer(request)
    })
    const states: string[] = []
    const queue = new PlanDraftSaveQueue('review-1', save, 0, 'hash-0', (state) => states.push(state))

    queue.enqueue(payload('typed before the failure'))
    await expect(queue.flush()).rejects.toThrow('disk full')
    expect(queue.hasUnsaved()).toBe(true)
    // Still sticky: nothing goes out again until somebody asks.
    await expect(queue.flush()).rejects.toThrow('disk full')
    expect(requests).toHaveLength(1)

    await queue.retry()
    expect(requests.map((request) => request.normalizedMarkdown)).toEqual([
      'typed before the failure',
      'typed before the failure',
    ])
    expect(queue.hasUnsaved()).toBe(false)
    expect(queue.lastSaved()?.normalizedMarkdown).toBe('typed before the failure')
    expect(states.at(-1)).toBe('saved')
  })

  it('accepts edits after a failure without throwing and retries the newest one', async () => {
    const requests: PlanReviewDraftSaveRequest[] = []
    const save = vi.fn(async (request: PlanReviewDraftSaveRequest) => {
      requests.push(request)
      if (requests.length === 1) throw new Error('offline')
      return answer(request)
    })
    const states: string[] = []
    const queue = new PlanDraftSaveQueue('review-1', save, 0, 'hash-0', (state) => states.push(state))
    queue.enqueue(payload('first'))
    await expect(queue.flush()).rejects.toThrow('offline')

    expect(() => queue.enqueue(payload('second'))).not.toThrow()
    expect(states.at(-1)).toBe('error')
    await queue.retry()
    expect(requests.at(-1)?.normalizedMarkdown).toBe('second')
  })

  it('refuses to retry a conflict, whose generation only a reload can replace', async () => {
    const save = vi.fn(async () => {
      throw new Error('plan state conflict: expected draft generation 0, found 1')
    })
    const queue = new PlanDraftSaveQueue('review-1', save, 0, 'hash-0', vi.fn())
    queue.enqueue(payload('mine'))
    await expect(queue.flush()).rejects.toThrow('plan state conflict')
    await expect(queue.retry()).rejects.toThrow('plan state conflict')
    expect(save).toHaveBeenCalledTimes(1)
    expect(queue.hasUnsaved()).toBe(true)
  })

  it('names the parts of the draft the server does not hold', () => {
    const saved = payload('# Plan\n')
    expect(planDraftUnsavedParts(saved, saved)).toEqual([])
    expect(planDraftUnsavedParts(saved, { ...saved, globalNote: 'Ship it' })).toEqual(['note'])
    expect(
      planDraftUnsavedParts(saved, {
        ...payload('# Edited\n'),
        comments: [
          {
            id: 'c',
            state: 'active',
            body: 'why',
            anchor: { kind: 'source_range', from: 0, to: 1, quote: '#', prefix: '', suffix: ' ' },
          },
        ],
      }),
    ).toEqual(['body', 'comments'])
  })
})

describe('plan review decision rules', () => {
  it('allows approval when raw Markdown changes only through the rich projection normalization', () => {
    const parsed = parsePlanMarkdown('# Plan   \n\nBody\n')
    expect(parsed.mode).toBe('rich')
    if (parsed.mode !== 'rich') return
    expect(
      planReviewActionRules({
        status: 'pending',
        baseMarkdown: parsed.normalizedMarkdown,
        draftMarkdown: parsed.normalizedMarkdown,
        comments: [],
        globalNote: null,
        saveState: 'saved',
        isHistorical: false,
      }),
    ).toMatchObject({ isPristine: true, canApprove: true })
  })

  it('reuses one decision id after a lost response and refuses an ambiguous opposite action', () => {
    const attempt = new PlanDecisionAttempt()
    const first = attempt.forAction('approve')
    expect(attempt.forAction('approve')).toEqual(first)
    expect(() => attempt.forAction('request_changes')).toThrow('still in doubt')
    attempt.reset()
    expect(attempt.forAction('request_changes').id).not.toBe(first.id)
  })
})

describe('isPlanStateConflict', () => {
  it('recognises the backend conflict variant by its fixed prefix, wrapped or not', () => {
    expect(isPlanStateConflict('plan state conflict: expected draft generation 3, found 4')).toBe(true)
    expect(isPlanStateConflict(new Error('plan state conflict: review is not pending'))).toBe(true)
  })

  it('does not read a validation error as a conflict because of a word in it', () => {
    expect(isPlanStateConflict('invalid plan state: comment anchor hash is malformed')).toBe(false)
    expect(isPlanStateConflict('invalid plan state: expected generation to be an integer')).toBe(false)
  })
})

describe('PlanDecisionInDoubtError', () => {
  it('names the decision still in doubt so the page can say so in its own words', () => {
    const attempt = new PlanDecisionAttempt()
    attempt.forAction('approve')
    let caught: unknown = null
    try {
      attempt.forAction('request_changes')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PlanDecisionInDoubtError)
    expect((caught as PlanDecisionInDoubtError).pending).toBe('approve')
  })
})
