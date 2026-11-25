import './log-viewer.css'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ChevronLeft, Download, RefreshCw } from '@keyline-icons/react/two-tone'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { LogRow } from './log-row'
import { SettingsSelect, type SettingsSelectOption } from '../primitives'
import { MAX_RENDERED, useAppLogs, type LevelFilter, type RangeFilter } from './use-app-logs'

export function LogViewer({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const logs = useAppLogs()
  const [exported, markExported] = useTemporaryFlag(3000)
  const [exportError, setExportError] = useState<string | null>(null)

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
    setExportError(null)
    try {
      await api.exportLogs({ outputPath: path })
    } catch (e) {
      // Unsaid, a refused write looks exactly like a cancelled picker.
      setExportError(String(e))
      return
    }
    markExported()
  }, [markExported])

  const unavailable = logs.settings !== null && !logs.settings.available

  return (
    <div data-slot="log-viewer" className="m-log-viewer">
      <div data-slot="log-viewer-header" className="m-log-viewer__header">
        <Button icon={<ChevronLeft />} variant="secondary" size="sm" onPress={onBack}>
          {t('settings.about.logs.back')}
        </Button>
        <h2 data-slot="log-viewer-title" className="m-log-viewer__title">
          {t('settings.about.logs.title')}
        </h2>
        <div data-slot="log-viewer-actions" className="m-log-viewer__actions">
          <Button
            variant="secondary"
            size="sm"
            onPress={logs.refresh}
            isDisabled={logs.loading}
            isPending={logs.refreshing}
            icon={<RefreshCw />}
          >
            {t('settings.about.logs.refresh')}
          </Button>
          {/* The picker names a path on this device and the file is written by
              whichever machine the logs belong to. Reading them here still
              works — that is what the rows below are. */}
          <Button icon={<Download />} variant="secondary" size="sm" onPress={onExport} isDisabled={!can.exportToDisk}>
            {exported ? t('settings.about.logs.exported') : t('settings.about.logs.export')}
          </Button>
        </div>
      </div>

      <p data-slot="log-viewer-export-hint" className="m-log-viewer__note">
        {can.exportToDisk ? t('settings.about.logs.exportHint') : t('capability.exportToDisk')}
      </p>
      {exportError && (
        <Alert data-slot="log-viewer-export-error" tone="danger" shouldAnnounce>
          {t('settings.about.logs.exportFailed', { error: exportError })}
        </Alert>
      )}

      <div data-slot="log-toolbar" className="m-log-viewer__toolbar">
        <SettingsSelect
          ariaLabel={t('settings.about.logs.levelFilter')}
          value={logs.level}
          options={levelOptions}
          onChange={logs.setLevel}
        />

        <div className="m-log-viewer__search">
          <SearchField
            aria-label={t('settings.about.logs.searchPlaceholder')}
            name="logSearch"
            value={logs.search}
            onChange={logs.setSearch}
            placeholder={t('settings.about.logs.searchPlaceholder')}
          />
        </div>

        <SettingsSelect
          ariaLabel={t('settings.about.logs.rangeFilter')}
          value={logs.range}
          options={rangeOptions}
          onChange={logs.setRange}
        />

        {logs.entries.length > 0 && (
          // Only what is on screen. The reader stops as soon as it has a page,
          // so a total would be a number nobody actually counted.
          <span data-slot="log-viewer-count" className="m-log-viewer__count" aria-live="polite">
            {t('settings.about.logs.count', { shown: logs.entries.length })}
          </span>
        )}
      </div>

      {/* A page of log lines is read, not operated: the rows only carry a copy
          button, so the list itself is the tab stop that scrolls it. */}
      <div data-slot="log-list" tabIndex={0} className="m-log-viewer__list">
        {unavailable ? (
          <EmptyState heading={t('settings.about.logs.unavailable')} headingLevel={3} size="sm" />
        ) : logs.error ? (
          <Alert data-slot="log-viewer-error" tone="danger" shouldAnnounce>
            {t('settings.about.logs.loadError')}
          </Alert>
        ) : logs.loading ? (
          <div
            data-slot="log-viewer-loading"
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="m-log-viewer__loading"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} shape="rect" width="100%" height="3rem" />
            ))}
          </div>
        ) : logs.entries.length === 0 ? (
          // Two different nothings: a filter that matched none, and a window
          // with nothing in it. Only the first has anything to undo.
          <EmptyState
            heading={logs.isFiltered ? t('settings.about.logs.empty') : t('settings.about.logs.emptyRange')}
            headingLevel={3}
            size="sm"
          />
        ) : (
          <>
            {logs.entries.map((entry) => (
              <LogRow key={`${entry.cursor.fileIndex}:${entry.cursor.byteOffset}`} entry={entry} />
            ))}
            <div data-slot="log-viewer-footer" className="m-log-viewer__footer">
              {logs.truncated && (
                <p data-slot="log-viewer-truncated" className="m-log-viewer__note">
                  {t('settings.about.logs.truncated')}
                </p>
              )}
              {logs.capped ? (
                <p data-slot="log-viewer-capped" className="m-log-viewer__note">
                  {t('settings.about.logs.capped', { max: MAX_RENDERED })}
                </p>
              ) : logs.canLoadOlder ? (
                <Button variant="secondary" size="sm" onPress={logs.loadOlder} isPending={logs.loadingMore}>
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
