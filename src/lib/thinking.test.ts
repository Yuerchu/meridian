import { describe, expect, it } from 'vitest'

import { EFFORT_LADDER, allowedEfforts, coerceThinkingLevel } from './thinking'
import type { ProviderCapabilities, ThinkingEffort } from '@/types'

function caps(supported?: ThinkingEffort[]): ProviderCapabilities {
  return {
    supports_tools: true,
    supports_streaming_tools: true,
    supports_thinking: true,
    supports_images: true,
    max_context_tokens: 200_000,
    max_output_tokens: 64_000,
    ...(supported === undefined ? {} : { supported_efforts: supported }),
  }
}

describe('allowedEfforts', () => {
  it('falls back to the full ladder when capabilities are unknown', () => {
    expect(allowedEfforts(null)).toEqual(EFFORT_LADDER)
  })

  it('falls back to the full ladder on a backend without supported_efforts', () => {
    expect(allowedEfforts(caps())).toEqual(EFFORT_LADDER)
  })

  it('keeps ladder order regardless of the order the backend sent', () => {
    expect(allowedEfforts(caps(['max', 'low', 'high']))).toEqual(['low', 'high', 'max'])
  })

  it('returns nothing for a model with no effort control', () => {
    expect(allowedEfforts(caps([]))).toEqual([])
  })
})

describe('coerceThinkingLevel', () => {
  it('passes model-independent levels through', () => {
    const haiku = caps([])
    expect(coerceThinkingLevel('default', haiku)).toBe('default')
    expect(coerceThinkingLevel('off', haiku)).toBe('off')
  })

  it('coerces off to default when the model cannot disable thinking', () => {
    const gemini = { ...caps(['low', 'medium', 'high']), supports_thinking_off: false }
    expect(coerceThinkingLevel('off', gemini)).toBe('default')
  })

  it('keeps a supported tier', () => {
    expect(coerceThinkingLevel('xhigh', caps(['low', 'medium', 'high', 'xhigh', 'max']))).toBe('xhigh')
  })

  it('drops an unsupported tier to the whitelist median', () => {
    // gpt-5.2 shape: max is not accepted, median of 4 tiers is medium.
    expect(coerceThinkingLevel('max', caps(['low', 'medium', 'high', 'xhigh']))).toBe('medium')
    // o3 shape: median of 3 tiers is medium.
    expect(coerceThinkingLevel('max', caps(['low', 'medium', 'high']))).toBe('medium')
    // Two tiers: median index 0.
    expect(coerceThinkingLevel('max', caps(['low', 'high']))).toBe('low')
  })

  it('falls back to default when the model has no effort control', () => {
    expect(coerceThinkingLevel('max', caps([]))).toBe('default')
  })

  it('leaves a tier alone while capabilities are still loading', () => {
    expect(coerceThinkingLevel('max', null)).toBe('max')
  })
})
