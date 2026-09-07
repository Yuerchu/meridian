import { generateJSON, type JSONContent } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { createTwoFilesPatch } from 'diff'
import { marked } from 'marked'

import type { JsonValue } from '@/types'

export const PLAN_EDITOR_SCHEMA_VERSION = 1
export const PLAN_EDITOR_SCHEMA_HASH = 'meridian-plan-markdown-v1'

export type PlanMarkdownFallbackReason =
  | 'raw_html'
  | 'image'
  | 'footnote'
  | 'heading_level'
  | 'table'
  | 'task_list'
  | 'editor_schema'
  | 'saved_source'
  | 'unsupported'
  | 'malformed'

export type ParsedPlanMarkdown =
  | { mode: 'rich'; document: JSONContent; normalizedMarkdown: string }
  | { mode: 'source'; sourceText: string; reason: PlanMarkdownFallbackReason }

const editorExtensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } })]

function sourceFallbackReason(markdown: string): PlanMarkdownFallbackReason | null {
  if (/<(?:!--|\/?[a-z][^>\n]*)>/i.test(markdown)) return 'raw_html'
  if (/!\[[^\]]*\]\s*(?:\([^\n)]*\)|\[[^\]]*\])/.test(markdown)) return 'image'
  if (/(?:^|\n)\[\^[^\]]+\]:|\[\^[^\]]+\]/.test(markdown)) return 'footnote'
  if (/^#{4,}\s/m.test(markdown)) return 'heading_level'
  if (/^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m.test(markdown)) return 'table'
  if (/^\s*[-+*]\s+\[[ xX]\]\s+/m.test(markdown)) return 'task_list'
  // Reference definitions are valid Markdown but StarterKit has nowhere to
  // preserve the definition itself. Falling back is preferable to converting
  // it into an inline link and silently changing the source document.
  if (/^\s*\[[^\]^]+\]:\s*\S+/m.test(markdown)) return 'unsupported'
  return null
}

function jsonContent(value: JsonValue | null): JSONContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, JsonValue>
  if (candidate.type !== 'doc' || !Array.isArray(candidate.content)) return null
  return value as JSONContent
}

export function planEditorDocument(value: JsonValue | null): JSONContent | null {
  return jsonContent(value)
}

function markedHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true })
  if (typeof html !== 'string') throw new Error('marked returned an asynchronous result')
  return html
}

export function parsePlanMarkdown(markdown: string): ParsedPlanMarkdown {
  const unsupported = sourceFallbackReason(markdown)
  if (unsupported) return { mode: 'source', sourceText: markdown, reason: unsupported }

  try {
    const document = generateJSON(markedHtml(markdown), editorExtensions)
    const normalizedMarkdown = serializePlanDocument(document)
    // The serializer is deliberately a closed grammar. A second pass proves
    // that its own output has a stable semantic representation before an
    // editable WYSIWYG is offered.
    const reparsed = generateJSON(markedHtml(normalizedMarkdown), editorExtensions)
    if (
      JSON.stringify(reparsed) !== JSON.stringify(document) ||
      serializePlanDocument(reparsed) !== normalizedMarkdown
    ) {
      return { mode: 'source', sourceText: markdown, reason: 'malformed' }
    }
    return { mode: 'rich', document, normalizedMarkdown }
  } catch {
    return { mode: 'source', sourceText: markdown, reason: 'malformed' }
  }
}

function textContent(node: JSONContent): string {
  return (node.content ?? []).map((child) => (child.type === 'text' ? (child.text ?? '') : textContent(child))).join('')
}

function codeSpan(value: string): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  const padding = /^\s|\s$/.test(value) && value.trim() ? ' ' : ''
  return `${fence}${padding}${value}${padding}${fence}`
}

function escapeInline(value: string): string {
  return value.replace(/([\\*_`~[\]<>])/g, '\\$1')
}

function serializeText(node: JSONContent): string {
  const marks = node.marks ?? []
  const code = marks.some((mark) => mark.type === 'code')
  let value = code ? codeSpan(node.text ?? '') : escapeInline(node.text ?? '')

  for (const mark of marks) {
    if (mark.type === 'code') continue
    if (mark.type === 'bold') value = `**${value}**`
    else if (mark.type === 'italic') value = `_${value}_`
    else if (mark.type === 'strike') value = `~~${value}~~`
    else if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
      if (!href) throw new Error('link mark is missing href')
      const title = typeof mark.attrs?.title === 'string' && mark.attrs.title ? ` "${mark.attrs.title}"` : ''
      value = `[${value}](${href.replace(/\)/g, '\\)')}${title})`
    } else {
      throw new Error(`unsupported plan mark: ${String(mark.type)}`)
    }
  }
  return value
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'text') return serializeText(node)
      if (node.type === 'hardBreak') return '  \n'
      throw new Error(`unsupported inline plan node: ${String(node.type)}`)
    })
    .join('')
}

function escapeBlockLeadingSyntax(value: string): string {
  return value
    .split('\n')
    .map((line) => {
      if (/^\s*(?:-{3,}|={3,})\s*$/.test(line)) return line.replace(/^(\s*)([-=])/, '$1\\$2')
      if (/^\s*#{1,6}(?:\s|$)/.test(line)) return line.replace(/^(\s*)#/, '$1\\#')
      if (/^\s*[-+>](?:\s|$)/.test(line)) return line.replace(/^(\s*)([-+>])/, '$1\\$2')
      if (/^\s*\d+[.)](?:\s|$)/.test(line)) return line.replace(/^(\s*\d+)([.)])/, '$1\\$2')
      if (/^\s*(?:`{3,}|~{3,})/.test(line)) return line.replace(/^(\s*)([`~])/, '$1\\$2')
      if (/^\s*\|/.test(line)) return line.replace(/^(\s*)\|/, '$1\\|')
      return line
    })
    .join('\n')
}

function indentContinuation(value: string, width: number): string {
  const indent = ' '.repeat(width)
  return value
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `${indent}${line}`))
    .join('\n')
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && (node.content ?? []).length === 0
}

/** Markdown has no spelling for an empty paragraph, so one is skipped rather
 *  than written as a run of blank lines the parser would fold away anyway. */
function serializeBlocks(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .filter((node) => !isEmptyParagraph(node))
    .map(serializeBlock)
    .join('\n\n')
}

function serializeListItem(node: JSONContent, marker: string): string {
  if (node.type !== 'listItem') throw new Error(`unsupported list child: ${String(node.type)}`)
  const continuation = indentContinuation(serializeBlocks(node.content), marker.length)
  return `${marker}${continuation}`
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return escapeBlockLeadingSyntax(serializeInline(node.content))
    case 'heading': {
      const level = Number(node.attrs?.level)
      if (![1, 2, 3].includes(level)) throw new Error(`unsupported heading level: ${String(level)}`)
      return `${'#'.repeat(level)} ${serializeInline(node.content)}`
    }
    case 'blockquote':
      return serializeBlocks(node.content)
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n')
    case 'bulletList':
      return (node.content ?? []).map((child) => serializeListItem(child, '- ')).join('\n')
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
      return (node.content ?? []).map((child, index) => serializeListItem(child, `${start + index}. `)).join('\n')
    }
    case 'codeBlock': {
      const content = textContent(node).replace(/\n$/, '')
      const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length))
      const fence = '`'.repeat(longest + 1)
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `${fence}${language}\n${content}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    default:
      throw new Error(`unsupported plan block: ${String(node.type)}`)
  }
}

function serializePlanDocumentUnchecked(document: JSONContent): string {
  if (document.type !== 'doc') throw new Error('plan editor value must be a doc')
  const markdown = serializeBlocks(document.content).trimEnd()
  return markdown ? `${markdown}\n` : ''
}

/** The tree with every empty paragraph removed, except where that would leave
 *  a block with no children at all — the parser fills one back in there, so
 *  both sides of the round-trip check keep exactly one. */
function withoutEmptyParagraphs(node: JSONContent): JSONContent {
  if (!node.content) return node
  const kept = node.content.map(withoutEmptyParagraphs).filter((child) => !isEmptyParagraph(child))
  const content = kept.length === 0 && node.content.length > 0 ? [{ type: 'paragraph' }] : kept
  return { ...node, content }
}

/** Drop the empty paragraphs the live editor keeps after a trailing list,
 *  heading or code block. StarterKit's `TrailingNode` appends one on the first
 *  transaction — a click into the editor is enough — and Markdown cannot write
 *  it, so it is an editing affordance rather than content and must not read
 *  as an edit. Only the tail is touched: nothing removed sits before a comment
 *  anchor, so no ProseMirror position moves. */
export function normalizePlanEditorDocument(document: JSONContent): JSONContent {
  const content = document.content ?? []
  let end = content.length
  while (end > 1 && isEmptyParagraph(content[end - 1])) end -= 1
  return end === content.length ? document : { ...document, content: content.slice(0, end) }
}

/** Serialize only when the emitted Markdown reparses into the same editor tree.
 *  This is also the save boundary for live RichTextEditor values, not merely a
 *  check performed when opening an existing plan. Empty paragraphs are not part
 *  of that tree's semantics — Markdown cannot hold one — so the comparison
 *  ignores them; a trailing hard break, which Markdown also drops, still fails. */
export function serializePlanDocument(document: JSONContent): string {
  const markdown = serializePlanDocumentUnchecked(document)
  const reparsed = generateJSON(markedHtml(markdown), editorExtensions)
  if (JSON.stringify(withoutEmptyParagraphs(reparsed)) !== JSON.stringify(withoutEmptyParagraphs(document))) {
    throw new Error('serialized plan Markdown changes the editor document semantics')
  }
  return markdown
}

export function planSuggestionPatch(baseMarkdown: string, draftMarkdown: string): string {
  if (baseMarkdown === draftMarkdown) return ''
  return createTwoFilesPatch('plan.md', 'plan.md', baseMarkdown, draftMarkdown, 'reviewed', 'suggested', {
    context: 4,
  })
}
