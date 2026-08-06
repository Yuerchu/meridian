import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines, parsePatch } from 'diff'
import hljs from 'highlight.js/lib/common'
import { fileIconUrl } from '@/lib/file-icon'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUturnCcwLeft, Check, ChevronUp, Circle, CircleCheck, CircleDashed,
  CircleQuestion, Compass, FileText, ForwardStep, Globe, ListCheck,
  PaperPlane, Square, SquareCheck, SquareListUl, TriangleExclamation, Xmark,
} from '@gravity-ui/icons'
import { Button, Input } from '@heroui/react'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolResult,
  ChatToolStatusIcon,
  ChatToolTrigger,
  type ChatToolState,
} from '@/components/ui/chat-tool'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { parseTodoArgs, todoProgress, TodoItemList, type TodoDraft } from './todo-list'
import { MarkdownContent } from './markdown-content'
import type { ToolCallDisplay } from '@/types'

interface AskOption {
  label: string
  description?: string
}

interface AskQuestion {
  id: string
  question: string
  options?: AskOption[]
  multi_select?: boolean
}

interface QuestionAnswer {
  selected: string | string[] | null
  notes: string
}

function emptyAnswer(q: AskQuestion): QuestionAnswer {
  return { selected: q.multi_select ? [] : null, notes: '' }
}

function hasContent(a: QuestionAnswer | undefined): boolean {
  if (!a) return false
  if (a.notes.trim()) return true
  if (Array.isArray(a.selected)) return a.selected.length > 0
  return a.selected !== null
}

function formatAnswer(a: QuestionAnswer | undefined, skipped: boolean): string {
  if (skipped) return '(skipped)'
  if (!a) return '(skipped)'
  const sel = Array.isArray(a.selected)
    ? a.selected.join(', ')
    : a.selected
  const notes = a.notes.trim()
  if (sel && notes) return `${sel}\n\nNotes: ${notes}`
  if (sel) return sel
  if (notes) return notes
  return '(no answer)'
}

function QuestionBlock({
  q,
  value,
  skipped,
  onChange,
  onSkip,
  onUnskip,
}: {
  q: AskQuestion
  value: QuestionAnswer
  skipped: boolean
  onChange: (id: string, val: QuestionAnswer) => void
  onSkip: (id: string) => void
  onUnskip: (id: string) => void
}) {
  const { t } = useTranslation()
  const hasOptions = q.options && q.options.length > 0
  const isMulti = q.multi_select === true

  const toggleMulti = (label: string) => {
    const arr = Array.isArray(value.selected) ? value.selected : []
    const next = arr.includes(label) ? arr.filter((v) => v !== label) : [...arr, label]
    onChange(q.id, { ...value, selected: next })
  }

  const selectSingle = (label: string) => {
    onChange(q.id, { ...value, selected: value.selected === label ? null : label })
  }

  if (skipped) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted line-through">{q.question}</span>
        <Button
          variant="ghost"
          onClick={() => onUnskip(q.id)}
          className="text-xs text-muted shrink-0 ml-2"
        >
          <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
          {t('chat.tool.undo')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-foreground font-medium">{q.question}</div>
        <Button
          variant="ghost"
          onClick={() => onSkip(q.id)}
          className="text-xs text-muted shrink-0 mt-0.5"
        >
          <ForwardStep className="w-3.5 h-3.5" />
          {t('chat.tool.skipQuestion')}
        </Button>
      </div>

      {hasOptions && (
        <div className="space-y-1">
          {q.options!.map((opt) => {
            const checked = isMulti
              ? (Array.isArray(value.selected) && value.selected.includes(opt.label))
              : value.selected === opt.label

            return (
              <Button
                key={opt.label}
                variant="ghost"
                onClick={() => isMulti ? toggleMulti(opt.label) : selectSingle(opt.label)}
                className={`w-full justify-start gap-2 h-auto rounded-lg px-2.5 py-1.5 text-left ${
                  checked
                    ? 'bg-default/80 text-default-foreground'
                    : 'text-muted'
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isMulti
                    ? (checked
                      ? <SquareCheck className="w-3.5 h-3.5 text-foreground" />
                      : <Square className="w-3.5 h-3.5" />)
                    : (checked
                      ? <CircleCheck className="w-3.5 h-3.5 text-foreground" />
                      : <Circle className="w-3.5 h-3.5" />)
                  }
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-xs text-muted">{opt.description}</span>
                  )}
                </span>
              </Button>
            )
          })}
        </div>
      )}

      <Input fullWidth
        type="text"
        value={value.notes}
        onChange={(e) => onChange(q.id, { ...value, notes: e.target.value })}
        placeholder={hasOptions ? t('chat.tool.notesPlaceholder') : t('chat.tool.askUserPlaceholder')}
        className="text-xs"
        autoFocus={!hasOptions}
      />
    </div>
  )
}

function AskUserBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})
  const [skippedSet, setSkippedSet] = useState<Set<string>>(new Set())

  let questions: AskQuestion[] = []
  try {
    const parsed = JSON.parse(data.arguments)
    questions = parsed.questions || []
  } catch {
    // ignore
  }

  const getAnswer = (id: string, q: AskQuestion) => answers[id] ?? emptyAnswer(q)

  const handleChange = useCallback((id: string, val: QuestionAnswer) => {
    setAnswers((prev) => ({ ...prev, [id]: val }))
    setSkippedSet((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleSkip = useCallback((id: string) => {
    setSkippedSet((prev) => new Set(prev).add(id))
  }, [])

  const handleUnskip = useCallback((id: string) => {
    setSkippedSet((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleSubmit = useCallback(() => {
    const result: Record<string, string> = {}
    for (const q of questions) {
      result[q.id] = formatAnswer(answers[q.id], skippedSet.has(q.id))
    }
    api.respondToAsk(data.call_id, JSON.stringify(result))
  }, [answers, skippedSet, questions, data.call_id])

  const canSubmit = questions.some((q) =>
    skippedSet.has(q.id) || hasContent(answers[q.id])
  )

  return (
    <div className="my-3 overflow-hidden rounded-2xl bg-surface text-sm shadow-surface">
      <div className="flex items-center gap-2 bg-default px-4 py-3">
        <CircleQuestion className="w-3.5 h-3.5 text-muted" />
        <span className="font-medium text-foreground">{t('chat.tool.askUser')}</span>
        {data.status === 'running' && <CircleDashed className="w-3.5 h-3.5 animate-spin text-muted ml-auto" />}
        {data.status === 'completed' && <Check className="w-3.5 h-3.5 text-success-soft-foreground ml-auto" />}
      </div>

      {data.status === 'pending' && (
        <div className="space-y-3 px-4 py-3">
          {questions.map((q) => (
            <QuestionBlock
              key={q.id}
              q={q}
              value={getAnswer(q.id, q)}
              skipped={skippedSet.has(q.id)}
              onChange={handleChange}
              onSkip={handleSkip}
              onUnskip={handleUnskip}
            />
          ))}
          <div className="pt-1">
            <Button
              onClick={handleSubmit}
              isDisabled={!canSubmit}
            >
              <PaperPlane className="w-3.5 h-3.5" />
              {t('chat.tool.askUserSubmit')}
            </Button>
          </div>
        </div>
      )}

      {data.result && (
        <div className="border-t border-separator bg-default/40">
          <div className="max-h-40 overflow-y-auto ">
            <pre className="whitespace-pre-wrap text-foreground px-4 py-3 text-xs">
              {data.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

function getHljsLang(ext: string): string | null {
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', less: 'less', json: 'json', yaml: 'yaml',
    yml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', lua: 'lua',
    r: 'r', dart: 'dart', vue: 'xml', svelte: 'xml',
  }
  return map[ext] ?? null
}

// ---- Diff rendering for file-editing tools (write_file / edit_file / apply_patch) ----

type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk'

interface DiffLine {
  kind: DiffLineKind
  text: string
}

interface FileDiff {
  path: string
  op: 'create' | 'delete' | 'modify'
  replaceAll?: boolean
  lines: DiffLine[]
}

const MAX_DIFF_LINES = 300

function splitDiffText(s: string): string[] {
  const lines = s.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function writeFileDiff(args: Record<string, unknown>): FileDiff[] | null {
  const path = typeof args.path === 'string' ? args.path : null
  const content = typeof args.content === 'string' ? args.content : null
  if (path === null || content === null) return null
  return [{
    path,
    op: 'modify',
    lines: splitDiffText(content).map((text): DiffLine => ({ kind: 'add', text })),
  }]
}

function editFileDiff(args: Record<string, unknown>): FileDiff[] | null {
  const path = typeof args.file_path === 'string' ? args.file_path : null
  const oldStr = typeof args.old_string === 'string' ? args.old_string : null
  const newStr = typeof args.new_string === 'string' ? args.new_string : null
  if (path === null || oldStr === null || newStr === null) return null
  const lines: DiffLine[] = []
  for (const change of diffLines(oldStr, newStr)) {
    const kind: DiffLineKind = change.added ? 'add' : change.removed ? 'remove' : 'context'
    for (const text of splitDiffText(change.value)) lines.push({ kind, text })
  }
  return [{
    path,
    op: 'modify',
    replaceAll: args.replace_all === true,
    lines,
  }]
}

// Codex-style patch: *** Begin Patch / *** Update File: x / @@ ctx / +- lines / *** End Patch
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
      cur.path = `${cur.path} → ${move[1].trim()}`
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

function stripDiffPrefix(p: string): string {
  const trimmed = p.trim()
  return trimmed.startsWith('a/') || trimmed.startsWith('b/') ? trimmed.slice(2) : trimmed
}

// Line-scanning fallback for diffs jsdiff rejects, e.g. hunk headers whose
// line counts are wrong — models miscount them routinely.
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

function applyPatchDiff(args: Record<string, unknown>): FileDiff[] | null {
  const patch = typeof args.patch === 'string' ? args.patch : null
  if (patch === null) return null
  const parsed = /^\*\*\* (Begin Patch|Update File|Add File|Delete File)/m.test(patch)
    ? parseCodexPatch(patch)
    : parseUnifiedPatch(patch)
  if (parsed.length > 0) return parsed
  // Unrecognized format: still show the raw patch with real newlines.
  return [{
    path: '',
    op: 'modify',
    lines: splitDiffText(patch).map((text): DiffLine => ({ kind: 'context', text })),
  }]
}

function toolFileDiffs(toolName: string, args: Record<string, unknown>): FileDiff[] | null {
  switch (toolName) {
    case 'write_file':
      return writeFileDiff(args)
    case 'edit_file':
      return editFileDiff(args)
    case 'apply_patch':
      return applyPatchDiff(args)
    default:
      return null
  }
}

/** Highlighted lines keep the tint and give up the tinted foreground: syntax
 *  colours are the point of turning it on, and a green identifier on a green
 *  wash reads worse than either alone. The sign in the gutter stays coloured,
 *  so added and removed are still one glance apart. */
function diffLineClass(kind: DiffLineKind, highlighted: boolean): string {
  switch (kind) {
    case 'add':
      return highlighted ? 'bg-success/10 text-foreground/80' : 'bg-success/10 text-success-soft-foreground'
    case 'remove':
      return highlighted ? 'bg-danger/10 text-foreground/80' : 'bg-danger/10 text-danger'
    case 'hunk':
      return 'text-muted'
    default:
      return 'text-foreground/80'
  }
}

function diffSignClass(kind: DiffLineKind): string | undefined {
  if (kind === 'add') return 'text-success-soft-foreground'
  if (kind === 'remove') return 'text-danger'
  return undefined
}

/** Extensions highlight.js does not already know by that name. Everything else
 *  (`ts`, `py`, `rs`, `json`, `yml`, …) is an alias it resolves on its own. */
const EXT_ALIASES: Record<string, string> = {
  tsx: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  h: 'c',
  hpp: 'cpp',
  vue: 'xml',
  svelte: 'xml',
}

function diffLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext || ext === path.toLowerCase()) return undefined
  const name = EXT_ALIASES[ext] ?? ext
  return hljs.getLanguage(name) ? name : undefined
}

/**
 * Highlights each line on its own rather than the file as a whole.
 *
 * A diff is not a program: its lines come from two versions at once and the
 * context between them is missing, so there is no whole to parse. Line by line
 * a template literal or block comment spanning several lines loses its colour
 * after the first — the price of colouring the other 99%.
 */
function highlightDiffLine(text: string, language: string): string {
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}

function diffLinePrefix(kind: DiffLineKind): string {
  switch (kind) {
    case 'add':
      return '+ '
    case 'remove':
      return '- '
    case 'hunk':
      return ''
    default:
      return '  '
  }
}

function FileIcon({ path }: { path: string }) {
  const src = fileIconUrl(path)
  if (!src) return <FileText className="w-3.5 h-3.5 shrink-0" />
  // Decorative: the file name it sits beside already names the file.
  return <img src={src} alt="" aria-hidden className="size-3.5 shrink-0" />
}

function FileDiffCard({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation()
  const added = diff.lines.filter((l) => l.kind === 'add').length
  const removed = diff.lines.filter((l) => l.kind === 'remove').length
  const fileName = diff.path.split(/[/\\]/).pop() ?? diff.path
  const shown = diff.lines.slice(0, MAX_DIFF_LINES)
  const hidden = diff.lines.length - shown.length
  const language = diffLanguage(diff.path)

  return (
    <div data-slot="file-diff" className="rounded-lg bg-default/40 overflow-hidden">
      {diff.path !== '' && (
        <div
          data-slot="file-diff-header"
          className="flex items-center gap-2 px-3 py-1 bg-default/30 text-xs text-muted border-b border-border/50"
        >
          <FileIcon path={diff.path} />
          <span className="font-mono truncate" title={diff.path}>{fileName}</span>
          {diff.op === 'create' && <span className="text-success-soft-foreground shrink-0">{t('chat.tool.diff.newFile')}</span>}
          {diff.op === 'delete' && <span className="text-danger shrink-0">{t('chat.tool.diff.deletedFile')}</span>}
          {diff.replaceAll && <span className="shrink-0">{t('chat.tool.diff.replaceAll')}</span>}
          {(added > 0 || removed > 0) && (
            <span data-slot="file-diff-stats" className="ml-auto shrink-0 font-mono">
              {added > 0 && <span className="text-success-soft-foreground">+{added}</span>}
              {added > 0 && removed > 0 && ' '}
              {removed > 0 && <span className="text-danger">-{removed}</span>}
            </span>
          )}
        </div>
      )}
      <div data-slot="file-diff-content" className="max-h-60 overflow-auto">
        <div className="py-1 font-mono text-xs leading-relaxed w-max min-w-full">
          {shown.map((line, i) => (
            <div
              key={i}
              data-slot="file-diff-line"
              data-kind={line.kind}
              className={cn('px-3 whitespace-pre', diffLineClass(line.kind, !!language))}
            >
              <span className={diffSignClass(line.kind)}>{diffLinePrefix(line.kind)}</span>
              {language && line.kind !== 'hunk' && line.text
                // hljs escapes what it emits, and the sign beside it is ours.
                ? <span dangerouslySetInnerHTML={{ __html: highlightDiffLine(line.text, language) }} />
                : line.text || ' '}
            </div>
          ))}
          {hidden > 0 && (
            <div className="px-3 text-muted/60">
              {t('chat.tool.diff.moreLines', { count: hidden })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReadFileResult({ result, path }: { result: string; path: string }) {
  const ext = getFileExtension(path)
  const lang = getHljsLang(ext)
  const fileName = path.split(/[/\\]/).pop() ?? path

  return (
    <div className="rounded-lg bg-default/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 bg-default/30 text-xs text-muted border-b border-border/50">
        <FileIcon path={path} />
        <span className="font-mono truncate">{fileName}</span>
      </div>
      <div className="max-h-60 overflow-auto">
        <pre className="text-xs leading-relaxed px-3 py-2">
          <code className={lang ? `language-${lang} hljs` : ''}>
            {result.length > 2000 ? `${result.slice(0, 2000)}...` : result}
          </code>
        </pre>
      </div>
    </div>
  )
}

interface SearchMatch {
  file: string
  line: number
  text: string
}

function parseSearchResult(result: string): SearchMatch[] | null {
  const lines = result.split('\n').filter(Boolean)
  if (lines.length === 0) return null

  const matches: SearchMatch[] = []
  for (const line of lines) {
    if (line.startsWith('(showing first') || line === 'No matches found.') continue
    const m = line.match(/^(.+?):(\d+):(.*)$/)
    if (m) {
      matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] })
    }
  }
  return matches.length > 0 ? matches : null
}

function SearchResult({ result }: { result: string }) {
  const matches = useMemo(() => parseSearchResult(result), [result])

  const grouped = useMemo(() => {
    const map = new Map<string, { line: number; text: string }[]>()
    for (const m of matches ?? []) {
      const existing = map.get(m.file)
      if (existing) existing.push({ line: m.line, text: m.text })
      else map.set(m.file, [{ line: m.line, text: m.text }])
    }
    return map
  }, [matches])

  if (!matches) {
    return (
      <div className="rounded-lg bg-default/40">
        <pre className="whitespace-pre-wrap text-foreground px-3 py-2 text-xs">{result}</pre>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-default/40 max-h-60 overflow-auto">
      {Array.from(grouped.entries()).map(([file, items]) => (
        <div key={file} className="not-first:border-t not-first:border-border/50">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-default/30 text-xs text-muted">
            <FileIcon path={file} />
            <span className="font-mono truncate">{file.split(/[/\\]/).pop()}</span>
            <span className="text-muted/50 ml-auto shrink-0">{items.length}</span>
          </div>
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 px-3 py-0.5 text-xs hover:bg-default/20">
              <span className="text-muted/50 font-mono w-8 text-right shrink-0">{item.line}</span>
              <span className="text-foreground font-mono truncate">{item.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function CommandResult({ result }: { result: string }) {
  return (
    <div className="rounded-lg bg-default/40">
      <div className="max-h-60 overflow-auto">
        <pre className="whitespace-pre-wrap text-foreground px-3 py-2 text-xs font-mono leading-relaxed">
          {result.length > 2000 ? `${result.slice(0, 2000)}...` : result}
        </pre>
      </div>
    </div>
  )
}

function GenericResult({ result }: { result: string }) {
  // JSON results get pretty-printed and syntax-highlighted like HeroUI's preset.
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(result), null, 2)
    } catch {
      return null
    }
  }, [result])

  if (pretty !== null && pretty.length <= 2000) {
    return <ChatToolResult text={pretty} />
  }

  return (
    <div className="rounded-lg bg-default/40">
      <div className="max-h-40 overflow-y-auto">
        <pre className="whitespace-pre-wrap text-foreground px-3 py-2 text-xs">
          {result.length > 1000 ? `${result.slice(0, 1000)}...` : result}
        </pre>
      </div>
    </div>
  )
}

function ToolResult({ toolName, result, args }: { toolName: string; result: string; args: Record<string, unknown> }) {
  switch (toolName) {
    case 'read_file':
      return <ReadFileResult result={result} path={String(args.path ?? '')} />
    case 'search_files':
    case 'glob':
      return <SearchResult result={result} />
    case 'run_command':
      return <CommandResult result={result} />
    default:
      return <GenericResult result={result} />
  }
}

function PendingApproval({ callId, retryReason }: { callId: string; retryReason?: string }) {
  const { t } = useTranslation()
  const [approved, setApproved] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const isEscalation = retryReason !== undefined

  if (approved) {
    return (
      <div className="flex items-center gap-2 px-0.5 text-muted">
        <CircleDashed className="w-3.5 h-3.5 animate-spin" />
        <span className="text-xs">{t('chat.tool.running')}</span>
      </div>
    )
  }

  if (!showFeedback) {
    return (
      <>
        {isEscalation && (
          <div className="flex items-start gap-1.5 px-0.5 text-xs text-muted">
            <TriangleExclamation className="w-3.5 h-3.5 text-warning-soft-foreground shrink-0" />
            <span>{t('chat.tool.sandboxRetryPrompt')}</span>
          </div>
        )}
        <ChatToolApproval>
          <Button
            variant="outline"
            className="text-danger hover:text-danger"
            onClick={() => setShowFeedback(true)}
          >
            <Xmark className="w-3.5 h-3.5" />
            {t('chat.tool.deny')}
          </Button>
          <Button onClick={() => { setApproved(true); api.approveToolCall(callId) }}>
            <Check className="w-3.5 h-3.5" />
            {isEscalation ? t('chat.tool.retryWithoutSandbox') : t('chat.tool.allow')}
          </Button>
        </ChatToolApproval>
      </>
    )
  }

  return (
    <div className="space-y-2">
      <Input fullWidth
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') api.denyToolCall(callId, feedback || undefined) }}
        placeholder={t('chat.tool.denyReasonPlaceholder')}
        className="text-xs"
        autoFocus
      />
      <ChatToolApproval className="pt-0">
        <Button variant="ghost" onClick={() => setShowFeedback(false)}>
          {t('chat.tool.cancel')}
        </Button>
        <Button
          variant="outline"
          className="text-danger hover:text-danger"
          onClick={() => api.denyToolCall(callId, feedback || undefined)}
        >
          <Xmark className="w-3.5 h-3.5" />
          {feedback.trim() ? t('chat.tool.denyWithReason') : t('chat.tool.deny')}
        </Button>
      </ChatToolApproval>
    </div>
  )
}

interface WebSearchSource {
  title: string
  url: string
  content: string
  favicon?: string
  site_name?: string
}

// null means the result is not valid tool output (i.e. a raw error string).
function parseWebSearchResult(result: string): WebSearchSource[] | null {
  try {
    const data = JSON.parse(result)
    if (data && Array.isArray(data.sources)) return data.sources
  } catch { /* not JSON */ }
  return null
}

function WebSearchBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const query = useMemo(() => {
    try {
      return JSON.parse(data.arguments)?.query ?? ''
    } catch { return '' }
  }, [data.arguments])

  const sources = useMemo(
    () => (data.result ? parseWebSearchResult(data.result) : null),
    [data.result],
  )

  if (data.status === 'pending') {
    return (
      <ChatTool state="requires-action" defaultExpanded className="my-3">
        <ChatToolTrigger>
          <ChatToolStatusIcon />
          <span className="font-medium text-foreground shrink-0">{t('chat.tool.name.web_search')}</span>
          {query && <span className="text-muted truncate">{query}</span>}
        </ChatToolTrigger>
        <ChatToolContent>
          <PendingApproval callId={data.call_id} />
        </ChatToolContent>
      </ChatTool>
    )
  }

  if (data.status !== 'completed' && data.status !== 'denied' && data.status !== 'error') {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-muted">
        <Globe className="w-3.5 h-3.5 animate-pulse" />
        <span>{t('chat.tool.webSearch.searching')}</span>
        {query && <span className="text-foreground truncate max-w-60">{query}</span>}
      </div>
    )
  }

  if (data.status === 'denied') {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-muted">
        <Globe className="w-3.5 h-3.5" />
        <Xmark className="w-3.5 h-3.5 text-danger" />
      </div>
    )
  }

  if (data.status === 'error' || sources === null) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs">
        <Globe className="w-3.5 h-3.5 text-danger shrink-0" />
        <span className="text-danger">{t('chat.tool.webSearch.failed')}</span>
        {data.result && (
          <span className="text-muted truncate max-w-80" title={data.result}>
            {data.result.length > 200 ? `${data.result.slice(0, 200)}...` : data.result}
          </span>
        )}
      </div>
    )
  }

  if (sources.length === 0) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-muted">
        <Globe className="w-3.5 h-3.5" />
        <span>{t('chat.tool.webSearch.noResults')}</span>
        {query && <span className="truncate max-w-60">{query}</span>}
      </div>
    )
  }

  return (
    <div className="my-2 space-y-1.5">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="h-auto justify-start rounded-none p-0 gap-1.5 text-xs font-normal text-muted hover:text-foreground hover:bg-transparent dark:hover:bg-transparent transition-colors"
      >
        <span>{t('chat.tool.webSearch.sources', { count: sources.length })}</span>
        <ChevronUp className={`w-3.5 h-3.5 transition-transform ${expanded ? '' : 'rotate-180'}`} />
      </Button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 pt-1">
              {sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-default/50 px-2.5 py-1 text-xs text-muted hover:bg-default hover:text-foreground transition-colors"
                  title={src.title}
                >
                  {src.favicon && (
                    <img
                      src={src.favicon}
                      alt=""
                      className="w-3.5 h-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                  <span className="truncate max-w-32">{src.site_name || src.title}</span>
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * A finished plan awaiting the user's verdict. Approving it ends plan mode and
 * the same reply carries straight on into implementing, so the buttons say what
 * happens next rather than a bare allow/deny.
 */
/**
 * The model asking to stop building and plan instead. Deliberately plainer than
 * the plan card: there is no artifact to read yet, just a reason and a decision.
 */
function EnterPlanBlock({ data, reason }: { data: ToolCallDisplay; reason: string }) {
  const { t } = useTranslation()
  const [sent, setSent] = useState(false)
  const declined = data.status === 'denied'

  const decide = useCallback((send: () => Promise<void>) => {
    setSent(true)
    send().catch(() => setSent(false))
  }, [])

  // Same status ring as `ChatTool`: a HeroUI card carries no edge, so an edge
  // is left to mean "this one is waiting on you". A decided plan is just a card.
  return (
    <div
      data-slot="enter-plan"
      data-status={data.status}
      className={cn(
        'my-3 overflow-hidden rounded-2xl bg-surface text-xs shadow-surface',
        !declined && 'ring-1 ring-info/40 ring-inset',
      )}
    >
      <div data-slot="enter-plan-header" className="flex items-center gap-2 bg-default px-4 py-3">
        <Compass aria-hidden className="size-3.5 shrink-0 text-muted" />
        <span data-slot="enter-plan-title" className="font-medium text-foreground">
          {t('chat.plan.enterTitle')}
        </span>
        {data.status === 'completed' && <Check className="ml-auto size-3.5 text-success-soft-foreground" />}
        {declined && <Xmark className="ml-auto size-3.5 text-muted" />}
      </div>

      <div data-slot="enter-plan-reason" className="px-4 py-3 text-foreground">
        {reason}
      </div>

      {data.status === 'pending' && !sent && (
        <div data-slot="enter-plan-actions" className="border-t border-separator px-4 py-3">
          <ChatToolApproval>
            <Button variant="outline" onClick={() => decide(() => api.denyToolCall(data.call_id))}>
              <Xmark className="w-3.5 h-3.5" />
              {t('chat.plan.keepBuilding')}
            </Button>
            <Button onClick={() => decide(() => api.approveToolCall(data.call_id))}>
              <Compass className="w-3.5 h-3.5" />
              {t('chat.plan.startPlanning')}
            </Button>
          </ChatToolApproval>
        </div>
      )}

      {data.status === 'pending' && sent && (
        <div
          data-slot="enter-plan-waiting"
          className="flex items-center gap-2 border-t border-separator px-4 py-3 text-muted"
        >
          <CircleDashed className="w-3.5 h-3.5 animate-spin" />
          <span>{t('chat.tool.running')}</span>
        </div>
      )}
    </div>
  )
}

function ExitPlanBlock({ data, plan }: { data: ToolCallDisplay; plan: string }) {
  const { t } = useTranslation()
  // One state instead of two booleans: `sent` and `feedback` are mutually
  // exclusive, and a pair of flags allows a fourth combination that means
  // nothing.
  const [ui, setUi] = useState<'idle' | 'feedback' | 'sent'>('idle')
  const [feedback, setFeedback] = useState('')
  const wasRejected = data.status === 'denied'

  // The waiter on the Rust side is gone once the turn is cancelled, so these
  // calls really can reject. Falling back to the buttons beats spinning forever
  // on a decision nobody is waiting for.
  const decide = useCallback((send: () => Promise<void>) => {
    setUi('sent')
    send().catch(() => setUi('idle'))
  }, [])

  const sendBack = useCallback(
    () => decide(() => api.denyToolCall(data.call_id, feedback.trim() || undefined)),
    [decide, data.call_id, feedback],
  )

  return (
    <div
      data-slot="exit-plan"
      data-status={data.status}
      className={cn(
        'my-3 overflow-hidden rounded-2xl bg-surface text-xs shadow-surface',
        !wasRejected && 'ring-1 ring-info/40 ring-inset',
      )}
    >
      <div data-slot="exit-plan-header" className="flex items-center gap-2 bg-default px-4 py-3">
        <SquareListUl aria-hidden className="size-3.5 shrink-0 text-muted" />
        <span data-slot="exit-plan-title" className="font-medium text-foreground">
          {t('chat.plan.title')}
        </span>
        {data.status === 'completed' && <Check className="ml-auto size-3.5 text-success-soft-foreground" />}
        {wasRejected && <Xmark className="ml-auto size-3.5 text-muted" />}
      </div>

      <div data-slot="exit-plan-body" className="max-h-96 overflow-y-auto px-4 py-3">
        <MarkdownContent content={plan} />
      </div>

      {data.status === 'pending' && ui !== 'sent' && (
        <div data-slot="exit-plan-actions" className="border-t border-separator px-4 py-3">
          {ui === 'feedback' ? (
            <div data-slot="exit-plan-feedback" className="space-y-2">
              <Input fullWidth
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendBack() }}
                placeholder={t('chat.plan.feedbackPlaceholder')}
                className="text-xs"
                autoFocus
              />
              <ChatToolApproval className="pt-0">
                <Button variant="ghost" onClick={() => setUi('idle')}>
                  {t('chat.tool.cancel')}
                </Button>
                <Button variant="outline" onClick={sendBack}>
                  <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
                  {t('chat.plan.sendBack')}
                </Button>
              </ChatToolApproval>
            </div>
          ) : (
            <ChatToolApproval>
              <Button variant="outline" onClick={() => setUi('feedback')}>
                <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
                {t('chat.plan.revise')}
              </Button>
              <Button
                onClick={() => decide(() => api.approveToolCall(data.call_id))}
              >
                <Check className="w-3.5 h-3.5" />
                {t('chat.plan.approve')}
              </Button>
            </ChatToolApproval>
          )}
        </div>
      )}

      {data.status === 'pending' && ui === 'sent' && (
        <div
          data-slot="exit-plan-waiting"
          className="flex items-center gap-2 border-t border-separator px-4 py-3 text-muted"
        >
          <CircleDashed className="w-3.5 h-3.5 animate-spin" />
          <span>{t('chat.tool.running')}</span>
        </div>
      )}
    </div>
  )
}

function TodoListBlock({ data, title, todos }: { data: ToolCallDisplay; title: string; todos: TodoDraft[] }) {
  const { t } = useTranslation()
  const { done, total } = todoProgress(todos)

  return (
    <ChatTool state={mapChatToolState(data.status)} defaultExpanded={done < total} className="my-3">
      <ChatToolTrigger
        endContent={
          <span className="shrink-0 text-muted tabular-nums">
            {t('chat.todo.progress', { done, total })}
          </span>
        }
      >
        <ListCheck aria-hidden className="size-3.5 shrink-0 text-muted" />
        <span className="truncate font-medium text-foreground">{title}</span>
      </ChatToolTrigger>
      <ChatToolContent>
        <TodoItemList todos={todos} />
        {data.status === 'error' && data.result && <ChatToolError>{data.result}</ChatToolError>}
      </ChatToolContent>
    </ChatTool>
  )
}

function ToolArgsSummary({ toolName, args }: { toolName: string; args: Record<string, unknown> }) {
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
      return args.path
        ? <span className="text-foreground font-mono text-xs truncate">{String(args.path)}</span>
        : null
    case 'run_command':
      return args.command
        ? <span className="text-foreground font-mono text-xs truncate">{String(args.command)}</span>
        : null
    case 'search_files':
      return args.pattern
        ? <span className="text-foreground font-mono text-xs truncate">{String(args.pattern)}</span>
        : null
    case 'write_file':
      return args.path
        ? <span className="text-foreground font-mono text-xs truncate">{String(args.path)}</span>
        : null
    case 'edit_file':
      return args.file_path
        ? <span className="text-foreground font-mono text-xs truncate">{String(args.file_path)}</span>
        : null
    case 'apply_patch': {
      const patch = typeof args.patch === 'string' ? args.patch : ''
      const m = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)
        ?? patch.match(/^\+\+\+ (?:b\/)?(.+)$/m)
      return m
        ? <span className="text-foreground font-mono text-xs truncate">{m[1].trim()}</span>
        : null
    }
    default:
      return null
  }
}

function mapChatToolState(status: ToolCallDisplay['status']): ChatToolState {
  switch (status) {
    case 'pending':
      return 'requires-action'
    case 'approved':
    case 'running':
      return 'input-available'
    case 'completed':
      return 'output-available'
    default:
      return 'output-error'
  }
}

export function ToolCallBlock({ data, className }: { data: ToolCallDisplay; className?: string }) {
  const { t } = useTranslation()
  const isCompleted = data.status === 'completed' || data.status === 'denied' || data.status === 'error'

  const parsedArgs: Record<string, unknown> = useMemo(() => {
    try {
      const parsed = JSON.parse(data.arguments)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch { /* ignore */ }
    return {}
  }, [data.arguments])

  const fileDiffs = useMemo(
    () => toolFileDiffs(data.tool_name, parsedArgs),
    [data.tool_name, parsedArgs],
  )

  if (data.tool_name === 'ask_user') {
    return <AskUserBlock data={data} />
  }

  if (data.tool_name === 'web_search') {
    return <WebSearchBlock data={data} />
  }

  if (data.tool_name === 'enter_plan') {
    const reason = typeof parsedArgs.reason === 'string' ? parsedArgs.reason.trim() : ''
    if (reason) {
      return <EnterPlanBlock data={data} reason={reason} />
    }
  }

  if (data.tool_name === 'exit_plan') {
    const plan = typeof parsedArgs.plan === 'string' ? parsedArgs.plan.trim() : ''
    if (plan) {
      return <ExitPlanBlock data={data} plan={plan} />
    }
  }

  // Mid-stream the arguments are partial JSON and this parse fails, so the
  // call renders as a plain tool card until the checklist is complete.
  if (data.tool_name === 'update_todos') {
    const todoArgs = parseTodoArgs(parsedArgs)
    if (todoArgs) {
      return <TodoListBlock data={data} title={todoArgs.title} todos={todoArgs.todos} />
    }
  }

  const toolNameKey = `chat.tool.name.${data.tool_name}`
  const displayName = t(toolNameKey)
  const toolLabel = displayName !== toolNameKey ? displayName : data.tool_name

  const trimmedArgs = data.arguments.trim()
  const showArgs = trimmedArgs !== '' && trimmedArgs !== '{}'

  return (
    <ChatTool
      state={mapChatToolState(data.status)}
      defaultExpanded={!isCompleted}
      className={cn('my-3', className)}
    >
      <ChatToolTrigger>
        <ChatToolStatusIcon />
        <span className="font-medium text-foreground shrink-0">{toolLabel}</span>
        <ToolArgsSummary toolName={data.tool_name} args={parsedArgs} />
      </ChatToolTrigger>
      <ChatToolContent>
        {fileDiffs
          ? fileDiffs.map((d, i) => <FileDiffCard key={i} diff={d} />)
          : showArgs && <ChatToolArgs text={data.arguments} />}

        {data.status === 'pending' && (
          <PendingApproval
            callId={data.escalation_call_id ?? data.call_id}
            retryReason={data.escalation_call_id ? (data.retry_reason ?? '') : undefined}
          />
        )}

        {data.result && (
          data.status === 'error' ? (
            <ChatToolError>
              {data.result.length > 1000 ? `${data.result.slice(0, 1000)}...` : data.result}
            </ChatToolError>
          ) : (
            <ToolResult toolName={data.tool_name} result={data.result} args={parsedArgs} />
          )
        )}
      </ChatToolContent>
    </ChatTool>
  )
}
