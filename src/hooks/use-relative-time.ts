import { useTranslation } from 'react-i18next'

/**
 * "just now" / "5m ago" / "3h ago", falling back to a plain date beyond a day.
 * A hook rather than a function because the strings come from i18next and have
 * to re-render with a language switch.
 */
export function useRelativeTime() {
  const { t } = useTranslation()
  return (ts: number): string => {
    const diff = Date.now() - ts
    if (diff < 60_000) return t('chat.time.justNow')
    if (diff < 3600_000) return t('chat.time.mAgo', { count: Math.floor(diff / 60_000) })
    if (diff < 86400_000) return t('chat.time.hAgo', { count: Math.floor(diff / 3600_000) })
    return new Date(ts).toLocaleDateString()
  }
}
