import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from '@gravity-ui/icons'
import { Button, Tooltip, TooltipTrigger } from '@/components/base'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { cx } from '@/utils/cx'
import type { LogEntryInfoResponse } from '@/types'
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
const dateFormatters = new Map<string, { time: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat }>()

function formatLocalTime(tsMs: number, locale: string): string {
  const d = new Date(tsMs)
  let formatters = dateFormatters.get(locale)
  if (!formatters) {
    const clockOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    }
    formatters = {
      time: new Intl.DateTimeFormat(locale, clockOptions),
      dateTime: new Intl.DateTimeFormat(locale, { ...clockOptions, month: '2-digit', day: '2-digit' }),
    }
    dateFormatters.set(locale, formatters)
  }
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? formatters.time.format(d) : formatters.dateTime.format(d)
}

function LogRowImpl({ entry }: { entry: LogEntryInfoResponse }) {
  const { t, i18n } = useTranslation()
  const [copied, markCopied] = useTemporaryFlag()

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2))
    markCopied()
  }, [entry, markCopied])

  // Span fields first: they say which conversation or request this belongs to,
  // which is what a reader is usually scanning for.
  const fields = [...Object.entries(entry.spanFields ?? {}), ...Object.entries(entry.fields ?? {})]

  const isError = entry.level === 'ERROR'
  // Rendered in local time. The record stores UTC so the file sorts lexically,
  // but showing that verbatim puts an event the user caused at 00:44 under a
  // timestamp of 16:01, which makes the log look like it belongs to someone
  // else's session.
  const time = formatLocalTime(entry.tsMs, i18n.resolvedLanguage ?? i18n.language)

  return (
    <div
      data-slot="log-row"
      className={cx(
        'group grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 border-b border-border-button-default px-3 py-2 last:border-b-0',
        isError && 'bg-status-danger-soft',
      )}
    >
      <span data-slot="log-row-time" className="font-mono text-caption-1-regular tabular-nums text-text-secondary">
        {time}
      </span>

      <div data-slot="log-row-body" className="min-w-0 space-y-1">
        <div data-slot="log-row-meta" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <LogLevelBadge level={entry.level} />
          <span data-slot="log-row-target" className="truncate font-mono text-caption-1-regular text-text-secondary">
            {entry.target}
          </span>
        </div>
        <p data-slot="log-row-message" className="text-body-regular break-words text-text-primary">
          {entry.msg}
        </p>
        {fields.length > 0 && (
          <div
            data-slot="log-row-fields"
            className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-caption-1-regular text-text-secondary"
          >
            {fields.map(([key, value]) => (
              <span key={key} data-slot="log-row-field" className="break-all">
                {key}={renderValue(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      <TooltipTrigger delay={0}>
        <Button
          iconOnly
          data-slot="log-row-copy"
          variant="ghost"
          size="small"
          aria-label={t('settings.about.logs.copyRecord')}
          onPress={onCopy}
          // Focus-visible alone does not rescue this on a touch screen, where a
          // tap grants no focus ring — the only action on the row would be
          // permanently invisible.
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Tooltip>{t('settings.about.logs.copyRecord')}</Tooltip>
      </TooltipTrigger>
    </div>
  )
}

/** Memoised for the same reason the message list is: with no virtualisation,
 *  stable rows are what keeps a few hundred of them cheap to re-render. */
export const LogRow = memo(LogRowImpl)
