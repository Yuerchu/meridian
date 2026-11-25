import './voice-settings.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@/lib/transport'
import { open } from '@tauri-apps/plugin-dialog'
import { Bin } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { ProgressCircle } from '@/components/yuerchu-ui/components/progress-circle/progress-circle'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import type { VoiceModelDownloadEvent } from '@/lib/app-event'
import { usePlatform } from '@/hooks/use-platform'
import type { VoiceFilterLevel, VoiceModelStatusInfoResponse } from '@/types'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsHeader, SettingsPane } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'
import { titleIfTruncated } from '@/lib/truncation'

const FILTER_LEVELS = ['off', 'standard', 'aggressive'] as const

function formatSize(bytes: number, number: Intl.NumberFormat): string {
  return `${number.format(bytes / 1024 / 1024)} MB`
}

export function VoiceSettings() {
  const { t, i18n } = useTranslation()
  const isAndroid = usePlatform() === 'android'
  const [status, setStatus] = useState<VoiceModelStatusInfoResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [progress, setProgress] = useState<VoiceModelDownloadEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState<VoiceFilterLevel>('standard')
  const [mirrorUrl, setMirrorUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const sizeNumber = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language, i18n.resolvedLanguage],
  )

  const refreshStatus = useCallback(async () => {
    const next = await api.voice.getModelStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    let disposed = false
    void refreshStatus()
      .catch((reason) => setError(String(reason)))
      .finally(() => setStatusLoading(false))
    void api.preferences
      .get({ key: 'voice.filter_level' })
      .then(({ value }) => {
        if (value && !disposed) setFilterLevel(value)
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason))
      })
    void api.preferences
      .get({ key: 'voice.download_url' })
      .then(({ value }) => {
        if (value && !disposed) setMirrorUrl(value)
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason))
      })

    const unlistenProgress = listen('voice-model-download', (e) => {
      if (!disposed) setProgress(e.payload)
    })
    const unlistenDone = listen('voice-model-download-done', (e) => {
      if (disposed) return
      setProgress(null)
      if (e.payload.type === 'failed') {
        setError(e.payload.error)
      }
      void refreshStatus().catch(console.error)
    })
    return () => {
      disposed = true
      unlistenProgress.then((fn) => fn())
      unlistenDone.then((fn) => fn())
    }
  }, [refreshStatus])

  const handleDownload = async () => {
    setError(null)
    setProgress({ type: 'progress', downloaded: 0, total: null })
    try {
      await api.voice.startModelDownload({ url: mirrorUrl.trim() || null })
    } catch (e) {
      // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- clears a download progress bar; the error is shown beside it
      setProgress(null)
      setError(String(e))
    }
    void refreshStatus().catch(console.error)
  }

  const handleCancelDownload = async () => {
    await api.voice.stopModelDownload().catch(console.error)
  }

  const handleImport = async () => {
    // Cancelling the picker rejects on Android instead of resolving to null.
    //
    // No extension filter there either: Android turns it into a SAF MIME
    // filter, and .tar.bz2 is registered on few enough devices that the picker
    // would open onto an empty list with the archive sitting right there.
    const file = await open({
      multiple: false,
      ...(isAndroid ? {} : { filters: [{ name: 'Model archive', extensions: ['bz2', 'tar'] }] }),
    }).catch(() => null)
    if (typeof file !== 'string') return
    setError(null)
    setImporting(true)
    try {
      setStatus(await api.voice.importModel({ archive_path: file }))
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async () => {
    if (
      !(await confirm({
        description: t('settings.voice.deleteModelConfirm'),
        confirmLabel: t('common.delete'),
      }))
    )
      return
    setError(null)
    try {
      await api.voice.deleteModel()
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleFilterChange = (value: VoiceFilterLevel) => {
    setFilterLevel(value)
    api.preferences.set({ key: 'voice.filter_level', value }).catch((reason) => setError(String(reason)))
  }

  const handleMirrorChange = (value: string) => {
    setMirrorUrl(value)
  }

  const persistMirror = () => {
    const value = mirrorUrl.trim() || null
    api.preferences.set({ key: 'voice.download_url', value }).catch((reason) => setError(String(reason)))
  }

  const downloading = progress !== null
  const filterOptions = FILTER_LEVELS.map((v) => ({ value: v, label: t(`settings.voice.filter.${v}`) }))

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.voice.title')} subtitle={t('settings.voice.intro')} />

      <div data-slot="voice-model" className="m-voice__section">
        <SettingsGroup heading={t('settings.voice.model')} headingLevel={3}>
          {statusLoading ? (
            <div
              data-slot="voice-model-loading"
              role="status"
              aria-label={t('common.loading')}
              className="m-voice__loading"
            >
              <span aria-hidden>
                <Spinner size="sm" />
              </span>
              {t('common.loading')}
            </div>
          ) : status?.installed ? (
            <div data-slot="voice-model-installed">
              <SettingsRow
                label={t('settings.voice.modelInstalled')}
                description={
                  <span className="m-voice__meta" onPointerEnter={titleIfTruncated}>
                    {formatSize(status.size_bytes, sizeNumber)} · {status.path}
                  </span>
                }
              >
                <TooltipTrigger>
                  <Button
                    icon={<Bin />}
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings.voice.deleteModel')}
                    onPress={handleDelete}
                    isDisabled={downloading}
                  />
                  <Tooltip>{t('settings.voice.deleteModel')}</Tooltip>
                </TooltipTrigger>
              </SettingsRow>
            </div>
          ) : downloading ? (
            <div data-slot="voice-model-download" className="m-voice__download">
              <ProgressCircle
                aria-label={t('settings.voice.downloading')}
                {...(progress.total
                  ? { value: progress.downloaded, maxValue: progress.total }
                  : { isIndeterminate: true })}
                size="sm"
              />
              <span data-slot="voice-download-progress" className="m-voice__progress">
                {formatSize(progress.downloaded, sizeNumber)}
                {progress.total ? ` / ${formatSize(progress.total, sizeNumber)}` : ''}
              </span>
              <Button variant="secondary" size="sm" onPress={handleCancelDownload}>
                {t('settings.voice.cancelDownload')}
              </Button>
            </div>
          ) : (
            <SettingsRow
              layout="stacked"
              label={t('settings.voice.modelMissing')}
              description={t('settings.voice.modelHint')}
            >
              <div className="m-voice__footer">
                <div data-slot="voice-model-actions" className="m-voice__actions">
                  <Button size="sm" onPress={handleDownload}>
                    {t('settings.voice.download')}
                  </Button>
                  {/* Downloading still works remotely — the host fetches it to
                      its own disk, which is where it has to be. Importing does
                      not: the archive is on the device the picker runs on. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={handleImport}
                    isDisabled={!can.importFromDisk}
                    isPending={importing}
                    aria-busy={importing}
                  >
                    {t('settings.voice.import')}
                  </Button>
                </div>
                {!can.importFromDisk && (
                  <p data-slot="voice-import-unavailable" className="m-voice__meta">
                    {t('capability.importFromDisk')}
                  </p>
                )}
              </div>
            </SettingsRow>
          )}
        </SettingsGroup>
        {error && (
          <Alert data-slot="voice-error" tone="danger" shouldAnnounce>
            {error}
          </Alert>
        )}
      </div>

      <SettingsGroup>
        <SettingsRow layout="stacked" label={t('settings.voice.mirror')} description={t('settings.voice.mirrorHint')}>
          <TextField
            type="url"
            value={mirrorUrl}
            name="voiceDownloadUrl"
            inputMode="url"
            spellCheck="false"
            onChange={handleMirrorChange}
            onBlur={persistMirror}
            placeholder={t('settings.voice.mirrorPlaceholder')}
            isDisabled={downloading}
            className="m-voice__field"
          />
        </SettingsRow>
        <SettingsRow label={t('settings.voice.filterLevel')} description={t('settings.voice.filterHint')}>
          <div className="m-voice__select">
            <Select
              selectedKey={filterLevel}
              onSelectionChange={(key) => {
                if (key != null) handleFilterChange(String(key) as VoiceFilterLevel)
              }}
            >
              {filterOptions.map((option) => (
                <ListBoxItem key={option.value} id={option.value} textValue={option.label}>
                  {option.label}
                </ListBoxItem>
              ))}
            </Select>
          </div>
        </SettingsRow>
      </SettingsGroup>
      {confirmDialog}
    </SettingsPane>
  )
}
