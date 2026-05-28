import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'

export function About() {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.about.title')}</h2>
      </div>

      <div className="space-y-4 text-sm text-foreground">
        <div>
          <div className="text-xl font-semibold">{t('app.name')}</div>
          {version && <div className="text-muted-foreground mt-0.5">v{version}</div>}
        </div>

        <p className="text-muted-foreground leading-relaxed">
          {t('settings.about.description')}
        </p>

        <div className="pt-2 border-t border-border space-y-2 text-xs text-muted-foreground">
          <p>{t('settings.about.copyright')}</p>
          <p>{t('settings.about.notice')}</p>
        </div>
      </div>
    </div>
  )
}
