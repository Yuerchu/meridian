/**
 * A canonical, base-10 decimal carried over JSON as a string.
 *
 * The brand prevents an arbitrary string from entering a monetary calculation
 * without first passing through {@link decimal}. Runtime values stay strings:
 * `number` is never an intermediate representation for money.
 */
declare const decimalStringBrand: unique symbol
export type DecimalString = string & { readonly [decimalStringBrand]: true }

export interface ParsedDecimal {
  /** Signed integer after removing the decimal point. */
  readonly coefficient: bigint
  /** Number of base-10 fractional digits in `coefficient`. */
  readonly scale: number
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/
const MAX_INPUT_DIGITS = 256
const powersOfTen: bigint[] = [1n]

function pow10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError(`Invalid decimal scale: ${exponent}`)
  }
  for (let i = powersOfTen.length; i <= exponent; i += 1) {
    powersOfTen.push(powersOfTen[i - 1] * 10n)
  }
  return powersOfTen[exponent]
}

function normalize(coefficient: bigint, scale: number): ParsedDecimal {
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 }
  let nextCoefficient = coefficient
  let nextScale = scale
  while (nextScale > 0 && nextCoefficient % 10n === 0n) {
    nextCoefficient /= 10n
    nextScale -= 1
  }
  return { coefficient: nextCoefficient, scale: nextScale }
}

/** Parse fixed-point notation. Exponents, whitespace, `NaN` and infinities are rejected. */
export function parseDecimal(value: string): ParsedDecimal {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`Invalid decimal: ${JSON.stringify(value)}`)
  }
  const digits = value[0] === '-' ? value.slice(1) : value
  const digitCount = digits.length - (digits.includes('.') ? 1 : 0)
  if (digitCount > MAX_INPUT_DIGITS) {
    throw new RangeError(`Decimal exceeds ${MAX_INPUT_DIGITS} digits`)
  }

  const point = digits.indexOf('.')
  const scale = point === -1 ? 0 : digits.length - point - 1
  const unsigned = point === -1 ? digits : `${digits.slice(0, point)}${digits.slice(point + 1)}`
  const coefficient = BigInt(`${value[0] === '-' ? '-' : ''}${unsigned}`)
  return normalize(coefficient, scale)
}

function stringifyDecimal({ coefficient, scale }: ParsedDecimal): DecimalString {
  if (coefficient === 0n) return '0' as DecimalString
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString()
  const sign = negative ? '-' : ''
  if (scale === 0) return `${sign}${digits}` as DecimalString
  if (digits.length <= scale) {
    return `${sign}0.${'0'.repeat(scale - digits.length)}${digits}` as DecimalString
  }
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` as DecimalString
}

/** Validate and canonicalise a decimal string. */
export function decimal(value: string): DecimalString {
  return stringifyDecimal(parseDecimal(value))
}

/** Assert that an untrusted wire value is already a canonical decimal string. */
export function assertDecimal(value: unknown): DecimalString {
  if (typeof value !== 'string') throw new TypeError('Decimal wire value must be a string')
  const canonical = decimal(value)
  if (canonical !== value) throw new TypeError(`Decimal wire value is not canonical: ${JSON.stringify(value)}`)
  return canonical
}

function validate38_18(value: DecimalString): DecimalString {
  const parsed = parseDecimal(value)
  if (parsed.coefficient < 0n) throw new RangeError('Decimal must be non-negative')
  if (parsed.scale > 18) throw new RangeError('Decimal scale exceeds 18')

  const digits = parsed.coefficient.toString()
  const integerDigits = Math.max(1, digits.length - parsed.scale)
  if (digits.length > 38 || integerDigits > 20) {
    throw new RangeError('Decimal precision exceeds DECIMAL(38, 18)')
  }
  return value
}

/**
 * Validate a non-negative SQL-style `DECIMAL(38, 18)` value.
 *
 * This is the input contract for prices, balances and configurable monetary
 * thresholds. Calculated amounts use {@link decimal}, since multiplying two
 * valid rates can legitimately create more than eighteen fractional digits.
 */
export function decimal38_18(value: string): DecimalString {
  const canonical = decimal(value)
  return validate38_18(canonical)
}

/** Assert the strict wire form of a non-negative `DECIMAL(38, 18)`. */
export function assertDecimal38_18(value: unknown): DecimalString {
  return validate38_18(assertDecimal(value))
}

function parseCanonical(value: DecimalString): ParsedDecimal {
  assertDecimal(value)
  return parseDecimal(value)
}

function aligned(a: ParsedDecimal, b: ParsedDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.coefficient * pow10(scale - a.scale), b.coefficient * pow10(scale - b.scale), scale]
}

/** Exact base-10 addition. */
export function addDecimals(left: DecimalString, right: DecimalString): DecimalString {
  const [a, b, scale] = aligned(parseCanonical(left), parseCanonical(right))
  return stringifyDecimal(normalize(a + b, scale))
}

/** Exact base-10 sum. */
export function sumDecimals(values: Iterable<DecimalString>): DecimalString {
  let total = '0' as DecimalString
  for (const value of values) total = addDecimals(total, value)
  return total
}

/** Exact base-10 comparison. */
export function compareDecimals(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const [a, b] = aligned(parseCanonical(left), parseCanonical(right))
  return a < b ? -1 : a > b ? 1 : 0
}

/** Exact base-10 multiplication. */
export function multiplyDecimals(left: DecimalString, right: DecimalString): DecimalString {
  const a = parseCanonical(left)
  const b = parseCanonical(right)
  return stringifyDecimal(normalize(a.coefficient * b.coefficient, a.scale + b.scale))
}

/** True only for canonical or non-canonical decimal zero. */
export function isZeroDecimal(value: DecimalString): boolean {
  return parseCanonical(value).coefficient === 0n
}

function divideRoundedHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Decimal divisor must be positive')
  const negative = numerator < 0n
  const absolute = negative ? -numerator : numerator
  const quotient = absolute / denominator
  const remainder = absolute % denominator
  const twice = remainder * 2n
  const rounded = twice > denominator || (twice === denominator && quotient % 2n !== 0n) ? quotient + 1n : quotient
  return negative ? -rounded : rounded
}

/** Round to at most `scale` fractional digits using round-half-to-even. */
export function roundDecimal(value: DecimalString, scale: number): DecimalString {
  if (!Number.isSafeInteger(scale) || scale < 0) throw new RangeError(`Invalid decimal scale: ${scale}`)
  const parsed = parseCanonical(value)
  if (parsed.scale <= scale) return stringifyDecimal(parsed)
  const shift = pow10(parsed.scale - scale)
  return stringifyDecimal(normalize(divideRoundedHalfEven(parsed.coefficient, shift), scale))
}

/**
 * Exact ratio projected as a CSS percentage. The returned string, rather than
 * a floating-point value, can be assigned directly to `style.width`.
 */
export function decimalPercent(value: DecimalString, total: DecimalString, fractionDigits = 6): `${string}%` {
  if (!Number.isSafeInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
    throw new RangeError(`Invalid percentage precision: ${fractionDigits}`)
  }
  const numerator = parseCanonical(value)
  const denominator = parseCanonical(total)
  if (numerator.coefficient < 0n || denominator.coefficient <= 0n) {
    throw new RangeError('A percentage requires a non-negative value and positive total')
  }
  const scaledNumerator = numerator.coefficient * pow10(denominator.scale) * 100n * pow10(fractionDigits)
  const scaledDenominator = denominator.coefficient * pow10(numerator.scale)
  const percentage = divideRoundedHalfEven(scaledNumerator, scaledDenominator)
  const result = stringifyDecimal(normalize(percentage, fractionDigits))
  return `${result}%`
}
