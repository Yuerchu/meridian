import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A wall-clock time for a message bubble: `14:20`, or `2:20 PM` where the
 * locale says so.
 *
 * Not `useRelativeTime`. "3 minutes ago" is right for a sidebar row that is
 * glanced at, and wrong beside every bubble of a conversation being read — a
 * transcript is read in order, so what the reader wants to know is *when*, and
 * a relative label that keeps changing under them says it less clearly each
 * minute. The date is not repeated per bubble either: the transcript draws a
 * separator where the day changes, so the time alone is unambiguous.
 */
export function useClockTime(): { format: (ts: number) => string; formatFull: (ts: number) => string } {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  return useMemo(() => {
    const clock = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' })
    const full = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' })
    return {
      format: (ts: number) => clock.format(ts),
      formatFull: (ts: number) => full.format(ts),
    }
  }, [lang])
}

/** Whether two timestamps fall on different local calendar days — which is
 *  what decides whether the transcript draws a date between them. */
export function isDifferentDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() !== db.getFullYear() || da.getMonth() !== db.getMonth() || da.getDate() !== db.getDate()
}

/** The label a date separator carries: today's date in the reader's locale,
 *  with the year only when it is not this one. */
export function useDateLabel(): (ts: number) => string {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  return useMemo(() => {
    const thisYear = new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric' })
    const otherYear = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    return (ts: number) =>
      new Date(ts).getFullYear() === new Date().getFullYear() ? thisYear.format(ts) : otherYear.format(ts)
  }, [lang])
}
