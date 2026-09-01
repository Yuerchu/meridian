import { parsePatchText } from './patch-parse'
import { parseJsonText, requireRecord } from './strict-json'
import type { MessageViewModel } from '@/types'

/**
 * Which files a conversation changed, from the tool calls in its transcript.
 *
 * Deliberately not an extension of `toolFileDiffs`. That one returns the lines
 * to draw in a card and only knows the three tools that produce a diff; this
 * one wants paths and verbs, and has to know about deletes and moves as well.
 * Making one function serve both would mean carrying a body of diff text for
 * every file in a panel that never shows a line of it.
 *
 * **It is a lower bound, and the panel has to say so.** `run_command` can write
 * anything, and nothing here can read a shell command and know what it touched.
 * What this covers is the file tools, which is what "the assistant edited this"
 * usually means and never all of it.
 */

export type TouchedOp = 'create' | 'modify' | 'delete'

export interface TouchedFile {
  path: string
  op: TouchedOp
  /** How many calls landed on it. A file edited six times is worth noticing. */
  count: number
}

/**
 * Folding a file's history down to one verb.
 *
 * Created and then edited is still created — the file did not exist before this
 * conversation, which is the thing worth knowing. Deleted wins over whatever
 * came before it. Deleted and then written again is a modify: the path exists
 * at the end and existed at the start, and calling that a create would be a
 * claim about a file that was already there.
 */
function fold(previous: TouchedOp | undefined, next: TouchedOp): TouchedOp {
  if (previous === undefined) return next
  if (next === 'delete') return 'delete'
  if (previous === 'delete') return 'modify'
  if (previous === 'create') return 'create'
  return next === 'create' ? 'create' : 'modify'
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** One call's effect on the filesystem, or nothing if it has none. */
function callEffects(toolName: string, args: Record<string, unknown>): Array<[string, TouchedOp]> {
  switch (toolName) {
    case 'write_file': {
      const path = str(args, 'path')
      // `modify`, not `create`: nothing in the arguments says whether the file
      // was there before, and guessing wrong is worse than being vague.
      return path ? [[path, 'modify']] : []
    }
    case 'edit_file': {
      const path = str(args, 'file_path')
      return path ? [[path, 'modify']] : []
    }
    case 'delete_file': {
      const path = str(args, 'path')
      return path ? [[path, 'delete']] : []
    }
    case 'move_file': {
      // Two paths in one call, and both changed. The tree shows the origin
      // gone and the destination new, which is what a move looks like from
      // the outside.
      const from = str(args, 'from')
      const to = str(args, 'to')
      const out: Array<[string, TouchedOp]> = []
      if (from) out.push([from, 'delete'])
      if (to) out.push([to, 'create'])
      return out
    }
    case 'apply_patch': {
      const patch = str(args, 'patch')
      if (!patch) return []
      const out: Array<[string, TouchedOp]> = []
      for (const file of parsePatchText(patch)) {
        if (file.path === '') continue
        // A move inside a patch is the same two facts as `move_file`.
        if (file.movedFrom) out.push([file.movedFrom, 'delete'])
        out.push([file.path, file.op])
      }
      return out
    }
    default:
      return []
  }
}

/**
 * Reads the transcript in order, so the fold above sees the real sequence.
 *
 * Only `completed` calls count. A denied call never ran and an errored one did
 * not finish; listing either would put a file in the panel that is not on disk,
 * which is worse than leaving one out.
 */
export function touchedFiles(messages: MessageViewModel[]): TouchedFile[] {
  const seen = new Map<string, TouchedFile>()

  for (const message of messages) {
    for (const block of message._blocks ?? []) {
      if (block.type !== 'tool_call') continue
      if (block.data.status !== 'completed') continue

      const label = `completed ${block.data.tool_name} arguments`
      const args = requireRecord(parseJsonText(block.data.arguments, label), label)

      for (const [path, op] of callEffects(block.data.tool_name, args)) {
        const previous = seen.get(path)
        seen.set(path, {
          path,
          op: fold(previous?.op, op),
          count: (previous?.count ?? 0) + 1,
        })
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/* ------------------------------------------------------------------ tree */

export interface FileNode {
  /** The full path for a file, the path so far for a directory. */
  id: string
  name: string
  children?: FileNode[]
  file?: TouchedFile
}

/**
 * Nests flat paths, then collapses runs of single-child directories.
 *
 * Without the collapse, one file under `src/components/chat/` costs four rows
 * to reach and three of them say nothing. `src/components/chat` as one row is
 * how every file tree worth using renders that, and the id stays the full path
 * so nothing downstream has to know it happened.
 */
export function buildFileTree(files: TouchedFile[]): FileNode[] {
  const root: FileNode = { id: '', name: '', children: [] }

  for (const file of files) {
    // Both separators: paths come from whatever the model wrote, and a Windows
    // conversation mixes them freely within one transcript.
    const parts = file.path.split(/[/\\]/).filter(Boolean)
    let node = root
    parts.forEach((part, i) => {
      const last = i === parts.length - 1
      const id = parts.slice(0, i + 1).join('/')
      let next = node.children?.find((c) => c.id === id)
      if (!next) {
        next = last ? { id, name: part, file } : { id, name: part, children: [] }
        node.children = [...(node.children ?? []), next]
      }
      node = next
    })
  }

  return collapse(root.children ?? [])
}

function collapse(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (!node.children) return node
    let merged = node
    let name = node.name
    while (merged.children?.length === 1 && merged.children[0].children) {
      merged = merged.children[0]
      name = `${name}/${merged.name}`
    }
    return { ...merged, name, children: collapse(merged.children ?? []) }
  })
}
