import { diffLines } from 'diff'
import { numberDiffLines, splitDiffText, type DiffLine, type DiffLineKind, type FileDiff } from '@/lib/patch-parse'
import type { ToolCallDiffInfoResponse } from '@/types'

/**
 * The diff a hosted agent reported, as the card draws it.
 *
 * One `FileDiff` per path, its hunks in the order the adapter sent them. Each
 * hunk is a line diff of its own old and new text — the adapter's blocks are
 * already the changed region with its context, so this is the same computation
 * `editFileDiff` makes from the arguments, only on text the agent read off the
 * disk. A hunk that carries a line is numbered from it, both sides, which is
 * the same approximation `useEditLocation` makes for an edit found by probe;
 * one that does not is drawn unnumbered rather than off a guess.
 *
 * A file every one of whose hunks has `old_text: null` was created; anything
 * else is a modification. That is what lets a `Write` over an existing file
 * show what it removed, which the arguments alone can never say.
 */
export function agentFileDiffs(diffs: readonly ToolCallDiffInfoResponse[]): FileDiff[] {
  const byPath = new Map<string, FileDiff>()
  for (const hunk of diffs) {
    let lines: DiffLine[] = []
    for (const change of diffLines(hunk.old_text ?? '', hunk.new_text)) {
      const kind: DiffLineKind = change.added ? 'add' : change.removed ? 'remove' : 'context'
      for (const text of splitDiffText(change.value)) lines.push({ kind, text })
    }
    if (hunk.line !== null) lines = numberDiffLines(lines, { oldStart: hunk.line, newStart: hunk.line })
    const file = byPath.get(hunk.path)
    if (file) {
      if (hunk.old_text !== null) file.op = 'modify'
      file.lines.push(...lines)
    } else {
      byPath.set(hunk.path, { path: hunk.path, op: hunk.old_text === null ? 'create' : 'modify', lines })
    }
  }
  return [...byPath.values()]
}
