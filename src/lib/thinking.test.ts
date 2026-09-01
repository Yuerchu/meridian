import { describe, expect, it } from 'vitest'

import { EFFORT_LADDER, allowedEfforts, requireSupportedThinkingLevel } from './thinking'
import type { ProviderCapabilitiesInfoResponse, ThinkingEffort } from '@/types'

function caps(supported: ThinkingEffort[] = []): ProviderCapabilitiesInfoResponse {
  return {
    supports_tools: true,
    supports_streaming_tools: true,
    supports_thinking: true,
    supports_thinking_off: true,
    supports_images: true,
    max_context_tokens: 200_000,
    max_output_tokens: 64_000,
    supports_pdf: true,
    supports_temperature: true,
    supports_top_p: true,
    max_temperature: 2,
    thinking_style: 'effort_only',
    supported_efforts: supported,
    default_effort: null,
    supports_fast: false,
    supports_verbosity: false,
    default_verbosity: null,
    server_tools: [],
  }
}

describe('allowedEfforts', () => {
  it('falls back to the full ladder when capabilities are unknown', () => {
    expect(allowedEfforts(null)).toEqual(EFFORT_LADDER)
  })

  it('keeps ladder order regardless of the order the backend sent', () => {
    expect(allowedEfforts(caps(['max', 'low', 'high']))).toEqual(['low', 'high', 'max'])
  })

  it('returns nothing for a model with no effort control', () => {
    expect(allowedEfforts(caps([]))).toEqual([])
  })
})

describe('requireSupportedThinkingLevel', () => {
  it('passes model-independent levels through', () => {
    const haiku = caps()
    expect(requireSupportedThinkingLevel('default', haiku)).toBe('default')
    expect(requireSupportedThinkingLevel('off', haiku)).toBe('off')
  })

  it('rejects off when the model cannot disable thinking', () => {
    const gemini = { ...caps(['low', 'medium', 'high']), supports_thinking_off: false }
    expect(() => requireSupportedThinkingLevel('off', gemini)).toThrow('does not support disabling thinking')
  })

  it('keeps a supported tier', () => {
    expect(requireSupportedThinkingLevel('xhigh', caps(['low', 'medium', 'high', 'xhigh', 'max']))).toBe('xhigh')
  })

  it('rejects unsupported tiers instead of selecting a substitute', () => {
    expect(() => requireSupportedThinkingLevel('max', caps(['low', 'medium', 'high', 'xhigh']))).toThrow(
      "does not support thinking effort 'max'",
    )
    expect(() => requireSupportedThinkingLevel('max', caps([]))).toThrow("does not support thinking effort 'max'")
  })

  it('leaves a tier alone while capabilities are still loading', () => {
    expect(requireSupportedThinkingLevel('max', null)).toBe('max')
  })
})
