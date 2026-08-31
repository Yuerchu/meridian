import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@/lib/transport'
import { open } from '@tauri-apps/plugin-dialog'
import { TrashBin } from '@gravity-ui/icons'
import { Button, Card, Description, Input, Label, ProgressCircle, Spinner, TextField } from '@heroui/react'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { usePlatform } from '@/hooks/use-platform'
import type { VoiceModelStatus } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSelect } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'

const FILTER_LEVELS = ['off', 'standard', 'aggressive'] as const

interface DownloadProgress {
  downloaded: number
  total: number | null
}

function formatSize(bytes: number, number: Intl.NumberFormat): string {
  return `${number.format(bytes / 1024 / 1024)} MB`
}

export function VoiceSettings() {
  const { t, i18n } = useTranslation()
  const isAndroid = usePlatform() === 'android'
  const [status, setStatus] = useState<VoiceModelStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState('standard')
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
    void api.getPreference('voice.filter_level').then((v) => {
      if (v && !disposed) setFilterLevel(v)
    })
    void api.getPreference('voice.download_url').then((v) => {
      if (v && !disposed) setMirrorUrl(v)
    })

    const unlistenProgress = listen<DownloadProgress>('voice-model-download', (e) => {
      if (!disposed) setProgress(e.payload)
    })
    const unlistenDone = listen<{ ok: boolean; error?: string }>('voice-model-download-done', (e) => {
      if (disposed) return
      setProgress(null)
      if (!e.payload.ok && e.payload.error !== 'cancelled') {
        setError(e.payload.error ?? 'Download failed')
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
    setProgress({ downloaded: 0, total: null })
    try {
      await api.voiceDownloadModel(mirrorUrl.trim() || undefined)
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
      setStatus(await api.voiceImportModel(file))
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

  const handleFilterChange = (value: string) => {
    setFilterLevel(value)
    api.setPreference('voice.filter_level', value)
  }

  const handleMirrorChange = (value: string) => {
    setMirrorUrl(value)
    api.setPreference('voice.download_url', value)
  }

  const downloading = progress !== null
  const filterOptions = FILTER_LEVELS.map((v) => ({ value: v, label: t(`settings.voice.filter.${v}`) }))

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.voice.title')} subtitle={t('settings.voice.intro')} />

      <div className="space-y-1.5">
        <p className="block text-xs font-medium text-muted">{t('settings.voice.model')}</p>
        <Card>
          {statusLoading ? (
            <div
              role="status"
              aria-label={t('common.loading')}
              className="flex items-center gap-2 p-4 text-sm text-muted"
            >
              <Spinner aria-hidden="true" size="sm" />
              {t('common.loading')}
            </div>
          ) : status?.installed ? (
            <div className="flex items-center justify-between gap-2">
              <Card.Header className="min-w-0">
                <Card.Title>{t('settings.voice.modelInstalled')}</Card.Title>
                <Card.Description className="truncate">
                  {formatSize(status.size_bytes, sizeNumber)} · {status.path}
                </Card.Description>
              </Card.Header>
              <Button
                isIconOnly
                variant="ghost"
                aria-label={t('settings.voice.deleteModel')}
                onPress={handleDelete}
                isDisabled={downloading}
              >
                <TrashBin className="w-4 h-4" />
              </Button>
            </div>
          ) : downloading ? (
            <div className="flex items-center gap-3">
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
              <span className="text-xs text-muted flex-1">
                {formatSize(progress.downloaded, sizeNumber)}
                {progress.total ? ` / ${formatSize(progress.total, sizeNumber)}` : ''}
              </span>
              <Button variant="outline" size="sm" onPress={handleCancelDownload}>
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
                <div className="flex gap-2">
                  <Button size="sm" onPress={handleDownload}>
                    {t('settings.voice.download')}
                  </Button>
                  {/* Downloading still works remotely — the host fetches it to
                      its own disk, which is where it has to be. Importing does
                      not: the archive is on the device the picker runs on. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={handleImport}
                    isDisabled={importing || !can.importFromDisk}
                    aria-busy={importing}
                  >
                    {importing && <Spinner aria-hidden="true" size="sm" />}
                    {t('settings.voice.import')}
                  </Button>
                </div>
                {!can.importFromDisk && <p className="text-xs text-muted">{t('capability.importFromDisk')}</p>}
              </Card.Footer>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </Card>
      </div>

      <TextField fullWidth type="url">
        <Label>{t('settings.voice.mirror')}</Label>
        <Input
          value={mirrorUrl}
          name="voiceDownloadUrl"
          inputMode="url"
          spellCheck={false}
          onChange={(e) => handleMirrorChange(e.target.value)}
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
        fullWidth
        triggerClassName="max-w-xs"
      />
      {confirmDialog}
    </SettingsPane>
  )
}
