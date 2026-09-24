import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import type { LogCursorInfoResponse, LogEntryInfoResponse, LogSettingsResponse } from '@/types'

export type LevelFilter = 'all' | 'warn' | 'error'
export type RangeFilter = '15m' | '1h' | '24h' | 'all'

/** One page from the backend. Small enough to stay responsive, large enough that
 *  scrolling rarely needs a second one. */
const PAGE_SIZE = 200

/** Ceiling on what the list holds. The frontend has no virtualisation — and
 *  cannot use CSS containment, which crashes WebView2 — so the answer to a large
 *  log is a narrower filter, not more rows. */
export const MAX_RENDERED = 600

const RANGE_MINUTES: Record<RangeFilter, number | null> = {
  '15m': 15,
  '1h': 60,
  '24h': 24 * 60,
  all: null,
}

function sinceFor(range: RangeFilter): number | undefined {
  const minutes = RANGE_MINUTES[range]
  return minutes === null ? undefined : Date.now() - minutes * 60_000
}

export function useAppLogs() {
  const [level, setLevel] = useState<LevelFilter>('all')
  const [range, setRange] = useState<RangeFilter>('1h')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [entries, setEntries] = useState<LogEntryInfoResponse[]>([])
  const [cursor, setCursor] = useState<LogCursorInfoResponse | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  // Whether any page has landed. The skeleton is for the first load only: a
  // refresh that swapped the rows for grey boxes threw away what was being
  // read to fetch slightly different lines of it.
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<LogSettingsResponse | null>(null)

  // Typing a filter should not fire a request per keystroke; the backend walks
  // the file on every call.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    api
      .getLogSettings()
      .then(setSettings)
      // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- read-only viewer; null hides the level control
      .catch(() => setSettings(null))
  }, [])

  /** Guards against a slow first page landing after a newer one. */
  const requestId = useRef(0)

  const load = useCallback(() => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    api
      .readLogs({
        minLevel: level === 'all' ? undefined : level,
        limit: PAGE_SIZE,
        contains: debouncedSearch || undefined,
        sinceTsMs: sinceFor(range),
      })
      .then((page) => {
        if (id !== requestId.current) return
        setEntries(page.entries)
        setCursor(page.nextCursor)
        setTruncated(page.scanTruncated)
        setLoaded(true)
      })
      .catch((e) => {
        if (id !== requestId.current) return
        setError(String(e))
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- read-only log viewer; the error is shown beside the emptied list
        setEntries([])
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- read-only log viewer; the error is shown beside the emptied list
        setCursor(null)
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [level, range, debouncedSearch])

  useEffect(load, [load])

  const loadOlder = useCallback(() => {
    if (!cursor || loadingMore) return
    const id = requestId.current
    setLoadingMore(true)
    api
      .readLogs({
        minLevel: level === 'all' ? undefined : level,
        limit: PAGE_SIZE,
        contains: debouncedSearch || undefined,
        sinceTsMs: sinceFor(range),
        cursor,
      })
      .then((page) => {
        // A filter change while this was in flight makes the result stale.
        if (id !== requestId.current) return
        setEntries((prev) => [...prev, ...page.entries].slice(0, MAX_RENDERED))
        setCursor(page.nextCursor)
        setTruncated(page.scanTruncated)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMore(false))
  }, [cursor, loadingMore, level, range, debouncedSearch])

  const capped = entries.length >= MAX_RENDERED
  return {
    level,
    setLevel,
    range,
    setRange,
    search,
    setSearch,
    entries,
    settings,
    /** The first page is on its way and there is nothing to show yet. */
    loading: loading && !loaded,
    /** A later reload, with the previous rows still on screen. */
    refreshing: loading && loaded,
    loadingMore,
    error,
    truncated,
    capped,
    /** More records exist and there is room to show them. */
    canLoadOlder: cursor !== null && !capped,
    refresh: load,
    loadOlder,
    /** True when nothing matched but the log itself is fine. */
    isFiltered: level !== 'all' || debouncedSearch.length > 0,
  }
}
