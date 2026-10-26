import { describe, expect, it } from 'vitest'

import { formatDefinitionTokens } from './format'

describe('formatDefinitionTokens', () => {
  it('keeps small counts exact', () => {
    expect(formatDefinitionTokens(0)).toBe('0')
    expect(formatDefinitionTokens(420)).toBe('420')
    expect(formatDefinitionTokens(999)).toBe('999')
  })

  it('uses one decimal until 10k, then whole thousands', () => {
    expect(formatDefinitionTokens(1000)).toBe('1k')
    expect(formatDefinitionTokens(1400)).toBe('1.4k')
    expect(formatDefinitionTokens(10_000)).toBe('10k')
    expect(formatDefinitionTokens(1_000_000)).toBe('1M')
  })
})
