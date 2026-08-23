import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label, Skeleton, Spinner, Tabs } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { KPI } from '@heroui-pro/react/kpi'
import { AreaChart } from '@heroui-pro/react/area-chart'
import { BarChart } from '@heroui-pro/react/bar-chart'

import { api } from '@/api'
import { cn } from '@/lib/utils'
import { SettingsHeader, SettingsPane } from './primitives'
import type { UsageBucket, UsageFilter } from '@/types'

/**
 * What the assistant has cost, out of the audit log.
 *
 * Every figure on this page is computed in Rust — see
 * `src-tauri/src/db/ops/usage.rs`. Nothing here adds up a cost, and it must stay
 * that way: a cached token bills at the cache rate *instead of* the input rate,
 * so the cost of a group is not the sum of the costs of its parts under any
 * arithmetic available to this file. What it does is ask for one grouping per
 * view and draw what comes back.
 *
 * The one number this page is responsible for not lying about is the total.
 * `unpriced_messages` counts replies from models nobody has priced; their tokens
 * are in the counts and their cost is in nobody's total, so the cost is shown
 * with that caveat attached rather than on its own.
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
 * A bucket's tokens, split into the four bands.
 *
 * Saturating, like `BilledTokens::from_totals` on the other side: a provider
 * that reports more cached tokens than prompt tokens is contradicting itself,
 * and the answer to that is a zero band rather than a bar drawn below the axis.
 */
function split(bucket: UsageBucket): Split {
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

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Cost carries no currency symbol on purpose: the prices are whatever the user
 * typed into the provider editor, in whatever currency they were quoting, and
 * nothing records which. Four decimals because a single cheap reply rounds to
 * zero at two, and a column of zeroes reads as broken.
 */
const money = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

interface Report {
  total: UsageBucket
  days: UsageBucket[]
  providers: UsageBucket[]
  models: UsageBucket[]
  rows: UsageBucket[]
}

const EMPTY_TOTAL: UsageBucket = {
  key: '',
  label: null,
  messages: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost: 0,
  unpriced_messages: 0,
}

export function UsageSettings() {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>(30)
  const [origin, setOrigin] = useState<Origin>(null)
  const [breakdown, setBreakdown] = useState<Breakdown>('conversation')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Read here rather than in a memo over `range`: "the last 30 days" is
    // relative to the moment the query runs, and a clock read during render is
    // both impure and stale by the time anything uses it.
    const filter: UsageFilter = {
      since_ms: range === null ? null : Date.now() - range * DAY_MS,
      until_ms: null,
      origin,
    }
    // Five groupings in flight together. They are independent queries over the
    // same table, and running them in series would show the page filling in one
    // chart at a time.
    Promise.all([
      api.usageReport('total', filter),
      api.usageReport('day', filter),
      api.usageReport('provider', filter),
      api.usageReport('model', filter),
      api.usageReport(breakdown, filter),
    ])
      .then(([total, days, providers, models, rows]) => {
        if (cancelled) return
        setReport({ total: total[0] ?? EMPTY_TOTAL, days, providers, models, rows })
      })
      .catch(() => {
        if (!cancelled) setReport(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, origin, breakdown])

  const rangeLabel = useCallback(
    (value: Range) =>
      value === null ? t('settings.usage.range.all') : t('settings.usage.range.days', { count: value }),
    [t],
  )

  const total = report?.total ?? EMPTY_TOTAL
  // Of the prompt tokens that were sent, how many the upstream already had.
  // Zero prompt tokens is not a 0% hit rate — it is no data — so the card shows
  // a dash rather than a number nobody earned.
  const hitRate = total.input_tokens > 0 ? total.cache_read_tokens / total.input_tokens : null

  return (
    <SettingsPane className="max-w-4xl">
      <SettingsHeader title={t('settings.usage.title')} subtitle={t('settings.usage.subtitle')} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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

      {!report ? (
        <UsageSkeleton />
      ) : total.messages === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>{t('settings.usage.empty')}</EmptyState.Title>
            <EmptyState.Description>{t('settings.usage.emptyHint')}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 @sm/pane:grid-cols-2 @2xl/pane:grid-cols-4 gap-3">
            <Kpi title={t('settings.usage.kpi.cost')}>
              <span className="block truncate text-2xl font-semibold tracking-tight">{money.format(total.cost)}</span>
            </Kpi>
            {/* The count is formatted before it goes in, not by i18next: passing
                the raw number leaves it ungrouped, and "13830144" sitting under
                "1514.9万" reads as two different quantities. */}
            <Kpi
              title={t('settings.usage.kpi.input')}
              note={t('settings.usage.kpi.inputNote', {
                value: compact.format(total.cache_read_tokens),
              })}
            >
              <span className="block truncate text-2xl font-semibold tracking-tight">
                {compact.format(total.input_tokens)}
              </span>
            </Kpi>
            <Kpi title={t('settings.usage.kpi.output')}>
              <span className="block truncate text-2xl font-semibold tracking-tight">
                {compact.format(total.output_tokens)}
              </span>
            </Kpi>
            <Kpi
              title={t('settings.usage.kpi.cacheRate')}
              note={t('settings.usage.kpi.replies', { count: total.messages })}
            >
              <span className="block truncate text-2xl font-semibold tracking-tight">
                {hitRate === null ? '—' : `${(hitRate * 100).toFixed(1)}%`}
              </span>
            </Kpi>
          </div>

          {total.unpriced_messages > 0 && (
            <p data-slot="unpriced-warning" className="text-xs text-warning">
              {t('settings.usage.unpriced', { count: total.unpriced_messages })}
            </p>
          )}

          <Section title={t('settings.usage.trend')}>
            <TokenTrend days={report?.days ?? []} />
          </Section>

          <div className="grid gap-6 @2xl/pane:grid-cols-2">
            <Section title={t('settings.usage.byProvider')}>
              <TokenBars buckets={report?.providers ?? []} />
            </Section>
            <Section title={t('settings.usage.byModel')}>
              <TokenBars buckets={report?.models ?? []} />
            </Section>
          </div>

          {/* The one place on this page where the tabs really do switch the
              content beneath them, so this one has panels. Only the selected
              panel renders, and `rows` is that dimension's data — the fetch is
              keyed on the same state the tab is. */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('settings.usage.breakdown')}</h3>
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
                    buckets={report?.rows ?? []}
                    labelFor={value === 'kind' ? (key) => t(`settings.usage.kind.${key}`) : undefined}
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
 * One filter, as a labelled row of tabs.
 *
 * No `Tabs.Panel`: these two do not switch what is shown, they narrow what
 * every panel below is *about*. React Aria is fine with a tab list that
 * controls nothing — what it will not tolerate is a `Tab` whose `id` names a
 * panel that does not exist, which is why the ids here are never reused as
 * panel ids anywhere on the page.
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
    <div className="space-y-1.5">
      <Label className="text-xs text-muted">{label}</Label>
      <Tabs selectedKey={selectedKey} onSelectionChange={(key) => onChange(String(key))}>
        <Tabs.ListContainer className="w-fit">
          <Tabs.List aria-label={label}>
            {items.map(([id, text]) => (
              <Tabs.Tab key={id} id={id} className={TAB}>
                {text}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
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
    <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-6">
      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 @2xl/pane:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[200px] w-full rounded-lg" />
      <div className="grid gap-6 @2xl/pane:grid-cols-2">
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
            four decimals (see `money`), which is a long string at `text-2xl` —
            it used to be drawn straight out through the side of the card. */}
        <div className="min-w-0">
          {children}
          {note && <p className="mt-0.5 truncate text-xs text-muted">{note}</p>}
        </div>
      </KPI.Content>
    </KPI>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
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
function TokenTrend({ days }: { days: UsageBucket[] }) {
  const { t } = useTranslation()
  const data = useMemo(() => days.map((d) => ({ day: d.key.slice(5), ...split(d) })), [days])
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
function TokenBars({ buckets }: { buckets: UsageBucket[] }) {
  const { t } = useTranslation()
  const data = useMemo(() => buckets.slice(0, 6).map((b) => ({ name: b.label ?? b.key, ...split(b) })), [buckets])
  const bands = present(data)
  if (data.length === 0) return null
  return (
    <>
      <Legend bands={bands} />
      <BarChart data={data} height={Math.max(120, data.length * 34)} layout="vertical">
        <BarChart.XAxis hide type="number" />
        {/* `auto` rather than a fixed 110px, which is a third of the chart on a
            phone — recharts measures the labels and takes what they need. Model
            ids are long and the axis is what names the bars, so neither a fixed
            width that starves the bars nor one that truncates the names is the
            answer. */}
        <BarChart.YAxis dataKey="name" tickMargin={4} type="category" width="auto" />
        {bands.map((band, i) => (
          <BarChart.Bar
            key={band.key}
            barSize={14}
            dataKey={band.key}
            fill={band.color}
            name={t(band.labelKey)}
            stackId="tokens"
            radius={i === 0 ? [4, 0, 0, 4] : i === bands.length - 1 ? [0, 4, 4, 0] : undefined}
          />
        ))}
        <BarChart.Tooltip
          content={<BarChart.TooltipContent indicator="line" valueFormatter={(v) => compact.format(Number(v))} />}
        />
      </BarChart>
    </>
  )
}

/**
 * Pro's charts ship no legend part and do not re-export recharts', so this is
 * the shape its own examples use — and it has to be built from the same `bands`
 * the chart drew, or it starts naming a series that is not there.
 */
function Legend({ bands }: { bands: readonly (typeof SERIES)[number][] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {bands.map((band) => (
        <span key={band.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: band.color }} />
          <span className="text-xs text-muted">{t(band.labelKey)}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * The ranked list under the charts.
 *
 * A `grid` rather than a `table`: the rows carry no header semantics worth the
 * markup, and the same shape is already used for the log viewer. `tabular-nums`
 * on every figure, so the columns line up down the page.
 */
function BucketTable({ buckets, labelFor }: { buckets: UsageBucket[]; labelFor?: (key: string) => string }) {
  const { t } = useTranslation()
  if (buckets.length === 0) return null
  return (
    <div data-slot="usage-table" className="rounded-lg border border-border">
      {buckets.slice(0, 12).map((bucket, i) => (
        <div
          key={bucket.key}
          className={cn(
            'grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2',
            i > 0 && 'border-t border-border',
          )}
        >
          {/* `labelFor` is for dimensions whose keys are not ids and so carry
              no backend label — `kind`, whose keys are roles. Without it a row
              with no label reads as "deleted", which is right for a
              conversation that is gone and nonsense for a role that is not a
              thing that can be deleted. */}
          <span className={cn('truncate text-sm', !bucket.label && !labelFor && 'text-muted italic')}>
            {bucket.label ?? labelFor?.(bucket.key) ?? t('settings.usage.deleted')}
          </span>
          <span className="text-xs text-muted tabular-nums">
            {t('settings.usage.tokens', {
              value: compact.format(bucket.input_tokens + bucket.output_tokens),
            })}
          </span>
          <span
            className={cn('w-20 text-right text-sm tabular-nums', bucket.unpriced_messages > 0 && 'text-muted')}
            // The cost of a row that is partly unpriced is a lower bound, and a
            // number with no way to say so is the one thing this page must not
            // print. The dimmed text is the visible half of that; this is the
            // half a screen reader gets.
            title={
              bucket.unpriced_messages > 0
                ? t('settings.usage.unpriced', { count: bucket.unpriced_messages })
                : undefined
            }
          >
            {money.format(bucket.cost)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default UsageSettings
