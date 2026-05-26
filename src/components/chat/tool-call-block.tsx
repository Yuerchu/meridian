import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, Check, X, Loader2, MessageCircleQuestion, Send, Circle, CircleCheck, Square, SquareCheck } from 'lucide-react'
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
  options: AskOption[]
  multi_select?: boolean
}

type Answers = Record<string, string | string[]>

function QuestionBlock({
  q,
  value,
  onChange,
}: {
  q: AskQuestion
  value: string | string[] | undefined
  onChange: (id: string, val: string | string[]) => void
}) {
  const { t } = useTranslation()
  const [otherText, setOtherText] = useState('')
  const isMulti = q.multi_select === true

  const selected = isMulti
    ? (Array.isArray(value) ? value : [])
    : (typeof value === 'string' ? value : '')

  const isOtherSelected = isMulti
    ? (selected as string[]).includes('__other__')
    : selected === '__other__'

  const toggleMulti = (label: string) => {
    const arr = selected as string[]
    const next = arr.includes(label) ? arr.filter((v) => v !== label) : [...arr, label]
    onChange(q.id, next)
  }

  const selectSingle = (label: string) => {
    onChange(q.id, label)
  }

  const toggleOther = () => {
    if (isMulti) {
      toggleMulti('__other__')
    } else {
      selectSingle(isOtherSelected ? '' : '__other__')
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-sm text-foreground font-medium">{q.question}</div>
      <div className="space-y-1">
        {q.options.map((opt) => {
          const checked = isMulti
            ? (selected as string[]).includes(opt.label)
            : selected === opt.label

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

        {/* Other option */}
        <button
          type="button"
          onClick={toggleOther}
          className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
            isOtherSelected
              ? 'bg-accent/80 text-accent-foreground'
              : 'hover:bg-accent/40 text-muted-foreground'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {isMulti
              ? (isOtherSelected
                ? <SquareCheck className="w-3.5 h-3.5 text-foreground" />
                : <Square className="w-3.5 h-3.5" />)
              : (isOtherSelected
                ? <CircleCheck className="w-3.5 h-3.5 text-foreground" />
                : <Circle className="w-3.5 h-3.5" />)
            }
          </span>
          <span className="text-xs font-medium text-foreground">{t('chat.tool.other')}</span>
        </button>

        {isOtherSelected && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder={t('chat.tool.otherPlaceholder')}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        )}
      </div>
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

  const handleChange = useCallback((id: string, val: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [id]: val }))
  }, [])

  const handleSubmit = useCallback(() => {
    const result: Record<string, string | string[]> = {}
    for (const q of questions) {
      const val = answers[q.id]
      if (val === '__other__' || (Array.isArray(val) && val.includes('__other__'))) {
        const otherInput = document.querySelector<HTMLInputElement>(
          `[data-ask-question="${q.id}"] input[type="text"]`
        )
        const otherText = otherInput?.value?.trim() || ''
        if (Array.isArray(val)) {
          result[q.id] = [...val.filter((v) => v !== '__other__'), ...(otherText ? [otherText] : [])]
        } else {
          result[q.id] = otherText || ''
        }
      } else if (val !== undefined) {
        result[q.id] = val
      } else {
        result[q.id] = q.multi_select ? [] : ''
      }
    }
    api.respondToAsk(data.call_id, JSON.stringify(result))
  }, [answers, questions, data.call_id])

  const hasAnswer = questions.some((q) => {
    const val = answers[q.id]
    if (Array.isArray(val)) return val.length > 0
    return !!val
  })

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
            <div key={q.id} data-ask-question={q.id}>
              <QuestionBlock q={q} value={answers[q.id]} onChange={handleChange} />
            </div>
          ))}
          <div className="pt-1">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={handleSubmit}
              disabled={!hasAnswer}
            >
              <Send className="w-3 h-3" />
              {t('chat.tool.askUserSubmit')}
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
