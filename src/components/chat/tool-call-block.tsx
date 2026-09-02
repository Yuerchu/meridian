import { Fragment, useState, useCallback, useContext, useEffect, useMemo, useRef, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { diffLines } from 'diff'
import {
  firstHunkStart,
  numberDiffLines,
  parsePatchText,
  splitDiffText,
  type DiffLine,
  type DiffLineKind,
  type FileDiff,
} from '@/lib/patch-parse'
import {
  isOneLiner,
  NO_SEARCH_MATCHES,
  parseCommandOutput,
  parseDirectoryListing,
  parseGlobResult,
  parseReadFileOutput,
  parseSearchMatches,
  parseSubAgentResult,
  splitListingFootnote,
  splitTruncation,
  type CommandOutput,
  type SubAgentOutcome,
  type SubAgentResult,
} from '@/lib/tool-output'
import { ShikiCode } from './shiki-code'
import { NumberedCode } from './numbered-code'
import { SubAgentTimeline } from './sub-agent-timeline'
import { DiffStats, FileDiffCard, FileIcon } from './file-diff-card'
import { pathExtension } from '@/lib/paths'
import { PathLabel } from '@/components/ui/path-label'
import { Hint } from '@/components/ui/hint'
import {
  ArrowUpRightFromSquare,
  ArrowUturnCcwLeft,
  Ban,
  Check,
  CircleCheck,
  CircleDashed,
  CircleQuestion,
  Clock,
  Compass,
  Folder,
  ForwardStep,
  Globe,
  Link,
  ListCheck,
  PaperPlane,
  SquareListUl,
  TriangleExclamation,
  Xmark,
} from '@gravity-ui/icons'
import { Button, Checkbox, CheckboxGroup, Chip, Input, Radio, RadioGroup, Spinner } from '@heroui/react'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolPanelBody,
  ChatToolPanelFooter,
  ChatToolPanelHeader,
  ChatToolPresentationContext,
  ChatToolResult,
  ChatToolStatusIcon,
  ChatToolTrigger,
  type ChatToolState,
} from '@/components/ui/chat-tool'
import { BubbleKeyboardKey } from '@/components/ui/bubble-keyboard'
import { usePanelExpansion } from '@/hooks/use-panel-expansion'
import { useEditLocation } from '@/hooks/use-edit-location'
import { ariaHotkey, formatHotkey } from '@/hooks/use-hotkey'
import { APPROVE_HOTKEY, DENY_HOTKEY } from '@/hooks/use-transcript-hotkeys'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { parseTodoArgs, todoProgress, TodoItemList, type TodoDraft } from './todo-list'
import { ChatSource, ChatSources } from '@heroui-pro/react/chat-source'

import { openExternally } from '@/lib/external-link'
import { CopyButton, MarkdownContent } from './markdown-content'
import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { AutoReviewVerdictInfoResponse, ToolCallDisplay } from '@/types'

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
  invalid,
  registerField,
  onChange,
  onSkip,
  onUnskip,
}: {
  q: AskQuestion
  value: QuestionAnswer
  skipped: boolean
  invalid: boolean
  registerField: (id: string, element: HTMLDivElement | null) => void
  onChange: (id: string, val: QuestionAnswer) => void
  onSkip: (id: string) => void
  onUnskip: (id: string) => void
}) {
  const { t } = useTranslation()
  const fieldId = useId()
  const questionId = `${fieldId}-label`
  const errorId = `${fieldId}-error`
  const hasOptions = q.options && q.options.length > 0
  const isMulti = q.multi_select === true

  if (skipped) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted line-through">{q.question}</span>
        <Button variant="ghost" onPress={() => onUnskip(q.id)} className="text-xs text-muted shrink-0 ml-2">
          <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
          {t('chat.tool.undo')}
        </Button>
      </div>
    )
  }

  return (
    <div ref={(element) => registerField(q.id, element)} className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div id={questionId} className="text-sm text-foreground font-medium">
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
          <Button variant="ghost" onPress={() => onSkip(q.id)} className="text-xs text-muted shrink-0 mt-0.5">
            <ForwardStep className="w-3.5 h-3.5" />
            {t('chat.tool.skipQuestion')}
          </Button>
        )}
      </div>

      {hasOptions &&
        (isMulti ? (
          <CheckboxGroup
            data-slot="question-answer"
            aria-labelledby={questionId}
            aria-describedby={invalid ? errorId : undefined}
            isInvalid={invalid}
            name={q.id}
            value={Array.isArray(value.selected) ? value.selected : []}
            onChange={(selected) => onChange(q.id, { ...value, selected })}
            className="gap-1"
          >
            {q.options!.map((opt) => (
              <Checkbox key={opt.label} value={opt.label} variant="secondary" className="w-full gap-0">
                <Checkbox.Content className="w-full items-start gap-2 rounded-lg px-2.5 py-1.5 whitespace-normal hover:bg-default/50 data-[selected=true]:bg-default/80">
                  <Checkbox.Control className="mt-0.5 shrink-0">
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="text-xs font-medium text-foreground">{opt.label}</span>
                    {opt.description && <span className="block text-xs text-muted">{opt.description}</span>}
                  </span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </CheckboxGroup>
        ) : (
          <RadioGroup
            data-slot="question-answer"
            aria-labelledby={questionId}
            aria-describedby={invalid ? errorId : undefined}
            isInvalid={invalid}
            name={q.id}
            value={typeof value.selected === 'string' ? value.selected : ''}
            onChange={(selected) => onChange(q.id, { ...value, selected })}
            className="gap-1"
          >
            {q.options!.map((opt) => (
              <Radio key={opt.label} value={opt.label} className="w-full gap-0">
                <Radio.Content className="w-full items-start gap-2 rounded-lg px-2.5 py-1.5 whitespace-normal hover:bg-default/50 data-[selected=true]:bg-default/80">
                  <Radio.Control className="mt-0.5 shrink-0">
                    <Radio.Indicator />
                  </Radio.Control>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="text-xs font-medium text-foreground">{opt.label}</span>
                    {opt.description && <span className="block text-xs text-muted">{opt.description}</span>}
                  </span>
                </Radio.Content>
              </Radio>
            ))}
          </RadioGroup>
        ))}

      {/* Withheld where nothing could carry what was typed. A box that discards
          what is put in it is worse than no box, and this one would take the
          answer with it: `formatAnswer` folds a note into the selection, so a
          note beside a valid choice is what makes the pair unplaceable. */}
      {acceptsText(q) && (
        <Input
          data-slot="question-answer"
          fullWidth
          type="text"
          name={`${q.id}-notes`}
          autoComplete="off"
          aria-labelledby={questionId}
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          value={value.notes}
          onChange={(e) => onChange(q.id, { ...value, notes: e.target.value })}
          placeholder={hasOptions ? t('chat.tool.notesPlaceholder') : t('chat.tool.askUserPlaceholder')}
          className="text-xs"
        />
      )}
      {invalid && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {t('chat.tool.answerRequired')}
        </p>
      )}
    </div>
  )
}

function AskUserBlock({
  data,
  onAnswered,
  chromeless = false,
}: {
  data: ToolCallDisplay
  onAnswered?: () => void
  /** The form with no card or key around it, for a question that is already
   *  inside another tool's panel — a delegated run's. A card inside a panel
   *  is a rounder corner inside a squarer one, the wrong way up the ladder. */
  chromeless?: boolean
}) {
  const { t } = useTranslation()
  const presentation = useContext(ChatToolPresentationContext)
  const expansion = usePanelExpansion(`${data.call_id}:ask`, false, data.status === 'pending')
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})
  const [skippedSet, setSkippedSet] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [emptyFormError, setEmptyFormError] = useState(false)
  const fieldRefs = useRef(new Map<string, HTMLDivElement>())
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const retireAnswered = useConversationStore((s) => s.retireAnsweredApproval)

  // Held rather than read live, because answering retires the queue entry this
  // comes out of: without the ref the form would swap back to the call's own
  // input the instant send succeeded, taking every selection with it.
  const pending = useConversationStore((s) => {
    const attention = data.approval_id ? s.attention[data.approval_id] : undefined
    return attention?.kind === 'approval' || attention?.kind === 'ask' ? attention.arguments : undefined
  })
  const form = useRef<string | undefined>(undefined)
  if (pending) form.current = pending

  const questions = useMemo<AskQuestion[]>(
    () => askQuestionsFrom(pending ?? form.current ?? data.arguments),
    [pending, data.arguments],
  )

  const getAnswer = (id: string, q: AskQuestion) => answers[id] ?? emptyAnswer(q)

  const handleChange = useCallback((id: string, val: QuestionAnswer) => {
    setAnswers((prev) => ({ ...prev, [id]: val }))
    setEmptyFormError(false)
    setSkippedSet((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleSkip = useCallback((id: string) => {
    setSkippedSet((prev) => new Set(prev).add(id))
    setEmptyFormError(false)
  }, [])

  const handleUnskip = useCallback((id: string) => {
    setEmptyFormError(false)
    setSkippedSet((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const registerField = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) fieldRefs.current.set(id, element)
    else fieldRefs.current.delete(id)
  }, [])

  const focusQuestion = useCallback((id: string | undefined) => {
    if (!id) return
    requestAnimationFrame(() => {
      const field = fieldRefs.current.get(id)
      field
        ?.querySelector<HTMLElement>(
          '[data-slot="question-answer"] input, [data-slot="question-answer"] [role="radio"], [data-slot="question-answer"] [role="checkbox"], [data-slot="question-answer"]',
        )
        ?.focus()
    })
  }, [])

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const approvalId = data.approval_id
      if (!approvalId) return
      setSubmitAttempted(true)
      const missing = questions.filter((q) => q.required && !hasRequiredAnswer(q, answers[q.id]))
      const hasAnyAnswer = questions.some((q) => skippedSet.has(q.id) || hasContent(q, answers[q.id]))
      setEmptyFormError(!hasAnyAnswer)
      if (missing.length > 0 || !hasAnyAnswer) {
        focusQuestion(missing[0]?.id ?? questions[0]?.id)
        return
      }
      const result: Record<string, string> = {}
      for (const q of questions) {
        result[q.id] = formatAnswer(answers[q.id], skippedSet.has(q.id))
      }
      setSending(true)
      api.respondToAsk({ approvalId, response: JSON.stringify(result) }).then(
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
    },
    [answers, skippedSet, questions, data.approval_id, markOrphaned, retireAnswered, onAnswered, focusQuestion],
  )

  // A question the asker will not do without has to be answered before this
  // form can go, and the check belongs here rather than only on the way out:
  // the backend declines the *whole* payload over one missing required answer,
  // and by then the card has already reported success and retired the queue
  // entry, so every other answer is lost without a word.
  const unanswered = questions.filter((q) => q.required && !hasRequiredAnswer(q, answers[q.id]))
  const inCard = !chromeless && presentation === 'card'
  const section = inCard ? 'px-4 py-3' : ''
  const body = (
    <>
      {data.status === 'pending' && (
        <form className={cn('space-y-3', section)} aria-busy={sending} noValidate onSubmit={handleSubmit}>
          {questions.map((q) => (
            <QuestionBlock
              key={q.id}
              q={q}
              value={getAnswer(q.id, q)}
              skipped={skippedSet.has(q.id)}
              invalid={submitAttempted && q.required === true && !hasRequiredAnswer(q, answers[q.id])}
              registerField={registerField}
              onChange={handleChange}
              onSkip={handleSkip}
              onUnskip={handleUnskip}
            />
          ))}
          {emptyFormError && (
            <p role="alert" className="text-xs text-danger">
              {t('chat.tool.answerOrSkip')}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" isPending={sending}>
              {sending ? <Spinner color="current" size="sm" /> : <PaperPlane className="w-3.5 h-3.5" />}
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
        </form>
      )}

      {/* The questions are left on screen — they are still worth reading — but
          the form goes, since there is no longer anyone to send it to, and
          whatever did become of it is said here instead. */}
      {data.status !== 'pending' && data.status !== 'completed' && (
        <div className={section}>
          <CardOutcome status={data.status} />
        </div>
      )}

      {data.result && (
        <div className={inCard ? 'border-t border-separator bg-default/40' : 'rounded-lg bg-default/50'}>
          <div className="max-h-40 overflow-y-auto ">
            <pre className={cn('whitespace-pre-wrap text-foreground text-xs', inCard ? 'px-4 py-3' : 'px-3 py-2')}>
              {data.result}
            </pre>
          </div>
        </div>
      )}
    </>
  )

  if (chromeless) {
    return (
      <div data-slot="ask-user" data-status={data.status} className="flex flex-col gap-3">
        {body}
      </div>
    )
  }

  if (presentation === 'keyboard') {
    return (
      <ChatTool state={mapChatToolState(data.status)} {...expansion}>
        <ChatToolTrigger>
          <CircleQuestion aria-hidden className="size-3.5 shrink-0 text-muted" />
          <span className="font-medium text-foreground shrink-0">{t('chat.tool.askUser')}</span>
          {data.status === 'completed' && (
            <Check aria-hidden className="size-3.5 shrink-0 text-success-soft-foreground" />
          )}
        </ChatToolTrigger>
        <ChatToolContent>{body}</ChatToolContent>
      </ChatTool>
    )
  }

  return (
    <div className="my-3 overflow-hidden rounded-2xl bg-surface text-sm shadow-surface ring-1 ring-border ring-inset">
      <div className="flex items-center gap-2 bg-default px-4 py-3">
        <CircleQuestion className="w-3.5 h-3.5 text-muted" />
        <span className="font-medium text-foreground">{t('chat.tool.askUser')}</span>
        {/* No spinner here for `running`: the body below says so in words, and
            two of them side by side read as two things happening. */}
        {data.status === 'completed' && <Check className="w-3.5 h-3.5 text-success-soft-foreground ml-auto" />}
      </div>
      {body}
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

function ResultToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="border-t border-border/50 px-3 py-1.5">
      <Button variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs" onPress={onToggle}>
        {t(expanded ? 'chat.tool.showLess' : 'chat.tool.showFullResult')}
      </Button>
    </div>
  )
}

/** A line under a listing saying what was left out of it. */
function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="tool-footnote" className="border-t border-border/50 px-3 py-1.5 text-xs text-muted">
      {children}
    </div>
  )
}

/** A result that is one sentence about nothing — no matches, an empty
 *  directory — said in the panel's own words rather than the tool's. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="tool-empty" className="px-3 py-2 text-xs text-muted">
      {children}
    </div>
  )
}

function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]',
        className,
      )}
    >
      {text}
    </pre>
  )
}

/** The first `limit` characters, cut at a line end so no line is torn. */
function headOf(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.lastIndexOf('\n', limit)
  return text.slice(0, cut > limit / 2 ? cut : limit)
}

/**
 * The file `read_file` returned, numbered from one. The tool has no range
 * argument, so what came back starts at the file's first line and the gutter
 * can say so; a reader can name a line to the model by its number.
 */
function ReadFileResult({ result, path }: { result: string; path: string }) {
  const { t } = useTranslation()
  const { content, truncated: capped } = useMemo(() => parseReadFileOutput(result), [result])
  const [expanded, setExpanded] = useState(false)
  const long = content.length > 2000
  const body = long && !expanded ? headOf(content, 2000) : content
  return (
    <div data-slot="read-file-result">
      <div className="max-h-72 overflow-auto">
        <NumberedCode code={body} language={pathExtension(path)} />
      </div>
      {long && <ResultToggle expanded={expanded} onToggle={() => setExpanded((current) => !current)} />}
      {capped && (
        <Footnote>
          {capped.totalBytes !== null
            ? t('chat.tool.panel.fileTruncatedTotal', { bytes: capped.totalBytes.toLocaleString() })
            : t('chat.tool.panel.fileTruncated')}
        </Footnote>
      )}
    </div>
  )
}

function SearchResult({ result }: { result: string }) {
  const { t } = useTranslation()
  const { body, footnote } = useMemo(() => splitListingFootnote(result), [result])
  const matches = useMemo(() => parseSearchMatches(body), [body])
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
    if (body.trim() === NO_SEARCH_MATCHES) return <EmptyLine>{t('chat.tool.panel.noMatches')}</EmptyLine>
    return <PlainText text={body} />
  }

  return (
    <div data-slot="search-result">
      <div className="max-h-72 overflow-auto">
        {Array.from(grouped.entries()).map(([file, items]) => (
          <div key={file} className="not-first:border-t not-first:border-border/50">
            <div className="flex items-center gap-1.5 bg-default/30 px-3 py-1 text-xs text-muted">
              <FileIcon path={file} />
              <PathLabel path={file} className="min-w-0 flex-1" />
              <span className="ml-auto shrink-0 tabular-nums">{items.length}</span>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex w-max min-w-full gap-2 px-3 py-0.5 text-xs hover:bg-default/20">
                <span className="w-8 shrink-0 text-right font-mono text-muted tabular-nums">{item.line}</span>
                <span className="font-mono whitespace-pre text-foreground">{item.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {footnote.showingFirst !== null && (
        <Footnote>{t('chat.tool.panel.showingFirst', { count: footnote.showingFirst })}</Footnote>
      )}
    </div>
  )
}

/** `glob` answers with bare paths and nothing else — never `path:line:text`,
 *  so it gets a list of its own rather than a search's parser. */
function GlobResult({ result }: { result: string }) {
  const { t } = useTranslation()
  const { body, footnote } = useMemo(() => splitListingFootnote(result), [result])
  const { paths, empty } = useMemo(() => parseGlobResult(body), [body])
  if (empty) return <EmptyLine>{t('chat.tool.panel.noGlobMatches')}</EmptyLine>
  return (
    <div data-slot="glob-result">
      <div className="max-h-72 overflow-auto py-1">
        {paths.map((path) => (
          <div key={path} className="flex items-center gap-1.5 px-3 py-0.5 text-xs hover:bg-default/20">
            <FileIcon path={path} />
            <PathLabel path={path} className="min-w-0 flex-1" />
          </div>
        ))}
      </div>
      {footnote.showingFirst !== null && (
        <Footnote>{t('chat.tool.panel.showingFirst', { count: footnote.showingFirst })}</Footnote>
      )}
    </div>
  )
}

function DirectoryResult({ result }: { result: string }) {
  const { t } = useTranslation()
  const entries = useMemo(() => parseDirectoryListing(result), [result])
  if (entries === null) return <PlainText text={result} />
  if (entries.length === 0) return <EmptyLine>{t('chat.tool.panel.emptyDirectory')}</EmptyLine>
  return (
    <div data-slot="directory-result" className="max-h-72 overflow-auto py-1">
      {entries.map((entry) => (
        <div
          key={`${entry.kind}:${entry.name}`}
          className="flex items-center gap-1.5 px-3 py-0.5 text-xs hover:bg-default/20"
        >
          {entry.kind === 'dir' ? (
            <Folder aria-hidden className="size-3.5 shrink-0 text-muted" />
          ) : entry.kind === 'link' ? (
            <Link aria-hidden className="size-3.5 shrink-0 text-muted" />
          ) : (
            <FileIcon path={entry.name} />
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-foreground">{entry.name}</span>
          {entry.size !== null && <span className="shrink-0 font-mono text-muted tabular-nums">{entry.size}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * What a command printed, in the parts `formatted()` joined: stdout, then
 * stderr in its own tinted section. The trailers — exit code, timeout, the
 * command's own cap — are chips in the panel header, drawn by the block.
 */
function CommandOutputView({ output }: { output: CommandOutput }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (output.noOutput) return <EmptyLine>{t('chat.shell.noOutput')}</EmptyLine>
  const long = output.stdout.length > 2000
  const stdout = long && !expanded ? `${output.stdout.slice(0, 2000)}…` : output.stdout
  return (
    <div data-slot="command-output">
      {output.stdout !== '' && <PlainText text={stdout} />}
      {long && <ResultToggle expanded={expanded} onToggle={() => setExpanded((current) => !current)} />}
      {output.stderr !== '' && (
        <div data-slot="command-stderr" className="border-t border-border/50 bg-danger/5">
          <div className="px-3 pt-1.5 text-xs font-medium text-danger">{t('chat.tool.panel.stderr')}</div>
          <PlainText text={output.stderr} className="max-h-48 pt-0.5" />
        </div>
      )}
    </div>
  )
}

/** The command itself, as the shell will see it. Highlighted as bash, which is
 *  the backend's default shell on every platform including Windows; a hosted
 *  agent's `Bash` is bash by name. */
function CommandCode({ command }: { command: string }) {
  return (
    <div data-slot="command-code" className="relative">
      {/* Wrapped, not scrolled: a command is read whole before it is
          approved, and a long `cd … && …` scrolled off to the right is the
          part that matters least visible. The copy button keeps its corner. */}
      <div className="max-h-48 overflow-auto py-0.5 pr-9 pl-1 [&_pre]:break-all [&_pre]:whitespace-pre-wrap">
        <ShikiCode code={command} language="bash" />
      </div>
      <CopyButton text={command} className="absolute top-1.5 right-1.5" />
    </div>
  )
}

function GenericResult({ result }: { result: string }) {
  const [expanded, setExpanded] = useState(false)
  // JSON results get pretty-printed and syntax-highlighted like HeroUI's preset.
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(result), null, 2)
    } catch {
      return null
    }
  }, [result])

  if (pretty !== null && pretty.length <= 2000) {
    return <ChatToolResult text={pretty} className="max-h-72 rounded-none bg-transparent" />
  }

  const display = pretty ?? result
  const truncated = display.length > 1000

  return (
    <div data-slot="generic-result">
      <PlainText text={truncated && !expanded ? `${display.slice(0, 1000)}…` : display} className="max-h-48" />
      {truncated && <ResultToggle expanded={expanded} onToggle={() => setExpanded((current) => !current)} />}
    </div>
  )
}

function ToolErrorResult({ result }: { result: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = result.length > 1000
  return (
    <div className="p-2">
      <ChatToolError>{truncated && !expanded ? `${result.slice(0, 1000)}…` : result}</ChatToolError>
      {truncated && <ResultToggle expanded={expanded} onToggle={() => setExpanded((current) => !current)} />}
    </div>
  )
}

/** Tools whose result is what they read, and so belongs in the body whatever
 *  its length — never folded into a footer sentence. */
const READING_TOOLS = new Set(['read_file', 'Read', 'search_files', 'Grep', 'glob', 'Glob', 'list_directory'])

function ToolResult({ toolName, result, args }: { toolName: string; result: string; args: Record<string, unknown> }) {
  switch (toolName) {
    case 'read_file':
      return <ReadFileResult result={result} path={String(args.path ?? '')} />
    case 'Read':
      return <ReadFileResult result={result} path={String(args.file_path ?? '')} />
    case 'search_files':
      return <SearchResult result={result} />
    case 'glob':
      return <GlobResult result={result} />
    case 'list_directory':
      return <DirectoryResult result={result} />
    default:
      return <GenericResult result={result} />
  }
}

/**
 * The arguments as a list of what they are, for a tool with no drawing of its
 * own: a memory's key and content, an MCP call's fields. The keys the built-in
 * tools use have names in the locale; anything else shows as the model wrote
 * it. A value with line breaks in it, or a long one, gets a block of its own
 * under its label so the columns do not fight over the width.
 */
function ArgsList({ args }: { args: Record<string, unknown> }) {
  const { t } = useTranslation()
  const entries = Object.entries(args).filter(([key]) => key !== 'description')
  if (entries.length === 0) return null
  return (
    <dl data-slot="tool-args-list" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-xs">
      {entries.map(([key, value]) => {
        const labelKey = `chat.tool.param.${key}`
        const label = t(labelKey)
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        const block = text.includes('\n') || text.length > 80
        return (
          <Fragment key={key}>
            <dt className={cn('text-muted', block && 'col-span-2')}>{label === labelKey ? key : label}</dt>
            <dd
              className={cn(
                'min-w-0 font-mono text-foreground/90',
                block ? 'col-span-2 rounded-md bg-default/40 px-2 py-1 break-words whitespace-pre-wrap' : 'truncate',
              )}
            >
              {text}
            </dd>
          </Fragment>
        )
      })}
    </dl>
  )
}

/** The chips a command's trailers become. */
function commandChips(t: TFunction, output: CommandOutput): React.ReactNode[] {
  const chips: React.ReactNode[] = []
  if (output.exitCode !== null) {
    chips.push(
      <Chip key="exit" size="sm" variant="soft" color={output.exitCode === 0 ? 'default' : 'danger'}>
        {t('chat.shell.exitCode', { code: output.exitCode })}
      </Chip>,
    )
  }
  if (output.timedOut) {
    chips.push(
      <Chip key="timeout" size="sm" variant="soft" color="warning">
        {t('chat.tool.panel.timedOut')}
      </Chip>,
    )
  }
  if (output.truncated) {
    chips.push(
      <Chip key="cap" size="sm" variant="soft">
        {t('chat.shell.truncated')}
      </Chip>,
    )
  }
  return chips
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

  // The refuse shortcut cannot refuse on its own — a reason may be typed — so
  // it asks; this is the answer, and taking it up clears the ask.
  const denyRequested = useConversationStore((s) => s.denyRequestApprovalId === approvalId)
  const consumeDenyRequest = useConversationStore((s) => s.consumeDenyRequest)
  useEffect(() => {
    if (!denyRequested) return
    if (ui === 'idle') setUi('feedback')
    consumeDenyRequest(approvalId)
  }, [denyRequested, ui, approvalId, consumeDenyRequest])

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
        <CircleDashed className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
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
          {/* The label in its own span, with the chord beside it as a hint the
              accessible name leaves out: `aria-keyshortcuts` is what a screen
              reader announces, and `aria-hidden` keeps the hint from being read
              as part of the button's name. */}
          <Button
            variant="outline"
            className="text-danger hover:text-danger"
            aria-keyshortcuts={ariaHotkey(DENY_HOTKEY)}
            onPress={() => setUi('feedback')}
          >
            <Xmark className="w-3.5 h-3.5" />
            <span>{t('chat.tool.deny')}</span>
            <HotkeyHint combo={DENY_HOTKEY} />
          </Button>
          <Button
            aria-keyshortcuts={ariaHotkey(APPROVE_HOTKEY)}
            onPress={() => decide(() => api.approveToolCall(approvalId))}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isEscalation ? t('chat.tool.retryWithoutSandbox') : t('chat.tool.allow')}</span>
            <HotkeyHint combo={APPROVE_HOTKEY} />
          </Button>
        </ChatToolApproval>
      </>
    )
  }

  const deny = () => decide(() => api.denyToolCall({ approvalId, reason: feedback || null }))

  return (
    <div className="space-y-2">
      <Input
        fullWidth
        type="text"
        name="tool-denial-reason"
        autoComplete="off"
        aria-label={t('chat.tool.denyReason')}
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
        <Button variant="ghost" onPress={() => setUi('idle')}>
          {t('chat.tool.cancel')}
        </Button>
        <Button variant="outline" className="text-danger hover:text-danger" onPress={deny}>
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
  const presentation = useContext(ChatToolPresentationContext)
  const settled =
    data.status === 'completed' || data.status === 'denied' || data.status === 'error' || data.status === 'orphaned'
  const expansion = usePanelExpansion(data.call_id, !settled, data.status === 'pending')

  // One key whatever the state, so the row of keys under a bubble does not
  // change shape as a search goes from asked to running to answered. The card
  // below draws each state as its own thing, which was right for a card in a
  // column and wrong for a key in a row.
  if (presentation === 'keyboard') {
    const failed = data.status === 'error' || (data.status === 'completed' && sources === null)
    const state: ChatToolState = failed ? 'output-error' : mapChatToolState(data.status)
    return (
      <ChatTool state={state} {...expansion}>
        <ChatToolTrigger
          endContent={
            sources && sources.length > 0 ? (
              <span className="tabular-nums">{t('chat.tool.webSearch.sources', { count: sources.length })}</span>
            ) : null
          }
        >
          <Globe aria-hidden className="size-3.5 shrink-0 text-muted" />
          <span className="font-medium text-foreground shrink-0">{t('chat.tool.name.web_search')}</span>
          {query && (
            <span data-slot="tool-arg" className="text-muted">
              {query}
            </span>
          )}
        </ChatToolTrigger>
        <ChatToolContent>
          {data.status === 'pending' && data.approval_id && (
            <PendingApproval key={data.approval_id} approvalId={data.approval_id} retryReason={data.retry_reason} />
          )}
          {data.status === 'orphaned' && <OrphanedNotice />}
          {!settled && data.status !== 'pending' && (
            <div className="flex items-center gap-2 text-muted">
              <Globe className="size-3.5 animate-pulse" />
              <span>{t('chat.tool.webSearch.searching')}</span>
            </div>
          )}
          {data.status === 'denied' && <CardOutcome status="denied" detail={data.result} />}
          {failed && (
            <>
              <div className="flex items-center gap-2 text-danger">
                <Globe className="size-3.5 shrink-0" />
                <span>{t('chat.tool.webSearch.failed')}</span>
              </div>
              {data.result && <ToolErrorResult result={data.result} />}
            </>
          )}
          {sources && sources.length === 0 && (
            <div className="flex items-center gap-2 text-muted">
              <Globe className="size-3.5" />
              <span>{t('chat.tool.webSearch.noResults')}</span>
            </div>
          )}
          {sources && sources.length > 0 && (
            <ul data-slot="web-search-sources" className="flex flex-col gap-1">
              {sources.map((src, i) => (
                <li key={i}>
                  <ChatSource
                    description={src.title}
                    faviconUrl={src.favicon ?? undefined}
                    href={src.url}
                    title={src.site_name || src.title}
                  >
                    <ChatSource.Trigger
                      href="#meridian-external"
                      rel="noreferrer noopener"
                      target={undefined}
                      onAuxClick={(e) => {
                        e.preventDefault()
                        if (e.button === 1) openExternally(src.url, e)
                      }}
                      onClick={(e) => openExternally(src.url, e)}
                    >
                      <ChatSource.Icon faviconUrl={src.favicon ?? undefined} />
                      <ChatSource.Title>{src.site_name || src.title}</ChatSource.Title>
                    </ChatSource.Trigger>
                  </ChatSource>
                </li>
              ))}
            </ul>
          )}
        </ChatToolContent>
      </ChatTool>
    )
  }

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
      <div className="my-2 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-danger shrink-0" />
          <span className="text-danger">{t('chat.tool.webSearch.failed')}</span>
        </div>
        {data.result && <ToolErrorResult result={data.result} />}
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
              <ChatSource.Trigger
                href="#meridian-external"
                rel="noreferrer noopener"
                target={undefined}
                onAuxClick={(e) => {
                  e.preventDefault()
                  if (e.button === 1) openExternally(src.url, e)
                }}
                onClick={(e) => openExternally(src.url, e)}
              >
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

  const presentation = useContext(ChatToolPresentationContext)
  const expansion = usePanelExpansion(data.call_id, false, data.status === 'pending')
  const inCard = presentation === 'card'
  const section = inCard ? 'px-4 py-3' : ''
  const divider = inCard ? 'border-t border-separator' : ''

  const body = (
    <>
      <div data-slot="enter-plan-reason" className={cn('text-foreground', section)}>
        {reason}
      </div>

      {data.status === 'pending' && approvalId && !sent && (
        <div data-slot="enter-plan-actions" className={cn(divider, section)}>
          <ChatToolApproval>
            <Button variant="outline" onPress={() => decide(() => api.denyToolCall({ approvalId, reason: null }))}>
              <Xmark className="w-3.5 h-3.5" />
              {t('chat.plan.keepBuilding')}
            </Button>
            <Button onPress={() => decide(() => api.approveToolCall(approvalId))}>
              <Compass className="w-3.5 h-3.5" />
              {t('chat.plan.startPlanning')}
            </Button>
          </ChatToolApproval>
        </div>
      )}

      {data.status === 'pending' && sent && (
        <div data-slot="enter-plan-waiting" className={cn('flex items-center gap-2 text-muted', divider, section)}>
          <CircleDashed className="w-3.5 h-3.5 animate-spin" />
          <span>{t('chat.tool.running')}</span>
        </div>
      )}

      {data.status !== 'pending' && data.status !== 'completed' && (
        <div data-slot="enter-plan-outcome" className={cn(divider, section)}>
          <CardOutcome status={data.status} detail={data.result} />
        </div>
      )}
    </>
  )

  if (presentation === 'keyboard') {
    return (
      <ChatTool state={mapChatToolState(data.status)} {...expansion}>
        <ChatToolTrigger>
          <Compass aria-hidden className="size-3.5 shrink-0 text-muted" />
          <span data-slot="enter-plan-title" className="font-medium text-foreground shrink-0">
            {t('chat.plan.enterTitle')}
          </span>
          {data.status === 'completed' && (
            <Check aria-hidden className="size-3.5 shrink-0 text-success-soft-foreground" />
          )}
          {declined && <Xmark aria-hidden className="size-3.5 shrink-0 text-muted" />}
        </ChatToolTrigger>
        <ChatToolContent>{body}</ChatToolContent>
      </ChatTool>
    )
  }

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
      {body}
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
    if (approvalId) decide(() => api.denyToolCall({ approvalId, reason: feedback.trim() || null }))
  }, [decide, approvalId, feedback])

  const presentation = useContext(ChatToolPresentationContext)
  const expansion = usePanelExpansion(data.call_id, false, data.status === 'pending')
  const inCard = presentation === 'card'
  const section = inCard ? 'px-4 py-3' : ''
  const divider = inCard ? 'border-t border-separator' : ''

  const body = (
    <>
      <div data-slot="exit-plan-body" className={cn('max-h-96 overflow-y-auto', section)}>
        <MarkdownContent content={plan} />
      </div>

      {data.status === 'pending' && approvalId && ui !== 'sent' && (
        <div data-slot="exit-plan-actions" className={cn(divider, section)}>
          {ui === 'feedback' ? (
            <div data-slot="exit-plan-feedback" className="space-y-2">
              <Input
                fullWidth
                type="text"
                name="plan-feedback"
                autoComplete="off"
                aria-label={t('chat.plan.feedbackLabel')}
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
                <Button variant="ghost" onPress={() => setUi('idle')}>
                  {t('chat.tool.cancel')}
                </Button>
                <Button variant="outline" onPress={sendBack}>
                  <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
                  {t('chat.plan.sendBack')}
                </Button>
              </ChatToolApproval>
            </div>
          ) : (
            <ChatToolApproval>
              <Button variant="outline" onPress={() => setUi('feedback')}>
                <ArrowUturnCcwLeft className="w-3.5 h-3.5" />
                {t('chat.plan.revise')}
              </Button>
              <Button onPress={() => decide(() => api.approveToolCall(approvalId))}>
                <Check className="w-3.5 h-3.5" />
                {t('chat.plan.approve')}
              </Button>
            </ChatToolApproval>
          )}
        </div>
      )}

      {data.status === 'pending' && ui === 'sent' && (
        <div data-slot="exit-plan-waiting" className={cn('flex items-center gap-2 text-muted', divider, section)}>
          <CircleDashed className="w-3.5 h-3.5 animate-spin" />
          <span>{t('chat.tool.running')}</span>
        </div>
      )}

      {data.status !== 'pending' && data.status !== 'completed' && (
        <div data-slot="exit-plan-outcome" className={cn(divider, section)}>
          <CardOutcome status={data.status} detail={data.result} />
        </div>
      )}
    </>
  )

  if (presentation === 'keyboard') {
    return (
      <ChatTool state={mapChatToolState(data.status)} {...expansion}>
        <ChatToolTrigger>
          <SquareListUl aria-hidden className="size-3.5 shrink-0 text-muted" />
          <span data-slot="exit-plan-title" className="font-medium text-foreground shrink-0">
            {t('chat.plan.title')}
          </span>
          {data.status === 'completed' && (
            <Check aria-hidden className="size-3.5 shrink-0 text-success-soft-foreground" />
          )}
          {wasRejected && <Xmark aria-hidden className="size-3.5 shrink-0 text-muted" />}
        </ChatToolTrigger>
        <ChatToolContent>{body}</ChatToolContent>
      </ChatTool>
    )
  }

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
      {body}
    </div>
  )
}

function PlanReviewEntryBlock({ data, reviewId }: { data: ToolCallDisplay; reviewId: string }) {
  const { t } = useTranslation()
  const openReview = usePlanReviewStore((state) => state.openReview)
  const summary = usePlanReviewStore((state) => state.summaries[reviewId])
  const status =
    summary?.status ??
    (data.status === 'pending'
      ? 'pending'
      : data.status === 'completed'
        ? 'approved'
        : data.status === 'denied'
          ? 'changes_requested'
          : 'orphaned')
  const presentation = useContext(ChatToolPresentationContext)

  // A key that goes somewhere rather than opening something: the review has a
  // page of its own, and a panel here would be a second, smaller copy of it.
  if (presentation === 'keyboard') {
    return (
      <BubbleKeyboardKey
        data-slot="plan-review-entry"
        data-status={status}
        state={status === 'pending' ? 'navigate' : 'output-available'}
        onClick={() => openReview(reviewId)}
      >
        <SquareListUl aria-hidden className="size-3.5 shrink-0" />
        <span className="font-medium shrink-0">{t('chat.plan.title')}</span>
        <Chip size="sm" variant="secondary" className="ml-auto">
          {t(`chat.plan.status.${status}`)}
        </Chip>
      </BubbleKeyboardKey>
    )
  }

  return (
    <div
      data-slot="plan-review-entry"
      data-status={status}
      className={cn(
        'my-3 rounded-2xl bg-surface p-4 text-sm shadow-surface',
        status === 'pending' && 'ring-1 ring-info/40 ring-inset',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SquareListUl aria-hidden className="size-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{t('chat.plan.title')}</span>
            <Chip size="sm" variant="secondary">
              {t(`chat.plan.status.${status}`)}
            </Chip>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted">
            {status === 'pending' ? t('chat.plan.reviewReady') : t('chat.plan.reviewHistory')}
          </p>
        </div>
        <Button variant={status === 'pending' ? 'primary' : 'outline'} onPress={() => openReview(reviewId)}>
          {t('chat.plan.review')}
        </Button>
      </div>
    </div>
  )
}

function TodoListBlock({ data, title, todos }: { data: ToolCallDisplay; title: string; todos: TodoDraft[] }) {
  const { t } = useTranslation()
  const { done, total } = todoProgress(todos)
  const expansion = usePanelExpansion(data.call_id, done < total, false)

  return (
    <ChatTool state={mapChatToolState(data.status)} {...expansion}>
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
/** What kind of thing the identifying argument is, which decides how it is
 *  drawn: a path keeps its file name, a command keeps its first line. */
export interface IdentifyingArg {
  kind: 'path' | 'command' | 'text'
  value: string
}

export function identifyingArg(toolName: string, args: Record<string, unknown>): IdentifyingArg | null {
  const str = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null)
  const path = (value: string | null): IdentifyingArg | null => (value === null ? null : { kind: 'path', value })
  const text = (value: string | null): IdentifyingArg | null => (value === null ? null : { kind: 'text', value })
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
    case 'write_file':
      return path(str(args.path))
    case 'edit_file':
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return path(str(args.file_path) ?? str(args.notebook_path))
    case 'run_command':
    case 'Bash':
    case 'SlashCommand': {
      const command = str(args.command)
      return command === null ? null : { kind: 'command', value: command }
    }
    case 'search_files':
    case 'glob':
    case 'Glob':
    case 'Grep':
      return text(str(args.pattern))
    case 'WebFetch':
      return text(str(args.url))
    case 'Skill':
      return text(str(args.skill))
    case 'apply_patch': {
      const patch = typeof args.patch === 'string' ? args.patch : ''
      const m = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m) ?? patch.match(/^\+\+\+ (?:b\/)?(.+)$/m)
      return path(m ? m[1].trim() : null)
    }
    default:
      return null
  }
}

/** A command's first line, with a count of the lines it is standing in for. */
function commandHeadline(command: string): { head: string; more: number } {
  const lines = command.split('\n').filter((line) => line.trim() !== '')
  return { head: lines[0] ?? command, more: Math.max(0, lines.length - 1) }
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
 *
 * **`compact` is for an ordinary key and nothing else.** A key is half a row
 * and shows one line, so a path keeps its file name and gives up its directory
 * from the end, and a command keeps its first line with a count of the rest.
 * A key waiting on a decision and the approval toast show the whole value:
 * what is being approved cannot be something the reader did not see. Neither
 * clamps here — how many lines the whole value may take is the container's
 * call, and it says so with a descendant selector on `tool-arg`.
 */
export function ToolArgsSummary({
  toolName,
  args,
  compact = false,
  className,
}: {
  toolName: string
  args: Record<string, unknown>
  compact?: boolean
  className?: string
}) {
  const arg = identifyingArg(toolName, args)
  if (arg === null) return null
  const base = 'min-w-0 font-mono text-xs text-foreground'
  if (arg.kind === 'path') {
    return (
      <span data-slot="tool-arg" className={cn(base, 'flex', className)}>
        <PathLabel path={arg.value} wrap={!compact} />
      </span>
    )
  }
  if (arg.kind === 'command' && compact) {
    const { head, more } = commandHeadline(arg.value)
    return (
      <span data-slot="tool-arg" className={cn(base, 'flex whitespace-nowrap', className)}>
        <span className="min-w-0 truncate">{head}</span>
        {more > 0 && (
          <span aria-hidden className="ml-1 shrink-0 text-muted">
            ⏎ +{more}
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      data-slot="tool-arg"
      className={cn(base, compact ? 'truncate' : 'break-words whitespace-pre-wrap [overflow-wrap:anywhere]', className)}
    >
      {arg.value}
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
  const settled =
    data.status === 'completed' || data.status === 'denied' || data.status === 'error' || data.status === 'orphaned'
  const expansion = usePanelExpansion(data.call_id, !settled, nested != null)
  const [taskOpen, setTaskOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // The report, with the verdict sentence and the stranded note taken off. The
  // verdict itself comes from the run's recorded status when there is one —
  // the sentence is parsed only for rows from before the status was carried.
  const report = useMemo(
    () =>
      data.result === undefined || data.status === 'error'
        ? null
        : parseSubAgentResult(splitTruncation(data.result).body),
    [data.result, data.status],
  )
  const outcome = subAgentOutcome(data, report)
  const longReport = (report?.body.length ?? 0) > 1500

  // A question the run raised makes this key the one waiting on a person, and
  // the key has to say so: `run_agent` itself is merely running, and a spinner
  // is what a reader scrolls past.
  return (
    <ChatTool state={nested ? 'requires-action' : mapChatToolState(data.status)} {...expansion}>
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
        <ChatToolPanelHeader
          title={description}
          description={t(`chat.subAgent.${readOnly ? 'explore' : 'agent'}`)}
          end={outcome && <SubAgentStatusChip outcome={outcome} />}
        />
        <ChatToolPanelBody>
          {prompt && (
            <section data-slot="sub-agent-task" className="px-3 pt-2 pb-1">
              <div className="mb-1 text-xs font-medium text-muted">{t('chat.tool.panel.task')}</div>
              {/* Three lines and a fade, unless asked for the whole thing: the
                  briefing is the model's, often long, and the reader mostly
                  wants the report under it. */}
              <div className={cn('relative text-xs', !taskOpen && 'max-h-[4.5rem] overflow-hidden')}>
                <MarkdownContent content={prompt} blockId={`${data.call_id}:prompt`} />
                {!taskOpen && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface to-transparent"
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-0.5 h-auto px-1 py-0.5 text-xs"
                aria-expanded={taskOpen}
                onPress={() => setTaskOpen((open) => !open)}
              >
                {t(taskOpen ? 'chat.tool.panel.collapseTask' : 'chat.tool.panel.expandTask')}
              </Button>
            </section>
          )}

          {/* The question the run raised. Asked here because this is where
              somebody is looking — its own conversation may never be opened. */}
          {nested && (
            <div className="space-y-2 border-t border-border/50 px-3 py-2">
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
                  chromeless
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

          {data.sub_agent && (
            <div className="border-t border-border/50">
              <SubAgentTimeline run={data.sub_agent} live={data.status === 'running'} count={steps} />
            </div>
          )}

          {report && (
            <section data-slot="sub-agent-report" className="border-t border-border/50 px-3 py-2">
              <div className="mb-1 text-xs font-medium text-muted">{t('chat.tool.panel.report')}</div>
              {report.body !== '' ? (
                <div className={cn('relative', longReport && !reportOpen && 'max-h-96 overflow-hidden')}>
                  <MarkdownContent content={report.body} blockId={`${data.call_id}:report`} />
                  {longReport && !reportOpen && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-surface to-transparent"
                    />
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted">{t('chat.tool.panel.noReport')}</p>
              )}
              {longReport && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-auto px-1 py-0.5 text-xs"
                  onPress={() => setReportOpen((open) => !open)}
                >
                  {t(reportOpen ? 'chat.tool.showLess' : 'chat.tool.showFullResult')}
                </Button>
              )}
              {report.stranded && (
                <div
                  data-slot="sub-agent-stranded"
                  className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning-soft-foreground"
                >
                  <TriangleExclamation className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                  <span>{report.stranded}</span>
                </div>
              )}
            </section>
          )}

          {data.status === 'error' && data.result && (
            <div className="border-t border-border/50">
              <ToolErrorResult result={data.result} />
            </div>
          )}
        </ChatToolPanelBody>

        {(data.sub_agent || data.status === 'orphaned' || data.status === 'denied') && (
          <ChatToolPanelFooter>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <CardOutcome status={data.status} detail={data.status === 'denied' ? data.result : undefined} />
              {/* TODO: this opens, but half-furnished. `ChatView` and the
                  header read their conversation out of `s.conversations` (six
                  reads in `chat-view.tsx`, one in `App.tsx`), and a sub-agent's
                  is filtered out of that list — it is the sidebar's data
                  source and these are hidden on purpose. So `assistant_id`,
                  `mode`, `accept_edits`, `thinking_level` and `fast_mode` all
                  come back null and the header shows the app name. The
                  snapshot already carries the whole conversation;
                  `loadMessages` drops it. Fix is a `conversationDetails` cache
                  with a `conversationById` selector those seven reads fall
                  back through — deferred with the rest of the navigation work
                  until the HeroUI Pro change lands, since that is the layer it
                  sits in.

                  The second half of the same deferral: this keeps its own
                  stack in `conversation-store` while `stores/nav-store.ts`
                  owns the real one. Two truths for one back gesture; only the
                  system back key on mobile can tell, which is why it can
                  wait. */}
              {data.sub_agent && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto text-xs"
                  onPress={() => openConversation(data.sub_agent!.conversation_id)}
                >
                  {t('chat.tool.panel.openConversation')}
                  <ArrowUpRightFromSquare className="size-3" />
                </Button>
              )}
            </div>
          </ChatToolPanelFooter>
        )}
      </ChatToolContent>
    </ChatTool>
  )
}

type SubAgentVerdict = SubAgentOutcome | 'running' | 'interrupted'

/** The run's verdict: the backend's recorded status first, the sentence at the
 *  head of the result for rows from before that status was carried. */
function subAgentOutcome(data: ToolCallDisplay, report: SubAgentResult | null): SubAgentVerdict | null {
  if (data.status === 'running' || data.status === 'approved') return 'running'
  if (data.status === 'error') return 'failed'
  switch (data.sub_agent?.status) {
    case 'running':
    case 'waiting_review':
      return 'running'
    case 'done':
      return 'done'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
    default:
      return report?.outcome ?? null
  }
}

function SubAgentStatusChip({ outcome }: { outcome: SubAgentVerdict }) {
  const { t } = useTranslation()
  const label = t(`chat.tool.panel.status.${outcome}`)
  const icon =
    outcome === 'running' ? (
      <Spinner size="sm" color="current" className="size-3" />
    ) : outcome === 'done' ? (
      <CircleCheck className="size-3" />
    ) : outcome === 'failed' ? (
      <TriangleExclamation className="size-3" />
    ) : (
      <Ban className="size-3" />
    )
  return (
    // The attributes ride a span of our own: HeroUI's Chip keeps what it is
    // handed to itself.
    <span data-slot="sub-agent-status" data-outcome={outcome} className="contents">
      <Chip
        size="sm"
        variant="soft"
        color={
          outcome === 'done'
            ? 'success'
            : outcome === 'failed'
              ? 'danger'
              : outcome === 'running'
                ? 'default'
                : 'warning'
        }
      >
        {icon}
        {label}
      </Chip>
    </span>
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

/** A chord drawn beside a decision, the way a menu item shows its shortcut.
 *  Hidden from assistive technology: `aria-keyshortcuts` on the button says
 *  the same thing in a form a screen reader knows how to announce. */
function HotkeyHint({ combo }: { combo: string }) {
  return (
    <kbd aria-hidden className="ml-1 hidden font-sans text-xs opacity-60 pointer-fine:inline">
      {formatHotkey(combo)}
    </kbd>
  )
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
function AutoReviewNotice({ verdict }: { verdict: AutoReviewVerdictInfoResponse }) {
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
function CardOutcome({
  status,
  detail,
  sentence,
}: {
  status: ToolCallDisplay['status']
  detail?: string
  /** A finished call's one-line confirmation, in the tool's own words. */
  sentence?: string
}) {
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
      return null
    case 'completed':
      return sentence
        ? notice(<CircleCheck className="w-3.5 h-3.5 shrink-0 text-success-soft-foreground" />, sentence)
        : null
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
    if (raw.status === 'pending' && !raw.approval_id && !raw.plan_review_id) return { ...raw, status: 'orphaned' }
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

  // Open while it works or waits, shut once it has an outcome — unless the
  // reader said otherwise. Called before the specialised cards return, because
  // hooks are; the ones that draw their own chrome keep an expansion of their
  // own and ignore this one.
  const expansion = usePanelExpansion(data.call_id, !isCompleted, data.status === 'pending')
  const presentation = useContext(ChatToolPresentationContext)

  // Where an edit lands. Asked here, ahead of the early returns, because it is
  // a hook; it asks nothing unless the call is an edit that has not run yet.
  const isEdit = data.tool_name === 'edit_file' || data.tool_name === 'Edit'
  const editLine = useEditLocation(
    data,
    isEdit && typeof parsedArgs.file_path === 'string' ? parsedArgs.file_path : null,
    isEdit && typeof parsedArgs.old_string === 'string' ? parsedArgs.old_string : null,
  )

  // Numbers where somebody knows them. A whole-file write starts at one; a
  // unified patch says where each hunk starts; an edit is placed by the probe
  // that read the file for `old_string`. Anything else is drawn unnumbered.
  const numberedDiffs = useMemo(() => {
    if (!fileDiffs) return null
    return fileDiffs.map((diff) => {
      if (data.tool_name === 'write_file' || data.tool_name === 'Write') {
        return { ...diff, lines: numberDiffLines(diff.lines, { oldStart: 1, newStart: 1 }) }
      }
      if (data.tool_name === 'edit_file' || data.tool_name === 'Edit') {
        return editLine === null
          ? diff
          : { ...diff, lines: numberDiffLines(diff.lines, { oldStart: editLine, newStart: editLine }) }
      }
      const start = firstHunkStart(diff.lines)
      return start === null ? diff : { ...diff, lines: numberDiffLines(diff.lines, start) }
    })
  }, [fileDiffs, data.tool_name, editLine])

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
    if (data.plan_review_id) {
      return <PlanReviewEntryBlock data={data} reviewId={data.plan_review_id} />
    }
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
  const description = toolDescription(parsedArgs)
  const arg = identifyingArg(data.tool_name, parsedArgs)
  const state = mapChatToolState(data.status)
  // A key is half a row; a key waiting on a decision, or a card, shows the
  // whole value. See `ToolArgsSummary`.
  const compact = presentation === 'keyboard' && state !== 'requires-action'

  const trimmedArgs = data.arguments.trim()
  const showArgs = trimmedArgs !== '' && trimmedArgs !== '{}'
  const parsedOk = Object.keys(parsedArgs).length > 0
  const isCommand = arg?.kind === 'command'

  // What came back, with the turn-level truncation taken off the front so the
  // renderers below see what the tool wrote. An error's text is the error.
  const output = data.result !== undefined && data.status !== 'error' ? splitTruncation(data.result) : null
  const command = isCommand && output !== null ? parseCommandOutput(output.body) : null
  // A confirmation — "Successfully wrote 312 bytes to …", "Saved memory …" —
  // is one sentence about the outcome and goes in the footer as such. What a
  // reading tool returns is the reading, however short, and stays in the body;
  // so does a command's one line of output.
  const sentence =
    output !== null && !isCommand && !READING_TOOLS.has(data.tool_name) && isOneLiner(output.body)
      ? output.body.trim()
      : null

  const singleDiff = numberedDiffs !== null && numberedDiffs.length === 1 ? numberedDiffs[0] : null

  const end: React.ReactNode[] = []
  if (singleDiff) end.push(<DiffStats key="stats" diff={singleDiff} />)
  if (command) end.push(...commandChips(t, command))
  if (output?.truncation) {
    end.push(
      <Hint key="truncated" label={t('chat.tool.panel.truncatedTokens', { count: output.truncation.originalTokens })}>
        <Chip size="sm" variant="soft">
          {t('chat.tool.panel.truncated')}
        </Chip>
      </Hint>,
    )
  }

  // The header says in full what the key had to shorten: the whole path, the
  // description a compact key kept as a tooltip. A key waiting on a decision
  // already shows both in full, and so does a card, so there the header
  // carries only its chips — the same line an inch lower would say nothing.
  // A command's own text is the first thing in the body, so its header, when
  // there is one, is what the command is for.
  const title =
    !compact || arg === null ? null : arg.kind === 'path' ? (
      <PathLabel path={arg.value} wrap />
    ) : arg.kind === 'command' ? (
      description
    ) : (
      <span className="font-mono">{arg.value}</span>
    )
  const headerDescription = compact && arg?.kind !== 'command' ? description : null

  const pendingRow = data.status === 'pending' && data.approval_id !== undefined
  // Only the ends nothing else on the panel shows: a refusal, a turn that
  // died, a question parked on another card. Running has the key's spinner
  // and queued has the key's label.
  const outcome = data.status === 'denied' || data.status === 'orphaned' || data.status === 'awaiting_parent'
  const hasFooter = pendingRow || outcome || data.auto_review !== undefined || sentence !== null

  return (
    <ChatTool state={state} {...expansion} className={className}>
      {/* Both, on two lines: what this call is, and what it is for. Neither
          displaces the other — see `toolDescription`. */}
      <ChatToolTrigger subtitle={description}>
        <ChatToolStatusIcon />
        <span className="font-medium text-foreground shrink-0">{label}</span>
        <ToolArgsSummary toolName={data.tool_name} args={parsedArgs} compact={compact} />
        {/* In the trigger, not the body: a queued card is collapsed, and a
            standing clock beside a spinning one is too fine a distinction to
            rest the whole answer on. The summary stays — with three commands
            queued, which one this is matters as much as that it is waiting. */}
        {data.status === 'queued' && (
          <span className="ml-auto shrink-0 text-xs text-muted">{t('chat.tool.queued')}</span>
        )}
      </ChatToolTrigger>
      <ChatToolContent>
        {(title !== null || headerDescription !== null || end.length > 0) && (
          <ChatToolPanelHeader title={title} description={headerDescription} end={end.length > 0 ? end : undefined} />
        )}
        <ChatToolPanelBody>
          {singleDiff ? (
            // The panel header already names the file; a second header would
            // name it again an inch lower.
            <FileDiffCard diff={singleDiff} header={false} />
          ) : numberedDiffs ? (
            numberedDiffs.map((d, i) => <FileDiffCard key={i} diff={d} />)
          ) : isCommand ? (
            <CommandCode command={arg.value} />
          ) : parsedOk ? (
            <ArgsList args={parsedArgs} />
          ) : (
            // Mid-stream the JSON is partial and parses to nothing; it is shown
            // as it stands rather than as an empty list.
            showArgs && <ChatToolArgs text={data.arguments} className="rounded-none bg-transparent" />
          )}

          {data.status === 'error' && data.result !== undefined && (
            <div className="border-t border-border/50">
              <ToolErrorResult result={data.result} />
            </div>
          )}
          {output !== null && sentence === null && (
            <div className="border-t border-border/50">
              {command ? (
                <CommandOutputView output={command} />
              ) : (
                <ToolResult toolName={data.tool_name} result={output.body} args={parsedArgs} />
              )}
            </div>
          )}
        </ChatToolPanelBody>
        {hasFooter && (
          <ChatToolPanelFooter>
            {/* Above the buttons rather than below: when a review came back
                unreadable there *are* buttons under this, and what it says is
                why the user is being asked at all. */}
            {data.auto_review && <AutoReviewNotice verdict={data.auto_review} />}
            {pendingRow && (
              <PendingApproval key={data.approval_id} approvalId={data.approval_id!} retryReason={data.retry_reason} />
            )}
            <CardOutcome
              status={data.status}
              detail={data.status === 'denied' ? data.result : undefined}
              sentence={sentence ?? undefined}
            />
          </ChatToolPanelFooter>
        )}
      </ChatToolContent>
    </ChatTool>
  )
}
