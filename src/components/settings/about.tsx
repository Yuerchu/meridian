import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Check, ChevronRight, Copy, FileText } from '@keyline-icons/react/two-tone'
import { Button, Chip, Link, Separator, Skeleton, Tooltip, TooltipTrigger } from '@/components/base'
import { Hint } from '@/components/ui/hint'
import { ItemCard } from '@/components/base'
import { ItemCardGroup } from '@/components/base'
import { api } from '@/api'
import { openExternalUrl } from '@/lib/external-link'
import { MeridianMark } from '@/components/ui/meridian-mark'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
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
 * What a row's text has to be told, twice.
 *
 * `ItemCard.Title` and `ItemCard.Description` are both `truncate`, which needs
 * a bounded width to do anything — without one, a description longer than the
 * row can grow past its container instead of ellipsizing, painting straight
 * over the button on the right. `w-full` is what gives it a bound to overflow
 * against.
 *
 * Then they diverge. A title is two or three words and truncating it loses
 * nothing; a description is a sentence, and on a phone it does not fit on one
 * line at any font size worth reading — so it wraps instead. It stays one line
 * on the desktop anyway, where there is room.
 */
const ROW_TITLE = 'w-full truncate'
const ROW_DESCRIPTION = 'w-full whitespace-normal'

/**
 * One `label: value` line. The value is selectable — half of them get quoted.
 *
 * Which side gives way is the whole point here. `ItemCard.Action` ships
 * `flex-shrink: 0`, which is right for a button and wrong for a value that can
 * be a path: a data directory of `C:\Users\…\AppData\Roaming\…` would hold its
 * full width and squeeze the label out instead. So the label side is pinned
 * (`flex-none` — these are five short words and none of them should ever
 * shorten) and the value side is the one that shrinks and ellipsises, with the
 * whole string on `title` for anyone who needs to read it.
 */
function InfoRow({ label, value, action }: { label: string; value?: string; action?: React.ReactNode }) {
  return (
    <ItemCard>
      <ItemCard.Content className="flex-none">
        <ItemCard.Title className={ROW_TITLE}>{label}</ItemCard.Title>
      </ItemCard.Content>
      <ItemCard.Action className="min-w-0 shrink">
        <div data-slot="info-row-value" className="flex min-w-0 items-center gap-1">
          {value === undefined ? (
            <Skeleton className="h-4 w-28 rounded-md" />
          ) : (
            <Hint className="text-text-secondary min-w-0 truncate text-caption-1-regular select-text" label={value}>
              {value}
            </Hint>
          )}
          {action}
        </div>
      </ItemCard.Action>
    </ItemCard>
  )
}

const FONT_PAGES = {
  inter: 'https://rsms.me/inter/',
  misans: 'https://hyperos.mi.com/font/',
  maple: 'https://github.com/subframe7536/maple-font',
} as const

/** A font's name, opening its home page in the browser — never in this WebView. */
function FontLink({ url, children }: { url: string; children?: React.ReactNode }) {
  return (
    <Link className="text-caption-1-regular" onPress={() => void openExternalUrl(url)}>
      {children}
    </Link>
  )
}

export function About() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfoResponse | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [copied, markCopied] = useTemporaryFlag()
  const [pathCopied, markPathCopied] = useTemporaryFlag()

  useEffect(() => {
    // Silent on failure: this panel is where someone lands *because* something
    // is wrong, and an error notification over the version number helps nobody.
    api.getAppInfo().then(setInfo, () => {})
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
      <div data-slot="about-logs" className="h-full">
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
    `Tauri ${info?.tauriVersion ?? '?'}`,
    runtime,
    platform ?? '?',
    info?.dataDir ?? '',
  ].join('\n')

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.about.title')} />

      <div data-slot="about-hero" className="flex items-start gap-4">
        <div
          data-slot="about-mark"
          className="bg-button-ghost-background text-button-ghost-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl"
        >
          <MeridianMark intro className="size-8" />
        </div>
        <div data-slot="about-identity" className="min-w-0 space-y-1.5">
          <div data-slot="about-name-row" className="flex flex-wrap items-center gap-2">
            {/* Plain text: a shimmer means "working", and the app's name is not. */}
            <span data-slot="about-name" className="text-text-primary text-title-2-semibold">
              {t('app.name')}
            </span>
            {info && (
              <Chip size="sm" variant="secondary">
                v{info.version}
              </Chip>
            )}
          </div>
          <p data-slot="about-description" className="text-text-secondary text-body-regular leading-relaxed">
            {t('settings.about.description')}
          </p>
        </div>
      </div>

      <ItemCardGroup variant="transparent">
        <ItemCardGroup.Header className="px-1.5">
          <ItemCardGroup.Title>{t('settings.about.diagnostics')}</ItemCardGroup.Title>
        </ItemCardGroup.Header>

        <ItemCardGroup className="overflow-hidden">
          {/* The upstream example makes a whole row pressable by rendering a native
              `<button>`; an eslint rule here forbids one, and the row would have
              had to stay free of controls anyway. So both rows carry their
              action on the right instead, which is also the only shape that
              still works when a row grows a second one. */}
          <ItemCard>
            <ItemCard.Icon>
              <FileText className="size-4" />
            </ItemCard.Icon>
            <ItemCard.Content className="min-w-0">
              <ItemCard.Title className={ROW_TITLE}>{t('settings.about.logs.title')}</ItemCard.Title>
              <ItemCard.Description className={ROW_DESCRIPTION}>
                {t('settings.about.logs.subtitle')}
              </ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action>
              <Button trailingIcon={ChevronRight} size="small" variant="secondary" onPress={() => setShowLogs(true)}>
                {t('settings.about.logs.open')}
              </Button>
            </ItemCard.Action>
          </ItemCard>

          <Separator />

          <ItemCard>
            <ItemCard.Icon>
              <Copy className="size-4" />
            </ItemCard.Icon>
            <ItemCard.Content className="min-w-0">
              <ItemCard.Title className={ROW_TITLE}>{t('settings.about.copyInfo.title')}</ItemCard.Title>
              <ItemCard.Description className={ROW_DESCRIPTION}>
                {t('settings.about.copyInfo.subtitle')}
              </ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action>
              <Button
                size="small"
                variant="secondary"
                aria-label={t('settings.about.copyInfo.action')}
                isDisabled={!info}
                onPress={() => {
                  navigator.clipboard.writeText(diagnostics)
                  markCopied()
                }}
              >
                {copied && <Check aria-hidden="true" className="size-4" />}
                {t('settings.about.copyInfo.action')}
              </Button>
            </ItemCard.Action>
          </ItemCard>
        </ItemCardGroup>
      </ItemCardGroup>

      <ItemCardGroup variant="transparent">
        <ItemCardGroup.Header className="px-1.5">
          <ItemCardGroup.Title>{t('settings.about.system.title')}</ItemCardGroup.Title>
        </ItemCardGroup.Header>

        <ItemCardGroup variant="outline">
          <InfoRow label={t('settings.about.system.version')} value={info?.version} />
          <Separator />
          <InfoRow label="Tauri" value={info?.tauriVersion} />
          <Separator />
          {/* Read off `navigator`, so it needs no round trip and is never absent. */}
          <InfoRow label={t('settings.about.system.runtime')} value={runtime} />
          <Separator />
          <InfoRow label={t('settings.about.system.platform')} value={platform ?? undefined} />
          <Separator />
          <InfoRow
            label={t('settings.about.system.dataDir')}
            value={info?.dataDir}
            action={
              info && (
                <TooltipTrigger delay={0}>
                  <Button
                    iconOnly
                    leadingIcon={pathCopied ? Check : Copy}
                    size="small"
                    variant="neutral"
                    aria-label={t('settings.about.system.copyDataDir')}
                    onPress={() => {
                      navigator.clipboard.writeText(info.dataDir)
                      markPathCopied()
                    }}
                  />
                  <Tooltip>{t('settings.about.system.copyDataDir')}</Tooltip>
                </TooltipTrigger>
              )
            }
          />
        </ItemCardGroup>
      </ItemCardGroup>

      <div
        data-slot="about-footer"
        className="border-border-button-default text-text-secondary space-y-2 border-t pt-4 text-caption-1-regular"
      >
        <p data-slot="about-footer-line">{t('settings.about.copyright')}</p>
        <p data-slot="about-footer-line">{t('settings.about.notice')}</p>
        <p data-slot="about-footer-line">{t('settings.about.grokBuildNotice')}</p>
        {/* MiSans's licence requires the software to say it uses MiSans. The
            licence texts ship beside the fonts, under fonts/licenses/. */}
        <p data-slot="about-footer-line">
          <Trans
            i18nKey="settings.about.fonts"
            components={{
              inter: <FontLink url={FONT_PAGES.inter} />,
              misans: <FontLink url={FONT_PAGES.misans} />,
              maple: <FontLink url={FONT_PAGES.maple} />,
            }}
          />
        </p>
        <p data-slot="about-footer-line">{t('settings.about.fontsMiSansNotice')}</p>
      </div>
    </SettingsPane>
  )
}
