import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { TrashBin } from '@gravity-ui/icons'
import { Button, Card, Input, Label, ListBox, ProgressCircle, Select } from '@heroui/react'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import type { VoiceModelStatus } from '@/types'
import { SettingsHeader, SettingsPane } from './primitives'

const FILTER_LEVELS = ['off', 'standard', 'aggressive'] as const

interface DownloadProgress {
  downloaded: number
  total: number | null
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function VoiceSettings() {
  const { t } = useTranslation()
  const isAndroid = usePlatform() === 'android'
  const [status, setStatus] = useState<VoiceModelStatus | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState('standard')
  const [mirrorUrl, setMirrorUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const mirrorUrlId = useId()

  const refreshStatus = useCallback(async () => {
    const next = await api.voiceModelStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    let disposed = false
    void refreshStatus().catch(console.error)
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
        <p className="block text-xs font-medium text-muted">
          {t('settings.voice.model')}
        </p>
        <Card>
          {status?.installed ? (
            <div className="flex items-center justify-between gap-2">
              <Card.Header className="min-w-0">
                <Card.Title>{t('settings.voice.modelInstalled')}</Card.Title>
                <Card.Description className="truncate">
                  {formatSize(status.size_bytes)} · {status.path}
                </Card.Description>
              </Card.Header>
              <Button isIconOnly variant="ghost" onClick={handleDelete} isDisabled={downloading}>
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
                {formatSize(progress.downloaded)}
                {progress.total ? ` / ${formatSize(progress.total)}` : ''}
              </span>
              <Button variant="outline" size="sm" onClick={handleCancelDownload}>
                {t('settings.voice.cancelDownload')}
              </Button>
            </div>
          ) : (
            <>
              <Card.Header>
                <Card.Title>{t('settings.voice.modelMissing')}</Card.Title>
                <Card.Description>{t('settings.voice.modelHint')}</Card.Description>
              </Card.Header>
              <Card.Footer className="gap-2">
                <Button size="sm" onClick={handleDownload}>
                  {t('settings.voice.download')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleImport} isDisabled={importing}>
                  {importing ? t('settings.voice.importing') : t('settings.voice.import')}
                </Button>
              </Card.Footer>
            </>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </Card>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={mirrorUrlId} className="block text-xs font-medium text-muted">
          {t('settings.voice.mirror')}
        </label>
        <Input fullWidth
          id={mirrorUrlId}
          value={mirrorUrl}
          onChange={(e) => handleMirrorChange(e.target.value)}
          placeholder={t('settings.voice.mirrorPlaceholder')}
          className="w-full"
          disabled={downloading}
        />
        <p className="text-xs text-muted">{t('settings.voice.mirrorHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Select fullWidth value={filterLevel} onChange={(v) => v && handleFilterChange(String(v))}>
          <Label className="block text-xs font-medium text-muted">
            {t('settings.voice.filterLevel')}
          </Label>
          <Select.Trigger className="max-w-xs">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {filterOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="text-xs text-muted">{t('settings.voice.filterHint')}</p>
      </div>
    </SettingsPane>
  )
}
