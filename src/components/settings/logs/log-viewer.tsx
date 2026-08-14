import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ChevronLeft, ArrowDownToLine, ArrowsRotateRight, Magnifier } from '@gravity-ui/icons'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { Button, InputGroup, ListBox, Select, Skeleton, Spinner } from '@heroui/react'
import { LogRow } from './log-row'
import { MAX_RENDERED, useAppLogs, type LevelFilter, type RangeFilter } from './use-app-logs'

export function LogViewer({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const logs = useAppLogs()
  const [exported, markExported] = useTemporaryFlag(3000)

  const onExport = useCallback(async () => {
    // The webview has no filesystem access; the dialog picks a path and Rust
    // does the writing, same as conversation export.
    // Cancelling the picker rejects on Android instead of resolving to null.
    const path = await save({
      defaultPath: `meridian-logs-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
    }).catch(() => null)
    if (!path) return
    await api.exportLogs(path)
    markExported()
  }, [markExported])

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
          <Button variant="ghost" size="sm" onClick={logs.refresh} isDisabled={logs.loading}>
            <ArrowsRotateRight className="size-4" />
            {t('settings.about.logs.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onExport}>
            <ArrowDownToLine className="size-4" />
            {exported ? t('settings.about.logs.exported') : t('settings.about.logs.export')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted">{t('settings.about.logs.exportHint')}</p>

      <div data-slot="log-toolbar" className="flex flex-wrap items-center gap-2">
        <Select value={logs.level} onChange={(v) => { if (v) logs.setLevel(String(v) as LevelFilter) }}>
          <Select.Trigger className="w-44">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="all" textValue={t('settings.about.logs.levelAll')}>
                {t('settings.about.logs.levelAll')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="warn" textValue={t('settings.about.logs.levelWarn')}>
                {t('settings.about.logs.levelWarn')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="error" textValue={t('settings.about.logs.levelError')}>
                {t('settings.about.logs.levelError')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        <InputGroup className="max-w-xs flex-1">
          <InputGroup.Prefix>
            <Magnifier className="size-4" />
          </InputGroup.Prefix>
          <InputGroup.Input
            value={logs.search}
            onChange={(e) => logs.setSearch(e.target.value)}
            placeholder={t('settings.about.logs.searchPlaceholder')}
          />
        </InputGroup>

        <Select value={logs.range} onChange={(v) => { if (v) logs.setRange(String(v) as RangeFilter) }}>
          <Select.Trigger className="w-40">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="15m" textValue={t('settings.about.logs.range15m')}>
                {t('settings.about.logs.range15m')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="1h" textValue={t('settings.about.logs.range1h')}>
                {t('settings.about.logs.range1h')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="24h" textValue={t('settings.about.logs.range24h')}>
                {t('settings.about.logs.range24h')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="all" textValue={t('settings.about.logs.rangeAll')}>
                {t('settings.about.logs.rangeAll')}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        {logs.entries.length > 0 && (
          // Only what is on screen. The reader stops as soon as it has a page,
          // so a total would be a number nobody actually counted.
          <span className="ml-auto text-xs text-muted">
            {t('settings.about.logs.count', { shown: logs.entries.length })}
          </span>
        )}
      </div>

      {/* A page of log lines is read, not operated: the rows only carry a copy
          button, so the list itself is the tab stop that scrolls it. */}
      <div
        data-slot="log-list"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
      >
        {unavailable ? (
          <p className="p-6 text-sm text-muted">
            {t('settings.about.logs.unavailable')}
          </p>
        ) : logs.error ? (
          <p className="p-6 text-sm text-danger">{t('settings.about.logs.loadError')}</p>
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
                  isDisabled={logs.loadingMore}
                >
                  {logs.loadingMore && <Spinner className="size-4" />}
                  {t('settings.about.logs.loadOlder')}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
