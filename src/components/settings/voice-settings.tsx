import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@/lib/transport'
import { open } from '@tauri-apps/plugin-dialog'
import { Bin } from '@keyline-icons/react/two-tone'
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ProgressCircle,
  Spinner,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import type { VoiceModelDownloadEvent } from '@/lib/app-event'
import { usePlatform } from '@/hooks/use-platform'
import type { VoiceFilterLevel, VoiceModelStatusInfoResponse } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSelect } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'

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
    const next = await api.voiceModelStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    let disposed = false
    void refreshStatus()
      .catch((reason) => setError(String(reason)))
      .finally(() => setStatusLoading(false))
    void api
      .getPreference({ key: 'voice.filter_level' })
      .then(({ value }) => {
        if (value && !disposed) setFilterLevel(value)
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason))
      })
    void api
      .getPreference({ key: 'voice.download_url' })
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
      await api.voiceDownloadModel({ url: mirrorUrl.trim() || null })
    } catch (e) {
      setProgress(null)
      setError(String(e))
    }
    void refreshStatus().catch(console.error)
  }

  const handleCancelDownload = async () => {
    await api.voiceCancelDownload().catch(console.error)
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
      setStatus(await api.voiceImportModel({ archivePath: file }))
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async () => {
    if (!(await confirm({ body: t('settings.voice.deleteModelConfirm'), status: 'warning' }))) return
    setError(null)
    try {
      await api.voiceDeleteModel()
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleFilterChange = (value: VoiceFilterLevel) => {
    setFilterLevel(value)
    api.setPreference({ key: 'voice.filter_level', value }).catch((reason) => setError(String(reason)))
  }

  const handleMirrorChange = (value: string) => {
    setMirrorUrl(value)
  }

  const persistMirror = () => {
    const value = mirrorUrl.trim() || null
    api.setPreference({ key: 'voice.download_url', value }).catch((reason) => setError(String(reason)))
  }

  const downloading = progress !== null
  const filterOptions = FILTER_LEVELS.map((v) => ({ value: v, label: t(`settings.voice.filter.${v}`) }))

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.voice.title')} subtitle={t('settings.voice.intro')} />

      <div data-slot="voice-model" className="space-y-1.5">
        <p data-slot="voice-section-label" className="block text-caption-1-medium text-text-secondary">
          {t('settings.voice.model')}
        </p>
        <Card>
          {statusLoading ? (
            <div
              data-slot="voice-model-loading"
              role="status"
              aria-label={t('common.loading')}
              className="flex items-center gap-2 p-4 text-body-regular text-text-secondary"
            >
              <Spinner aria-hidden="true" size="sm" />
              {t('common.loading')}
            </div>
          ) : status?.installed ? (
            <div data-slot="voice-model-installed" className="flex items-center justify-between gap-2">
              <Card.Header className="min-w-0">
                <Card.Title>{t('settings.voice.modelInstalled')}</Card.Title>
                <Card.Description className="truncate">
                  {formatSize(status.size_bytes, sizeNumber)} · {status.path}
                </Card.Description>
              </Card.Header>
              <TooltipTrigger delay={0}>
                <Button
                  iconOnly
                  leadingIcon={Bin}
                  size="small"
                  variant="neutral"
                  aria-label={t('settings.voice.deleteModel')}
                  onPress={handleDelete}
                  isDisabled={downloading}
                />
                <Tooltip>{t('settings.voice.deleteModel')}</Tooltip>
              </TooltipTrigger>
            </div>
          ) : downloading ? (
            <div data-slot="voice-model-download" className="flex items-center gap-3">
              <ProgressCircle
                aria-label={t('settings.voice.downloading')}
                value={progress.total ? progress.downloaded : undefined}
                maxValue={progress.total ?? undefined}
                isIndeterminate={!progress.total}
                size="sm"
              >
                <ProgressCircle.Track>
                  <ProgressCircle.TrackCircle />
                  <ProgressCircle.FillCircle />
                </ProgressCircle.Track>
              </ProgressCircle>
              <span data-slot="voice-download-progress" className="text-caption-1-regular text-text-secondary flex-1">
                {formatSize(progress.downloaded, sizeNumber)}
                {progress.total ? ` / ${formatSize(progress.total, sizeNumber)}` : ''}
              </span>
              <Button variant="secondary" size="small" onPress={handleCancelDownload}>
                {t('settings.voice.cancelDownload')}
              </Button>
            </div>
          ) : (
            <>
              <Card.Header>
                <Card.Title>{t('settings.voice.modelMissing')}</Card.Title>
                <Card.Description>{t('settings.voice.modelHint')}</Card.Description>
              </Card.Header>
              <Card.Footer className="flex-col items-start gap-2">
                <div data-slot="voice-model-actions" className="flex gap-2">
                  <Button size="small" onPress={handleDownload}>
                    {t('settings.voice.download')}
                  </Button>
                  {/* Downloading still works remotely — the host fetches it to
                      its own disk, which is where it has to be. Importing does
                      not: the archive is on the device the picker runs on. */}
                  <Button
                    variant="secondary"
                    size="small"
                    onPress={handleImport}
                    isDisabled={!can.importFromDisk}
                    isPending={importing}
                    aria-busy={importing}
                  >
                    {t('settings.voice.import')}
                  </Button>
                </div>
                {!can.importFromDisk && (
                  <p data-slot="voice-import-unavailable" className="text-caption-1-regular text-text-secondary">
                    {t('capability.importFromDisk')}
                  </p>
                )}
              </Card.Footer>
            </>
          )}
          {error && (
            <p data-slot="voice-error" role="alert" className="text-caption-1-regular text-status-danger">
              {error}
            </p>
          )}
        </Card>
      </div>

      <TextField type="url">
        <Label>{t('settings.voice.mirror')}</Label>
        <Input
          value={mirrorUrl}
          name="voiceDownloadUrl"
          inputMode="url"
          spellCheck={false}
          onChange={(e) => handleMirrorChange(e.target.value)}
          onBlur={persistMirror}
          placeholder={t('settings.voice.mirrorPlaceholder')}
          className="w-full"
          disabled={downloading}
        />
        <Description>{t('settings.voice.mirrorHint')}</Description>
      </TextField>

      <SettingsSelect
        label={t('settings.voice.filterLevel')}
        value={filterLevel}
        options={filterOptions}
        onChange={handleFilterChange}
        description={t('settings.voice.filterHint')}

        triggerClassName="max-w-xs"
      />
      {confirmDialog}
    </SettingsPane>
  )
}
