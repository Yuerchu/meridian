/**
 * What the model editor can say about a model's capabilities, and how much room
 * a conversation gets inside its window.
 *
 * Pure, and lifted out of the panel so the one number that has to agree with
 * the backend can be tested against it directly.
 */

/**
 * Capability overrides are tri-state on purpose. A plain checkbox cannot express
 * "inherit", so the first save would pin every capability to its current value
 * and the model would stop receiving catalog updates forever.
 */
export type Tri = 'auto' | 'on' | 'off'

export function triFrom(value: boolean | undefined): Tri {
  return value === undefined ? 'auto' : value ? 'on' : 'off'
}

export function triTo(tri: Tri): boolean | undefined {
  return tri === 'auto' ? undefined : tri === 'on'
}

/**
 * The latest a conversation can start compacting and still have room to answer.
 *
 * Mirrors `safe_threshold` in `src-tauri/crates/core/src/agent/tokenizer.rs`, which is the
 * authority — it clamps whatever is stored here, so the two disagreeing costs a
 * misleading number in this form rather than a broken turn. The old default was
 * a flat 90% of the window, which ignored output entirely: on a model that
 * advertises 128k of output against a 256k window it reserved nothing, and the
 * request the threshold permitted was one the provider had to refuse.
 *
 * Both limits are required. An unknown output ceiling used to reserve nothing
 * (`maxOutput ?? 0`), which suggested a threshold for a reply of zero tokens —
 * a number the backend never computes, since it refuses a turn whose ceiling
 * nobody knows. With either unknown there is no suggestion: the field stays
 * blank and is asked for at save.
 */
export function safeThreshold(contextWindow: number, maxOutput: number): number {
  const reserve = Math.min(maxOutput, 32000)
  const headroom = Math.min(Math.floor(contextWindow / 20), 8000)
  return Math.max(contextWindow - reserve - headroom, Math.floor(contextWindow / 2))
}

/**
 * A token count as typed, or `undefined` when it is not one.
 *
 * Strict on purpose. `parseInt` reads `12k` as 12 and `abc` as NaN, and the old
 * `|| 128000` turned the second into a window nobody chose — a model parameter
 * with a default hardcoded in the form, which the backend refuses to do too.
 * Unreadable input is refused at save instead.
 */
export function parseTokenCount(raw: string): number | undefined {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return undefined
  const n = Number(text)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}
