import { useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { diffLines } from 'diff'
import { parsePatchText, splitDiffText, type DiffLine, type DiffLineKind, type FileDiff } from '@/lib/patch-parse'
import { ShikiCode } from './shiki-code'
import { FileDiffCard, FileIcon, fileNameOf, pathExtension } from './file-diff-card'
import {
  ArrowUturnCcwLeft,
  Ban,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleQuestion,
  Clock,
  Compass,
  ForwardStep,
  Globe,
  ListCheck,
  PaperPlane,
  Square,
  SquareCheck,
  SquareListUl,
  TriangleExclamation,
  Xmark,
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
import { ChatSource, ChatSources } from '@heroui-pro/react/chat-source'

import { openExternally } from '@/lib/external-link'
import { MarkdownContent } from './markdown-content'
import { useConversationStore } from '@/stores/conversation-store'
import type { AutoReviewVerdict, ToolCallDisplay } from '@/types'

interface AskOption {
  label: string
  description?: string
}

interface AskQuestion {
  id: string
  question: string
  options?: AskOption[]
  multi_select?: boolean
  /** The asker will not take an answer without this one.
   *
   *  Only a hosted agent's elicitation sets it — this app's own `ask_user` has
   *  no such notion, and every question there may be skipped. It is enforced
   *  here because here is the only place it can be: the backend's own check is
   *  a backstop that declines the *whole* form, by which point the card has
   *  said the answers were sent. */
  required?: boolean
  /** Whether anything typed for this question can actually be sent.
   *
   *  False for a question whose answer must be one of its options and which has
   *  no companion "Other" field behind it: there the schema takes a `const`,
   *  and free text is an accept the asker rejects outright — which discards the
   *  whole form rather than that one field. Absent means yes, which is what
   *  every `ask_user` question is. */
  accepts_text?: boolean
}

/** The questions, from whichever of the two sources has ids on it.
 *
 *  A hosted agent's question arrives twice: the ACP adapter announces the tool
 *  call carrying `AskUserQuestion`'s own input, and the form to draw comes with
 *  the approval, which is the one the backend has keyed to the fields it will
 *  read the answers back out of. Falling back to the call's own input would
 *  render the same questions under no ids at all — one `undefined` key shared
 *  by every question, and an answer the agent cannot match to anything.
 *
 *  Index-derived ids are the last resort rather than the plan: they happen to
 *  line up with what the adapter names its fields, and a silent reliance on
 *  that is exactly the kind of coupling that breaks without saying so. */
function askQuestionsFrom(json: string): AskQuestion[] {
  try {
    const parsed = JSON.parse(json)
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : []
    return questions.map((q: AskQuestion, i: number) => (q?.id ? q : { ...q, id: `question_${i}` }))
  } catch {
    return []
  }
}

interface QuestionAnswer {
  selected: string | string[] | null
  notes: string
}

function emptyAnswer(q: AskQuestion): QuestionAnswer {
  return { selected: q.multi_select ? [] : null, notes: '' }
}

/** Whether a typed answer is offered for this question at all. */
function acceptsText(q: AskQuestion): boolean {
  return q.accepts_text !== false
}

function isSelected(a: QuestionAnswer | undefined): boolean {
  if (!a) return false
  if (Array.isArray(a.selected)) return a.selected.length > 0
  return a.selected !== null
}

/** Whether anything at all has been given for this question — which is what
 *  decides that the form is worth submitting, not that it may be. */
function hasContent(q: AskQuestion, a: QuestionAnswer | undefined): boolean {
  if (!a) return false
  return (acceptsText(q) && a.notes.trim() !== '') || isSelected(a)
}

/** Whether this question is answered in the way its asker will accept.
 *
 *  Only `required` questions are held to it, and for an enumerated one the bar
 *  is a *selection*: the free-text box beside it is a different property in the
 *  schema, so an accept that fills it in instead is still missing the required
 *  one — and a required field missing is the whole form discarded. Typing into
 *  it therefore reads as content (the form has been started) without reading as
 *  an answer (it cannot be sent). */
function hasRequiredAnswer(q: AskQuestion, a: QuestionAnswer | undefined): boolean {
  if (q.options && q.options.length > 0) return isSelected(a)
  return hasContent(q, a)
}

function formatAnswer(a: QuestionAnswer | undefined, skipped: boolean): string {
  if (skipped) return '(skipped)'
  if (!a) return '(skipped)'
  const sel = Array.isArray(a.selected) ? a.selected.join(', ') : a.selected
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
        <Button variant="ghost" onClick={() => onUnskip(q.id)} className="text-xs text-muted shrink-0 ml-2">
          <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
          {t('chat.tool.undo')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-foreground font-medium">
          {q.question}
          {/* The mark and the withheld skip button are one decision: an asker
              that will not take an answer without this one leaves nothing to
              skip to. */}
          {q.required && (
            <span aria-label={t('chat.tool.requiredQuestion')} className="ml-1 text-danger">
              *
            </span>
          )}
        </div>
        {!q.required && (
          <Button variant="ghost" onClick={() => onSkip(q.id)} className="text-xs text-muted shrink-0 mt-0.5">
            <ForwardStep className="w-3.5 h-3.5" />
            {t('chat.tool.skipQuestion')}
          </Button>
        )}
      </div>

      {hasOptions && (
        <div className="space-y-1">
          {q.options!.map((opt) => {
            const checked = isMulti
              ? Array.isArray(value.selected) && value.selected.includes(opt.label)
              : value.selected === opt.label

            return (
              <Button
                key={opt.label}
                variant="ghost"
                onClick={() => (isMulti ? toggleMulti(opt.label) : selectSingle(opt.label))}
                className={cn(
                  // `whitespace-normal` overrides the Button base class, which is
                  // `whitespace-nowrap`. These labels are written by a model and
                  // are routinely whole sentences, so on a narrow card the option
                  // ran under the clipped edge with no way to read the rest of
                  // it — and an option you cannot read is one you cannot pick.
                  'w-full justify-start gap-2 h-auto rounded-lg px-2.5 py-1.5 text-left whitespace-normal',
                  checked ? 'bg-default/80 text-default-foreground' : 'text-muted',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {isMulti ? (
                    checked ? (
                      <SquareCheck className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )
                  ) : checked ? (
                    <CircleCheck className="w-3.5 h-3.5 text-foreground" />
                  ) : (
                    <Circle className="w-3.5 h-3.5" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{opt.label}</span>
                  {opt.description && <span className="block text-xs text-muted">{opt.description}</span>}
                </span>
              </Button>
            )
          })}
        </div>
      )}

      {/* Withheld where nothing could carry what was typed. A box that discards
          what is put in it is worse than no box, and this one would take the
          answer with it: `formatAnswer` folds a note into the selection, so a
          note beside a valid choice is what makes the pair unplaceable. */}
      {acceptsText(q) && (
        <Input
          fullWidth
          type="text"
          value={value.notes}
          onChange={(e) => onChange(q.id, { ...value, notes: e.target.value })}
          placeholder={hasOptions ? t('chat.tool.notesPlaceholder') : t('chat.tool.askUserPlaceholder')}
          className="text-xs"
          autoFocus={!hasOptions}
        />
      )}
    </div>
  )
}

function AskUserBlock({ data, onAnswered }: { data: ToolCallDisplay; onAnswered?: () => void }) {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})
  const [skippedSet, setSkippedSet] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const retireAnswered = useConversationStore((s) => s.retireAnsweredApproval)

  // Held rather than read live, because answering retires the queue entry this
  // comes out of: without the ref the form would swap back to the call's own
  // input the instant send succeeded, taking every selection with it.
  const pending = useConversationStore((s) => (data.approval_id ? s.attention[data.approval_id]?.arguments : undefined))
  const form = useRef<string | undefined>(undefined)
  if (pending) form.current = pending

  const questions = useMemo<AskQuestion[]>(
    () => askQuestionsFrom(pending ?? form.current ?? data.arguments),
    [pending, data.arguments],
  )

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
    const approvalId = data.approval_id
    if (!approvalId) return
    const result: Record<string, string> = {}
    for (const q of questions) {
      result[q.id] = formatAnswer(answers[q.id], skippedSet.has(q.id))
    }
    setSending(true)
    api.respondToAsk(approvalId, JSON.stringify(result)).then(
      // Same reason as `PendingApproval`: the queue is a separate ledger and
      // learns nothing from an answer given here. A question answered on this
      // form and left in it is offered again as a toast — "go and answer this"
      // for something already answered — the moment the reader moves on.
      () => {
        retireAnswered(approvalId)
        onAnswered?.()
      },
      // Nobody is listening any more: say so instead of leaving a form that
      // silently discards what the user typed.
      () => {
        setSending(false)
        markOrphaned(approvalId)
      },
    )
  }, [answers, skippedSet, questions, data.approval_id, markOrphaned, retireAnswered, onAnswered])

  // A question the asker will not do without has to be answered before this
  // form can go, and the check belongs here rather than only on the way out:
  // the backend declines the *whole* payload over one missing required answer,
  // and by then the card has already reported success and retired the queue
  // entry, so every other answer is lost without a word.
  const unanswered = questions.filter((q) => q.required && !hasRequiredAnswer(q, answers[q.id]))
  const canSubmit =
    unanswered.length === 0 && questions.some((q) => skippedSet.has(q.id) || hasContent(q, answers[q.id]))

  return (
    <div className="my-3 overflow-hidden rounded-2xl bg-surface text-sm shadow-surface ring-1 ring-border ring-inset">
      <div className="flex items-center gap-2 bg-default px-4 py-3">
        <CircleQuestion className="w-3.5 h-3.5 text-muted" />
        <span className="font-medium text-foreground">{t('chat.tool.askUser')}</span>
        {/* No spinner here for `running`: the body below says so in words, and
            two of them side by side read as two things happening. */}
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
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSubmit} isDisabled={!canSubmit || sending}>
              <PaperPlane className="w-3.5 h-3.5" />
              {t('chat.tool.askUserSubmit')}
            </Button>
            {/* A disabled button with no reason beside it reads as broken. Only
                once something has been filled in, so it is a correction rather
                than a demand made before anyone has started. */}
            {unanswered.length > 0 && questions.some((q) => hasContent(q, answers[q.id])) && (
              <span role="status" className="text-xs text-muted">
                {t('chat.tool.askUserRequiredPending', { count: unanswered.length })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* The questions are left on screen — they are still worth reading — but
          the form goes, since there is no longer anyone to send it to, and
          whatever did become of it is said here instead. */}
      {data.status !== 'pending' && data.status !== 'completed' && (
        <div className="px-4 py-3">
          <CardOutcome status={data.status} />
        </div>
      )}

      {data.result && (
        <div className="border-t border-separator bg-default/40">
          <div className="max-h-40 overflow-y-auto ">
            <pre className="whitespace-pre-wrap text-foreground px-4 py-3 text-xs">{data.result}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Diff extraction for file-editing tools (write_file / edit_file / apply_patch) ----
// The card itself lives in file-diff-card.tsx, shared with the workspace panel.

function writeFileDiff(args: Record<string, unknown>): FileDiff[] | null {
  const path = typeof args.path === 'string' ? args.path : null
  const content = typeof args.content === 'string' ? args.content : null
  if (path === null || content === null) return null
  return [
    {
      path,
      op: 'modify',
      lines: splitDiffText(content).map((text): DiffLine => ({ kind: 'add', text })),
    },
  ]
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
  return [
    {
      path,
      op: 'modify',
      replaceAll: args.replace_all === true,
      lines,
    },
  ]
}

function applyPatchDiff(args: Record<string, unknown>): FileDiff[] | null {
  const patch = typeof args.patch === 'string' ? args.patch : null
  if (patch === null) return null
  const parsed = parsePatchText(patch)
  if (parsed.length > 0) return parsed
  // Unrecognized format: still show the raw patch with real newlines.
  return [
    {
      path: '',
      op: 'modify',
      lines: splitDiffText(patch).map((text): DiffLine => ({ kind: 'context', text })),
    },
  ]
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

function ReadFileResult({ result, path }: { result: string; path: string }) {
  // Same reason as `FileDiffCard`: this header has no `title` at all, so the
  // bare filename was the only thing identifying which file was read.
  const fileName = fileNameOf(path)
  // Previously this only *claimed* to be highlighted: it put `language-x hljs`
  // on the element and never ran a highlighter, so the class bought a
  // background colour and nothing else.
  const body = result.length > 2000 ? `${result.slice(0, 2000)}...` : result

  return (
    <div className="rounded-lg bg-default/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 bg-default/30 text-xs text-muted border-b border-border/50">
        <FileIcon path={path} />
        <span className="font-mono truncate">{fileName}</span>
      </div>
      <div className="max-h-60 overflow-auto">
        <ShikiCode code={body} language={pathExtension(path)} />
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
            <span className="text-muted ml-auto shrink-0">{items.length}</span>
          </div>
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 px-3 py-0.5 text-xs hover:bg-default/20">
              <span className="text-muted font-mono w-8 text-right shrink-0">{item.line}</span>
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

function PendingApproval({
  approvalId,
  retryReason,
  onAnswered,
}: {
  approvalId: string
  retryReason?: string
  /** Called once an answer is accepted. Ordinary approvals need nothing here —
   *  the tool result that follows retires the card — but a delegated run's
   *  result is emitted on its own conversation, which the card's session
   *  never hears about. */
  onAnswered?: () => void
}) {
  const { t } = useTranslation()
  // One state, not two booleans: the pair had combinations that mean nothing
  // ("sent" and "typing a reason" at once) and no way to express "sending
  // failed, put the buttons back".
  const [ui, setUi] = useState<'idle' | 'feedback' | 'sent'>('idle')
  const [feedback, setFeedback] = useState('')
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const retireAnswered = useConversationStore((s) => s.retireAnsweredApproval)
  const isEscalation = retryReason !== undefined

  // Optimistic, with a way back. The backend rejects when it is no longer
  // holding the turn open, and a card that swallowed that would spin forever.
  const decide = (send: () => Promise<void>) => {
    const previous = ui
    setUi('sent')
    send().then(
      () => {
        // The queue is a separate ledger from this card, and it does not learn
        // anything from an answer given here. Left in it, this question is
        // offered again as a toast the moment the reader moves to another
        // conversation — buttons for a decision that has already been made.
        retireAnswered(approvalId)
        onAnswered?.()
      },
      () => {
        setUi(previous)
        markOrphaned(approvalId)
      },
    )
  }

  if (ui === 'sent') {
    return (
      <div className="flex items-center gap-2 px-0.5 text-muted">
        <CircleDashed className="w-3.5 h-3.5 animate-spin" />
        <span className="text-xs">{t('chat.tool.running')}</span>
      </div>
    )
  }

  if (ui === 'idle') {
    return (
      <>
        {isEscalation && (
          <div className="flex items-start gap-1.5 px-0.5 text-xs text-muted">
            <TriangleExclamation className="w-3.5 h-3.5 text-warning-soft-foreground shrink-0" />
            <span>{t('chat.tool.sandboxRetryPrompt')}</span>
          </div>
        )}
        <ChatToolApproval>
          <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setUi('feedback')}>
            <Xmark className="w-3.5 h-3.5" />
            {t('chat.tool.deny')}
          </Button>
          <Button onClick={() => decide(() => api.approveToolCall(approvalId))}>
            <Check className="w-3.5 h-3.5" />
            {isEscalation ? t('chat.tool.retryWithoutSandbox') : t('chat.tool.allow')}
          </Button>
        </ChatToolApproval>
      </>
    )
  }

  const deny = () => decide(() => api.denyToolCall(approvalId, feedback || undefined))

  return (
    <div className="space-y-2">
      <Input
        fullWidth
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') deny()
        }}
        placeholder={t('chat.tool.denyReasonPlaceholder')}
        className="text-xs"
        autoFocus
      />
      <ChatToolApproval className="pt-0">
        <Button variant="ghost" onClick={() => setUi('idle')}>
          {t('chat.tool.cancel')}
        </Button>
        <Button variant="outline" className="text-danger hover:text-danger" onClick={deny}>
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
  } catch {
    /* not JSON */
  }
  return null
}

function WebSearchBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()

  const query = useMemo(() => {
    try {
      return JSON.parse(data.arguments)?.query ?? ''
    } catch {
      return ''
    }
  }, [data.arguments])

  const sources = useMemo(() => (data.result ? parseWebSearchResult(data.result) : null), [data.result])

  if (data.status === 'pending') {
    return (
      <ChatTool state="requires-action" defaultExpanded className="my-3">
        <ChatToolTrigger>
          <ChatToolStatusIcon />
          <span className="font-medium text-foreground shrink-0">{t('chat.tool.name.web_search')}</span>
          {query && <span className="text-muted truncate">{query}</span>}
        </ChatToolTrigger>
        <ChatToolContent>
          {data.approval_id && (
            <PendingApproval
              // A new approval id is a new question, and the answer to the last
              // one must not still be on screen. Without this the card keeps the
              // "sent" it was left in — which is the spinner — so a sandbox
              // escalation arrives behind a card that looks like it is already
              // working, and the buttons only appear if the conversation is
              // reopened and the component is rebuilt from scratch.
              key={data.approval_id}
              approvalId={data.approval_id}
              retryReason={data.retry_reason}
            />
          )}
        </ChatToolContent>
      </ChatTool>
    )
  }

  // Ahead of the loading state below, which would otherwise claim a dead call
  // is still searching.
  if (data.status === 'orphaned') {
    return (
      <ChatTool state="output-error" defaultExpanded={false} className="my-3">
        <ChatToolTrigger>
          <ChatToolStatusIcon />
          <span className="font-medium text-foreground shrink-0">{t('chat.tool.name.web_search')}</span>
          {query && <span className="text-muted truncate">{query}</span>}
        </ChatToolTrigger>
        <ChatToolContent>
          <OrphanedNotice />
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
    <ChatSources className="my-2" defaultExpanded={false}>
      <ChatSources.Trigger>{t('chat.tool.webSearch.sources', { count: sources.length })}</ChatSources.Trigger>
      <ChatSources.Content>
        <ChatSources.List>
          {sources.map((src, i) => (
            // `description` is what mounts the hover preview, so the page title
            // moves out of a native `title` tooltip and into something that can
            // hold more than one line.
            <ChatSource
              key={i}
              description={src.title}
              faviconUrl={src.favicon ?? undefined}
              href={src.url}
              title={src.site_name || src.title}
            >
              <ChatSource.Trigger rel="noreferrer noopener" onClick={(e) => openExternally(src.url, e)}>
                <ChatSource.Icon faviconUrl={src.favicon ?? undefined} />
                <ChatSource.Title>{src.site_name || src.title}</ChatSource.Title>
              </ChatSource.Trigger>
            </ChatSource>
          ))}
        </ChatSources.List>
      </ChatSources.Content>
    </ChatSources>
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
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const declined = data.status === 'denied'
  const approvalId = data.approval_id

  const decide = useCallback(
    (send: () => Promise<void>) => {
      setSent(true)
      send().catch(() => {
        setSent(false)
        if (approvalId) markOrphaned(approvalId)
      })
    },
    [approvalId, markOrphaned],
  )

  // Same status ring as `ChatTool`: the card's own edge is recoloured to mean
  // "this one is waiting on you". Which is `pending` and only `pending` — keyed
  // off "not denied" it was drawn around every other state too, so a call that
  // had errored, been abandoned or already been approved all sat there asking
  // for a decision that had been made or could not be.
  return (
    <div
      data-slot="enter-plan"
      data-status={data.status}
      className={cn(
        'my-3 overflow-hidden rounded-2xl bg-surface text-sm shadow-surface ring-1 ring-border ring-inset',
        data.status === 'pending' && 'ring-info/40',
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

      {data.status === 'pending' && approvalId && !sent && (
        <div data-slot="enter-plan-actions" className="border-t border-separator px-4 py-3">
          <ChatToolApproval>
            <Button variant="outline" onClick={() => decide(() => api.denyToolCall(approvalId))}>
              <Xmark className="w-3.5 h-3.5" />
              {t('chat.plan.keepBuilding')}
            </Button>
            <Button onClick={() => decide(() => api.approveToolCall(approvalId))}>
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

      {data.status !== 'pending' && data.status !== 'completed' && (
        <div data-slot="enter-plan-outcome" className="border-t border-separator px-4 py-3">
          <CardOutcome status={data.status} detail={data.result} />
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
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const wasRejected = data.status === 'denied'
  const approvalId = data.approval_id

  // The waiter on the Rust side is gone once the turn is cancelled, so these
  // calls really can reject. Falling back to the buttons beats spinning forever
  // on a decision nobody is waiting for — and the card is retired outright,
  // since the answer has nowhere left to go.
  const decide = useCallback(
    (send: () => Promise<void>) => {
      setUi('sent')
      send().catch(() => {
        setUi('idle')
        if (approvalId) markOrphaned(approvalId)
      })
    },
    [approvalId, markOrphaned],
  )

  const sendBack = useCallback(() => {
    if (approvalId) decide(() => api.denyToolCall(approvalId, feedback.trim() || undefined))
  }, [decide, approvalId, feedback])

  return (
    <div
      data-slot="exit-plan"
      data-status={data.status}
      className={cn(
        'my-3 overflow-hidden rounded-2xl bg-surface text-sm shadow-surface ring-1 ring-border ring-inset',
        // Only while it is actually waiting on a decision — see `EnterPlanBlock`.
        data.status === 'pending' && 'ring-info/40',
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

      {data.status === 'pending' && approvalId && ui !== 'sent' && (
        <div data-slot="exit-plan-actions" className="border-t border-separator px-4 py-3">
          {ui === 'feedback' ? (
            <div data-slot="exit-plan-feedback" className="space-y-2">
              <Input
                fullWidth
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') sendBack()
                }}
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
              <Button onClick={() => decide(() => api.approveToolCall(approvalId))}>
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

      {data.status !== 'pending' && data.status !== 'completed' && (
        <div data-slot="exit-plan-outcome" className="border-t border-separator px-4 py-3">
          <CardOutcome status={data.status} detail={data.result} />
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
          <span className="shrink-0 text-muted tabular-nums">{t('chat.todo.progress', { done, total })}</span>
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

/**
 * What to call a tool in front of a person.
 *
 * `t()` hands back the key it was given when nothing is written for it, which is
 * how a tool with no translation — anything from MCP or the custom registry — is
 * told apart and shown under its bare id.
 */
export function toolLabel(t: TFunction, toolName: string): string {
  const key = `chat.tool.name.${toolName}`
  const name = t(key)
  return name === key ? toolName : name
}

/**
 * A one-line summary a person wrote, when the call carries one.
 *
 * Every tool whose arguments are opaque takes a `description` — a shell command
 * is the case that forces it, since `cd … && git log --reverse --diff-filter=A
 * --format=…` says what will run and nothing about why. Claude Code's `Bash` and
 * `Task` carry one; ours follow.
 *
 * **It is drawn beside the identifying argument, never instead of it.** Letting
 * it win the one summary line read well and quietly took the path off a
 * `write_file` card — and `toolFileDiffs` means the body then renders a diff
 * rather than the raw arguments, with the file's own name in the header and the
 * directory only in a `title`, which a touch screen cannot reach. Approving a
 * write is exactly when the directory matters most. See `ChatToolTrigger`'s
 * `subtitle` for where this goes instead.
 */
export function toolDescription(args: Record<string, unknown>): string | null {
  const value = args.description
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The identifying argument, for the tools that have one: a path, a command, a
 * pattern. `null` for everything else, including anything from MCP or the custom
 * registry — a summary guessed off an unknown schema is worse than none.
 *
 * The capitalised names are Claude Code's, reaching us through
 * `_meta.claudeCode.toolName` on a hosted session. Without them a hosted
 * transcript is a column of cards saying `Read` and nothing else.
 */
function identifyingArg(toolName: string, args: Record<string, unknown>): string | null {
  const str = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null)
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
    case 'write_file':
      return str(args.path)
    case 'edit_file':
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return str(args.file_path) ?? str(args.notebook_path)
    case 'run_command':
    case 'Bash':
    case 'SlashCommand':
      return str(args.command)
    case 'search_files':
    case 'glob':
    case 'Glob':
    case 'Grep':
      return str(args.pattern)
    case 'WebFetch':
      return str(args.url)
    case 'Skill':
      return str(args.skill)
    case 'apply_patch': {
      const patch = typeof args.patch === 'string' ? args.patch : ''
      const m = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m) ?? patch.match(/^\+\+\+ (?:b\/)?(.+)$/m)
      return m ? m[1].trim() : null
    }
    default:
      return null
  }
}

/**
 * The one line that says *which* call this is: a path, a command, a pattern.
 *
 * Deliberately not the description, which answers a different question and gets
 * its own line — see [`toolDescription`] for what happened when it did not.
 *
 * Exported because the approval queue draws the same question outside the
 * transcript, and two answers to "what is this call" would disagree in exactly
 * the place it matters — an `apply_patch` whose file the card names and the
 * queue does not is a decision made on less than the card offered.
 */
export function ToolArgsSummary({ toolName, args }: { toolName: string; args: Record<string, unknown> }) {
  const arg = identifyingArg(toolName, args)
  return arg === null ? null : (
    <span
      data-slot="tool-arg"
      className="line-clamp-2 min-w-0 break-words whitespace-normal font-mono text-xs text-foreground [overflow-wrap:anywhere]"
      title={arg}
    >
      {arg}
    </span>
  )
}

/**
 * A run handed to another agent.
 *
 * Its transcript is a conversation of its own, hidden from the sidebar and
 * reachable only from here, so this card is the whole of what the reader knows
 * about it until they go in: what it was asked to do, how far it has got, and
 * anything it needs permission for.
 *
 * The step count comes from the store keyed by the run's turn, not from the
 * sub-agent's message list — that list also holds whatever the user typed into
 * the run after it finished, and this card is reporting on one delegation.
 */
function SubAgentBlock({
  data,
  description,
  kind,
  prompt,
}: {
  data: ToolCallDisplay
  description: string
  kind: string
  prompt?: string
}) {
  const { t } = useTranslation()
  const openConversation = useConversationStore((s) => s.openConversation)
  const resolveNested = useConversationStore((s) => s.resolveNestedApproval)
  const activeId = useConversationStore((s) => s.activeId)
  // Live while it runs; the snapshot's count is what survives a reload.
  const live = useConversationStore((s) => (data.sub_agent ? s.subAgentSteps[data.sub_agent.turn_id] : undefined))
  const steps = Math.max(live ?? 0, data.sub_agent?.steps ?? 0)
  const nested = data.nested_approval
  const readOnly = kind === 'explore'

  return (
    <ChatTool state={mapChatToolState(data.status)} defaultExpanded className="my-3">
      <ChatToolTrigger>
        {readOnly ? (
          <Compass aria-hidden className="size-3.5 shrink-0 text-muted" />
        ) : (
          <ForwardStep aria-hidden className="size-3.5 shrink-0 text-muted" />
        )}
        <span className="font-medium text-foreground shrink-0">
          {t(`chat.subAgent.${readOnly ? 'explore' : 'agent'}`)}
        </span>
        <span className="truncate text-muted">{description}</span>
        {steps > 0 && (
          <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
            {t('chat.subAgent.steps', { count: steps })}
          </span>
        )}
      </ChatToolTrigger>
      <ChatToolContent>
        {prompt && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap px-0.5 text-xs text-muted">{prompt}</pre>
        )}

        {/* The question the run raised. Asked here because this is where
            somebody is looking — its own conversation may never be opened. */}
        {nested && (
          <div className="space-y-2 rounded-lg border border-border p-2">
            <div className="flex items-start gap-1.5 px-0.5 text-xs text-muted">
              <CircleQuestion className="w-3.5 h-3.5 shrink-0" />
              <span>{t('chat.subAgent.asksFor', { tool: nested.tool_name })}</span>
            </div>
            <ChatToolArgs text={nested.arguments} />
            {nested.tool_name === 'ask_user' || nested.tool_name === 'AskUserQuestion' ? (
              <AskUserBlock
                data={{
                  call_id: nested.call_id,
                  tool_name: nested.tool_name,
                  arguments: nested.arguments,
                  status: 'pending',
                  approval_id: nested.approval_id,
                  retry_reason: nested.retry_reason,
                }}
                onAnswered={() => activeId && resolveNested(activeId, nested.approval_id)}
              />
            ) : (
              <PendingApproval
                key={nested.approval_id}
                approvalId={nested.approval_id}
                retryReason={nested.retry_reason}
                onAnswered={() => activeId && resolveNested(activeId, nested.approval_id)}
              />
            )}
          </div>
        )}

        {/* TODO: this opens, but half-furnished. `ChatView` and the header read
            their conversation out of `s.conversations` (six reads in
            `chat-view.tsx`, one in `App.tsx`), and a sub-agent's is filtered out
            of that list — it is the sidebar's data source and these are hidden
            on purpose. So `assistant_id`, `mode`, `accept_edits`,
            `thinking_level` and `fast_mode` all come back null and the header
            shows the app name. The snapshot already carries the whole
            conversation; `loadMessages` takes `compact_cursor` off it and drops
            the rest. Fix is a `conversationDetails` cache with a
            `conversationById` selector those seven reads fall back through —
            deferred with the rest of the navigation work until the HeroUI Pro
            change lands, since that is the layer it sits in.

            The second half of the same deferral: this keeps its own stack in
            `conversation-store` while `stores/nav-store.ts` owns the real one.
            Two truths for one back gesture; only the system back key on mobile
            can tell, which is why it can wait. */}
        {data.sub_agent && (
          <Button variant="ghost" className="text-xs" onClick={() => openConversation(data.sub_agent!.conversation_id)}>
            {t('chat.subAgent.viewProcess')}
          </Button>
        )}

        {data.status === 'orphaned' && <OrphanedNotice />}

        {data.result &&
          (data.status === 'error' ? (
            <ChatToolError>{data.result}</ChatToolError>
          ) : (
            <ChatToolResult>{data.result}</ChatToolResult>
          ))}
      </ChatToolContent>
    </ChatTool>
  )
}

function mapChatToolState(status: ToolCallDisplay['status']): ChatToolState {
  switch (status) {
    case 'pending':
      return 'requires-action'
    case 'approved':
    case 'running':
      return 'input-available'
    case 'queued':
      return 'queued'
    // Not `requires-action`: nothing here can act on it. It is a wait like any
    // other wait, and the card says who it is waiting on.
    case 'awaiting_parent':
      return 'input-available'
    case 'completed':
      return 'output-available'
    // Explicit rather than left to the default: an orphaned call really did
    // fail to produce a result, so the error styling is right — but saying so
    // here keeps the next person from reading it as an oversight.
    case 'orphaned':
      return 'output-error'
    default:
      return 'output-error'
  }
}

/** The turn that asked this is gone, so there is no longer anything to answer.
 *  Shown in place of the buttons, which would have nothing to address. */
function OrphanedNotice() {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-1.5 px-0.5 text-xs text-muted">
      <TriangleExclamation className="w-3.5 h-3.5 text-warning-soft-foreground shrink-0" />
      <span>{t('chat.tool.orphaned')}</span>
    </div>
  )
}

/**
 * Who decided this call, when it was not the person reading the transcript.
 *
 * Drawn for every automatic verdict rather than only for refusals. A denial has
 * to be attributable — without this the model's "Tool call denied" reads as it
 * changing its mind, which is the one reading that leads nowhere — but an
 * approval matters too: it is the only place the user can see what is being
 * waved through on their behalf, and the only way they can tell the mode is
 * working before it refuses something.
 *
 * `unreadable` is neither. The review ran, cost money and answered nothing, and
 * the decision fell back to the card below this one. Saying so is what keeps a
 * misconfigured reviewer from looking like no reviewer at all.
 */
function AutoReviewNotice({ verdict }: { verdict: AutoReviewVerdict }) {
  const { t } = useTranslation()
  const denied = verdict.outcome === 'deny'
  const unreadable = verdict.outcome === 'unreadable'
  const label = denied
    ? t('chat.tool.autoReview.denied')
    : unreadable
      ? t('chat.tool.autoReview.unreadable')
      : t('chat.tool.autoReview.allowed')

  return (
    <div
      data-slot="auto-review"
      className={cn(
        'space-y-1 rounded-lg px-2 py-1.5 text-xs',
        denied ? 'bg-danger-soft text-danger-soft-foreground' : 'bg-default text-muted',
      )}
    >
      <div className="flex items-center gap-1.5">
        {denied ? (
          <Ban className="w-3.5 h-3.5 shrink-0" />
        ) : unreadable ? (
          <TriangleExclamation className="w-3.5 h-3.5 shrink-0 text-warning-soft-foreground" />
        ) : (
          <CircleCheck className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="font-medium">{label}</span>
        {verdict.risk && <span className="shrink-0">{t(`chat.tool.autoReview.risk.${verdict.risk}`)}</span>}
        {verdict.authorization && (
          <span className="shrink-0">{t(`chat.tool.autoReview.auth.${verdict.authorization}`)}</span>
        )}
        {/* Only worth saying when it went and looked: the cheap pass is the
            default and naming it on every card would be noise. */}
        {verdict.stage === 'investigate' && (
          <span className="ml-auto shrink-0">{t('chat.tool.autoReview.investigated')}</span>
        )}
      </div>
      {verdict.rationale?.trim() && (
        <p className={cn('whitespace-pre-wrap', denied ? undefined : 'text-muted')}>{verdict.rationale}</p>
      )}
    </div>
  )
}

/**
 * How an interactive card ended, whenever that was not "the user answered".
 *
 * The three cards that draw their own body — the question, and the two plan
 * cards — each handled only the states they were written against: waiting, and
 * answered. Everything else fell through to a header with nothing under it, or
 * worse, to a refusal printed in the same place an answer would go.
 *
 * They meet those states routinely now. `tool_outcome` records how a call went,
 * so `denied` and `error` survive a reload instead of quietly becoming
 * `completed`, and an unanswered call on a turn that is still running reads as
 * `running` rather than being written off as abandoned.
 *
 * Returns null for the two the cards do draw themselves, and for nothing else.
 * The `never` binding at the end is what makes that true rather than merely
 * intended: a status added to the union and not handled here fails to compile,
 * where without it the switch would simply fall off the end and React would
 * render an empty card that nobody notices.
 *
 * `detail` is what the tool actually said — a refusal's reason, an error's
 * message. Shown under the general line rather than in place of it, because
 * "this failed" and "here is what it said" answer different questions and the
 * second is often a stack trace.
 */
function CardOutcome({ status, detail }: { status: ToolCallDisplay['status']; detail?: string }) {
  const { t } = useTranslation()
  const notice = (icon: React.ReactNode, text: string, withDetail = false) => (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1.5 px-0.5 text-xs text-muted">
        {icon}
        <span>{text}</span>
      </div>
      {withDetail && detail?.trim() && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap px-0.5 text-xs text-foreground">{detail}</pre>
      )}
    </div>
  )

  switch (status) {
    case 'pending':
    case 'completed':
      return null
    case 'orphaned':
      return <OrphanedNotice />
    case 'denied':
      return notice(<Ban className="w-3.5 h-3.5 shrink-0" />, t('chat.tool.wasDenied'), true)
    case 'error':
      return notice(<TriangleExclamation className="w-3.5 h-3.5 text-danger shrink-0" />, t('chat.tool.wasError'), true)
    // `approved` alongside `running` because it means the same thing to a card:
    // decided, not yet finished. Neither has a result to show yet.
    case 'approved':
    case 'running':
      return notice(<CircleDashed className="w-3.5 h-3.5 animate-spin shrink-0" />, t('chat.tool.running'))
    // Still, because it is still. The spinner above is what claims work is
    // happening, and for this one nothing is.
    case 'queued':
      return notice(<Clock className="w-3.5 h-3.5 shrink-0" />, t('chat.tool.queued'))
    // Waiting on a person, but not on whoever is reading this. The question was
    // put on the card that spawned the run, and saying so is the point — a card
    // that simply sat there would read as hung.
    case 'awaiting_parent':
      return notice(<Clock className="w-3.5 h-3.5 shrink-0" />, t('chat.tool.awaitingParent'))
    default: {
      const unhandled: never = status
      throw new Error(`unhandled tool call status: ${String(unhandled)}`)
    }
  }
}

export function ToolCallBlock({
  data: raw,
  queued,
  className,
}: {
  data: ToolCallDisplay
  queued?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  // Two corrections, both made once here where every card is dispatched from,
  // so no individual card has to remember either.
  //
  // A call cannot be pending without an id to answer it with, or it draws a
  // button that addresses nothing. And a call whose predecessor has not finished
  // is not running, whatever the transcript says — that one is decided by
  // position, which only the caller can see.
  const data: ToolCallDisplay = useMemo(() => {
    if (raw.status === 'pending' && !raw.approval_id) return { ...raw, status: 'orphaned' }
    if (queued && raw.status === 'running') return { ...raw, status: 'queued' }
    return raw
  }, [raw, queued])
  // Nothing to look at until it starts, so a queued call keeps itself shut.
  const isCompleted =
    data.status === 'completed' ||
    data.status === 'denied' ||
    data.status === 'error' ||
    data.status === 'orphaned' ||
    data.status === 'queued'

  const parsedArgs: Record<string, unknown> = useMemo(() => {
    try {
      const parsed = JSON.parse(data.arguments)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
    return {}
  }, [data.arguments])

  const fileDiffs = useMemo(() => toolFileDiffs(data.tool_name, parsedArgs), [data.tool_name, parsedArgs])

  // A hosted agent's questions and plans are the same two cards under different
  // names. Matching the name rather than translating it upstream keeps the
  // transcript honest about which tool actually ran — the card is a rendering
  // decision, and `AskUserQuestion` is what the agent called.
  if (data.tool_name === 'ask_user' || data.tool_name === 'AskUserQuestion') {
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

  if (data.tool_name === 'exit_plan' || data.tool_name === 'ExitPlanMode') {
    const plan = typeof parsedArgs.plan === 'string' ? parsedArgs.plan.trim() : ''
    if (plan) {
      return <ExitPlanBlock data={data} plan={plan} />
    }
  }

  // Mid-stream the description is not there yet, so the delegation renders as a
  // plain tool card until the model has finished writing the call.
  if (data.tool_name === 'run_agent') {
    const description = typeof parsedArgs.description === 'string' ? parsedArgs.description.trim() : ''
    const kind = typeof parsedArgs.agent === 'string' ? parsedArgs.agent : ''
    if (description) {
      return (
        <SubAgentBlock
          data={data}
          description={description}
          kind={kind}
          prompt={typeof parsedArgs.prompt === 'string' ? parsedArgs.prompt.trim() : undefined}
        />
      )
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

  const label = toolLabel(t, data.tool_name)

  const trimmedArgs = data.arguments.trim()
  const showArgs = trimmedArgs !== '' && trimmedArgs !== '{}'

  return (
    <ChatTool state={mapChatToolState(data.status)} defaultExpanded={!isCompleted} className={cn('my-3', className)}>
      {/* Both, on two lines: what this call is, and what it is for. Neither
          displaces the other — see `toolDescription`. */}
      <ChatToolTrigger subtitle={toolDescription(parsedArgs)}>
        <ChatToolStatusIcon />
        <span className="font-medium text-foreground shrink-0">{label}</span>
        <ToolArgsSummary toolName={data.tool_name} args={parsedArgs} />
        {/* In the trigger, not the body: a queued card is collapsed, and a
            standing clock beside a spinning one is too fine a distinction to
            rest the whole answer on. The summary stays — with three commands
            queued, which one this is matters as much as that it is waiting. */}
        {data.status === 'queued' && (
          <span className="ml-auto shrink-0 text-xs text-muted">{t('chat.tool.queued')}</span>
        )}
      </ChatToolTrigger>
      <ChatToolContent>
        {fileDiffs
          ? fileDiffs.map((d, i) => <FileDiffCard key={i} diff={d} />)
          : showArgs && <ChatToolArgs text={data.arguments} />}

        {/* Above the buttons rather than below: when a review came back
            unreadable there *are* buttons under this, and what it says is why
            the user is being asked at all. */}
        {data.auto_review && <AutoReviewNotice verdict={data.auto_review} />}

        {data.status === 'pending' && data.approval_id && (
          <PendingApproval key={data.approval_id} approvalId={data.approval_id} retryReason={data.retry_reason} />
        )}

        {data.status === 'orphaned' && <OrphanedNotice />}

        {data.result &&
          (data.status === 'error' ? (
            <ChatToolError>
              {data.result.length > 1000 ? `${data.result.slice(0, 1000)}...` : data.result}
            </ChatToolError>
          ) : (
            <ToolResult toolName={data.tool_name} result={data.result} args={parsedArgs} />
          ))}
      </ChatToolContent>
    </ChatTool>
  )
}
