import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'
import { ChevronRight, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogViewer } from './logs/log-viewer'

export function About() {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  // A view swap rather than a dialog: the log list needs the full width, and
  // About is deliberately narrow.
  if (showLogs) {
    return (
      <div className="h-[calc(100vh-8rem)]">
        <LogViewer onBack={() => setShowLogs(false)} />
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.about.title')}</h2>
      </div>

      <div className="space-y-4 text-sm text-foreground">
        <div>
          <span className="shimmer shimmer-duration-3000 text-xl font-semibold">{t('app.name')}</span>
          {version && <div className="text-muted mt-0.5">v{version}</div>}
        </div>

        <p className="text-muted leading-relaxed">
          {t('settings.about.description')}
        </p>

        <div data-slot="about-logs-card" className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <ScrollText className="size-4 mt-0.5 shrink-0 text-muted" />
            <div className="space-y-1">
              <p className="font-medium">{t('settings.about.logs.title')}</p>
              <p className="text-xs text-muted leading-relaxed">
                {t('settings.about.logs.subtitle')}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowLogs(true)}>
            {t('settings.about.logs.open')}
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="pt-2 border-t border-border space-y-2 text-xs text-muted">
          <p>{t('settings.about.copyright')}</p>
          <p>{t('settings.about.notice')}</p>
        </div>
      </div>
    </div>
  )
}
