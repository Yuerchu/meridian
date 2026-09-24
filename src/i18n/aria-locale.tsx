import type { ReactNode } from 'react'
import { I18nProvider } from 'react-aria-components'
import { useTranslation } from 'react-i18next'

/**
 * React Aria's own locale, kept to the app's language.
 *
 * Left alone, React Aria reads `navigator.language` — the operating system's,
 * not the one chosen in Settings — for every string it writes itself: a
 * Select's placeholder, the hidden DismissButton's name, SearchField's clear
 * button, drag-and-drop announcements, and every date and number it formats.
 * A Chinese UI on an English Windows used to read all of those in English.
 *
 * `useTranslation` re-renders on i18next's `languageChanged`, so switching the
 * language in Settings reaches React Aria in the same commit as the app's own
 * strings. The tag is BCP 47, which is what React Aria's message tables are
 * keyed by; i18next's `en`/`zh` are narrowed to the two locales this app ships.
 */
export function AriaLocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const locale = language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  return <I18nProvider locale={locale}>{children}</I18nProvider>
}
