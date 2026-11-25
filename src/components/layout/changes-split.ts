/**
 * The chat / changes horizontal split ratio (first panel = chat, second panel = changes).
 *
 * The changes panel opens at 30% (chat 70%) and can be dragged between 25% and 50%
 * of the pane (chat 75% down to 50%), keeping both the transcript and a file-tree row legible.
 */
export const CHANGES_SPLIT = {
  defaultSize: 70,
  minSize: 50,
  maxSize: 75,
} as const
