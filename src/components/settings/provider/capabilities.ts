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
 */
export function safeThreshold(contextWindow: number, maxOutput: number | null): number {
  const reserve = Math.min(maxOutput ?? 0, 32000)
  const headroom = Math.min(Math.floor(contextWindow / 20), 8000)
  return Math.max(contextWindow - reserve - headroom, Math.floor(contextWindow / 2))
}
