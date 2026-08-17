import type { ProviderCapabilities, ThinkingEffort, ThinkingLevel } from '@/types'

/**
 * Every effort tier, ascending. Mirrors EFFORT_LADDER in the Rust catalog
 * (`src-tauri/src/provider/capabilities.rs`).
 */
export const EFFORT_LADDER: readonly ThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The effort tiers the current model advertises.
 *
 * Returns the full ladder when capabilities are unknown -- either not loaded
 * yet, or served by a backend that predates `supported_efforts`. Showing too
 * many tiers is recoverable because the backend coerces anything unsupported
 * before it reaches the wire; showing too few would hide a tier the model
 * actually supports.
 */
export function allowedEfforts(caps: ProviderCapabilities | null): readonly ThinkingEffort[] {
  if (!caps || caps.supported_efforts === undefined) return EFFORT_LADDER
  const advertised = new Set(caps.supported_efforts)
  return EFFORT_LADDER.filter((tier) => advertised.has(tier))
}

/**
 * Coerce a tier onto what the model accepts, landing on the median of the
 * whitelist rather than dropping to the default. Used when switching models so
 * a request degrades instead of silently losing its reasoning setting.
 *
 * `default` and `off` are model-independent and always pass through.
 */
export function coerceThinkingLevel(current: ThinkingLevel, caps: ProviderCapabilities | null): ThinkingLevel {
  if (current === 'default' || current === 'off') return current
  const allowed = allowedEfforts(caps)
  if (allowed.length === 0) return 'default'
  if (allowed.includes(current)) return current
  return allowed[Math.floor((allowed.length - 1) / 2)]
}
