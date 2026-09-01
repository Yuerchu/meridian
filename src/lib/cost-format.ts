import { assertDecimal, compareDecimals, decimal, parseDecimal, roundDecimal, type DecimalString } from '@/lib/decimal'

interface LocaleDecimalFormat {
  decimal: string
  group: string
  minus: string
  primaryGroupSize: number
  secondaryGroupSize: number
  digits: readonly string[]
}

const localeFormats = new Map<string, LocaleDecimalFormat>()
const currencyFormats = new Map<string, Intl.NumberFormat>()
const ZERO = decimal('0')
const ONE_MICRO = decimal('0.000001')

function localeDecimalFormat(locale?: string): LocaleDecimalFormat {
  const key = locale ?? ''
  const cached = localeFormats.get(key)
  if (cached) return cached

  // Static safe integers only describe the locale's punctuation, grouping and
  // numeral glyphs. The monetary value itself never enters Intl.NumberFormat.
  const formatter = new Intl.NumberFormat(locale, { useGrouping: true, minimumFractionDigits: 1 })
  const parts = formatter.formatToParts(-1_234_567_890_123.4)
  const integerParts = parts.filter((part) => part.type === 'integer').map((part) => part.value)
  const primaryGroupSize = integerParts[integerParts.length - 1]?.length ?? 3
  const secondaryGroupSize = integerParts[integerParts.length - 2]?.length ?? primaryGroupSize
  const next: LocaleDecimalFormat = {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    minus: parts.find((part) => part.type === 'minusSign')?.value ?? '-',
    primaryGroupSize,
    secondaryGroupSize,
    digits: Array.from({ length: 10 }, (_, digit) => {
      const integer = new Intl.NumberFormat(locale, { useGrouping: false }).formatToParts(digit)
      return integer.find((part) => part.type === 'integer')?.value ?? digit.toString()
    }),
  }
  localeFormats.set(key, next)
  return next
}

function groupInteger(value: string, format: LocaleDecimalFormat): string {
  if (value.length <= format.primaryGroupSize) return value
  const groups: string[] = []
  let end = value.length
  groups.unshift(value.slice(Math.max(0, end - format.primaryGroupSize), end))
  end -= format.primaryGroupSize
  while (end > 0) {
    const start = Math.max(0, end - format.secondaryGroupSize)
    groups.unshift(value.slice(start, end))
    end = start
  }
  return groups.join(format.group)
}

function localizeDigits(value: string, digits: readonly string[]): string {
  return value.replace(/\d/g, (digit) => digits[digit.charCodeAt(0) - 48])
}

/** Format a decimal string without converting the amount to a JS number. */
export function formatDecimalAmount(
  value: DecimalString,
  locale?: string,
  minimumFractionDigits = 2,
  maximumFractionDigits = 6,
): string {
  if (
    !Number.isSafeInteger(minimumFractionDigits) ||
    !Number.isSafeInteger(maximumFractionDigits) ||
    minimumFractionDigits < 0 ||
    maximumFractionDigits < minimumFractionDigits
  ) {
    throw new RangeError('Invalid decimal display precision')
  }
  const rounded = roundDecimal(value, maximumFractionDigits)
  const format = localeDecimalFormat(locale)
  const negative = rounded.startsWith('-')
  const unsigned = negative ? rounded.slice(1) : rounded
  const [integer, rawFraction = ''] = unsigned.split('.')
  const fraction = rawFraction.padEnd(minimumFractionDigits, '0')
  const grouped = groupInteger(integer, format)
  const body = fraction ? `${grouped}${format.decimal}${fraction}` : grouped
  return `${negative ? format.minus : ''}${localizeDigits(body, format.digits)}`
}

/** Format a balance exactly while borrowing only the currency layout from Intl. */
export function formatCurrencyAmount(value: DecimalString, currency: string, locale?: string): string {
  const canonical = assertDecimal(value)
  const negative = canonical.startsWith('-')
  const absolute = negative ? decimal(canonical.slice(1)) : canonical
  const amount = formatDecimalAmount(absolute, locale, 2, 2)
  const key = `${locale ?? ''}\u0000${currency}`
  try {
    let formatter = currencyFormats.get(key)
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      currencyFormats.set(key, formatter)
    }
    const parts = formatter.formatToParts(negative ? -1 : 1)
    let insertedAmount = false
    let result = ''
    for (const part of parts) {
      if (part.type === 'integer' || part.type === 'group' || part.type === 'decimal' || part.type === 'fraction') {
        if (!insertedAmount) {
          result += amount
          insertedAmount = true
        }
      } else {
        result += part.value
      }
    }
    return result
  } catch {
    const sign = negative ? localeDecimalFormat(locale).minus : ''
    return `${sign}${currency} ${amount}`
  }
}

function scientificAmount(value: DecimalString, locale?: string): string {
  const parsed = parseDecimal(value)
  const negative = parsed.coefficient < 0n
  let digits = (negative ? -parsed.coefficient : parsed.coefficient).toString()
  let exponent = digits.length - parsed.scale - 1

  if (digits.length > 3) {
    let kept = BigInt(digits.slice(0, 3))
    const discarded = digits.slice(3)
    const firstDiscarded = discarded[0]
    const remainderIsZero = /^0*$/.test(discarded.slice(1))
    const roundUp = firstDiscarded > '5' || (firstDiscarded === '5' && (!remainderIsZero || kept % 2n !== 0n))
    if (roundUp) kept += 1n
    if (kept === 1000n) {
      kept = 100n
      exponent += 1
    }
    digits = kept.toString()
  }

  const format = localeDecimalFormat(locale)
  const fraction = digits.slice(1).replace(/0+$/, '')
  const mantissa = fraction ? `${digits[0]}${format.decimal}${fraction}` : digits[0]
  const sign = negative ? format.minus : ''
  return `${sign}${localizeDigits(mantissa, format.digits)}e${exponent}`
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
export function formatCostAmount(value: DecimalString, qualifier: CostQualifier = 'exact', locale?: string): string {
  const canonical = assertDecimal(value)
  const absolute = canonical.startsWith('-') ? decimal(canonical.slice(1)) : canonical
  const formatted =
    compareDecimals(absolute, ZERO) > 0 && compareDecimals(absolute, ONE_MICRO) < 0
      ? scientificAmount(canonical, locale)
      : formatDecimalAmount(canonical, locale)
  const prefix =
    qualifier === 'lower_bound' ? '≥ ' : qualifier === 'estimated' || qualifier === 'partial_estimate' ? '≈ ' : ''
  return `${prefix}${formatted}`
}
