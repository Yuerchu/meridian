const decimalCost = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

const scientificCost = new Intl.NumberFormat(undefined, {
  notation: 'scientific',
  maximumSignificantDigits: 3,
})

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
export function formatCostAmount(value: number, qualifier: CostQualifier = 'exact'): string {
  const magnitude = Math.abs(value)
  const formatted = magnitude > 0 && magnitude < 0.000001 ? scientificCost.format(value) : decimalCost.format(value)
  const prefix =
    qualifier === 'lower_bound' ? '≥ ' : qualifier === 'estimated' || qualifier === 'partial_estimate' ? '≈ ' : ''
  return `${prefix}${formatted}`
}
