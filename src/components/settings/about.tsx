import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getVersion } from '@tauri-apps/api/app'
import { ChevronRight, FileText } from '@gravity-ui/icons'
import { Button, Card } from '@heroui/react'
import { useHistoryLevel } from '@/hooks/use-nav'
import { LogViewer } from './logs/log-viewer'
import { SettingsHeader, SettingsPane } from './primitives'

export function About() {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  // So the back gesture leaves the log list before it leaves settings.
  useHistoryLevel(showLogs, () => setShowLogs(false))

  // A view swap rather than a dialog: the log list needs the full width, and
  // About is deliberately narrow.
  if (showLogs) {
    // `h-full` rather than a viewport calculation: the old `100vh - 8rem`
    // guessed at a header height that grows by the status bar on a phone, and
    // the surrounding scroller already bounds this.
    return (
      <div className="h-full">
        <LogViewer onBack={() => setShowLogs(false)} />
      </div>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.about.title')} />

      <div className="space-y-4 text-sm text-foreground">
        <div>
          <span className="shimmer shimmer-duration-3000 text-xl font-semibold">{t('app.name')}</span>
          {version && <div className="text-muted mt-0.5">v{version}</div>}
        </div>

        <p className="text-muted leading-relaxed">
          {t('settings.about.description')}
        </p>

        <Card data-slot="about-logs-card">
          <div className="flex items-start gap-3">
            <FileText className="size-4 mt-0.5 shrink-0 text-muted" />
            <Card.Header>
              <Card.Title>{t('settings.about.logs.title')}</Card.Title>
              <Card.Description>{t('settings.about.logs.subtitle')}</Card.Description>
            </Card.Header>
          </div>
          <Card.Footer>
            <Button variant="secondary" size="sm" onClick={() => setShowLogs(true)}>
              {t('settings.about.logs.open')}
              <ChevronRight className="size-4" />
            </Button>
          </Card.Footer>
        </Card>

        <div className="pt-2 border-t border-border space-y-2 text-xs text-muted">
          <p>{t('settings.about.copyright')}</p>
          <p>{t('settings.about.notice')}</p>
        </div>
      </div>
    </SettingsPane>
  )
}
