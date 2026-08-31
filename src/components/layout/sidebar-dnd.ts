/**
 * What the sidebar's drag-and-drop moves, read off tree-row keys.
 *
 * The trees are rendered twice under different key prefixes (`d-` for the
 * panel, `m-` for the mobile sheet), and the drag hooks are built once above
 * both copies — so nothing here may assume a prefix, only the shape behind it.
 * Pure functions, because the RAC wiring around them is declarative config
 * that jsdom cannot drag anything across; this is the part a test can hold.
 */

/** The drag payload's type tag. Custom on purpose: a plain-text drag from
 *  anywhere else must not read as a conversation. */
export const CONVERSATION_DRAG_TYPE = 'meridian-conversation'

/** The conversation a tree-row key names, or `null` for any other row. */
export function conversationIdOf(key: string): string | null {
  return /^[a-z]+-conv-(.+)$/.exec(key)?.[1] ?? null
}

/**
 * Where dropping on this row would file a conversation.
 *
 * A project row files under that project; the "all projects" row files under
 * none — it is the tree's one unfile target, which matters because the loose
 * group unmounts entirely when every conversation is filed. Any other row —
 * a conversation, a header — is not a destination.
 */
export function dropDestination(key: string): { projectId: string | null } | null {
  const project = /^[a-z]+-project-(.+)$/.exec(key)?.[1]
  if (project) return { projectId: project }
  if (/^[a-z]+-all-projects$/.test(key)) return { projectId: null }
  return null
}
