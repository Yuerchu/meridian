/**
 * The library's NumberField speaks numbers, with `NaN` for an empty field. The
 * settings pages keep what was typed as a draft string instead, because their
 * save paths tell an empty field (unset, `null`) from a zero and refuse what
 * does not parse rather than defaulting it (`no-parse-or-default`). These two
 * are the boundary between the field and the draft, and nothing else.
 */
export function draftToNumber(draft: string): number {
  return draft.trim() === '' ? Number.NaN : Number(draft)
}

export function numberToDraft(value: number): string {
  return Number.isNaN(value) ? '' : String(value)
}

/** Ports, counts, round limits: digits as typed, no thousands separator. */
export const PLAIN_INTEGER: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 0 }
