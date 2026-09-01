import type { WorkspaceReferenceRequest } from '@/types'

export interface ComposerReference {
  /** The spelling in the draft, including the leading `@`. */
  raw: string
  /** Workspace-relative or absolute path. The backend resolves it authoritatively. */
  path: string
  lineStart?: number
  lineEnd?: number
  start: number
  end: number
}

export type ComposerIntent =
  | { kind: 'prompt'; text: string; references: ComposerReference[] }
  | { kind: 'slash'; raw: string; name: string; args: string }
  | { kind: 'shell'; raw: string; command: string }

export interface ActiveComposerToken {
  kind: 'reference' | 'slash'
  query: string
  start: number
  end: number
}

const LINE_RANGE = /#L(\d+)(?:-(?:L)?(\d+))?$/i
const TRAILING_PROSE = /[),.;:!?，。；：！？]+$/u
// PreparedContextItem persists these positions as SQLite/Rust i32 values.
const I32_MAX = 0x7fff_ffff

function splitLineRange(value: string): Pick<ComposerReference, 'path' | 'lineStart' | 'lineEnd'> {
  const match = LINE_RANGE.exec(value)
  if (!match) return { path: value }

  const lineStart = Number(match[1])
  const lineEnd = match[2] ? Number(match[2]) : lineStart
  if (
    !Number.isSafeInteger(lineStart) ||
    !Number.isSafeInteger(lineEnd) ||
    lineStart < 1 ||
    lineStart > I32_MAX ||
    lineEnd < lineStart ||
    lineEnd > I32_MAX
  ) {
    return { path: value }
  }
  return { path: value.slice(0, match.index), lineStart, lineEnd }
}

/**
 * Extract Claude-style file mentions without treating emails or escaped `@`s
 * as context references. This parser deliberately does not touch the text: the
 * visible message keeps the wording the user sent and the backend receives the
 * references beside it.
 */
export function extractComposerReferences(text: string): ComposerReference[] {
  const references: ComposerReference[] = []
  const seen = new Set<string>()
  const pattern = /(^|\s)@(?:"([^"]+)"(#[Ll]\d+(?:-(?:[Ll])?\d+)?)?|([^\s]+))/gu

  for (const match of text.matchAll(pattern)) {
    const leading = match[1] ?? ''
    const start = (match.index ?? 0) + leading.length
    const quoted = match[2]
    const quotedRange = match[3] ?? ''
    let value = quoted != null ? `${quoted}${quotedRange}` : (match[4] ?? '')
    if (!quoted) value = value.replace(TRAILING_PROSE, '')
    if (!value) continue

    const parsed = splitLineRange(value)
    if (!parsed.path) continue
    const raw = text.slice(start, start + 1 + (quoted != null ? quoted.length + 2 + quotedRange.length : value.length))
    const key = `${parsed.path.replace(/\\/g, '/')}\u0000${parsed.lineStart ?? ''}\u0000${parsed.lineEnd ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    references.push({ raw, ...parsed, start, end: start + raw.length })
  }

  return references
}

/** Parse the whole draft at submit time. */
export function parseComposerIntent(value: string): ComposerIntent {
  // A leading backslash is the explicit way to talk *about* a bang command.
  if (value.startsWith('\\!')) {
    const text = value.slice(1)
    return { kind: 'prompt', text, references: extractComposerReferences(text) }
  }
  if (value.startsWith('!')) return { kind: 'shell', raw: value, command: value.slice(1).trim() }

  const first = value.search(/\S/u)
  if (first >= 0 && value[first] === '/' && value[first - 1] !== '\\') {
    const candidate = value.slice(first)
    // A slash followed by another path separator is a path, not a command.
    const match = /^\/([\p{L}\p{N}_-]+)(?:\s+(.*))?$/u.exec(candidate)
    if (match) {
      return { kind: 'slash', raw: value, name: match[1].toLowerCase(), args: (match[2] ?? '').trim() }
    }
  }

  // Resolve references before removing an escape marker. Otherwise `\@file`
  // becomes a real attachment at the exact point where the user asked for a
  // literal mention. Positions are only editor metadata; the backend receives
  // the parsed path/range fields separately.
  const references = extractComposerReferences(value)
  const text =
    first >= 0 && value[first] === '\\' && (value[first + 1] === '/' || value[first + 1] === '@')
      ? `${value.slice(0, first)}${value.slice(first + 1)}`
      : value
  return { kind: 'prompt', text, references }
}

/** Find the token whose menu should be open at the current caret. */
export function activeComposerToken(value: string, caret: number): ActiveComposerToken | null {
  const before = value.slice(0, Math.max(0, Math.min(caret, value.length)))
  if (value.startsWith('!')) return null

  const slashStart = before.search(/\S/u)
  if (slashStart >= 0 && before[slashStart] === '/' && before[slashStart - 1] !== '\\') {
    const slash = before.slice(slashStart)
    if (/^\/[\p{L}\p{N}_-]*(?:\s+[^\s]*)?$/u.test(slash)) {
      return { kind: 'slash', query: slash.slice(1), start: slashStart, end: caret }
    }
  }

  const mention = /(^|\s)@(?:"([^"]*)"|"([^"]*)|([^\s]*))$/u.exec(before)
  if (!mention) return null
  const start = before.length - mention[0].length + (mention[1]?.length ?? 0)
  if (start > 0 && value[start - 1] === '\\') return null
  const closedQuoted = mention[2]
  // A closed quoted file is complete. A closed quoted directory remains an
  // active token so completion can replace it with one of its children.
  if (closedQuoted != null && !/[\\/]$/u.test(closedQuoted)) return null
  return {
    kind: 'reference',
    query: closedQuoted ?? mention[3] ?? mention[4] ?? '',
    start,
    end: caret,
  }
}

export function referenceInputs(references: ComposerReference[]): WorkspaceReferenceRequest[] {
  return references.map((reference) => ({
    path: reference.path,
    lineStart: reference.lineStart ?? null,
    lineEnd: reference.lineEnd ?? null,
  }))
}

export function insertReferenceToken(
  value: string,
  token: ActiveComposerToken,
  path: string,
  isDirectory: boolean,
): { value: string; caret: number; keepOpen: boolean } {
  const normalised = path.replace(/\\/g, '/')
  const completed = isDirectory && !normalised.endsWith('/') ? `${normalised}/` : normalised
  const rendered = /\s/u.test(completed) ? `@"${completed}"` : `@${completed}`
  const suffix = isDirectory ? '' : ' '
  const next = `${value.slice(0, token.start)}${rendered}${suffix}${value.slice(token.end)}`
  return { value: next, caret: token.start + rendered.length + suffix.length, keepOpen: isDirectory }
}
