import './log-viewer.css'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, TriangleAlert } from '@keyline-icons/react/two-tone'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { useCopy } from '@/hooks/use-copy'
import { CopyAnnouncement } from '@/components/ui/copy-button'
import type { LogEntryInfoResponse } from '@/types'
import { LogLevelBadge } from './log-level-badge'
import { titleIfTruncated } from '@/lib/truncation'

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
  const { copied, failure, copy } = useCopy()

  const onCopy = useCallback(() => void copy(JSON.stringify(entry, null, 2)), [entry, copy])

  // Span fields first: they say which conversation or request this belongs to,
  // which is what a reader is usually scanning for.
  const fields = [...Object.entries(entry.span_fields ?? {}), ...Object.entries(entry.fields ?? {})]

  const isError = entry.level === 'ERROR'
  // Rendered in local time. The record stores UTC so the file sorts lexically,
  // but showing that verbatim puts an event the user caused at 00:44 under a
  // timestamp of 16:01, which makes the log look like it belongs to someone
  // else's session.
  const time = formatLocalTime(entry.ts_ms, i18n.resolvedLanguage ?? i18n.language)

  return (
    <div data-slot="log-row" className="m-log-row" data-error={isError || undefined}>
      <span data-slot="log-row-time" className="m-log-row__time">
        {time}
      </span>

      <div data-slot="log-row-body" className="m-log-row__body">
        <div data-slot="log-row-meta" className="m-log-row__meta">
          <LogLevelBadge level={entry.level} />
          <span data-slot="log-row-target" onPointerEnter={titleIfTruncated} className="m-log-row__target">
            {entry.target}
          </span>
        </div>
        <p data-slot="log-row-message" className="m-log-row__message">
          {entry.msg}
        </p>
        {fields.length > 0 && (
          <div data-slot="log-row-fields" className="m-log-row__fields">
            {fields.map(([key, value]) => (
              <span key={key} data-slot="log-row-field" className="m-log-row__field">
                {key}={renderValue(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      <TooltipTrigger>
        <Button
          icon={failure !== null ? <TriangleAlert /> : copied ? <Check /> : <Copy />}
          data-slot="log-row-copy"
          variant="ghost"
          size="sm"
          aria-label={t('settings.about.logs.copyRecord')}
          onPress={onCopy}
        />
        <Tooltip>
          {failure !== null ? t('common.copyFailed', { error: failure }) : t('settings.about.logs.copyRecord')}
        </Tooltip>
      </TooltipTrigger>
      <CopyAnnouncement copied={copied} failure={failure} />
    </div>
  )
}

/** Memoised for the same reason the message list is: with no virtualisation,
 *  stable rows are what keeps a few hundred of them cheap to re-render. */
export const LogRow = memo(LogRowImpl)
