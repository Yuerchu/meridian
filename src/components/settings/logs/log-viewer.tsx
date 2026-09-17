import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ChevronLeft, ArrowDownToLine, ArrowsRotateRight, Magnifier } from '@gravity-ui/icons'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { Button, InputGroup, Skeleton, Spinner } from '@/components/base'
import { EmptyState } from '@/components/base'
import { LogRow } from './log-row'
import { SettingsSelect, type SettingsSelectOption } from '../primitives'
import { MAX_RENDERED, useAppLogs, type LevelFilter, type RangeFilter } from './use-app-logs'

export function LogViewer({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const logs = useAppLogs()
  const [exported, markExported] = useTemporaryFlag(3000)

  // The only two that were written out as literal items rather than a list.
  const levelOptions: SettingsSelectOption<LevelFilter>[] = [
    { value: 'all', label: t('settings.about.logs.levelAll') },
    { value: 'warn', label: t('settings.about.logs.levelWarn') },
    { value: 'error', label: t('settings.about.logs.levelError') },
  ]
  const rangeOptions: SettingsSelectOption<RangeFilter>[] = [
    { value: '15m', label: t('settings.about.logs.range15m') },
    { value: '1h', label: t('settings.about.logs.range1h') },
    { value: '24h', label: t('settings.about.logs.range24h') },
    { value: 'all', label: t('settings.about.logs.rangeAll') },
  ]

  const onExport = useCallback(async () => {
    // The webview has no filesystem access; the dialog picks a path and Rust
    // does the writing, same as conversation export.
    // Cancelling the picker rejects on Android instead of resolving to null.
    const path = await save({
      defaultPath: `meridian-logs-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
    }).catch(() => null)
    if (!path) return
    await api.exportLogs({ outputPath: path })
    markExported()
  }, [markExported])

  const unavailable = logs.settings !== null && !logs.settings.available

  return (
    <div data-slot="log-viewer" className="flex h-full flex-col gap-4">
      <div data-slot="log-viewer-header" className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onPress={onBack}>
          <ChevronLeft className="size-4" />
          {t('settings.about.logs.back')}
        </Button>
        <h2 data-slot="log-viewer-title" className="text-lg font-medium">
          {t('settings.about.logs.title')}
        </h2>
        <div data-slot="log-viewer-actions" className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onPress={logs.refresh} isDisabled={logs.loading}>
            <ArrowsRotateRight className="size-4" />
            {t('settings.about.logs.refresh')}
          </Button>
          {/* The picker names a path on this device and the file is written by
              whichever machine the logs belong to. Reading them here still
              works — that is what the rows below are. */}
          <Button variant="secondary" size="sm" onPress={onExport} isDisabled={!can.exportToDisk}>
            <ArrowDownToLine className="size-4" />
            {exported ? t('settings.about.logs.exported') : t('settings.about.logs.export')}
          </Button>
        </div>
      </div>

      <p data-slot="log-viewer-export-hint" className="text-xs text-muted">
        {can.exportToDisk ? t('settings.about.logs.exportHint') : t('capability.exportToDisk')}
      </p>

      <div data-slot="log-toolbar" className="flex flex-wrap items-center gap-2">
        <SettingsSelect
          ariaLabel={t('settings.about.logs.levelFilter')}
          value={logs.level}
          options={levelOptions}
          onChange={logs.setLevel}
          triggerClassName="w-44"
        />

        <InputGroup className="max-w-xs flex-1">
          <InputGroup.Prefix>
            <Magnifier className="size-4" />
          </InputGroup.Prefix>
          <InputGroup.Input
            aria-label={t('settings.about.logs.searchPlaceholder')}
            name="logSearch"
            value={logs.search}
            onChange={(e: import('react').ChangeEvent<HTMLInputElement>) => logs.setSearch(e.target.value)}
            placeholder={t('settings.about.logs.searchPlaceholder')}
          />
        </InputGroup>

        <SettingsSelect
          ariaLabel={t('settings.about.logs.rangeFilter')}
          value={logs.range}
          options={rangeOptions}
          onChange={logs.setRange}
          triggerClassName="w-40"
        />

        {logs.entries.length > 0 && (
          // Only what is on screen. The reader stops as soon as it has a page,
          // so a total would be a number nobody actually counted.
          <span data-slot="log-viewer-count" className="ml-auto text-xs text-muted">
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
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.about.logs.unavailable')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        ) : logs.error ? (
          <p data-slot="log-viewer-error" role="alert" className="p-6 text-sm text-danger">
            {t('settings.about.logs.loadError')}
          </p>
        ) : logs.loading ? (
          <div
            data-slot="log-viewer-loading"
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3 p-3"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : logs.entries.length === 0 ? (
          // Two different nothings: a filter that matched none, and a window
          // with nothing in it. Only the first has anything to undo.
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>
                {logs.isFiltered ? t('settings.about.logs.empty') : t('settings.about.logs.emptyRange')}
              </EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <>
            {logs.entries.map((entry) => (
              <LogRow key={`${entry.cursor.fileIndex}:${entry.cursor.byteOffset}`} entry={entry} />
            ))}
            <div data-slot="log-viewer-footer" className="flex flex-col items-center gap-2 p-3">
              {logs.truncated && (
                <p data-slot="log-viewer-truncated" className="text-xs text-muted">
                  {t('settings.about.logs.truncated')}
                </p>
              )}
              {logs.capped ? (
                <p data-slot="log-viewer-capped" className="text-xs text-muted">
                  {t('settings.about.logs.capped', { max: MAX_RENDERED })}
                </p>
              ) : logs.canLoadOlder ? (
                <Button variant="ghost" size="sm" onPress={logs.loadOlder} isDisabled={logs.loadingMore}>
                  {logs.loadingMore && <Spinner size="sm" color="current" />}
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
