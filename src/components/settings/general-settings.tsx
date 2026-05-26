import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGES, setLocale } from '@/i18n'

export function GeneralSettings() {
  const { t, i18n } = useTranslation()

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.general.title')}</h2>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.general.language')}
        </label>
        <Select value={i18n.language} onValueChange={(v) => v && setLocale(v)}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
