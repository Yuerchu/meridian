import { parsePatch } from 'diff'

/**
 * Reading a patch back into which files it touches and how.
 *
 * Lifted out of `tool-call-block.tsx` when a second consumer appeared. The card
 * wants the lines to draw; the changed-files panel wants only the paths and the
 * verbs. Both need the same three parsers, and a patch parsed two different ways
 * is a patch that will eventually disagree with itself.
 */

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** Where the line sits in the file before the change. A removed or context
   *  line has one; an added line does not. Absent when nothing knows. */
  oldNo?: number
  /** Where the line sits in the file after the change. */
  newNo?: number
}

export interface FileDiff {
  path: string
  op: 'create' | 'delete' | 'modify'
  replaceAll?: boolean
  /** Where a moved file came from. `path` is always the destination. */
  movedFrom?: string
  lines: DiffLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Line numbers for a diff, from a known starting point.
 *
 * Only ever called with a start somebody actually knows: `1` for a file being
 * written whole, the hunk headers of a unified patch, the line a
 * `read_file`-style probe found `old_string` on. A guessed start would draw a
 * gutter of confident wrong numbers, which is worse than no gutter — so the
 * card leaves the numbers off rather than call this with a guess.
 *
 * A hunk header inside the lines resets both counters to what it declares,
 * which is what makes one call cover a multi-hunk patch. The loose parser keeps
 * headers as the model wrote them, so the regex accepts `@@ -1 +1 @@` without
 * counts and ignores anything trailing the second `@@`. A Codex-style header
 * (`@@ ctx`) carries no numbers and leaves the counters where they were.
 */
export function numberDiffLines(lines: DiffLine[], start: { oldStart: number; newStart: number }): DiffLine[] {
  let oldNo = start.oldStart
  let newNo = start.newStart
  return lines.map((line) => {
    switch (line.kind) {
      case 'hunk': {
        const m = HUNK_HEADER.exec(line.text)
        if (m) {
          oldNo = Number(m[1])
          newNo = Number(m[2])
        }
        return { ...line }
      }
      case 'add':
        return { ...line, newNo: newNo++ }
      case 'remove':
        return { ...line, oldNo: oldNo++ }
      default:
        return { ...line, oldNo: oldNo++, newNo: newNo++ }
    }
  })
}

/** The first hunk header's start, when the patch declares one. */
export function firstHunkStart(lines: DiffLine[]): { oldStart: number; newStart: number } | null {
  for (const line of lines) {
    if (line.kind !== 'hunk') continue
    const m = HUNK_HEADER.exec(line.text)
    return m ? { oldStart: Number(m[1]), newStart: Number(m[2]) } : null
  }
  return null
}

export function splitDiffText(s: string): string[] {
  const lines = s.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function stripDiffPrefix(p: string): string {
  const trimmed = p.trim()
  return trimmed.startsWith('a/') || trimmed.startsWith('b/') ? trimmed.slice(2) : trimmed
}

/** Codex-style: `*** Begin Patch` / `*** Update File: x` / `@@ ctx` / `+-` lines. */
function parseCodexPatch(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  let cur: FileDiff | null = null
  for (const raw of patch.split('\n')) {
    const header = raw.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/)
    if (header) {
      cur = {
        path: header[2].trim(),
        op: header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'modify',
        lines: [],
      }
      files.push(cur)
      continue
    }
    const move = raw.match(/^\*\*\* Move to: (.+)$/)
    if (move && cur) {
      // Destination in `path`, origin kept beside it. It used to be one string
      // with an arrow in the middle, which read correctly and could not be
      // used as a path by anything downstream.
      cur.movedFrom = cur.path
      cur.path = move[1].trim()
      continue
    }
    if (raw.startsWith('*** ')) continue
    if (!cur) continue
    if (raw.startsWith('@@')) cur.lines.push({ kind: 'hunk', text: raw })
    else if (raw.startsWith('+')) cur.lines.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) cur.lines.push({ kind: 'remove', text: raw.slice(1) })
    else cur.lines.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  return files
}

/** Line-scanning fallback for diffs jsdiff rejects, e.g. hunk headers whose
 *  line counts are wrong — models miscount them routinely. */
function parseUnifiedPatchLoose(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  const lines = patch.split('\n')
  let cur: FileDiff | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldPath = stripDiffPrefix(line.slice(4))
      const newPath = stripDiffPrefix(lines[i + 1].slice(4))
      cur = {
        path: newPath === '/dev/null' ? oldPath : newPath,
        op: oldPath === '/dev/null' ? 'create' : newPath === '/dev/null' ? 'delete' : 'modify',
        lines: [],
      }
      files.push(cur)
      i++
      continue
    }
    if (!cur) continue
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('\\')) continue
    if (line.startsWith('@@')) cur.lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) cur.lines.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) cur.lines.push({ kind: 'remove', text: line.slice(1) })
    else cur.lines.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  return files
}

function parseUnifiedPatch(patch: string): FileDiff[] {
  let parsed: ReturnType<typeof parsePatch>
  try {
    parsed = parsePatch(patch)
  } catch {
    return parseUnifiedPatchLoose(patch)
  }
  const files: FileDiff[] = []
  for (const f of parsed) {
    if (f.hunks.length === 0) continue
    const oldPath = stripDiffPrefix(f.oldFileName ?? '')
    const newPath = stripDiffPrefix(f.newFileName ?? '')
    const lines: DiffLine[] = []
    for (const h of f.hunks) {
      lines.push({ kind: 'hunk', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
      for (const l of h.lines) {
        if (l.startsWith('+')) lines.push({ kind: 'add', text: l.slice(1) })
        else if (l.startsWith('-')) lines.push({ kind: 'remove', text: l.slice(1) })
        else if (l.startsWith('\\')) continue
        else lines.push({ kind: 'context', text: l.startsWith(' ') ? l.slice(1) : l })
      }
    }
    files.push({
      path: newPath === '/dev/null' || newPath === '' ? oldPath : newPath,
      op: oldPath === '/dev/null' ? 'create' : newPath === '/dev/null' ? 'delete' : 'modify',
      lines,
    })
  }
  return files.length > 0 ? files : parseUnifiedPatchLoose(patch)
}

/** Which of the two patch dialects this is. */
export function parsePatchText(patch: string): FileDiff[] {
  return /^\*\*\* (Begin Patch|Update File|Add File|Delete File)/m.test(patch)
    ? parseCodexPatch(patch)
    : parseUnifiedPatch(patch)
}
