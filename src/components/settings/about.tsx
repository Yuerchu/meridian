import './about.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Copy, FileText, TriangleAlert } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { CopyAnnouncement } from '@/components/ui/copy-button'
import { Hint } from '@/components/ui/hint'
import { api } from '@/api'
import { MeridianMark } from '@/components/ui/meridian-mark'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useCopy } from '@/hooks/use-copy'
import type { AppInfoResponse } from '@/types'
import { LogViewer } from './logs/log-viewer'
import { SettingsHeader, SettingsPane } from './primitives'

/** What the page shows in the "runtime" row: the engine actually rendering it. */
function webViewLabel(ua: string): string {
  // Order matters — every Chromium UA also claims to be Safari.
  const edge = /Edg\/(\d+)/.exec(ua)
  if (edge) return `WebView2 ${edge[1]}`
  const chrome = /Chrome\/(\d+)/.exec(ua)
  if (chrome) return `Chromium ${chrome[1]}`
  const webkit = /Version\/(\d+[\d.]*).*Safari/.exec(ua)
  if (webkit) return `WebKit ${webkit[1]}`
  return 'WebView'
}

const OS_LABELS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

/**
 * One `label: value` line. The value is selectable — half of them get quoted.
 *
 * The label is pinned and the value shrinks. A data directory would otherwise
 * hold its full width and squeeze the label out. The whole string is the title
 * while it is actually cut off.
 */
function InfoRow({ label, value, action }: { label: string; value?: string; action?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <SettingsRow label={label}>
      <span data-slot="info-row-value" className="m-about__info-value">
        {value === undefined ? (
          <span role="status" aria-busy="true" aria-label={`${label}: ${t('common.loadingLabel')}`}>
            <Skeleton width="7rem" />
          </span>
        ) : (
          <Hint className="m-about__info-text" label={value}>
            {value}
          </Hint>
        )}
        {action}
      </span>
    </SettingsRow>
  )
}

export function About() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfoResponse | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const infoCopy = useCopy()
  const pathCopy = useCopy()

  useEffect(() => {
    // Silent on failure: this panel is where someone lands *because* something
    // is wrong, and an error notification over the version number helps nobody.
    api.platform.getAppInfo().then(setInfo, () => {})
  }, [])

  // So the back gesture leaves the log list before it leaves settings.
  useHistoryLevel(showLogs, () => setShowLogs(false))

  // A view swap rather than a dialog: the log list needs the full width, and
  // About is deliberately narrow.
  if (showLogs) {
    // Fill the scroller rather than guessing a header height. The old
    // `100vh - 8rem` missed the status bar on a phone.
    return (
      <div data-slot="about-logs" className="m-about__logs">
        <LogViewer onBack={() => setShowLogs(false)} />
      </div>
    )
  }

  const platform = info && `${OS_LABELS[info.os] ?? info.os} · ${info.arch}`
  const runtime = webViewLabel(navigator.userAgent)

  // Everything a bug report should open with, in one paste. Kept to what this
  // page already displays: nothing here is worth redacting before sending,
  // except a home directory the user can see in the row above.
  const diagnostics = [
    `Meridian ${info?.version ?? '?'}`,
    `Tauri ${info?.tauri_version ?? '?'}`,
    runtime,
    platform ?? '?',
    info?.data_dir ?? '',
  ].join('\n')

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.about.title')} />

      <div data-slot="about-hero" className="m-about__hero">
        <div data-slot="about-mark" className="m-about__mark">
          <MeridianMark intro className="m-about__mark-icon" />
        </div>
        <div data-slot="about-identity" className="m-about__identity">
          <div data-slot="about-name-row" className="m-about__name-row">
            {/* Plain text: a shimmer means "working", and the app's name is not. */}
            <span data-slot="about-name" className="m-about__name">
              {t('app.name')}
            </span>
            {info && <Badge size="sm">v{info.version}</Badge>}
          </div>
          <p data-slot="about-description" className="m-about__description">
            {t('settings.about.description')}
          </p>
        </div>
      </div>

      <div className="m-about__stack">
        <SettingsGroup heading={t('settings.about.diagnostics')} headingLevel={3}>
          <SettingsRow
            label={
              <span className="m-about__row-label">
                <FileText size={16} aria-hidden className="m-about__row-icon" />
                {t('settings.about.logs.title')}
              </span>
            }
            description={t('settings.about.logs.subtitle')}
          >
            <Button iconRight={<ChevronRight />} size="sm" variant="secondary" onPress={() => setShowLogs(true)}>
              {t('settings.about.logs.open')}
            </Button>
          </SettingsRow>
          <SettingsRow
            label={
              <span className="m-about__row-label">
                <Copy size={16} aria-hidden className="m-about__row-icon" />
                {t('settings.about.copyInfo.title')}
              </span>
            }
            description={infoCopy.failure === null ? t('settings.about.copyInfo.subtitle') : undefined}
          >
            <span className="m-about__row-action">
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('settings.about.copyInfo.action')}
                isDisabled={!info}
                onPress={() => void infoCopy.copy(diagnostics)}
              >
                {infoCopy.copied && <Check size={16} aria-hidden />}
                {t('settings.about.copyInfo.action')}
              </Button>
              <CopyAnnouncement copied={infoCopy.copied} failure={null} />
            </span>
          </SettingsRow>
        </SettingsGroup>
        {infoCopy.failure !== null && (
          <Alert tone="danger" shouldAnnounce>
            {t('common.copyFailed', { error: infoCopy.failure })}
          </Alert>
        )}
      </div>

      <SettingsGroup heading={t('settings.about.system.title')} headingLevel={3}>
        <InfoRow label={t('settings.about.system.version')} value={info?.version} />
        <InfoRow label="Tauri" value={info?.tauri_version} />
        {/* Read off `navigator`, so it needs no round trip and is never absent. */}
        <InfoRow label={t('settings.about.system.runtime')} value={runtime} />
        <InfoRow label={t('settings.about.system.platform')} value={platform ?? undefined} />
        <InfoRow
          label={t('settings.about.system.dataDir')}
          value={info?.data_dir}
          action={
            info && (
              <>
                <TooltipTrigger>
                  <Button
                    icon={pathCopy.failure !== null ? <TriangleAlert /> : pathCopy.copied ? <Check /> : <Copy />}
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings.about.system.copyDataDir')}
                    onPress={() => void pathCopy.copy(info.data_dir)}
                  />
                  <Tooltip>
                    {pathCopy.failure !== null
                      ? t('common.copyFailed', { error: pathCopy.failure })
                      : t('settings.about.system.copyDataDir')}
                  </Tooltip>
                </TooltipTrigger>
                <CopyAnnouncement copied={pathCopy.copied} failure={pathCopy.failure} />
              </>
            )
          }
        />
      </SettingsGroup>

      <div data-slot="about-footer" className="m-about__footer">
        <p data-slot="about-footer-line">{t('settings.about.copyright')}</p>
        <p data-slot="about-footer-line">{t('settings.about.notice')}</p>
        <p data-slot="about-footer-line">{t('settings.about.grokBuildNotice')}</p>
      </div>
    </SettingsPane>
  )
}
