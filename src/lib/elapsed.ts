/** How long something has been running, in the largest unit that reads well:
 *  seconds under a minute, minutes under an hour, hours and minutes past it.
 *
 *  Not `m:ss`: a running time of twelve minutes drawn as `12:00` reads as a
 *  time of day. Returns the i18n key and its values, so the words are the
 *  locale's. */
export function elapsedLabel(ms: number): { key: string; values: Record<string, number> } {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return { key: 'chat.background.elapsedSeconds', values: { count: total } }
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return { key: 'chat.background.elapsedMinutes', values: { count: minutes } }
  return { key: 'chat.background.elapsedHours', values: { hours: Math.floor(minutes / 60), minutes: minutes % 60 } }
}
