/**
 * Projections of `usage_report` buckets into the shapes the usage charts draw.
 *
 * Token counts and reply counts only. Nothing here touches a cost: money is a
 * Decimal string priced in Rust, and the charts that show it (`CostBars`) take
 * their widths from `decimalPercent` rather than from anything below.
 */

export const WEEKDAY_COUNT = 7
export const HOUR_COUNT = 24

const HOUR_KEY = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/

/**
 * Replies per weekday × hour of day, Monday first, from the `hour` grouping.
 *
 * The key is the local wall-clock hour the backend formatted
 * (`strftime('%Y-%m-%dT%H', …, 'localtime')`). The weekday of a calendar date
 * does not depend on any time zone, so it is read in UTC: reading it through
 * the viewer's zone would move a bucket across midnight for a remote client in
 * another one. A key in any other shape is a contract break and throws, rather
 * than being dropped from a chart that would then under-report without saying so.
 */
export function weekdayHourGrid(buckets: readonly { key: string; messages: number }[]): number[][] {
  const grid = Array.from({ length: WEEKDAY_COUNT }, () => new Array<number>(HOUR_COUNT).fill(0))
  for (const bucket of buckets) {
    const parsed = HOUR_KEY.exec(bucket.key)
    const hour = parsed ? Number(parsed[4]) : NaN
    if (!parsed || hour >= HOUR_COUNT) throw new Error(`Unexpected hour bucket key: ${bucket.key}`)
    const weekday = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]))).getUTCDay()
    grid[(weekday + 6) % WEEKDAY_COUNT][hour] += bucket.messages
  }
  return grid
}

export interface TokenRankItem {
  key: string
  label: string
  tokens: number
  /** Some of this bucket's replies are missing input or output usage, so
   *  `tokens` is a lower bound, not the count. */
  incomplete: boolean
  /** Length of the bar, as a share of the largest item. */
  width: `${string}%`
  /** Share of every item's tokens together, or null when any bucket's count is
   *  a lower bound: the denominator is then unknown too, and every share —
   *  the complete buckets' included — would be presented as exact without
   *  being so. */
  share: number | null
}

/**
 * Buckets ranked by the tokens they moved (prompt plus reply), largest first.
 *
 * Tokens rather than cost on purpose: a model nobody priced — a local one, a
 * subscription — still did the work, and a cost ranking leaves it out
 * entirely. A bucket with no tokens has nothing to draw and is left out.
 *
 * An incomplete bucket is ranked by its lower bound. Its true place may be
 * higher; the row says `≥` so the order is not read as settled.
 */
export function rankByTokens(
  buckets: readonly {
    key: string
    label: string | null
    input_tokens: number
    output_tokens: number
    incomplete_token_usage_messages: number
  }[],
  limit: number,
): TokenRankItem[] {
  const rows: Omit<TokenRankItem, 'width' | 'share'>[] = []
  let sum = 0
  let anyIncomplete = false
  for (const bucket of buckets) {
    const incomplete = bucket.incomplete_token_usage_messages > 0
    // Checked before the zero filter: a bucket whose usage is missing entirely
    // draws nothing, but it still leaves the total unknown.
    anyIncomplete ||= incomplete
    const tokens = bucket.input_tokens + bucket.output_tokens
    if (tokens <= 0) continue
    sum += tokens
    rows.push({ key: bucket.key, label: bucket.label ?? bucket.key, tokens, incomplete })
  }
  if (rows.length === 0) return []
  rows.sort((a, b) => b.tokens - a.tokens)
  const max = rows[0].tokens
  return rows.slice(0, limit).map((row) => ({
    ...row,
    width: `${(row.tokens / max) * 100}%`,
    share: anyIncomplete ? null : row.tokens / sum,
  }))
}
