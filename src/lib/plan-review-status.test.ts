import { describe, expect, it } from 'vitest'

import { planReviewStatusOfTool, planReviewToolStatus } from './plan-review-status'
import type { PlanReviewStatus } from '@/types'

describe('plan review status projection', () => {
  it.each<PlanReviewStatus>(['pending', 'approved', 'changes_requested', 'orphaned'])(
    'reads %s back off the tool row it projects to',
    (status) => {
      expect(planReviewStatusOfTool(planReviewToolStatus(status))).toBe(status)
    },
  )

  it('reads a row state the projection never produces as orphaned', () => {
    expect(planReviewStatusOfTool('running')).toBe('orphaned')
  })
})
