/**
 * What the sidebar's drag-and-drop moves, read off tree-row keys.
 *
 * The groups are rendered twice under different key prefixes (`d-` for the
 * panel, `m-` for the mobile sheet), and the drag payload is built by one
 * shared `getItems` — so nothing here may assume a prefix, only the shape
 * behind it. Pure functions, because the RAC wiring around them is declarative
 * config that jsdom cannot drag anything across; this is the part a test can
 * hold. Where a drop *lands* is no longer parsed from keys at all: each group
 * owns its drop handlers and carries its project id in props.
 */

/** The drag payload's type tag. Custom on purpose: a plain-text drag from
 *  anywhere else must not read as a conversation. */
export const CONVERSATION_DRAG_TYPE = 'meridian-conversation'

/** The conversation a tree-row key names, or `null` for any other row. */
export function conversationIdOf(key: string): string | null {
  return /^[a-z]+-conv-(.+)$/.exec(key)?.[1] ?? null
}

/**
 * Whether a drag hovering a group-header `DropZone` is one of ours.
 *
 * The zone sits outside any collection, so `acceptedDragTypes` does not guard
 * it — its `getDropOperation` has to ask itself, and answering yes to a
 * plain-text drag would offer "move into this project" to text dragged out of
 * the composer.
 */
export function acceptsConversationDrop(types: { has: (type: string) => boolean }): boolean {
  return types.has(CONVERSATION_DRAG_TYPE)
}
