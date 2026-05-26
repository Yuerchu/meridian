import { useTranslation } from 'react-i18next'

export function About() {
  const { t } = useTranslation()

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.about.title')}</h2>
      </div>

      <div className="space-y-4 text-sm text-foreground">
        <div>
          <div className="text-xl font-semibold">{t('app.name')}</div>
          <div className="text-muted-foreground mt-0.5">{t('about.version')}</div>
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
