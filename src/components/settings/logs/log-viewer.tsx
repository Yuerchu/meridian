import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ChevronLeft, Download, RefreshCw, Search } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { LogRow } from './log-row'
import { MAX_RENDERED, useAppLogs, type LevelFilter, type RangeFilter } from './use-app-logs'

export function LogViewer({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const logs = useAppLogs()
  const [exported, setExported] = useState(false)

  const onExport = useCallback(async () => {
    // The webview has no filesystem access; the dialog picks a path and Rust
    // does the writing, same as conversation export.
    const path = await save({
      defaultPath: `meridian-logs-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
    })
    if (!path) return
    await api.exportLogs(path)
    setExported(true)
    setTimeout(() => setExported(false), 3000)
  }, [])

  const unavailable = logs.settings !== null && !logs.settings.available

  return (
    <div data-slot="log-viewer" className="flex h-full flex-col gap-4">
      <div data-slot="log-viewer-header" className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {t('settings.about.logs.back')}
        </Button>
        <h2 className="text-lg font-medium">{t('settings.about.logs.title')}</h2>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={logs.refresh} disabled={logs.loading}>
            <RefreshCw className="size-4" />
            {t('settings.about.logs.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onExport}>
            <Download className="size-4" />
            {exported ? t('settings.about.logs.exported') : t('settings.about.logs.export')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted">{t('settings.about.logs.exportHint')}</p>

      <div data-slot="log-toolbar" className="flex flex-wrap items-center gap-2">
        <Select value={logs.level} onValueChange={(v) => logs.setLevel(v as LevelFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('settings.about.logs.levelAll')}</SelectItem>
            <SelectItem value="warn">{t('settings.about.logs.levelWarn')}</SelectItem>
            <SelectItem value="error">{t('settings.about.logs.levelError')}</SelectItem>
          </SelectContent>
        </Select>

        <InputGroup className="max-w-xs flex-1">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            value={logs.search}
            onChange={(e) => logs.setSearch(e.target.value)}
            placeholder={t('settings.about.logs.searchPlaceholder')}
          />
        </InputGroup>

        <Select value={logs.range} onValueChange={(v) => logs.setRange(v as RangeFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="15m">{t('settings.about.logs.range15m')}</SelectItem>
            <SelectItem value="1h">{t('settings.about.logs.range1h')}</SelectItem>
            <SelectItem value="24h">{t('settings.about.logs.range24h')}</SelectItem>
            <SelectItem value="all">{t('settings.about.logs.rangeAll')}</SelectItem>
          </SelectContent>
        </Select>

        {logs.entries.length > 0 && (
          // Only what is on screen. The reader stops as soon as it has a page,
          // so a total would be a number nobody actually counted.
          <span className="ml-auto text-xs text-muted">
            {t('settings.about.logs.count', { shown: logs.entries.length })}
          </span>
        )}
      </div>

      <div
        data-slot="log-list"
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
      >
        <ScrollArea className="h-full">
          {unavailable ? (
            <p className="p-6 text-sm text-muted">
              {t('settings.about.logs.unavailable')}
            </p>
          ) : logs.error ? (
            <p className="p-6 text-sm text-destructive">{t('settings.about.logs.loadError')}</p>
          ) : logs.loading ? (
            <div className="space-y-3 p-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : logs.entries.length === 0 ? (
            <p className="p-6 text-sm text-muted">
              {logs.isFiltered
                ? t('settings.about.logs.empty')
                : t('settings.about.logs.emptyRange')}
            </p>
          ) : (
            <>
              {logs.entries.map((entry) => (
                <LogRow
                  key={`${entry.cursor.fileIndex}:${entry.cursor.byteOffset}`}
                  entry={entry}
                />
              ))}
              <div className="flex flex-col items-center gap-2 p-3">
                {logs.truncated && (
                  <p className="text-xs text-muted">
                    {t('settings.about.logs.truncated')}
                  </p>
                )}
                {logs.capped ? (
                  <p className="text-xs text-muted">
                    {t('settings.about.logs.capped', { max: MAX_RENDERED })}
                  </p>
                ) : logs.canLoadOlder ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logs.loadOlder}
                    disabled={logs.loadingMore}
                  >
                    {logs.loadingMore && <Spinner className="size-4" />}
                    {t('settings.about.logs.loadOlder')}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
