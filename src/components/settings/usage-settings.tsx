import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Label, Skeleton, Spinner, Tabs, Tooltip } from '@heroui/react'
import { EmptyState } from '@/components/base'
import { KPI } from '@heroui-pro/react/kpi'
import { AreaChart } from '@heroui-pro/react/area-chart'
import { DataGrid, type DataGridColumn } from '@heroui-pro/react/data-grid'
import { ArrowRightFromSquare } from '@gravity-ui/icons'

import { api } from '@/api'
import { costQualifier, formatCostAmount, type CostQualifier } from '@/lib/cost-format'
import { compareDecimals, decimal, decimalPercent, sumDecimals, type DecimalString } from '@/lib/decimal'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/ui/hint'
import { SettingsHeader, SettingsPane } from './primitives'
import type { UsageBucketInfoResponse, UsageDimension, UsageReportRequest } from '@/types'

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
const BREAKDOWNS = ['conversation', 'source', 'bot', 'kind'] as const
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
 * Blue and cyan for the two halves of the prompt, so they read as parts of one
 * thing; magenta for the reply, which is the other thing.
 */
const SERIES = [
  { key: 'uncached', color: 'var(--chart-3)', labelKey: 'settings.usage.legend.uncached' },
  { key: 'cacheRead', color: 'var(--chart-2)', labelKey: 'settings.usage.legend.cacheRead' },
  { key: 'cacheWrite', color: 'var(--chart-1)', labelKey: 'settings.usage.legend.cacheWrite' },
  { key: 'output', color: 'var(--chart-4)', labelKey: 'settings.usage.legend.output' },
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
  { key: 'input_cost', color: 'var(--chart-3)', labelKey: 'settings.usage.cost.input' },
  { key: 'cache_cost', color: 'var(--chart-2)', labelKey: 'settings.usage.cost.cache' },
  { key: 'output_cost', color: 'var(--chart-4)', labelKey: 'settings.usage.cost.output' },
  { key: 'tool_cost', color: 'var(--chart-1)', labelKey: 'settings.usage.cost.tools' },
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
  rows: UsageBucketInfoResponse[]
  rowsDimension: Breakdown
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
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
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
    const request = (dimension: UsageDimension): UsageReportRequest => ({
      dimension,
      sinceMs: range === null ? null : Date.now() - range * DAY_MS,
      untilMs: null,
      origin,
      conversationId: null,
    })
    // Five groupings in flight together. They are independent queries over the
    // same table, and running them in series would show the page filling in one
    // chart at a time.
    Promise.all([
      api.usageReport(request('total')),
      api.usageReport(request('day')),
      api.usageReport(request('provider')),
      api.usageReport(request('model')),
      api.usageReport(request(breakdown)),
    ])
      .then(([total, days, providers, models, rows]) => {
        if (cancelled) return
        setReport({ total: total[0] ?? EMPTY_TOTAL, days, providers, models, rows, rowsDimension: breakdown })
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
  // Of the prompt tokens that were sent, how many the upstream already had.
  // Zero prompt tokens is not a 0% hit rate — it is no data — so the card shows
  // a dash rather than a number nobody earned.
  const hitRate =
    total.incomplete_token_usage_messages === 0 && total.input_tokens > 0
      ? total.cache_read_tokens / total.input_tokens
      : null

  return (
    <SettingsPane className="max-w-4xl">
      <SettingsHeader title={t('settings.usage.title')} subtitle={t('settings.usage.subtitle')} />

      <div data-slot="usage-filters" className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
        {loading && report && <Spinner size="sm" className="self-end" aria-label={t('common.loading')} />}
      </div>

      {error && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              <Hint className="min-w-0 break-words" label={error}>
                {t('settings.usage.loadError')}
              </Hint>
            </Alert.Description>
            <Button size="sm" variant="outline" onPress={() => setReload((value) => value + 1)}>
              {t('settings.usage.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      )}

      {!report && loading ? (
        <UsageSkeleton />
      ) : !report ? null : total.messages === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>{t('settings.usage.empty')}</EmptyState.Title>
            <EmptyState.Description>{t('settings.usage.emptyHint')}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <>
          <div data-slot="usage-kpis" className="grid grid-cols-1 @sm/pane:grid-cols-2 @2xl/pane:grid-cols-4 gap-3">
            <Kpi title={t('settings.usage.kpi.cost')}>
              <span
                data-slot="cost-total"
                className="block truncate text-2xl font-semibold tracking-tight tabular-nums"
              >
                {displayedCost(total, t, locale)}
              </span>
            </Kpi>
            {/* The count is formatted before it goes in, not by i18next: passing
                the raw number leaves it ungrouped, and "13830144" sitting under
                "1514.9万" reads as two different quantities. */}
            <Kpi title={t('settings.usage.kpi.input')} note={tokenNote}>
              <span data-slot="input-total" className="block truncate text-2xl font-semibold tracking-tight">
                {tokenTotal(total.input_tokens, total, t, compact)}
              </span>
            </Kpi>
            <Kpi title={t('settings.usage.kpi.output')}>
              <span data-slot="output-total" className="block truncate text-2xl font-semibold tracking-tight">
                {tokenTotal(total.output_tokens, total, t, compact)}
              </span>
            </Kpi>
            <Kpi
              title={t('settings.usage.kpi.cacheRate')}
              note={t('settings.usage.kpi.replies', { count: total.messages })}
            >
              <span data-slot="cache-rate" className="block truncate text-2xl font-semibold tracking-tight">
                {hitRate === null ? '—' : percent.format(hitRate)}
              </span>
            </Kpi>
          </div>

          {localQualifier !== 'exact' && (
            <p
              data-slot={total.unpriced_messages > 0 ? 'unpriced-warning' : 'estimated-warning'}
              className={cn('text-xs', total.unpriced_messages > 0 ? 'text-warning' : 'text-muted')}
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
          {billingNote && (
            <p data-slot="billing-coverage-warning" className="text-xs text-muted">
              {billingNote}
            </p>
          )}

          <CostBreakdown bucket={total} />

          <Section title={t('settings.usage.trend')}>
            <TokenTrend days={report?.days ?? []} />
          </Section>

          <div data-slot="usage-cost-charts" className="grid gap-6 @2xl/pane:grid-cols-2">
            <Section title={t('settings.usage.byProvider')}>
              <CostBars buckets={report?.providers ?? []} />
            </Section>
            <Section title={t('settings.usage.byModel')}>
              <CostBars buckets={report?.models ?? []} />
            </Section>
          </div>

          {/* The one place on this page where the tabs really do switch the
              content beneath them, so this one has panels. Only the selected
              panel renders, and `rows` is that dimension's data — the fetch is
              keyed on the same state the tab is. */}
          <section data-slot="usage-breakdown" className="space-y-2">
            <h3 data-slot="usage-breakdown-title" className="text-sm font-medium">
              {t('settings.usage.breakdown')}
            </h3>
            <Tabs selectedKey={breakdown} onSelectionChange={(key) => setBreakdown(key as Breakdown)}>
              <Tabs.ListContainer className="w-fit">
                <Tabs.List aria-label={t('settings.usage.breakdown')}>
                  {BREAKDOWNS.map((value) => (
                    <Tabs.Tab key={value} id={value} className={TAB}>
                      {t(`settings.usage.by.${value}`)}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
              {BREAKDOWNS.map((value) => (
                <Tabs.Panel key={value} id={value} className="p-0">
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
                </Tabs.Panel>
              ))}
            </Tabs>
          </section>
        </>
      )}
    </SettingsPane>
  )
}

/**
 * `.tabs__tab` is `w-full`, which in a flex row makes every tab claim the whole
 * width and then shrink to an equal share — so a two-word label wraps mid-label
 * ("近 7 / 天") rather than the row growing. `whitespace-nowrap` lets the list's
 * own `w-max` do what it was already trying to do. Overriding the width instead
 * would give up the equal-width behaviour, which is what makes the pill look
 * like a segmented control at all.
 */
const TAB = 'whitespace-nowrap'

/**
 * One filter, as a labelled segmented control. These choices narrow the page;
 * they do not switch a tab panel, so they should not expose tab semantics.
 *
 * `w-fit` on the container because the pill is `bg-default` and stretches to
 * whatever it is given; in a flex row that is the whole remaining width.
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
    <div data-slot="usage-filter" className="space-y-1.5">
      <Label className="text-xs text-muted">{label}</Label>
      <div
        data-slot="usage-filter-group"
        role="group"
        aria-label={label}
        className="flex w-fit rounded-xl bg-default p-1"
      >
        {items.map(([id, text]) => (
          <Button
            key={id}
            size="sm"
            variant={selectedKey === id ? 'secondary' : 'ghost'}
            aria-pressed={selectedKey === id}
            className={TAB}
            onPress={() => onChange(id)}
          >
            {text}
          </Button>
        ))}
      </div>
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
      className="space-y-6"
    >
      <div
        data-slot="usage-skeleton-kpis"
        className="grid grid-cols-1 @sm/pane:grid-cols-2 @2xl/pane:grid-cols-4 gap-3"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[200px] w-full rounded-lg" />
      <div data-slot="usage-skeleton-charts" className="grid gap-6 @2xl/pane:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}

/**
 * A figure with a caption.
 *
 * Pro's `KPI.Value` renders through `NumberValue`, which takes a number and
 * formats it with `Intl` — right for a count and wrong for the two figures here
 * that are not plain numbers (a cost with no currency, a rate that can be "no
 * data"). So the value slot takes a node and the card keeps everything else.
 */
function Kpi({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <KPI className="rounded-lg border border-border">
      <KPI.Header>
        <KPI.Title>{title}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        {/* `min-w-0` here and `block truncate` on each value: `.kpi__content` is
            a `1fr auto` grid, so without the floor this column never narrows,
            and `truncate` does nothing to an inline span. A cost carries up to
            six decimals, which is a long string at `text-2xl` —
            it used to be drawn straight out through the side of the card. */}
        <div data-slot="kpi-body" className="min-w-0">
          {children}
          {note && (
            <p data-slot="kpi-note" className="mt-0.5 truncate text-xs text-muted">
              {note}
            </p>
          )}
        </div>
      </KPI.Content>
    </KPI>
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
    <section data-slot="cost-breakdown" className="space-y-2" aria-labelledby="usage-cost-breakdown-title">
      <div data-slot="cost-breakdown-header" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 data-slot="cost-breakdown-title" id="usage-cost-breakdown-title" className="text-sm font-medium">
          {t('settings.usage.costBreakdown')}
        </h3>
        {note && (
          <span data-slot="cost-breakdown-note" className="text-xs text-muted">
            {note}
          </span>
        )}
      </div>
      {bucket.metered_messages === 0 && nonLocalMessages(bucket) > 0 ? (
        <p data-slot="cost-breakdown-empty" className="text-sm text-muted">
          {t('settings.usage.noLocalCostBreakdown')}
        </p>
      ) : (
        <dl data-slot="cost-breakdown-list" className="grid grid-cols-2 gap-x-6 gap-y-3 @sm/pane:grid-cols-4">
          {COST_SERIES.map((part) => (
            <div key={part.key} data-slot="cost-breakdown-part" className="min-w-0">
              <dt data-slot="cost-breakdown-part-label" className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  data-slot="cost-breakdown-swatch"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: part.color }}
                  aria-hidden="true"
                />
                <span data-slot="cost-breakdown-part-name" className="truncate">
                  {t(part.labelKey)}
                </span>
              </dt>
              <dd data-slot="cost-breakdown-part-value" className="mt-0.5 truncate text-sm font-medium tabular-nums">
                {qualifiedCost(bucket[part.key], componentQualifier(bucket, part.key), t, locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-slot="usage-section" className="space-y-2">
      <h3 data-slot="usage-section-title" className="text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * Tokens per day, input stacked under output.
 *
 * Tokens rather than cost, because a model nobody has priced still produced
 * them — a cost chart would be flat and blank on a fresh install and read as
 * the feature being broken rather than as prices being unset.
 */
function TokenTrend({ days }: { days: UsageBucketInfoResponse[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
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
    <>
      <Legend bands={bands} />
      <AreaChart data={data} height={200}>
        <defs>
          {bands.map((band) => (
            <linearGradient key={band.key} id={`usage-fill-${band.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={band.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={band.color} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <AreaChart.Grid vertical={false} />
        <AreaChart.XAxis dataKey="day" tickMargin={8} />
        <AreaChart.YAxis width={44} tickFormatter={(v: number) => compact.format(v)} />
        {bands.map((band) => (
          <AreaChart.Area
            key={band.key}
            dataKey={band.key}
            dot={false}
            fill={`url(#usage-fill-${band.key})`}
            name={t(band.labelKey)}
            stackId="tokens"
            stroke={band.color}
            strokeWidth={2}
            type="monotone"
          />
        ))}
        <AreaChart.Tooltip
          content={<AreaChart.TooltipContent indicator="line" valueFormatter={(v) => compact.format(Number(v))} />}
        />
      </AreaChart>
    </>
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
      <p data-slot="cost-bars-empty" className="text-sm text-muted">
        {t('settings.usage.noPricedCost')}
      </p>
    )
  }
  return (
    <>
      <Legend bands={bands} />
      {qualifier !== 'exact' && (
        <p data-slot="cost-bars-note" className="text-xs text-muted">
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
      <div className="space-y-2.5" data-slot="cost-bars">
        {data.map((row) => (
          <div
            key={row.bucket.key}
            data-slot="cost-bar-row"
            className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] items-center gap-2"
          >
            <Hint className="max-w-40 truncate text-xs text-muted" label={row.name}>
              {row.name}
            </Hint>
            <div
              data-slot="cost-bar"
              className="flex h-3.5 min-w-0 overflow-hidden rounded-lg bg-default"
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
                    className="block h-full first:rounded-s-lg last:rounded-e-lg"
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
 * Pro's charts ship no legend part and do not re-export recharts', so this is
 * the shape its own examples use — and it has to be built from the same `bands`
 * the chart drew, or it starts naming a series that is not there.
 */
function Legend({ bands }: { bands: readonly { key: string; color: string; labelKey: string }[] }) {
  const { t } = useTranslation()
  return (
    <div data-slot="usage-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {bands.map((band) => (
        <span key={band.key} data-slot="usage-legend-item" className="flex items-center gap-1.5">
          <span
            data-slot="usage-legend-swatch"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: band.color }}
          />
          <span data-slot="usage-legend-label" className="text-xs text-muted">
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
      input_tokens: matches.reduce((sum, row) => sum + row.input_tokens, 0),
      output_tokens: matches.reduce((sum, row) => sum + row.output_tokens, 0),
      cache_read_tokens: matches.reduce((sum, row) => sum + row.cache_read_tokens, 0),
      cache_write_tokens: matches.reduce((sum, row) => sum + row.cache_write_tokens, 0),
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

  const columns = useMemo<DataGridColumn<UsageGridRow>[]>(() => {
    const result: DataGridColumn<UsageGridRow>[] = [
      {
        id: 'label',
        header: dimensionLabel,
        isRowHeader: true,
        minWidth: 240,
        cell: (row) =>
          row.conversationCount > 1 ? (
            <span data-slot="usage-row-label-group" className="block min-w-0">
              <span data-slot="usage-row-label" className="block truncate text-sm">
                {row.displayLabel}
              </span>
              <span data-slot="usage-row-label-summary" className="block truncate text-xs text-muted">
                {t('settings.usage.conversationGroupSummary', {
                  conversations: row.conversationCount,
                  messages: row.messages,
                })}
              </span>
            </span>
          ) : (
            <Hint
              focusable={false}
              className={cn(
                'block truncate text-sm',
                row.isDeleted && 'text-muted italic',
                row.isConversationInstance && 'text-muted',
              )}
              label={row.isConversationInstance ? (row.conversationId ?? row.displayLabel) : row.displayLabel}
            >
              {row.displayLabel}
            </Hint>
          ),
      },
      {
        id: 'tokens',
        header: t('settings.usage.tokenColumn'),
        align: 'end',
        width: 136,
        minWidth: 120,
        headerClassName: 'whitespace-nowrap',
        cellClassName: 'whitespace-nowrap text-xs text-muted tabular-nums',
        cell: (row) => tokenTotal(row.input_tokens + row.output_tokens, row, t, compact),
      },
      {
        id: 'cost',
        header: t('settings.usage.kpi.cost'),
        align: 'end',
        width: 144,
        minWidth: 112,
        pinned: dimension === 'conversation' ? undefined : 'end',
        headerClassName: 'whitespace-nowrap',
        cellClassName: 'whitespace-nowrap text-sm tabular-nums',
        cell: (row) => {
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
              <span data-slot="usage-row-cost" className={cn(qualifier !== 'exact' && 'text-muted')}>
                {displayedCost(row, t, locale)}
              </span>
            )
          return (
            <Hint focusable={false} className={cn(qualifier !== 'exact' && 'text-muted')} label={hint}>
              {displayedCost(row, t, locale)}
            </Hint>
          )
        },
      },
    ]
    if (dimension === 'conversation') {
      result.push({
        id: 'actions',
        header: t('settings.usage.actionColumn'),
        align: 'end',
        width: 88,
        minWidth: 80,
        pinned: 'end',
        headerClassName: 'whitespace-nowrap',
        cell: (row) => {
          if (!row.conversationId) return null
          const conversationId = row.conversationId
          const label = t('settings.usage.openConversation', {
            title: row.conversationTitle || conversationId,
            // The visual child label is allowed to abbreviate a UUID. The
            // accessible name is not: two conversations can share that prefix.
            id: conversationId,
          })
          return (
            <Tooltip>
              <Button isIconOnly variant="ghost" aria-label={label} onPress={() => onOpenConversation(conversationId)}>
                <ArrowRightFromSquare className="size-4" />
              </Button>
              <Tooltip.Content placement="left">{label}</Tooltip.Content>
            </Tooltip>
          )
        },
      })
    }
    return result
  }, [compact, dimension, dimensionLabel, locale, onOpenConversation, t])

  return (
    <DataGrid<UsageGridRow>
      aria-label={`${t('settings.usage.breakdown')}: ${dimensionLabel}`}
      variant="secondary"
      columns={columns}
      data={rows}
      getRowId={(row) => row.rowId}
      getChildren={dimension === 'conversation' ? (row) => row.children : undefined}
      treeColumn={dimension === 'conversation' ? 'label' : undefined}
      renderEmptyState={() =>
        isLoading ? (
          <Spinner size="sm" aria-label={t('common.loading')} />
        ) : (
          <span data-slot="usage-grid-empty">{t('settings.usage.empty')}</span>
        )
      }
      // The named column must keep room for long conversation and model ids.
      // A conversation also has an action column; on a narrow pane the grid
      // scrolls instead of crushing them or widening the settings page itself.
      contentClassName={dimension === 'conversation' ? 'min-w-[38rem]' : 'min-w-[32rem]'}
      scrollContainerClassName="overflow-x-auto overscroll-contain"
    />
  )
}

export default UsageSettings
