import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { Trash2 } from 'lucide-react'
import { Input, ListBox, Select } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { CircularProgress } from '@/components/ui/circular-progress'
import { api } from '@/api'
import type { VoiceModelStatus } from '@/types'

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
  const [status, setStatus] = useState<VoiceModelStatus | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState('standard')
  const [mirrorUrl, setMirrorUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const statusRef = useRef<() => void>(() => {})

  const refreshStatus = () => {
    api.voiceModelStatus().then(setStatus).catch(console.error)
  }
  statusRef.current = refreshStatus

  useEffect(() => {
    refreshStatus()
    api.getPreference('voice.filter_level').then((v) => {
      if (v) setFilterLevel(v)
    })
    api.getPreference('voice.download_url').then((v) => {
      if (v) setMirrorUrl(v)
    })

    const unlistenProgress = listen<DownloadProgress>('voice-model-download', (e) => {
      setProgress(e.payload)
    })
    const unlistenDone = listen<{ ok: boolean; error?: string }>('voice-model-download-done', (e) => {
      setProgress(null)
      if (!e.payload.ok && e.payload.error !== 'cancelled') {
        setError(e.payload.error ?? 'Download failed')
      }
      statusRef.current()
    })
    return () => {
      unlistenProgress.then((fn) => fn())
      unlistenDone.then((fn) => fn())
    }
  }, [])

  const handleDownload = async () => {
    setError(null)
    setProgress({ downloaded: 0, total: null })
    try {
      await api.voiceDownloadModel(mirrorUrl.trim() || undefined)
    } catch (e) {
      setProgress(null)
      setError(String(e))
    }
    refreshStatus()
  }

  const handleCancelDownload = async () => {
    await api.voiceCancelDownload().catch(console.error)
  }

  const handleImport = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Model archive', extensions: ['bz2', 'tar'] }],
    })
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
      refreshStatus()
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
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.voice.title')}</h2>
        <p className="text-xs text-muted mt-1">{t('settings.voice.intro')}</p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.voice.model')}
        </label>
        <div className="rounded-lg border border-border px-3 py-2.5 space-y-2">
          {status?.installed ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm">{t('settings.voice.modelInstalled')}</p>
                <p className="text-xs text-muted truncate">
                  {formatSize(status.size_bytes)} · {status.path}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={handleDelete} disabled={downloading}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ) : downloading ? (
            <div className="flex items-center gap-3">
              <CircularProgress
                value={progress.total ? progress.downloaded : undefined}
                max={progress.total ?? undefined}
                indeterminate={!progress.total}
                size={20}
              />
              <span className="text-xs text-muted flex-1">
                {formatSize(progress.downloaded)}
                {progress.total ? ` / ${formatSize(progress.total)}` : ''}
              </span>
              <Button variant="outline" size="sm" onClick={handleCancelDownload}>
                {t('settings.voice.cancelDownload')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">{t('settings.voice.modelMissing')}</p>
              <p className="text-xs text-muted">{t('settings.voice.modelHint')}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleDownload}>
                  {t('settings.voice.download')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
                  {importing ? t('settings.voice.importing') : t('settings.voice.import')}
                </Button>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.voice.mirror')}
        </label>
        <Input fullWidth
          value={mirrorUrl}
          onChange={(e) => handleMirrorChange(e.target.value)}
          placeholder={t('settings.voice.mirrorPlaceholder')}
          className="w-full"
          disabled={downloading}
        />
        <p className="text-xs text-muted">{t('settings.voice.mirrorHint')}</p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.voice.filterLevel')}
        </label>
        <Select fullWidth value={filterLevel} onChange={(v) => v && handleFilterChange(String(v))}>
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
    </div>
  )
}
