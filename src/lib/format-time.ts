/**
 * The timestamp column in a conversation list.
 *
 * Deliberately not `useRelativeTime` from the transcript: that one narrates a
 * single message ("just now", "3 minutes ago") and grows with the number it
 * holds, which is fine beneath an answer and wrong in a column that every row
 * has to line up in. This resolves to at most a weekday or a short date.
 *
 * Nothing here goes through i18n — `Intl` already knows every locale's month
 * order and 12/24-hour habit, and a JSON copy of that would be a second, worse
 * one.
 */

// Constructing an `Intl.DateTimeFormat` is expensive relative to formatting
// with one, and a list calls this once per visible row on every render.
const caches = new Map<string, {
  time: Intl.DateTimeFormat
  weekday: Intl.DateTimeFormat
  monthDay: Intl.DateTimeFormat
  full: Intl.DateTimeFormat
}>()

function formatters(locale: string) {
  let f = caches.get(locale)
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      monthDay: new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }),
      full: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }),
    }
    caches.set(locale, f)
  }
  return f
}

/** `now` is injectable so tests do not depend on the wall clock. */
export function formatListTimestamp(ms: number, locale: string, now = Date.now()): string {
  const f = formatters(locale)
  const then = new Date(ms)
  const today = new Date(now)

  const sameDay =
    then.getFullYear() === today.getFullYear()
    && then.getMonth() === today.getMonth()
    && then.getDate() === today.getDate()
  if (sameDay) return f.time.format(then)

  // Calendar days apart, not elapsed milliseconds: something from 23:00
  // yesterday is "yesterday" at 01:00 today, two hours later.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const daysAgo = Math.floor((startOfToday - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000)
  if (daysAgo >= 1 && daysAgo < 7) return f.weekday.format(then)

  if (then.getFullYear() === today.getFullYear()) return f.monthDay.format(then)
  return f.full.format(then)
}
