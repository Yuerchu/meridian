const formatters = new Map<string, { decimal: Intl.NumberFormat; scientific: Intl.NumberFormat }>()

function costFormatters(locale?: string) {
  const key = locale ?? ''
  const cached = formatters.get(key)
  if (cached) return cached
  const next = {
    decimal: new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }),
    scientific: new Intl.NumberFormat(locale, {
      notation: 'scientific',
      maximumSignificantDigits: 3,
    }),
  }
  formatters.set(key, next)
  return next
}

export type CostQualifier = 'exact' | 'lower_bound' | 'estimated' | 'partial_estimate'

export function costQualifier(unpricedMessages: number, estimatedMessages: number): CostQualifier {
  if (estimatedMessages > 0) return unpricedMessages > 0 ? 'partial_estimate' : 'estimated'
  return unpricedMessages > 0 ? 'lower_bound' : 'exact'
}

/**
 * Format an already-priced backend amount without erasing a real small charge.
 * Costs normally use up to six decimal places; sub-micro amounts switch to
 * scientific notation so a non-zero value is never presented as zero.
 */
export function formatCostAmount(value: number, qualifier: CostQualifier = 'exact', locale?: string): string {
  const { decimal, scientific } = costFormatters(locale)
  const magnitude = Math.abs(value)
  const formatted = magnitude > 0 && magnitude < 0.000001 ? scientific.format(value) : decimal.format(value)
  const prefix =
    qualifier === 'lower_bound' ? '≥ ' : qualifier === 'estimated' || qualifier === 'partial_estimate' ? '≈ ' : ''
  return `${prefix}${formatted}`
}
