// Where a dropped card lands in its column, in the column's own order.
//
// React Aria reports a drop against one item of one list — "before this key",
// "after that key", or onto the list itself — while a board stores one order
// per column. And a column is not always one list: the agent board deals a
// column's cards into lanes, so the key a card was dropped beside belongs to a
// lane, and only the column's order says where that is.
import type { Key } from 'react-aria-components'

export type DropPosition = 'before' | 'after' | 'on'

/**
 * The index in `order` to insert at, counted *after* the moving cards have been
 * taken out — which is what a move does first. `targetKey` null is a drop onto
 * the list or column itself: the end. A drop `on` a card is not a position and
 * answers null, as is a target the column does not hold.
 */
export function dropIndex(
  order: readonly Key[],
  moving: ReadonlySet<Key>,
  targetKey: Key | null,
  position: DropPosition,
): number | null {
  const rest = order.filter((key) => !moving.has(key))
  if (targetKey === null) return rest.length
  if (position === 'on') return null
  const at = rest.indexOf(targetKey)
  if (at < 0) return null
  return position === 'after' ? at + 1 : at
}

/** `order` with `moving` taken out and put back at `index`, in their original order. */
export function moveKeys<T extends Key>(order: readonly T[], moving: readonly T[], index: number): T[] {
  const set = new Set<Key>(moving)
  const rest = order.filter((key) => !set.has(key))
  return [...rest.slice(0, index), ...moving, ...rest.slice(index)]
}
