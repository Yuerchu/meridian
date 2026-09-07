import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Marks the Markdown codec has no spelling for, removed from pasted content
 * before it reaches the document. HeroUI Pro's editor bundles `Underline`, so
 * anything copied out of Word, Docs or a web page with `<u>` or
 * `text-decoration: underline` on it arrives as a mark `serializePlanDocument`
 * refuses — and a refused document stops every save until the paste is undone.
 * Stripping the mark loses only the underline, which Markdown would have lost
 * on the way to `plan.md` anyway.
 */
const UNSUPPORTED_PASTE_MARKS = new Set(['underline'])

function withoutUnsupportedMarks(node: ProseMirrorNode): ProseMirrorNode {
  const content = Fragment.from(node.content.content.map(withoutUnsupportedMarks))
  const marks = node.marks.filter((mark) => !UNSUPPORTED_PASTE_MARKS.has(mark.type.name))
  return node.type.name === 'text' ? node.mark(marks) : node.copy(content).mark(marks)
}

/** ProseMirror's `transformPasted` hook for the plan editor. */
export function stripUnsupportedPasteMarks(slice: Slice): Slice {
  return new Slice(Fragment.from(slice.content.content.map(withoutUnsupportedMarks)), slice.openStart, slice.openEnd)
}
