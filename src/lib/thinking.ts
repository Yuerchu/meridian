import type { ProviderCapabilitiesInfoResponse, ThinkingEffort, ThinkingLevel } from '@/types'

/**
 * Every effort tier, ascending. Mirrors EFFORT_LADDER in the Rust catalog
 * (`src-tauri/src/provider/capabilities.rs`).
 */
export const EFFORT_LADDER: readonly ThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The effort tiers the current model advertises.
 *
 * Returns the full ladder only while capabilities have not loaded. Once loaded,
 * `supported_efforts` is a required part of the versioned backend contract.
 */
export function allowedEfforts(caps: ProviderCapabilitiesInfoResponse | null): readonly ThinkingEffort[] {
  if (!caps) return EFFORT_LADDER
  const advertised = new Set(caps.supported_efforts)
  return EFFORT_LADDER.filter((tier) => advertised.has(tier))
}

/** Validate an explicit tier without substituting a different request. */
export function requireSupportedThinkingLevel(
  current: ThinkingLevel,
  caps: ProviderCapabilitiesInfoResponse | null,
): ThinkingLevel {
  if (!caps) return current
  if (current === 'default') return current
  if (current === 'off') {
    if (!caps.supports_thinking_off) throw new Error('the selected model does not support disabling thinking')
    return current
  }
  const allowed = allowedEfforts(caps)
  if (allowed.includes(current)) return current
  throw new Error(`the selected model does not support thinking effort '${current}'`)
}
