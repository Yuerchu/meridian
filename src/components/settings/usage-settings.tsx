import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Key } from 'react-aria-components'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import './usage-settings.css'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Tab, TabList, TabPanel, Tabs } from '@/components/yuerchu-ui/components/tabs/tabs'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { BarChart, DonutChart } from '@/components/yuerchu-ui/components/chart/chart'
import { DataTable, type DataTableColumn } from '@/components/yuerchu-ui/components/data-table/data-table'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '@/components/yuerchu-ui/components/table/table'
import { ChevronRight, SquareArrowUpRight } from '@keyline-icons/react/two-tone'
import { UsageHeatmap } from './usage-heatmap'

import { api } from '@/api'
import { costQualifier, formatCostAmount, type CostQualifier } from '@/lib/cost-format'
import { compareDecimals, decimal, decimalPercent, sumDecimals, type DecimalString } from '@/lib/decimal'
import { Hint } from '@/components/ui/hint'
import { SettingsHeader, SettingsPane } from './primitives'
import { UsageGapsSheet } from './usage-gaps-sheet'
import type { UsageBucketInfoResponse, UsageCacheMissInfoResponse, UsageDimension, UsageReportRequest } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'
import { HOUR_COUNT, rankByTokens, weekdayHourGrid } from '@/lib/usage-charts'

/**
 * What the assistant has cost, out of the audit log.
 *
 * Every figure on this page is computed in Rust — see
 * `src-tauri/src/db/ops/usage.rs`. Nothing here derives a cost from token
 * totals, and it must stay that way: a cached token bills at the cache rate
 * *instead of* the input rate. The conversation table may add already-priced,
 * disjoint buckets that share a visible title; it never applies a rate. Every
 * other figure asks for one grouping per view and draws what comes back.
 *
 * The one number this page is responsible for not lying about is the total.
 * `unpriced_messages` counts replies whose metered usage or pricing is
 * incomplete; `estimated_messages` records historical rows priced from today's
 * provider/model configuration. Known pieces still contribute. The former is
 * a lower bound, the latter an estimate, and a total containing both is an
 * explicitly incomplete estimate rather than either false claim.
 */

/** Windows, in days. `null` is the whole log. */
const RANGES = [7, 30, null] as const
type Range = (typeof RANGES)[number]

const ORIGINS = [null, 'desktop', 'onebot'] as const
type Origin = (typeof ORIGINS)[number]

// `kind` splits answering the user from reviewing whether a tool call was
// allowed to happen. It sits with the others rather than in a panel of its own
// because it is the same question — where did the money go — and because the
// total above already includes both: without a way to decompose it, a user who
// turns the reviewer on has no way to find out what it costs them.
const BREAKDOWNS = ['logical_model', 'conversation', 'source', 'bot', 'kind'] as const
type Breakdown = (typeof BREAKDOWNS)[number]

const DAY_MS = 86_400_000

/**
 * The four bands every chart here stacks, in stacking order.
 *
 * The first three are the prompt taken apart the same way `compute_cost` takes
 * it apart, because that is the split that costs different amounts: what missed
 * cache pays full price, what was read from it pays a fraction, what was written
 * into it pays a premium. They sum to `input_tokens` rather than adding to it —
 * the two cache figures are subsets of the prompt, so drawing them beside a full
 * input band would count the cached part twice.
 *
 * The four library series, in stacking order. They are categorical, not status:
 * a band landing on amber would be read as a warning.
 */
const SERIES = [
  { key: 'uncached', color: 'var(--series-3)', labelKey: 'settings.usage.legend.uncached' },
  { key: 'cacheRead', color: 'var(--series-2)', labelKey: 'settings.usage.legend.cacheRead' },
  { key: 'cacheWrite', color: 'var(--series-1)', labelKey: 'settings.usage.legend.cacheWrite' },
  { key: 'output', color: 'var(--series-4)', labelKey: 'settings.usage.legend.output' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']
type Split = Record<SeriesKey, number>

/**
 * Backend-priced parts of a bill. These are deliberately different from the
 * token series above: the four numbers already include tier selection, cache
 * replacement and per-call tool rates. The UI may group or draw them, but must
 * never recreate them from token counts.
 */
const COST_SERIES = [
  { key: 'input_cost', color: 'var(--series-3)', labelKey: 'settings.usage.cost.input' },
  { key: 'cache_cost', color: 'var(--series-2)', labelKey: 'settings.usage.cost.cache' },
  { key: 'output_cost', color: 'var(--series-4)', labelKey: 'settings.usage.cost.output' },
  { key: 'tool_cost', color: 'var(--series-1)', labelKey: 'settings.usage.cost.tools' },
] as const

type CostSeriesKey = (typeof COST_SERIES)[number]['key']
type CostSplit = Record<CostSeriesKey, DecimalString>
const ZERO_DECIMAL = decimal('0')

function costSplit(bucket: UsageBucketInfoResponse): CostSplit {
  return {
    input_cost: bucket.input_cost,
    cache_cost: bucket.cache_cost,
    output_cost: bucket.output_cost,
    tool_cost: bucket.tool_cost,
  }
}

/**
 * A bucket's tokens, split into the four bands.
 *
 * Saturating, like `BilledTokens::from_totals` on the other side: a provider
 * that reports more cached tokens than prompt tokens is contradicting itself,
 * and the answer to that is a zero band rather than a bar drawn below the axis.
 */
function split(bucket: UsageBucketInfoResponse): Split {
  return {
    uncached: Math.max(0, bucket.input_tokens - bucket.cache_read_tokens - bucket.cache_write_tokens),
    cacheRead: bucket.cache_read_tokens,
    cacheWrite: bucket.cache_write_tokens,
    output: bucket.output_tokens,
  }
}

/**
 * Which bands are worth drawing at all.
 *
 * A series that is zero everywhere still takes a legend entry, and a legend
 * entry the reader can never find in the chart is worse than one band fewer.
 * Cache writes are zero on every provider but Anthropic, and zero there too
 * until the request builder starts sending `cache_control` — so on most
 * installs this is what keeps a permanently empty band off the page.
 */
function present(rows: Split[]): readonly (typeof SERIES)[number][] {
  return SERIES.filter((s) => rows.some((row) => row[s.key] > 0))
}

function presentCosts(rows: CostSplit[]): readonly (typeof COST_SERIES)[number][] {
  return COST_SERIES.filter((s) => rows.some((row) => compareDecimals(row[s.key], ZERO_DECIMAL) > 0))
}

function nonLocalMessages(bucket: UsageBucketInfoResponse): number {
  return bucket.subscription_messages + bucket.external_messages
}

function bucketCostQualifier(bucket: UsageBucketInfoResponse): CostQualifier {
  return costQualifier(bucket.unpriced_messages + nonLocalMessages(bucket), bucket.estimated_messages)
}

function componentQualifier(bucket: UsageBucketInfoResponse, key: CostSeriesKey): CostQualifier {
  const nonLocal = nonLocalMessages(bucket)
  return key === 'tool_cost'
    ? costQualifier(bucket.unpriced_tool_messages + nonLocal, bucket.estimated_tool_messages)
    : costQualifier(bucket.unpriced_token_messages + nonLocal, bucket.estimated_token_messages)
}

function qualifiedCost(
  value: DecimalString,
  qualifier: CostQualifier,
  t: ReturnType<typeof useTranslation>['t'],
  locale: string,
): string {
  const amount = formatCostAmount(value, qualifier, locale)
  return qualifier === 'partial_estimate' ? t('settings.usage.partialAmount', { amount }) : amount
}

function displayedCost(
  bucket: UsageBucketInfoResponse,
  t: ReturnType<typeof useTranslation>['t'],
  locale: string,
): string {
  if (bucket.metered_messages === 0) {
    if (bucket.external_messages > 0 && bucket.subscription_messages === 0) {
      return t('settings.usage.billing.external')
    }
    if (bucket.subscription_messages > 0 && bucket.external_messages === 0) {
      return t('settings.usage.billing.subscription')
    }
    if (nonLocalMessages(bucket) > 0) return t('settings.usage.billing.unavailable')
  }
  return qualifiedCost(bucket.total_cost, bucketCostQualifier(bucket), t, locale)
}

function billingCoverage(bucket: UsageBucketInfoResponse, t: ReturnType<typeof useTranslation>['t']): string | null {
  return nonLocalMessages(bucket) > 0
    ? t('settings.usage.billing.coverage', {
        subscription: bucket.subscription_messages,
        external: bucket.external_messages,
      })
    : null
}

function tokenTotal(
  value: number,
  bucket: UsageBucketInfoResponse,
  t: ReturnType<typeof useTranslation>['t'],
  compact: Intl.NumberFormat,
): string {
  if (bucket.messages > 0 && bucket.missing_token_usage_messages >= bucket.messages) {
    return t('settings.usage.kpi.tokensUnavailable')
  }
  const formatted = compact.format(value)
  return bucket.incomplete_token_usage_messages > 0 ? `≥ ${formatted}` : formatted
}

interface Report {
  total: UsageBucketInfoResponse
  days: UsageBucketInfoResponse[]
  providers: UsageBucketInfoResponse[]
  models: UsageBucketInfoResponse[]
  /** One bucket per `role`: answering the user, reviewing, titling, summing up. */
  kinds: UsageBucketInfoResponse[]
  /** Prompt tokens the previous request carried and this one billed again. */
  misses: UsageCacheMissInfoResponse
  /** Replies per weekday × hour, Monday first. */
  activity: number[][]
  rows: UsageBucketInfoResponse[]
  rowsDimension: Breakdown
  /** The window these figures cover, so the gap list explains the same counts. */
  sinceMs: number | null
}

const EMPTY_TOTAL: UsageBucketInfoResponse = {
  key: '',
  label: null,
  messages: 0,
  metered_messages: 0,
  subscription_messages: 0,
  external_messages: 0,
  missing_token_usage_messages: 0,
  incomplete_token_usage_messages: 0,
  missing_input_messages: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reported_input_tokens: 0,
  reported_input_cache_read_tokens: 0,
  cache_reported_input_tokens: 0,
  cache_reported_input_cache_read_tokens: 0,
  cache_reported_input_messages: 0,
  input_cost: ZERO_DECIMAL,
  output_cost: ZERO_DECIMAL,
  cache_cost: ZERO_DECIMAL,
  tool_cost: ZERO_DECIMAL,
  total_cost: ZERO_DECIMAL,
  unpriced_token_messages: 0,
  unpriced_tool_messages: 0,
  estimated_token_messages: 0,
  estimated_tool_messages: 0,
  estimated_messages: 0,
  unpriced_messages: 0,
}

/**
 * One row per request role.
 *
 * Compaction, titling, auto-review and extraction are requests the app made on
 * its own behalf. Their prompts are not the transcript's prefix, so their hit
 * rate is structurally near zero and says nothing about the conversation's —
 * averaging them into one number is what made the KPI look worse than the
 * turns it was meant to describe.
 */
function RequestTypeTable({ kinds }: { kinds: UsageBucketInfoResponse[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  )
  const rows = useMemo(
    () =>
      kinds.filter((kind) => kind.messages > 0).sort((a, b) => b.messages - a.messages || a.key.localeCompare(b.key)),
    [kinds],
  )
  const columns = useMemo<DataTableColumn<UsageBucketInfoResponse>[]>(
    () => [
      {
        id: 'role',
        header: t('settings.usage.byRequestType.role'),
        isRowHeader: true,
        cell: (row) => (
          <span className="m-usage-settings__truncate">{row.label ?? t(`settings.usage.kind.${row.key}`)}</span>
        ),
      },
      {
        id: 'hitRate',
        header: t('settings.usage.kpi.cacheRate'),
        align: 'end',
        width: 96,
        cell: (row) => (
          <span className="m-usage-settings__cell">
            {row.cache_reported_input_tokens > 0
              ? percent.format(row.cache_reported_input_cache_read_tokens / row.cache_reported_input_tokens)
              : '—'}
          </span>
        ),
      },
      {
        id: 'replies',
        header: t('settings.usage.byRequestType.replies'),
        align: 'end',
        width: 80,
        cell: (row) => <span className="m-usage-settings__cell">{compact.format(row.messages)}</span>,
      },
      {
        id: 'tokens',
        header: t('settings.usage.tokenColumn'),
        align: 'end',
        width: 96,
        cell: (row) => (
          <span className="m-usage-settings__cell">
            {tokenTotal(row.input_tokens + row.output_tokens, row, t, compact)}
          </span>
        ),
      },
      {
        id: 'cost',
        header: t('settings.usage.kpi.cost'),
        align: 'end',
        width: 120,
        cell: (row) => <span className="m-usage-settings__cell-strong">{displayedCost(row, t, locale)}</span>,
      },
    ],
    [compact, locale, percent, t],
  )

  if (rows.length === 0) return null
  return (
    <FigureCard title={t('settings.usage.byRequestType.title')}>
      <DataTable<UsageBucketInfoResponse>
        aria-label={t('settings.usage.byRequestType.title')}
        size="sm"
        columns={columns}
        rows={rows}
        getRowId={(row) => `kind:${row.key}`}
      />
    </FigureCard>
  )
}

const EMPTY_MISSES: UsageCacheMissInfoResponse = {
  missed_tokens: 0,
  missed_cost: ZERO_DECIMAL,
  miss_count: 0,
  measured_messages: 0,
  has_unpriced_misses: false,
}

/**
 * What the cache failed to save: prompt tokens the previous request carried
 * and this one paid full price for again. `measured_messages` is how many
 * replies a comparison was possible for — zero means the window has nothing
 * to compare, which is not the same as a perfect prefix.
 */
function CacheMisses({ misses }: { misses: UsageCacheMissInfoResponse }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  if (misses.measured_messages === 0) return null
  const qualifier: CostQualifier = misses.has_unpriced_misses ? 'lower_bound' : 'exact'
  return (
    <FigureCard title={t('settings.usage.cacheMisses.title')}>
      <div className="m-usage-settings__misses">
        <Kpi title={t('settings.usage.cacheMisses.tokens')}>
          <span data-slot="cache-missed-tokens" className="m-usage-settings__value">
            {compact.format(misses.missed_tokens)}
          </span>
        </Kpi>
        <Kpi title={t('settings.usage.cacheMisses.cost')}>
          <span data-slot="cache-missed-cost" className="m-usage-settings__value">
            {formatCostAmount(misses.missed_cost, qualifier, locale)}
          </span>
        </Kpi>
        <Kpi title={t('settings.usage.cacheMisses.count')}>
          <span data-slot="cache-missed-count" className="m-usage-settings__value">
            {compact.format(misses.miss_count)}
          </span>
        </Kpi>
      </div>
      <p className="m-usage-settings__note">
        {t('settings.usage.cacheMisses.note', { measured: misses.measured_messages })}
      </p>
    </FigureCard>
  )
}

export function UsageSettings({ onOpenConversation }: { onOpenConversation: (conversationId: string) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  )
  const [range, setRange] = useState<Range>(30)
  const [origin, setOrigin] = useState<Origin>(null)
  const [breakdown, setBreakdown] = useState<Breakdown>('conversation')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Read here rather than in a memo over `range`: "the last 30 days" is
    // relative to the moment the query runs, and a clock read during render is
    // both impure and stale by the time anything uses it.
    const sinceMs = range === null ? null : Date.now() - range * DAY_MS
    const request = (dimension: UsageDimension): UsageReportRequest => ({
      dimension,
      since_ms: sinceMs,
      until_ms: null,
      origin,
      conversation_id: null,
    })
    // Seven groupings in flight together. They are independent queries over the
    // same table, and running them in series would show the page filling in one
    // chart at a time.
    Promise.all([
      api.usage.getReport(request('total')),
      api.usage.getReport(request('day')),
      api.usage.getReport(request('provider')),
      api.usage.getReport(request('model')),
      api.usage.getReport(request('hour')),
      api.usage.getReport(request('kind')),
      api.usage.getReport(request(breakdown)),
      api.usage.getCacheMisses({ since_ms: sinceMs, until_ms: null, origin, conversation_id: null }),
    ])
      .then(([total, days, providers, models, hours, kinds, rows, misses]) => {
        if (cancelled) return
        // Projected here rather than during render: a malformed hour key is a
        // broken contract, and thrown from here it becomes the page's error
        // instead of taking the whole settings pane down with it.
        const activity = weekdayHourGrid(hours)
        setReport({
          total: total[0] ?? EMPTY_TOTAL,
          days,
          providers,
          models,
          kinds,
          misses,
          activity,
          rows,
          rowsDimension: breakdown,
          sinceMs,
        })
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, origin, breakdown, reload])

  const rangeLabel = useCallback(
    (value: Range) =>
      value === null ? t('settings.usage.range.all') : t('settings.usage.range.days', { count: value }),
    [t],
  )

  const total = report?.total ?? EMPTY_TOTAL
  const localQualifier = costQualifier(total.unpriced_messages, total.estimated_messages)
  const billingNote = billingCoverage(total, t)
  const tokenNote =
    total.incomplete_token_usage_messages > 0
      ? total.missing_token_usage_messages >= total.messages
        ? t('settings.usage.kpi.tokensUnavailableNote')
        : t('settings.usage.kpi.tokensPartialNote', {
            count: total.incomplete_token_usage_messages,
            value: compact.format(total.cache_read_tokens),
          })
      : t('settings.usage.kpi.inputNote', { value: compact.format(total.cache_read_tokens) })
  // The KPI is the conversation's hit rate, not the page's. Title generation,
  // auto-review, compaction and extraction each send a prompt that is not the
  // transcript's prefix, so by construction they never hit; averaging them in
  // understates the number a person is actually asking about. The table below
  // gives every role its own row.
  const assistantKind = report?.kinds.find((kind) => kind.key === 'assistant') ?? total
  // Of the prompt tokens whose cache-read usage the upstream reported, how
  // many were already cached. A missing cache-read field is unknown rather
  // than a zero hit, so it contributes to billing but not this rate.
  const hitRate =
    assistantKind.cache_reported_input_tokens > 0
      ? assistantKind.cache_reported_input_cache_read_tokens / assistantKind.cache_reported_input_tokens
      : null
  const hitRateCounted = assistantKind.cache_reported_input_messages
  const hasGaps = total.unpriced_messages > 0 || total.incomplete_token_usage_messages > 0
  const [gapsOpen, setGapsOpen] = useState(false)

  return (
    <SettingsPane width="wide">
      <SettingsHeader
        title={t('settings.usage.title')}
        subtitle={t('settings.usage.subtitle')}
        actions={
          <div data-slot="usage-filters" className="m-usage-settings__filters">
            <Filter
              label={t('settings.usage.rangeLabel')}
              selectedKey={String(range)}
              onChange={(key) => setRange(key === 'null' ? null : (Number(key) as Range))}
              items={RANGES.map((value) => [String(value), rangeLabel(value)])}
            />
            <Filter
              label={t('settings.usage.originLabel')}
              selectedKey={origin ?? 'all'}
              onChange={(key) => setOrigin(key === 'all' ? null : (key as Origin))}
              items={ORIGINS.map((value) => [value ?? 'all', t(`settings.usage.origin.${value ?? 'all'}`)])}
            />
            {/* Only once there is something to refresh. The first load draws the
                skeleton below instead, and two loading indicators for one wait is
                one too many. */}
            {loading && report && (
              <span className="m-usage-settings__refreshing">
                <Spinner size="sm" aria-label={t('common.loading')} />
              </span>
            )}
          </div>
        }
      />

      {error && (
        <Alert
          tone="danger"
          shouldAnnounce
          actions={
            <Button size="sm" variant="secondary" onPress={() => setReload((value) => value + 1)}>
              {t('settings.usage.retry')}
            </Button>
          }
        >
          <Hint className="m-usage-settings__error-text" label={error}>
            {t('settings.usage.loadError')}
          </Hint>
        </Alert>
      )}

      {!report && loading ? (
        <UsageSkeleton />
      ) : !report ? null : total.messages === 0 ? (
        <EmptyState
          heading={t('settings.usage.empty')}
          headingLevel={3}
          description={t('settings.usage.emptyHint')}
          size="sm"
        />
      ) : (
        <>
          <div data-slot="usage-kpis" className="m-usage-settings__kpis">
            <Kpi title={t('settings.usage.kpi.cost')}>
              <span data-slot="cost-total" className="m-usage-settings__value">
                {displayedCost(total, t, locale)}
              </span>
            </Kpi>
            {/* The count is formatted before it goes in, not by i18next: passing
                the raw number leaves it ungrouped, and "13830144" sitting under
                "1514.9万" reads as two different quantities. */}
            <Kpi title={t('settings.usage.kpi.input')} note={tokenNote}>
              <span data-slot="input-total" className="m-usage-settings__value">
                {tokenTotal(total.input_tokens, total, t, compact)}
              </span>
            </Kpi>
            <Kpi title={t('settings.usage.kpi.output')}>
              <span data-slot="output-total" className="m-usage-settings__value">
                {tokenTotal(total.output_tokens, total, t, compact)}
              </span>
            </Kpi>
            <Kpi
              title={t('settings.usage.kpi.cacheRateAssistant')}
              note={
                hitRateCounted < assistantKind.messages
                  ? t('settings.usage.kpi.cacheRateNote', {
                      counted: hitRateCounted,
                      count: assistantKind.messages,
                    })
                  : t('settings.usage.kpi.replies', { count: assistantKind.messages })
              }
            >
              <span data-slot="cache-rate" className="m-usage-settings__value">
                {hitRate === null ? '—' : percent.format(hitRate)}
              </span>
            </Kpi>
          </div>

          <div data-slot="usage-insights" className="m-usage-settings__insights">
            <RequestTypeTable kinds={report?.kinds ?? []} />
            <CacheMisses misses={report?.misses ?? EMPTY_MISSES} />
          </div>

          {localQualifier !== 'exact' && (
            <p
              data-slot={total.unpriced_messages > 0 ? 'unpriced-warning' : 'estimated-warning'}
              className="m-usage-settings__warning"
              data-tone={total.unpriced_messages > 0 ? 'warning' : undefined}
            >
              {localQualifier === 'partial_estimate'
                ? t('settings.usage.partialEstimate', {
                    estimated: total.estimated_messages,
                    unpriced: total.unpriced_messages,
                  })
                : localQualifier === 'estimated'
                  ? t('settings.usage.estimated', { count: total.estimated_messages })
                  : t('settings.usage.unpriced', { count: total.unpriced_messages })}
            </p>
          )}
          {hasGaps && (
            <div className="m-usage-settings__start">
              <Button size="sm" variant="secondary" data-slot="usage-gaps-show" onPress={() => setGapsOpen(true)}>
                {t('settings.usage.gaps.show')}
              </Button>
            </div>
          )}
          {billingNote && (
            <p data-slot="billing-coverage-warning" className="m-usage-settings__note">
              {billingNote}
            </p>
          )}

          <CostBreakdown bucket={total} />

          <FigureCard title={t('settings.usage.trend')}>
            <TokenTrend days={report?.days ?? []} />
          </FigureCard>

          <div data-slot="usage-cost-charts" className="m-usage-settings__charts">
            <FigureCard title={t('settings.usage.byProvider')}>
              <CostBars buckets={report?.providers ?? []} />
            </FigureCard>
            <FigureCard title={t('settings.usage.byModel')}>
              <CostBars buckets={report?.models ?? []} />
            </FigureCard>
          </div>

          <div data-slot="usage-token-charts" className="m-usage-settings__charts">
            <FigureCard title={t('settings.usage.tokensByModel')}>
              <TokensByModel buckets={report?.models ?? []} />
            </FigureCard>
            <FigureCard title={t('settings.usage.composition')}>
              <TokenComposition total={total} />
            </FigureCard>
          </div>

          <FigureCard title={t('settings.usage.activity')}>
            <Activity grid={report?.activity ?? []} />
          </FigureCard>

          {/* The one place on this page where the tabs really do switch the
              content beneath them, so this one has panels. Only the selected
              panel renders, and `rows` is that dimension's data — the fetch is
              keyed on the same state the tab is. */}
          <section data-slot="usage-breakdown" className="m-usage-settings__card">
            <h3 data-slot="usage-breakdown-title" className="m-usage-settings__title">
              {t('settings.usage.breakdown')}
            </h3>
            <Tabs selectedKey={breakdown} onSelectionChange={(key) => setBreakdown(key as Breakdown)}>
              <TabList aria-label={t('settings.usage.breakdown')}>
                {BREAKDOWNS.map((value) => (
                  <Tab key={value} id={value}>
                    {t(`settings.usage.by.${value}`)}
                  </Tab>
                ))}
              </TabList>
              {BREAKDOWNS.map((value) => (
                <TabPanel key={value} id={value}>
                  <BucketTable
                    // Keep the old charts while the next dimension loads, but
                    // never put those old rows under the newly selected table
                    // header. The small page-level spinner already announces
                    // the in-flight refresh.
                    buckets={report?.rowsDimension === value ? report.rows : []}
                    dimension={value}
                    dimensionLabel={t(`settings.usage.by.${value}`)}
                    isLoading={loading && report?.rowsDimension !== value}
                    onOpenConversation={onOpenConversation}
                  />
                </TabPanel>
              ))}
            </Tabs>
          </section>
        </>
      )}
      <UsageGapsSheet
        isOpen={gapsOpen}
        onOpenChange={setGapsOpen}
        sinceMs={report?.sinceMs ?? null}
        origin={origin}
        onOpenConversation={onOpenConversation}
      />
    </SettingsPane>
  )
}

/**
 * One filter, as a labelled segmented control. These choices narrow the page;
 * they do not switch a tab panel, so they should not expose tab semantics.
 */
function Filter({
  label,
  selectedKey,
  onChange,
  items,
}: {
  label: string
  selectedKey: string
  onChange: (key: string) => void
  items: [string, string][]
}) {
  return (
    <div data-slot="usage-filter" className="m-usage-settings__filter">
      <p className="m-usage-settings__filter-label">{label}</p>
      <SegmentedControl
        data-slot="usage-filter-group"
        aria-label={label}
        selectedKey={selectedKey}
        onSelectionChange={(key) => onChange(String(key))}
      >
        {items.map(([id, text]) => (
          <Segment key={id} id={id}>
            {text}
          </Segment>
        ))}
      </SegmentedControl>
    </div>
  )
}

/**
 * The report, before the first one arrives.
 *
 * Only for the first load. A filter change keeps the numbers on screen and puts
 * a spinner beside the filters instead — replacing a page of real figures with
 * grey boxes to fetch a slightly different set of them is a step backwards.
 *
 * Without this the page rendered `EMPTY_TOTAL`: four cards reading zero, then a
 * jump to the real numbers. A zero that turns out to be wrong is worse than no
 * number, because it is legible.
 */
function UsageSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      data-slot="usage-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className="m-usage-settings__skeleton"
    >
      <div data-slot="usage-skeleton-kpis" className="m-usage-settings__skeleton-kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="rect" height="6.5rem" />
        ))}
      </div>
      {/* One block per chart card below, at about its loaded height, so the
          page does not grow by several hundred pixels when the numbers land:
          the trend, the two cost cards, the two token cards, the activity. */}
      <div data-slot="usage-skeleton-card">
        <Skeleton shape="rect" height="18rem" />
      </div>
      <div data-slot="usage-skeleton-charts" className="m-usage-settings__skeleton-charts">
        <div data-slot="usage-skeleton-card">
          <Skeleton shape="rect" height="13rem" />
        </div>
        <div data-slot="usage-skeleton-card">
          <Skeleton shape="rect" height="13rem" />
        </div>
      </div>
      <div data-slot="usage-skeleton-token-charts" className="m-usage-settings__skeleton-charts">
        <div data-slot="usage-skeleton-card">
          <Skeleton shape="rect" height="16rem" />
        </div>
        <div data-slot="usage-skeleton-card">
          <Skeleton shape="rect" height="16rem" />
        </div>
      </div>
      <div data-slot="usage-skeleton-card">
        <Skeleton shape="rect" height="15rem" />
      </div>
    </div>
  )
}

/**
 * A figure with a caption.
 *
 * The value is a node, not a formatted number: a cost has no currency, and a
 * rate can be "no data". `min-width: 0` is what lets a six-decimal cost truncate
 * instead of drawing out through the side of the card.
 */
function Kpi({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section data-slot="kpi" className="m-usage-settings__kpi">
      <span data-slot="kpi-title" className="m-usage-settings__kpi-title">
        {title}
      </span>
      <div data-slot="kpi-body" className="m-usage-settings__kpi-body">
        {children}
        {note && (
          <p data-slot="kpi-note" className="m-usage-settings__kpi-note">
            {note}
          </p>
        )}
      </div>
    </section>
  )
}

/** A chart with its title. The heading is how the card is found. */
function FigureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-slot="chart-card" className="m-usage-settings__card">
      <div data-slot="chart-card-header" className="m-usage-settings__card-header">
        <h3 data-slot="chart-card-title" className="m-usage-settings__card-title">
          {title}
        </h3>
      </div>
      {children}
    </section>
  )
}

/**
 * The total decomposed into the independently-priced parts returned by Rust.
 * This stays a plain definition list rather than four more cards: the KPI above
 * is the headline, while these figures answer the follow-up question without
 * competing with it. Token and tool completeness are independent: a missing
 * provider-tool rate does not make the already-priced input and output
 * components approximate. The backend supplies those component counters, so
 * the UI never has to infer them from the aggregate total.
 */
function CostBreakdown({ bucket }: { bucket: UsageBucketInfoResponse }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const qualifier = bucketCostQualifier(bucket)
  const note =
    qualifier === 'partial_estimate'
      ? t('settings.usage.partialEstimatedParts')
      : qualifier === 'estimated'
        ? t('settings.usage.estimatedParts')
        : qualifier === 'lower_bound'
          ? t('settings.usage.pricedPartsOnly')
          : null
  return (
    <section data-slot="cost-breakdown" className="m-usage-settings__card" aria-labelledby="usage-cost-breakdown-title">
      <div data-slot="cost-breakdown-header" className="m-usage-settings__breakdown-header">
        <h3 data-slot="cost-breakdown-title" id="usage-cost-breakdown-title" className="m-usage-settings__title">
          {t('settings.usage.costBreakdown')}
        </h3>
        {note && (
          <span data-slot="cost-breakdown-note" className="m-usage-settings__note">
            {note}
          </span>
        )}
      </div>
      {bucket.metered_messages === 0 && nonLocalMessages(bucket) > 0 ? (
        <p data-slot="cost-breakdown-empty" className="m-usage-settings__note">
          {t('settings.usage.noLocalCostBreakdown')}
        </p>
      ) : (
        <dl data-slot="cost-breakdown-list" className="m-usage-settings__parts">
          {COST_SERIES.map((part) => (
            <div key={part.key} data-slot="cost-breakdown-part" className="m-usage-settings__part">
              <dt data-slot="cost-breakdown-part-label" className="m-usage-settings__part-label">
                <span
                  data-slot="cost-breakdown-swatch"
                  className="m-usage-settings__swatch"
                  style={{ backgroundColor: part.color }}
                  aria-hidden="true"
                />
                <span data-slot="cost-breakdown-part-name" className="m-usage-settings__part-name">
                  {t(part.labelKey)}
                </span>
              </dt>
              <dd data-slot="cost-breakdown-part-value" className="m-usage-settings__part-value">
                {qualifiedCost(bucket[part.key], componentQualifier(bucket, part.key), t, locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/**
 * Tokens per day, the prompt's three parts stacked under the reply, one column
 * a day.
 *
 * Tokens rather than cost, because a model nobody has priced still produced
 * them — a cost chart would be flat and blank on a fresh install and read as
 * the feature being broken rather than as prices being unset.
 */
function TokenTrend({ days }: { days: UsageBucketInfoResponse[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }), [locale])
  const data = useMemo(
    () =>
      days.map((d) => {
        const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.key)
        const label = parsed ? day.format(new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]))) : d.key
        return { day: label, ...split(d) }
      }),
    [day, days],
  )
  const bands = present(data)
  if (data.length === 0) return null
  return (
    <BarChart
      aria-label={t('settings.usage.trend')}
      data={data}
      x="day"
      series={bands.map((band) => ({ key: band.key, label: t(band.labelKey) }))}
      stacked
      height={240}
      showLegend
      valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
    />
  )
}

/**
 * Models ranked by the tokens they moved. The cost bars beside this one cannot
 * show a model nobody priced — a local one, a subscription — and that model
 * may well be where most of the work happened.
 */
function TokensByModel({ buckets }: { buckets: UsageBucketInfoResponse[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const share = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }), [locale])
  const items = useMemo(() => rankByTokens(buckets, 6), [buckets])
  if (items.length === 0) {
    // Nothing to rank is not "no usage" when the replies just lost their counts.
    const unknown = buckets.some((bucket) => bucket.incomplete_token_usage_messages > 0)
    return (
      <p data-slot="tokens-by-model-empty" className="m-usage-settings__note">
        {t(unknown ? 'settings.usage.tokensUnavailable' : 'settings.usage.noTokens')}
      </p>
    )
  }
  return (
    <ul data-slot="bar-list" aria-label={t('settings.usage.tokensByModel')} className="m-usage-bar-list">
      {items.map((item) => (
        <li key={item.key} data-slot="bar-list-row" className="m-usage-bar-list__row">
          <span
            data-slot="bar-list-bar"
            aria-hidden="true"
            className="m-usage-bar-list__bar"
            style={{ width: item.width }}
          />
          <span data-slot="bar-list-label" onPointerEnter={titleIfTruncated} className="m-usage-bar-list__label">
            {item.label}
          </span>
          <span data-slot="bar-list-value" className="m-usage-bar-list__value">
            {item.incomplete ? `≥ ${compact.format(item.tokens)}` : compact.format(item.tokens)}
          </span>
          {item.share !== null && (
            <span data-slot="bar-list-share" className="m-usage-bar-list__share">
              {share.format(item.share)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The total's tokens in the four bands the daily chart stacks: what missed the
 * cache, what was read from it, what was written into it, and the reply.
 */
function TokenComposition({ total }: { total: UsageBucketInfoResponse }) {
  const { t } = useTranslation()
  const parts = split(total)
  const bands = present([parts])
  // A reply missing its input or its output leaves every band, and the whole,
  // a lower bound — which band is short is not recorded. Same `≥` as the KPIs.
  const incomplete = total.incomplete_token_usage_messages > 0
  if (bands.length === 0) {
    // Every known band at zero with counts missing is unknown usage, not none.
    return (
      <p data-slot="token-composition-empty" className="m-usage-settings__note">
        {t(incomplete ? 'settings.usage.tokensUnavailable' : 'settings.usage.noTokens')}
      </p>
    )
  }
  return (
    <DonutChart
      aria-label={t('settings.usage.composition')}
      data={bands.map((band) => ({
        key: band.key,
        label: t(band.labelKey),
        value: parts[band.key],
      }))}
      label="label"
      value="value"
      totalLabel={incomplete ? `≥ ${t('settings.usage.compositionCenter')}` : t('settings.usage.compositionCenter')}
      valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
      height={220}
      showLegend
    />
  )
}

const hour = (h: number) => String(h).padStart(2, '0')

/** Replies by weekday and hour of day, Monday first, in local time. */
function Activity({ grid }: { grid: number[][] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  // 2024-01-01 was a Monday; it and the six days after it name the rows in order.
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))))
  }, [locale])
  let busiest = { row: 0, column: 0, value: 0 }
  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value > busiest.value) busiest = { row: r, column: c, value }
    }),
  )
  if (busiest.value === 0) return null
  return (
    <UsageHeatmap
      data={grid}
      rowLabels={weekdays}
      columnLabel={(c) => (c % 6 === 0 && c < HOUR_COUNT ? hour(c) : '')}
      caption={(r, c, value) => t('settings.usage.activityCell', { day: weekdays[r], hour: hour(c), count: value })}
      aria-label={t('settings.usage.activitySummary', {
        day: weekdays[busiest.row],
        hour: hour(busiest.column),
        count: busiest.value,
      })}
      less={t('settings.usage.activityLess')}
      more={t('settings.usage.activityMore')}
    />
  )
}

/**
 * The top few of a breakdown, as horizontal stacked bars.
 *
 * Only the outermost band of a stack gets a radius. Rounding every segment
 * breaks the bar into beads with gaps at every join, which reads as missing data
 * rather than as a stack.
 */
function CostBars({ buckets }: { buckets: UsageBucketInfoResponse[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const shownBuckets = useMemo(() => buckets.slice(0, 6), [buckets])
  const data = useMemo(
    () =>
      shownBuckets.map((bucket) => ({
        name: bucket.label ?? bucket.key,
        bucket,
        ...costSplit(bucket),
        total: sumDecimals(Object.values(costSplit(bucket))),
      })),
    [shownBuckets],
  )
  const bands = presentCosts(data)
  const maximum = data.reduce(
    (current, row) => (compareDecimals(row.total, current) > 0 ? row.total : current),
    ZERO_DECIMAL,
  )
  const qualifier = costQualifier(
    shownBuckets.reduce((sum, bucket) => sum + bucket.unpriced_messages + nonLocalMessages(bucket), 0),
    shownBuckets.reduce((sum, bucket) => sum + bucket.estimated_messages, 0),
  )
  if (data.length === 0 || bands.length === 0 || compareDecimals(maximum, ZERO_DECIMAL) === 0) {
    return (
      <p data-slot="cost-bars-empty" className="m-usage-settings__note">
        {t('settings.usage.noPricedCost')}
      </p>
    )
  }
  return (
    <>
      <Legend bands={bands} />
      {qualifier !== 'exact' && (
        <p data-slot="cost-bars-note" className="m-usage-settings__note">
          {t(
            qualifier === 'partial_estimate'
              ? 'settings.usage.costChartPartialEstimate'
              : qualifier === 'estimated'
                ? 'settings.usage.costChartEstimated'
                : 'settings.usage.costChartLowerBound',
          )}
        </p>
      )}
      {/* Widths are exact decimal percentages. Passing raw costs to Recharts
          would coerce them through IEEE-754 before the first pixel was drawn. */}
      <div className="m-usage-settings__bars" data-slot="cost-bars">
        {data.map((row) => (
          <div key={row.bucket.key} data-slot="cost-bar-row" className="m-usage-settings__bar-row">
            <Hint className="m-usage-settings__bar-label" label={row.name}>
              {row.name}
            </Hint>
            <div
              data-slot="cost-bar"
              className="m-usage-settings__bar"
              role="img"
              aria-label={`${row.name}: ${formatCostAmount(row.total, bucketCostQualifier(row.bucket), locale)}`}
            >
              {bands.map((band) => {
                const amount = row[band.key]
                if (compareDecimals(amount, ZERO_DECIMAL) === 0) return null
                return (
                  <Hint
                    key={band.key}
                    focusable={false}
                    className="m-usage-settings__bar-seg"
                    style={{ width: decimalPercent(amount, maximum), backgroundColor: band.color }}
                    label={`${t(band.labelKey)}: ${formatCostAmount(
                      amount,
                      componentQualifier(row.bucket, band.key),
                      locale,
                    )}`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Built from the same `bands` the chart drew, or it starts naming a series
 * that is not there.
 */
function Legend({ bands }: { bands: readonly { key: string; color: string; labelKey: string }[] }) {
  const { t } = useTranslation()
  return (
    <div data-slot="chart-legend" className="m-usage-settings__legend">
      {bands.map((band) => (
        <span key={band.key} data-slot="chart-legend-item" className="m-usage-settings__legend-item">
          <span
            data-slot="chart-legend-swatch"
            aria-hidden="true"
            className="m-usage-settings__swatch"
            style={{ backgroundColor: band.color }}
          />
          <span data-slot="chart-legend-label" className="m-usage-settings__legend-label">
            {t(band.labelKey)}
          </span>
        </span>
      ))}
    </div>
  )
}

interface UsageGridRow extends UsageBucketInfoResponse {
  rowId: string
  displayLabel: string
  isDeleted: boolean
  conversationId: string | null
  conversationTitle: string | null
  conversationCount: number
  isConversationInstance: boolean
  sourceIndex: number
  children?: UsageGridRow[]
}

function shortConversationId(id: string): string {
  return /^[0-9a-f]{8}-/i.test(id) ? id.slice(0, 8) : id
}

/**
 * Merge equal visible titles before the twelve-row limit is applied.
 *
 * Each child is still the backend's already-priced conversation bucket. The
 * parent only adds disjoint buckets; it never tries to price their token totals.
 * Deleted conversations stay independent because "Deleted" is a state, not a
 * title those conversations shared while they existed.
 */
function conversationRows(
  buckets: UsageBucketInfoResponse[],
  deletedLabel: string,
  instanceLabel: (id: string) => string,
): UsageGridRow[] {
  const rows: UsageGridRow[] = []
  const groups = new Map<string, UsageGridRow[]>()

  buckets.forEach((bucket, sourceIndex) => {
    // `Some("")` still means the conversation row exists. It has no useful
    // title, so its full id is both the visible fallback and the grouping key;
    // only SQL NULL means the conversation has been deleted.
    const visibleTitle = bucket.label || bucket.key
    const row: UsageGridRow = {
      ...bucket,
      rowId: `conversation:${bucket.key}`,
      displayLabel: bucket.label === null ? deletedLabel : visibleTitle,
      isDeleted: bucket.label === null,
      conversationId: bucket.label === null ? null : bucket.key,
      conversationTitle: bucket.label === null ? null : visibleTitle,
      conversationCount: 1,
      isConversationInstance: false,
      sourceIndex,
    }
    if (bucket.label === null) {
      rows.push(row)
      return
    }
    const group = groups.get(visibleTitle)
    if (group) group.push(row)
    else groups.set(visibleTitle, [row])
  })

  for (const [title, matches] of groups) {
    if (matches.length === 1) {
      rows.push(matches[0])
      continue
    }
    const children = matches.map((row) => ({
      ...row,
      displayLabel: instanceLabel(row.key),
      isConversationInstance: true,
    }))
    rows.push({
      key: `group:${matches[0].key}`,
      label: title,
      messages: matches.reduce((sum, row) => sum + row.messages, 0),
      metered_messages: matches.reduce((sum, row) => sum + row.metered_messages, 0),
      subscription_messages: matches.reduce((sum, row) => sum + row.subscription_messages, 0),
      external_messages: matches.reduce((sum, row) => sum + row.external_messages, 0),
      missing_token_usage_messages: matches.reduce((sum, row) => sum + row.missing_token_usage_messages, 0),
      incomplete_token_usage_messages: matches.reduce((sum, row) => sum + row.incomplete_token_usage_messages, 0),
      missing_input_messages: matches.reduce((sum, row) => sum + row.missing_input_messages, 0),
      input_tokens: matches.reduce((sum, row) => sum + row.input_tokens, 0),
      output_tokens: matches.reduce((sum, row) => sum + row.output_tokens, 0),
      cache_read_tokens: matches.reduce((sum, row) => sum + row.cache_read_tokens, 0),
      cache_write_tokens: matches.reduce((sum, row) => sum + row.cache_write_tokens, 0),
      reported_input_tokens: matches.reduce((sum, row) => sum + row.reported_input_tokens, 0),
      reported_input_cache_read_tokens: matches.reduce((sum, row) => sum + row.reported_input_cache_read_tokens, 0),
      cache_reported_input_tokens: matches.reduce((sum, row) => sum + row.cache_reported_input_tokens, 0),
      cache_reported_input_cache_read_tokens: matches.reduce(
        (sum, row) => sum + row.cache_reported_input_cache_read_tokens,
        0,
      ),
      cache_reported_input_messages: matches.reduce((sum, row) => sum + row.cache_reported_input_messages, 0),
      input_cost: sumDecimals(matches.map((row) => row.input_cost)),
      output_cost: sumDecimals(matches.map((row) => row.output_cost)),
      cache_cost: sumDecimals(matches.map((row) => row.cache_cost)),
      tool_cost: sumDecimals(matches.map((row) => row.tool_cost)),
      total_cost: sumDecimals(matches.map((row) => row.total_cost)),
      unpriced_token_messages: matches.reduce((sum, row) => sum + row.unpriced_token_messages, 0),
      unpriced_tool_messages: matches.reduce((sum, row) => sum + row.unpriced_tool_messages, 0),
      estimated_token_messages: matches.reduce((sum, row) => sum + row.estimated_token_messages, 0),
      estimated_tool_messages: matches.reduce((sum, row) => sum + row.estimated_tool_messages, 0),
      estimated_messages: matches.reduce((sum, row) => sum + row.estimated_messages, 0),
      unpriced_messages: matches.reduce((sum, row) => sum + row.unpriced_messages, 0),
      rowId: `conversation-group:${matches[0].key}`,
      displayLabel: title,
      isDeleted: false,
      conversationId: null,
      conversationTitle: title,
      conversationCount: matches.length,
      isConversationInstance: false,
      sourceIndex: matches[0].sourceIndex,
      children,
    })
  }

  // The backend ranks individual buckets by cost. Once several of those are
  // one visible row, its combined cost is the value that must determine rank.
  return rows
    .sort(
      (a, b) =>
        compareDecimals(b.total_cost, a.total_cost) ||
        b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens) ||
        a.sourceIndex - b.sourceIndex,
    )
    .slice(0, 12)
}

interface FlatUsageRow {
  item: UsageGridRow
  key: string
  level: number
  hasChildren: boolean
  expanded: boolean
  setSize: number
  posInSet: number
}

/** The ranked rows under the charts, with the selected dimension as the row header. */
function BucketTable({
  buckets,
  dimension,
  dimensionLabel,
  isLoading,
  onOpenConversation,
}: {
  buckets: UsageBucketInfoResponse[]
  dimension: Breakdown
  dimensionLabel: string
  isLoading: boolean
  onOpenConversation: (conversationId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(() => new Set())
  const tableRef = useRef<HTMLTableElement>(null)
  const isTree = dimension === 'conversation'

  const rows = useMemo<UsageGridRow[]>(() => {
    if (dimension === 'conversation') {
      return conversationRows(buckets, t('settings.usage.deleted'), (id) =>
        t('settings.usage.conversationInstance', { id: shortConversationId(id) }),
      )
    }
    return buckets.slice(0, 12).map((bucket, sourceIndex) => {
      // Only named OneBot sources can be deleted. Bot rows deliberately carry
      // the account number as their key and no label, while an empty bot/source
      // key is ordinary desktop traffic.
      const isDeleted = !bucket.label && dimension === 'source' && bucket.key !== ''
      const displayLabel =
        bucket.label ??
        (dimension === 'kind'
          ? t(`settings.usage.kind.${bucket.key}`)
          : dimension === 'bot' && bucket.key
            ? bucket.key
            : dimension === 'source' && bucket.key
              ? t('settings.usage.deleted')
              : t('settings.usage.origin.desktop'))
      return {
        ...bucket,
        rowId: `${dimension}:${bucket.key}`,
        displayLabel,
        isDeleted,
        conversationId: null,
        conversationTitle: null,
        conversationCount: 1,
        isConversationInstance: false,
        sourceIndex,
      }
    })
  }, [buckets, dimension, t])

  const flatRows = useMemo<FlatUsageRow[]>(() => {
    if (!isTree) return []
    const out: FlatUsageRow[] = []
    rows.forEach((item, index) => {
      const children = item.children
      const hasChildren = Boolean(children && children.length > 0)
      const expanded = hasChildren && expandedKeys.has(item.rowId)
      out.push({
        item,
        key: item.rowId,
        level: 1,
        hasChildren,
        expanded,
        setSize: rows.length,
        posInSet: index + 1,
      })
      if (expanded && children) {
        children.forEach((child, childIndex) => {
          out.push({
            item: child,
            key: child.rowId,
            level: 2,
            hasChildren: false,
            expanded: false,
            setSize: children.length,
            posInSet: childIndex + 1,
          })
        })
      }
    })
    return out
  }, [isTree, rows, expandedKeys])

  const toggle = useCallback((key: Key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  useEffect(() => {
    if (isTree && tableRef.current) tableRef.current.setAttribute('role', 'treegrid')
  }, [isTree, flatRows.length])

  const renderLabel = useCallback(
    (row: UsageGridRow) =>
      row.conversationCount > 1 ? (
        <span data-slot="usage-row-label-group" className="m-usage-settings__row-group">
          <span data-slot="usage-row-label" onPointerEnter={titleIfTruncated} className="m-usage-settings__row-label">
            {row.displayLabel}
          </span>
          <span data-slot="usage-row-label-summary" className="m-usage-settings__row-summary">
            {t('settings.usage.conversationGroupSummary', {
              conversations: row.conversationCount,
              messages: row.messages,
            })}
          </span>
        </span>
      ) : (
        <Hint
          focusable={false}
          className="m-usage-settings__row-label"
          data-muted={row.isDeleted || row.isConversationInstance || undefined}
          data-deleted={row.isDeleted || undefined}
          label={row.isConversationInstance ? (row.conversationId ?? row.displayLabel) : row.displayLabel}
        >
          {row.displayLabel}
        </Hint>
      ),
    [t],
  )

  const renderCost = useCallback(
    (row: UsageGridRow) => {
      const qualifier = bucketCostQualifier(row)
      const localQualifier = costQualifier(row.unpriced_messages, row.estimated_messages)
      const pricingTitle =
        localQualifier === 'partial_estimate'
          ? t('settings.usage.partialEstimate', {
              estimated: row.estimated_messages,
              unpriced: row.unpriced_messages,
            })
          : localQualifier === 'estimated'
            ? t('settings.usage.estimated', { count: row.estimated_messages })
            : localQualifier === 'lower_bound'
              ? t('settings.usage.unpriced', { count: row.unpriced_messages })
              : undefined
      const hint = [pricingTitle, billingCoverage(row, t)].filter(Boolean).join(' ')
      if (!hint)
        return (
          <span
            data-slot="usage-row-cost"
            className="m-usage-settings__cell-strong"
            data-muted={qualifier !== 'exact' || undefined}
          >
            {displayedCost(row, t, locale)}
          </span>
        )
      return (
        <Hint
          focusable={false}
          className="m-usage-settings__cell-strong"
          data-muted={qualifier !== 'exact' || undefined}
          label={hint}
        >
          {displayedCost(row, t, locale)}
        </Hint>
      )
    },
    [locale, t],
  )

  const renderAction = useCallback(
    (row: UsageGridRow) => {
      if (!row.conversationId) return null
      const conversationId = row.conversationId
      const label = t('settings.usage.openConversation', {
        title: row.conversationTitle || conversationId,
        // The visual child label is allowed to abbreviate a UUID. The
        // accessible name is not: two conversations can share that prefix.
        id: conversationId,
      })
      return (
        <TooltipTrigger>
          <Button
            icon={<SquareArrowUpRight />}
            size="sm"
            variant="ghost"
            aria-label={label}
            onPress={() => onOpenConversation(conversationId)}
          />
          <Tooltip placement="left">{label}</Tooltip>
        </TooltipTrigger>
      )
    },
    [onOpenConversation, t],
  )

  const columns = useMemo<DataTableColumn<UsageGridRow>[]>(
    () => [
      {
        id: 'label',
        header: dimensionLabel,
        isRowHeader: true,
        cell: renderLabel,
      },
      {
        id: 'tokens',
        header: t('settings.usage.tokenColumn'),
        align: 'end',
        width: 120,
        cell: (row) => (
          <span className="m-usage-settings__cell">
            {tokenTotal(row.input_tokens + row.output_tokens, row, t, compact)}
          </span>
        ),
      },
      {
        id: 'cost',
        header: t('settings.usage.kpi.cost'),
        align: 'end',
        width: 120,
        cell: renderCost,
      },
    ],
    [compact, dimensionLabel, renderCost, renderLabel, t],
  )

  if (!isTree) {
    return (
      <DataTable<UsageGridRow>
        aria-label={`${t('settings.usage.breakdown')}: ${dimensionLabel}`}
        size="sm"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.rowId}
        isLoading={isLoading}
        renderEmptyState={() => <span data-slot="usage-grid-empty">{t('settings.usage.empty')}</span>}
      />
    )
  }

  return (
    <Table
      ref={tableRef}
      aria-label={`${t('settings.usage.breakdown')}: ${dimensionLabel}`}
      size="sm"
      isLoading={isLoading}
    >
      <TableHeader>
        <Column id="label" isRowHeader>
          {dimensionLabel}
        </Column>
        <Column id="tokens" data-align="end">
          {t('settings.usage.tokenColumn')}
        </Column>
        <Column id="cost" data-align="end">
          {t('settings.usage.kpi.cost')}
        </Column>
        <Column id="actions" data-align="end">
          {t('settings.usage.actionColumn')}
        </Column>
      </TableHeader>
      <TableBody
        items={flatRows}
        renderEmptyState={() => <span data-slot="usage-grid-empty">{t('settings.usage.empty')}</span>}
      >
        {(flatRow) => (
          <Row
            id={flatRow.key}
            aria-level={flatRow.level}
            aria-expanded={flatRow.hasChildren ? flatRow.expanded : undefined}
            aria-setsize={flatRow.setSize}
            aria-posinset={flatRow.posInSet}
          >
            <Cell>
              <div className="m-usage-settings__tree-cell" data-level={flatRow.level}>
                {flatRow.hasChildren ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t(flatRow.expanded ? 'dataGrid.collapseRow' : 'dataGrid.expandRow', {
                      label: flatRow.item.displayLabel,
                    })}
                    icon={
                      <span className="m-usage-settings__expand-icon" data-expanded={flatRow.expanded || undefined}>
                        <ChevronRight size={14} aria-hidden />
                      </span>
                    }
                    onPress={() => toggle(flatRow.key)}
                  />
                ) : (
                  <span aria-hidden="true" className="m-usage-settings__tree-spacer" />
                )}
                <div className="m-usage-settings__tree-content">{renderLabel(flatRow.item)}</div>
              </div>
            </Cell>
            <Cell data-align="end">
              <span className="m-usage-settings__cell">
                {tokenTotal(flatRow.item.input_tokens + flatRow.item.output_tokens, flatRow.item, t, compact)}
              </span>
            </Cell>
            <Cell data-align="end">{renderCost(flatRow.item)}</Cell>
            <Cell data-align="end">{renderAction(flatRow.item)}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  )
}

export default UsageSettings
