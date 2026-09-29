import { describe, expect, it } from 'vitest'
import { isUnprompted } from './turn-trigger'

describe('isUnprompted', () => {
  // A plan continuation has no row of its own but carries on answering the
  // question above it; only a turn nobody asked for starts a group of its own.
  it('is true only for a turn nobody asked for', () => {
    expect(isUnprompted('task_completion')).toBe(true)
    expect(isUnprompted('agent_autonomous')).toBe(true)
    expect(isUnprompted('plan_continuation')).toBe(false)
    expect(isUnprompted('user')).toBe(false)
    expect(isUnprompted(undefined)).toBe(false)
  })
})
