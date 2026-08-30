import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      zh: { translation: zhCN },
      'zh-Hans': { translation: zhCN },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

function syncDocumentLanguage(language: string | undefined) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

i18n.on('languageChanged', syncDocumentLanguage)
syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)

export function setLocale(locale: string) {
  i18n.changeLanguage(locale)
}

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
]

export default i18n
