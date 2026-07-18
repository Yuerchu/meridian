import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGES, setLocale } from '@/i18n'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'

const LANGUAGE_OPTIONS = LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))

const SHELLS = [
  { value: 'bash', label: 'Bash (Git Bash)' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'CMD' },
]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const platform = usePlatform()
  const [shell, setShell] = useState('bash')

  useEffect(() => {
    api.getPreference('shell').then((v) => {
      if (v) setShell(v)
    })
  }, [])

  const handleShellChange = (value: string) => {
    setShell(value)
    api.setPreference('shell', value)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.general.title')}</h2>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.general.language')}
        </label>
        <Select value={i18n.language} onValueChange={(v) => v && setLocale(v)} items={LANGUAGE_OPTIONS}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {platform !== null && platform !== 'android' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.general.shell')}
          </label>
          <Select value={shell} onValueChange={(v) => v && handleShellChange(v)} items={SHELLS}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHELLS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.general.shellHint')}
          </p>
        </div>
      )}

      {platform === 'android' && <AndroidFileAccess />}
    </div>
  )
}
