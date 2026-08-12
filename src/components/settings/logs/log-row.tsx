import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@/types'
import { LogLevelBadge } from './log-level-badge'

/** Renders a field value without the quotes JSON would add around a string. */
function renderValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * `HH:MM:SS.mmm` in the viewer's own timezone, prefixed with the date once the
 * record is from another day — rotated files span several, and a bare clock
 * time there says nothing about which one.
 */
function formatLocalTime(tsMs: number): string {
  const d = new Date(tsMs)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay ? clock : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`
}

function LogRowImpl({ entry }: { entry: LogEntry }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [entry])

  // Span fields first: they say which conversation or request this belongs to,
  // which is what a reader is usually scanning for.
  const fields = [
    ...Object.entries(entry.span_fields ?? {}),
    ...Object.entries(entry.fields ?? {}),
  ]

  const isError = entry.level === 'ERROR'
  // Rendered in local time. The record stores UTC so the file sorts lexically,
  // but showing that verbatim puts an event the user caused at 00:44 under a
  // timestamp of 16:01, which makes the log look like it belongs to someone
  // else's session.
  const time = formatLocalTime(entry.ts_ms)

  return (
    <div
      data-slot="log-row"
      className={cn(
        'group grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-b-0',
        isError && 'bg-danger/5',
      )}
    >
      <span data-slot="log-row-time" className="font-mono text-xs tabular-nums text-muted">
        {time}
      </span>

      <div data-slot="log-row-body" className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <LogLevelBadge level={entry.level} />
          <span className="truncate font-mono text-xs text-muted">{entry.target}</span>
        </div>
        <p className="text-sm break-words text-foreground">
          {entry.raw ? (
            <span className="text-muted italic">
              {t('settings.about.logs.unparseable')}: {entry.raw}
            </span>
          ) : (
            entry.msg
          )}
        </p>
        {fields.length > 0 && (
          <div data-slot="log-row-fields" className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted">
            {fields.map(([key, value]) => (
              <span key={key} className="break-all">
                {key}={renderValue(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      <Button
        isIconOnly
        data-slot="log-row-copy"
        variant="ghost"
        size="sm"
        aria-label={t('settings.about.logs.copyRecord')}
        onClick={onCopy}
        // Focus-visible alone does not rescue this on a touch screen, where a
        // tap grants no focus ring — the only action on the row would be
        // permanently invisible.
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  )
}

/** Memoised for the same reason the message list is: with no virtualisation,
 *  stable rows are what keeps a few hundred of them cheap to re-render. */
export const LogRow = memo(LogRowImpl)
