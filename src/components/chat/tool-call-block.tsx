import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, Check, X, Loader2, MessageCircleQuestion, Send, SkipForward, Circle, CircleCheck, Square, SquareCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

type Answers = Record<string, QuestionAnswer>

function emptyAnswer(q: AskQuestion): QuestionAnswer {
  return { selected: q.multi_select ? [] : null, notes: '' }
}

function hasContent(a: QuestionAnswer | undefined): boolean {
  if (!a) return false
  if (a.notes.trim()) return true
  if (Array.isArray(a.selected)) return a.selected.length > 0
  return a.selected !== null
}

function formatAnswer(a: QuestionAnswer): string {
  const sel = Array.isArray(a.selected)
    ? a.selected.join(', ')
    : a.selected
  const notes = a.notes.trim()
  if (sel && notes) return `${sel}\n\nNotes: ${notes}`
  if (sel) return sel
  if (notes) return notes
  return '(skipped)'
}

function QuestionBlock({
  q,
  value,
  onChange,
}: {
  q: AskQuestion
  value: QuestionAnswer
  onChange: (id: string, val: QuestionAnswer) => void
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

  return (
    <div className="space-y-1.5">
      <div className="text-sm text-foreground font-medium">{q.question}</div>

      {hasOptions && (
        <div className="space-y-1">
          {q.options!.map((opt) => {
            const checked = isMulti
              ? (Array.isArray(value.selected) && value.selected.includes(opt.label))
              : value.selected === opt.label

            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => isMulti ? toggleMulti(opt.label) : selectSingle(opt.label)}
                className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
                  checked
                    ? 'bg-accent/80 text-accent-foreground'
                    : 'hover:bg-accent/40 text-muted-foreground'
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
              </button>
            )
          })}
        </div>
      )}

      <input
        type="text"
        value={value.notes}
        onChange={(e) => onChange(q.id, { ...value, notes: e.target.value })}
        placeholder={hasOptions ? t('chat.tool.notesPlaceholder') : t('chat.tool.askUserPlaceholder')}
        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus={!hasOptions}
      />
    </div>
  )
}

function AskUserBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()
  const [answers, setAnswers] = useState<Answers>({})

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
  }, [])

  const handleSubmit = useCallback(() => {
    const result: Record<string, string> = {}
    for (const q of questions) {
      result[q.id] = formatAnswer(getAnswer(q.id, q))
    }
    api.respondToAsk(data.call_id, JSON.stringify(result))
  }, [answers, questions, data.call_id])

  const handleSkip = useCallback(() => {
    const result: Record<string, string> = {}
    for (const q of questions) {
      result[q.id] = '(skipped)'
    }
    api.respondToAsk(data.call_id, JSON.stringify(result))
  }, [questions, data.call_id])

  const canSubmit = questions.some((q) => hasContent(answers[q.id]))

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
            <div key={q.id}>
              <QuestionBlock q={q} value={getAnswer(q.id, q)} onChange={handleChange} />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={handleSkip}
            >
              <SkipForward className="w-3 h-3" />
              {t('chat.tool.skip')}
            </Button>
          </div>
        </div>
      )}

      {data.result && (
        <div className="px-3 py-2 border-t border-border bg-muted/10">
          <pre className="whitespace-pre-wrap text-foreground max-h-40 overflow-y-auto text-[11px]">
            {data.result}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolCallBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()

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
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{data.tool_name}</span>
        {data.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
        {data.status === 'completed' && <Check className="w-3 h-3 text-green-500 ml-auto" />}
        {data.status === 'denied' && <X className="w-3 h-3 text-destructive ml-auto" />}
      </div>

      <div className="px-3 py-2 space-y-1 text-muted-foreground">
        {Object.entries(parsedArgs).map(([key, value]) => (
          <div key={key}>
            <span className="text-muted-foreground/60">{key}:</span>{' '}
            <span className="text-foreground">{String(value).length > 200 ? `${String(value).slice(0, 200)}...` : String(value)}</span>
          </div>
        ))}
      </div>

      {data.status === 'pending' && (
        <div className="flex gap-2 px-3 py-2 border-t border-border bg-muted/10">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => api.approveToolCall(data.call_id)}
          >
            <Check className="w-3 h-3" />
            {t('chat.tool.allow')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => api.denyToolCall(data.call_id)}
          >
            <X className="w-3 h-3" />
            {t('chat.tool.deny')}
          </Button>
        </div>
      )}

      {data.result && (
        <div className="px-3 py-2 border-t border-border bg-muted/10">
          <pre className="whitespace-pre-wrap text-foreground max-h-40 overflow-y-auto text-[11px]">
            {data.result.length > 1000 ? `${data.result.slice(0, 1000)}...` : data.result}
          </pre>
        </div>
      )}
    </div>
  )
}
