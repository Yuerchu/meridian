import { assertDecimal38_18, compareDecimals, decimal, decimal38_18 } from '@/lib/decimal'
import type { DecimalString, PriceTier } from '@/types'

/**
 * Prices as a form holds them, and as IPC requires them.
 *
 * A half-typed number is not a number, so every box here is a string until the
 * moment it is submitted — and the decoders below are strict on the way back in
 * for the same reason the backend is: a tier table that cannot be read is a
 * price nobody can reproduce, and guessing a default would be worse than saying
 * so.
 */

/**
 * One tier as the form holds it.
 *
 * Strings, like every other price box here, because a half-typed number is not
 * a number — parsing on each keystroke makes "4." unrepresentable and the field
 * impossible to type a decimal into.
 */
export type TierDraft = { threshold: string; input: string; output: string; cacheRead: string; cacheWrite: string }

/** The five base price boxes, named so a refusal can point at one. */
export type PriceField = 'input' | 'output' | 'cache' | 'cacheWrite' | 'serverTool'

export const BLANK_TIER: TierDraft = { threshold: '', input: '', output: '', cacheRead: '', cacheWrite: '' }

export const ZERO_DECIMAL = decimal('0')

export function optionalPrice(value: string): DecimalString | null {
  const trimmed = value
    .trim()
    // `.5` and `5.` are how people type prices; the canonical form is what is
    // stored, so widen the accepted spelling here rather than in the parser.
    .replace(/^(-?)\.(\d+)$/, '$10.$2')
    .replace(/^(-?\d+)\.$/, '$1')
  return trimmed === '' ? null : decimal38_18(trimmed)
}

export function tierThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Price-tier threshold must be a positive safe integer')
  }
  return value
}

export function tierRate(value: unknown, name: string): DecimalString {
  if (typeof value !== 'string') throw new TypeError(`Price-tier ${name} must be a decimal string`)
  return assertDecimal38_18(value)
}

export function tiersFrom(raw: PriceTier[]): TierDraft[] {
  if (!Array.isArray(raw)) throw new TypeError('Price tiers must be an array')
  return raw.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError(`Price tier ${index + 1} must be an object`)
    }
    const tier = candidate as unknown as Record<string, unknown>
    for (const key of ['min_prompt_tokens', 'input_price', 'output_price']) {
      if (!Object.prototype.hasOwnProperty.call(tier, key)) {
        throw new TypeError(`Price tier ${index + 1} is missing field ${key}`)
      }
    }
    const unknownKey = Object.keys(tier).find(
      (key) =>
        !['min_prompt_tokens', 'input_price', 'output_price', 'cache_read_price', 'cache_write_price'].includes(key),
    )
    if (unknownKey) throw new TypeError(`Price tier ${index + 1} has unknown field ${unknownKey}`)
    return {
      threshold: tierThreshold(tier.min_prompt_tokens).toString(),
      input: tierRate(tier.input_price, 'input_price'),
      output: tierRate(tier.output_price, 'output_price'),
      cacheRead: tier.cache_read_price == null ? '' : tierRate(tier.cache_read_price, 'cache_read_price'),
      cacheWrite: tier.cache_write_price == null ? '' : tierRate(tier.cache_write_price, 'cache_write_price'),
    }
  })
}

/**
 * Validate every explicit row and sort the typed DTO sent over IPC.
 *
 * A tier needs a threshold above zero and both rates. Half-filled rows are
 * rejected instead of being silently dropped. Sorting here gives the backend
 * one canonical order and is the order a human reads back.
 */
export function tiersTo(drafts: TierDraft[]): PriceTier[] {
  const tiers: PriceTier[] = drafts.map((draft, index) => {
    const threshold = draft.threshold.trim()
    if (!/^[1-9]\d*$/.test(threshold)) {
      throw new TypeError(`Price tier ${index + 1} needs a positive integer threshold`)
    }
    const minPromptTokens = Number(threshold)
    if (!Number.isSafeInteger(minPromptTokens)) {
      throw new RangeError(`Price tier ${index + 1} threshold is too large`)
    }
    return {
      min_prompt_tokens: minPromptTokens,
      input_price: decimal38_18(draft.input.trim()),
      output_price: decimal38_18(draft.output.trim()),
      cache_read_price: optionalPrice(draft.cacheRead),
      cache_write_price: optionalPrice(draft.cacheWrite),
    }
  })
  tiers.sort((a, b) => a.min_prompt_tokens - b.min_prompt_tokens)
  return tiers
}

/**
 * Whether anyone has actually said what this model costs.
 *
 * An explicit zero is a price — a free model — and null is nobody having
 * filled it in, which is the distinction the backend keeps and the reason this
 * is not `Boolean(input_price)`. Either rate being above zero is enough: some
 * upstreams charge for output alone.
 */
export function isPriced(prices: { input_price: DecimalString | null; output_price: DecimalString | null }): boolean {
  return (
    (prices.input_price != null && compareDecimals(prices.input_price, ZERO_DECIMAL) > 0) ||
    (prices.output_price != null && compareDecimals(prices.output_price, ZERO_DECIMAL) > 0)
  )
}
