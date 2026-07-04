import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Wrench, Check, X, Loader2, MessageCircleQuestion, Send, SkipForward, Undo2, Circle, CircleCheck, Square, SquareCheck, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
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
        <span className="text-sm text-muted-foreground line-through">{q.question}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onUnskip(q.id)}
          className="text-[11px] text-muted-foreground shrink-0 ml-2"
        >
          <Undo2 className="w-3 h-3" />
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
          size="xs"
          onClick={() => onSkip(q.id)}
          className="text-[11px] text-muted-foreground shrink-0 mt-0.5"
        >
          <SkipForward className="w-3 h-3" />
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
                className={`w-full justify-start gap-2 h-auto px-2.5 py-1.5 text-left ${
                  checked
                    ? 'bg-accent/80 text-accent-foreground'
                    : 'text-muted-foreground'
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
                    <span className="block text-[11px] text-muted-foreground">{opt.description}</span>
                  )}
                </span>
              </Button>
            )
          })}
        </div>
      )}

      <Input
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
    <div className="my-3 border border-border rounded-lg overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <MessageCircleQuestion className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{t('chat.tool.askUser')}</span>
        {data.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
        {data.status === 'completed' && <Check className="w-3 h-3 text-green-500 ml-auto" />}
      </div>

      {data.status === 'pending' && (
        <div className="px-3 py-2 space-y-3">
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
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              <Send className="w-3 h-3" />
              {t('chat.tool.askUserSubmit')}
            </Button>
          </div>
        </div>
      )}

      {data.result && (
        <div className="border-t border-border bg-muted/10">
          <div className="max-h-40 overflow-y-auto scroll-fade-y">
            <pre className="whitespace-pre-wrap text-foreground px-3 py-2 text-[11px]">
              {data.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingApproval({ callId }: { callId: string }) {
  const { t } = useTranslation()
  const [approved, setApproved] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  if (approved) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/10 text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-[11px]">{t('chat.tool.running')}</span>
      </div>
    )
  }

  if (!showFeedback) {
    return (
      <div className="flex gap-2 px-3 py-2 border-t border-border bg-muted/10">
        <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => { setApproved(true); api.approveToolCall(callId) }}>
          <Check className="w-3 h-3" />
          {t('chat.tool.allow')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={() => setShowFeedback(true)}
        >
          <X className="w-3 h-3" />
          {t('chat.tool.deny')}
        </Button>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 border-t border-border bg-muted/10 space-y-2">
      <Input
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') api.denyToolCall(callId, feedback || undefined) }}
        placeholder={t('chat.tool.denyReasonPlaceholder')}
        className="text-xs"
        autoFocus
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={() => api.denyToolCall(callId, feedback || undefined)}
        >
          <X className="w-3 h-3" />
          {feedback.trim() ? t('chat.tool.denyWithReason') : t('chat.tool.deny')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowFeedback(false)}>
          {t('chat.tool.cancel')}
        </Button>
      </div>
    </div>
  )
}

export function ToolCallBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()
  const isCompleted = data.status === 'completed' || data.status === 'denied'
  const [expanded, setExpanded] = useState(!isCompleted)

  if (data.tool_name === 'ask_user') {
    return <AskUserBlock data={data} />
  }

  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = JSON.parse(data.arguments)
  } catch {
    // ignore
  }

  return (
    <div className="my-3 border border-border rounded-lg overflow-hidden text-xs">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 bg-muted/30 w-full text-left hover:bg-muted/50 h-auto rounded-none"
      >
        <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{data.tool_name}</span>
        <AnimatePresence mode="wait">
          {data.status === 'running' && (
            <motion.span key="running" className="ml-auto" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            </motion.span>
          )}
          {data.status === 'completed' && (
            <motion.span key="done" className="ml-auto" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
              <Check className="w-3 h-3 text-green-500" />
            </motion.span>
          )}
          {data.status === 'denied' && (
            <motion.span key="denied" className="ml-auto" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
              <X className="w-3 h-3 text-destructive" />
            </motion.span>
          )}
        </AnimatePresence>
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </Button>

      {expanded && (
        <>
          <div className="px-3 py-2 space-y-1 text-muted-foreground">
            {Object.entries(parsedArgs).map(([key, value]) => (
              <div key={key}>
                <span className="text-muted-foreground/60">{key}:</span>{' '}
                <span className="text-foreground">{String(value).length > 200 ? `${String(value).slice(0, 200)}...` : String(value)}</span>
              </div>
            ))}
          </div>

          {data.status === 'pending' && <PendingApproval callId={data.call_id} />}

          {data.status === 'running' && (
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/10 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[11px]">{t('chat.tool.running')}</span>
            </div>
          )}

          {data.result && (
            <div className="border-t border-border bg-muted/10">
              <div className="max-h-40 overflow-y-auto scroll-fade-y">
                <pre className="whitespace-pre-wrap text-foreground px-3 py-2 text-[11px]">
                  {data.result.length > 1000 ? `${data.result.slice(0, 1000)}...` : data.result}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
