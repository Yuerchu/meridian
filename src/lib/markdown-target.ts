/** A file named by assistant-authored Markdown. */
export interface MarkdownFileReference {
  path: string
  line?: number
  endLine?: number
  column?: number
}

export interface MarkdownFileCandidate {
  reference: MarkdownFileReference
  source: string
}

export type MarkdownTarget =
  | { kind: 'external'; url: string }
  | { kind: 'file'; reference: MarkdownFileReference }
  | { kind: 'file-candidate'; reference: MarkdownFileReference }
  | { kind: 'fragment'; id: string }
  | { kind: 'unsupported' }

const FILE_REFERENCE_PREFIX = '#meridian-file='
const FILE_CANDIDATE_PREFIX = '#meridian-file-candidate='
// File-preview positions eventually enter PreparedContextItem's i32 fields.
const I32_MAX = 0x7fff_ffff

/** Extensions which are sufficiently file-like without a directory prefix. */
const FILE_EXTENSION =
  /\.(?:c|cc|cpp|css|csv|dart|diff|dockerfile|env|go|graphql|h|hpp|html?|java|js|jsx|json|jsonc|kt|less|lock|lua|md|mdx|mjs|mts|php|pl|properties|proto|ps1|py|rb|rs|sass|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)$/i

const KNOWN_FILE_NAME = /^(?:dockerfile|makefile|readme|license|gemfile|rakefile|\.env(?:\.[\w.-]+)?|\.gitignore)$/i

function validPosition(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= I32_MAX
}

function validOptionalPosition(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && validPosition(value))
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripLocation(value: string): MarkdownFileReference | null {
  const hash = /#L(\d+)(?:-L?(\d+))?(?:C(\d+))?$/i.exec(value)
  if (hash) {
    const line = Number(hash[1])
    const endLine = hash[2] ? Number(hash[2]) : undefined
    const column = hash[3] ? Number(hash[3]) : undefined
    if (
      !validPosition(line) ||
      (endLine !== undefined && !validPosition(endLine)) ||
      (column !== undefined && !validPosition(column))
    ) {
      return null
    }
    return {
      path: value.slice(0, hash.index),
      line,
      ...(endLine && endLine >= line ? { endLine } : {}),
      ...(column ? { column } : {}),
    }
  }

  const colon = /:(\d+)(?::(\d+))?$/.exec(value)
  if (colon) {
    const line = Number(colon[1])
    const column = colon[2] ? Number(colon[2]) : undefined
    if (!validPosition(line) || (column !== undefined && !validPosition(column))) return null
    return {
      path: value.slice(0, colon.index),
      line,
      ...(column ? { column } : {}),
    }
  }

  return { path: value }
}

function fileUriPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodePath(`${url.pathname}${url.hash}`)
    if (url.hostname && url.hostname !== 'localhost') {
      return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
    }
    // WHATWG keeps the slash before a Windows drive in file:///C:/path.
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return null
  }
}

export function isLikelyFilePath(value: string): boolean {
  const path = value.trim()
  if (!path || path === '.' || path === '..' || /[\r\n]/.test(path) || /[\\/]$/.test(path)) return false
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return false
  if (/^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(path)) return true
  const name = path.split(/[\\/]/).pop() ?? path
  return KNOWN_FILE_NAME.test(name) || FILE_EXTENSION.test(name)
}

function isFilePathCandidate(value: string): boolean {
  const path = value.trim()
  if (!path || path === '.' || path === '..' || /[\r\n]/.test(path) || /[\\/]$/.test(path)) return false
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return false
  return /[\\/]/.test(path) || isLikelyFilePath(path)
}

export function parseMarkdownFileReference(value: string): MarkdownFileReference | null {
  const decoded = decodePath(value.trim().replace(/^<|>$/g, ''))
  const reference = stripLocation(decoded)
  if (!reference || !isLikelyFilePath(reference.path)) return null
  return reference
}

export function parseMarkdownFileCandidate(value: string): MarkdownFileReference | null {
  const decoded = decodePath(value.trim().replace(/^<|>$/g, ''))
  const reference = stripLocation(decoded)
  if (!reference || !isFilePathCandidate(reference.path)) return null
  return reference
}

function parseFileReferenceMarker(value: string, candidate = false): MarkdownFileReference | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as MarkdownFileReference).path !== 'string' ||
      !validOptionalPosition((parsed as MarkdownFileReference).line) ||
      !validOptionalPosition((parsed as MarkdownFileReference).endLine) ||
      !validOptionalPosition((parsed as MarkdownFileReference).column) ||
      ((parsed as MarkdownFileReference).endLine !== undefined &&
        (parsed as MarkdownFileReference).line !== undefined &&
        (parsed as MarkdownFileReference).endLine! < (parsed as MarkdownFileReference).line!) ||
      !(candidate ? isFilePathCandidate : isLikelyFilePath)((parsed as MarkdownFileReference).path)
    ) {
      return null
    }
    return parsed as MarkdownFileReference
  } catch {
    return null
  }
}

/**
 * Classify first, then act. Assistant output is untrusted and must never be
 * handed to the WebView's own navigation as a fallback.
 */
export function classifyMarkdownTarget(value: string | undefined): MarkdownTarget {
  const href = value?.trim()
  if (!href) return { kind: 'unsupported' }

  if (href.startsWith(FILE_CANDIDATE_PREFIX)) {
    const reference = parseFileReferenceMarker(href.slice(FILE_CANDIDATE_PREFIX.length), true)
    return reference ? { kind: 'file-candidate', reference } : { kind: 'unsupported' }
  }

  if (href.startsWith(FILE_REFERENCE_PREFIX)) {
    const reference = parseFileReferenceMarker(href.slice(FILE_REFERENCE_PREFIX.length))
    return reference ? { kind: 'file', reference } : { kind: 'unsupported' }
  }

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'external', url: url.href }
    } catch {
      // Fall through to the refusal below.
    }
    return { kind: 'unsupported' }
  }

  if (/^\/\//.test(href)) {
    try {
      return { kind: 'external', url: new URL(`https:${href}`).href }
    } catch {
      return { kind: 'unsupported' }
    }
  }

  if (/^www\./i.test(href)) {
    try {
      return { kind: 'external', url: new URL(`https://${href}`).href }
    } catch {
      return { kind: 'unsupported' }
    }
  }

  if (/^file:/i.test(href)) {
    const path = fileUriPath(href)
    const reference = path ? parseMarkdownFileReference(path) : null
    return reference ? { kind: 'file', reference } : { kind: 'unsupported' }
  }

  if (href.startsWith('#')) return { kind: 'fragment', id: decodePath(href.slice(1)) }

  // A Windows drive is a path, not the URI scheme `c:`.
  if (!/^[A-Za-z]:[\\/]/.test(href) && /^[a-z][a-z\d+.-]*:/i.test(href)) {
    return { kind: 'unsupported' }
  }

  const reference = parseMarkdownFileReference(href)
  return reference ? { kind: 'file', reference } : { kind: 'unsupported' }
}

export function markdownFileReferenceHref(reference: MarkdownFileReference): string {
  return `${FILE_REFERENCE_PREFIX}${encodeURIComponent(JSON.stringify(reference))}`
}

export function markdownFileCandidateHref(reference: MarkdownFileReference): string {
  return `${FILE_CANDIDATE_PREFIX}${encodeURIComponent(JSON.stringify(reference))}`
}

export function markdownFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const AUTO_FILE_PATTERN = new RegExp(
  String.raw`(^|[\s([{<"'\u201c\u2018])(` +
    String.raw`(?:[A-Za-z]:[\\/][^\s<>"'\u201c\u201d\u2018\u2019]+|\\\\[^\s<>"'\u201c\u201d\u2018\u2019]+|(?:\.{1,2}[\\/]|/)[^\s<>"'\u201c\u201d\u2018\u2019]+|(?:[\p{L}\p{N}_@~.-]+[\\/])+[^\s<>"'\u201c\u201d\u2018\u2019]+|[\p{L}\p{N}_@~()-]+\.(?:c|cc|cpp|css|csv|dart|diff|go|graphql|h|hpp|html?|java|js|jsx|json|jsonc|kt|less|lock|lua|md|mdx|mjs|mts|php|pl|properties|proto|ps1|py|rb|rs|sass|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)(?:#L\d+(?:-L?\d+)?(?:C\d+)?|:\d+(?::\d+)?)?))` +
    String.raw`(?=$|[\s)\]}>"'\u201d\u2019,.;!?\uff0c\u3002\uff1b\uff01\uff1f])`,
  'giu',
)

/** Split a Markdown text node into unresolved candidates without touching the workspace. */
export function splitTextFileReferences(value: string): Array<string | MarkdownFileCandidate> {
  const parts: Array<string | MarkdownFileCandidate> = []
  let cursor = 0
  AUTO_FILE_PATTERN.lastIndex = 0

  for (const match of value.matchAll(AUTO_FILE_PATTERN)) {
    const leading = match[1] ?? ''
    let candidate = match[2] ?? ''
    // Sentence punctuation is not part of a path. Line/column suffixes are
    // consumed by the parser before this tail can be reached.
    candidate = candidate.replace(/[),.;!?\]}，。；！？]+$/u, '')
    const reference = parseMarkdownFileCandidate(candidate)
    if (!reference) continue

    const start = (match.index ?? 0) + leading.length
    if (start > cursor) parts.push(value.slice(cursor, start))
    parts.push({ reference, source: candidate })
    cursor = start + candidate.length
  }

  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts.length ? parts : [value]
}

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
  url?: string
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

const OPAQUE_MARKDOWN_NODES = new Set(['link', 'image', 'code', 'inlineCode', 'html'])

function underscoreAttentionSource(node: MarkdownAstNode, source: string): string | null {
  if (node.type !== 'strong' && node.type !== 'emphasis') return null
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start === undefined || end === undefined || start < 0 || end <= start || end > source.length) return null
  const raw = source.slice(start, end)
  const marker = node.type === 'strong' ? '__' : '_'
  return raw.startsWith(marker) && raw.endsWith(marker) && raw.length > marker.length * 2 ? raw : null
}

function candidateSpanning(
  value: string,
  middleStart: number,
  middleEnd: number,
): { start: number; end: number; candidate: MarkdownFileCandidate } | null {
  let cursor = 0
  for (const part of splitTextFileReferences(value)) {
    if (typeof part === 'string') {
      cursor += part.length
      continue
    }
    const start = cursor
    const end = start + part.source.length
    if (start <= middleStart && end >= middleEnd) return { start, end, candidate: part }
    cursor = end
  }
  return null
}

/**
 * CommonMark reads the double underscores in `fastapi/__init__.md` as strong
 * emphasis before remark plugins run. Rejoin only a candidate which spans the
 * entire underscore-delimited node; unrelated emphasis remains untouched.
 */
function restoreUnderscoreCandidates(node: MarkdownAstNode, source: string): void {
  if (!node.children || OPAQUE_MARKDOWN_NODES.has(node.type)) return

  let index = 0
  while (index < node.children.length) {
    const middle = node.children[index]
    const rawMiddle = underscoreAttentionSource(middle, source)
    if (!rawMiddle) {
      restoreUnderscoreCandidates(middle, source)
      index += 1
      continue
    }

    const hasLeft = index > 0 && node.children[index - 1].type === 'text'
    const hasRight = index + 1 < node.children.length && node.children[index + 1].type === 'text'
    const left = hasLeft ? (node.children[index - 1].value ?? '') : ''
    const right = hasRight ? (node.children[index + 1].value ?? '') : ''
    const middleStart = left.length
    const middleEnd = middleStart + rawMiddle.length
    const span = candidateSpanning(`${left}${rawMiddle}${right}`, middleStart, middleEnd)
    if (!span) {
      restoreUnderscoreCandidates(middle, source)
      index += 1
      continue
    }

    const prefix = left.slice(0, span.start)
    const candidateLeft = left.slice(span.start)
    const candidateRight = right.slice(0, span.end - middleEnd)
    const suffix = right.slice(span.end - middleEnd)
    const candidateChildren: MarkdownAstNode[] = []
    if (candidateLeft) candidateChildren.push({ type: 'text', value: candidateLeft })
    candidateChildren.push(middle)
    if (candidateRight) candidateChildren.push({ type: 'text', value: candidateRight })

    const replacement: MarkdownAstNode[] = []
    if (prefix) replacement.push({ type: 'text', value: prefix })
    replacement.push({
      type: 'link',
      url: markdownFileCandidateHref(span.candidate.reference),
      children: candidateChildren,
    })
    if (suffix) replacement.push({ type: 'text', value: suffix })

    const first = hasLeft ? index - 1 : index
    const count = 1 + Number(hasLeft) + Number(hasRight)
    node.children.splice(first, count, ...replacement)
    index = first + replacement.length
  }
}

function transformTextNodes(node: MarkdownAstNode): void {
  if (!node.children || OPAQUE_MARKDOWN_NODES.has(node.type)) return
  const children: MarkdownAstNode[] = []
  for (const child of node.children) {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformTextNodes(child)
      children.push(child)
      continue
    }

    for (const part of splitTextFileReferences(child.value)) {
      if (typeof part === 'string') {
        if (part) children.push({ type: 'text', value: part })
      } else {
        children.push({
          type: 'link',
          url: markdownFileCandidateHref(part.reference),
          children: [{ type: 'text', value: part.source }],
        })
      }
    }
  }
  node.children = children
}

/** A tiny remark plugin kept local so file recognition stays testable. */
export function remarkFileReferences() {
  return (tree: MarkdownAstNode, file?: { value?: unknown }) => {
    if (typeof file?.value === 'string') restoreUnderscoreCandidates(tree, file.value)
    transformTextNodes(tree)
  }
}
