import { decimal } from '@/lib/decimal'
import type { PriceTier } from '@/types'
import { isPriced, optionalPrice, tiersFrom, tiersTo } from './pricing'

/**
 * A price that cannot be read is a bill nobody can reproduce, so every decoder
 * here refuses rather than guessing — and every refusal is a thing a person can
 * do in the form, which is why each one is written down.
 */
describe('optionalPrice', () => {
  it('accepts the two spellings people actually type', () => {
    expect(optionalPrice('.5')).toBe(decimal('0.5'))
    expect(optionalPrice('5.')).toBe(decimal('5'))
    expect(optionalPrice(' 1.25 ')).toBe(decimal('1.25'))
  })

  /** Empty is "nobody has said", which the backend stores as null. */
  it('reads a blank box as no price rather than as zero', () => {
    expect(optionalPrice('')).toBeNull()
    expect(optionalPrice('   ')).toBeNull()
    expect(optionalPrice('0')).toBe(decimal('0'))
  })

  it('refuses anything that is not a number', () => {
    expect(() => optionalPrice('abc')).toThrow()
    expect(() => optionalPrice('1.2.3')).toThrow()
  })
})

describe('tiersFrom', () => {
  const tier = (over: Partial<PriceTier> = {}): PriceTier => ({
    min_prompt_tokens: 200_000,
    input_price: decimal('4'),
    output_price: decimal('12'),
    cache_read_price: null,
    cache_write_price: null,
    ...over,
  })

  it('round-trips a stored tier into the form and back', () => {
    const drafts = tiersFrom([tier({ cache_read_price: decimal('1') })])
    expect(drafts).toEqual([{ threshold: '200000', input: '4', output: '12', cacheRead: '1', cacheWrite: '' }])
    expect(tiersTo(drafts)).toEqual([tier({ cache_read_price: decimal('1') })])
  })

  /**
   * Strict in both directions, like the backend: a missing field, an extra one
   * or a number where a decimal string belongs are all a table that was not
   * written by this app, and reading one of those is how a rate silently
   * becomes something else.
   */
  it('refuses a tier it cannot read exactly', () => {
    const { min_prompt_tokens: _dropped, ...missing } = tier()
    expect(() => tiersFrom([missing as PriceTier])).toThrow(/missing field min_prompt_tokens/)
    expect(() => tiersFrom([{ ...tier(), future: true } as unknown as PriceTier])).toThrow(/unknown field future/)
    expect(() => tiersFrom([tier({ min_prompt_tokens: 0 })])).toThrow(/positive safe integer/)
    expect(() => tiersFrom([tier({ min_prompt_tokens: 1.5 })])).toThrow(/positive safe integer/)
    expect(() => tiersFrom([tier({ input_price: 4 as unknown as PriceTier['input_price'] })])).toThrow(
      /must be a decimal string/,
    )
    expect(() => tiersFrom(['nope' as unknown as PriceTier])).toThrow(/must be an object/)
  })

  it('reads an absent cache rate as an empty box, not as zero', () => {
    expect(tiersFrom([tier()])[0]).toMatchObject({ cacheRead: '', cacheWrite: '' })
  })
})

describe('tiersTo', () => {
  const draft = (threshold: string) => ({
    threshold,
    input: '4',
    output: '12',
    cacheRead: '',
    cacheWrite: '',
  })

  /** One canonical order for the backend, and the order a person reads back. */
  it('sorts ascending whatever order the rows were added in', () => {
    const tiers = tiersTo([draft('300000'), draft('100000')])
    expect(tiers.map((tier) => tier.min_prompt_tokens)).toEqual([100_000, 300_000])
  })

  it('refuses a half-filled row rather than dropping it', () => {
    expect(() => tiersTo([draft('')])).toThrow(/positive integer threshold/)
    expect(() => tiersTo([draft('0')])).toThrow(/positive integer threshold/)
    expect(() => tiersTo([draft('007')])).toThrow(/positive integer threshold/)
    expect(() => tiersTo([draft('12a')])).toThrow(/positive integer threshold/)
    expect(() => tiersTo([{ ...draft('1000'), input: '' }])).toThrow()
  })

  it('refuses a threshold no integer can hold', () => {
    expect(() => tiersTo([draft('99999999999999999999')])).toThrow(RangeError)
  })
})

describe('isPriced', () => {
  /**
   * Explicit zero is a price — a free model — and null is nobody having filled
   * it in. Collapsing the two is how a configured free model reads as
   * unconfigured, and an unconfigured one reads as free.
   */
  it('tells a free model from an unconfigured one', () => {
    expect(isPriced({ input_price: null, output_price: null })).toBe(false)
    expect(isPriced({ input_price: decimal('0'), output_price: decimal('0') })).toBe(true)
    expect(isPriced({ input_price: decimal('1.25'), output_price: decimal('10') })).toBe(true)
  })

  /** The backend's `Prices::known()`: half a rate set bills nothing. */
  it('needs both base rates', () => {
    expect(isPriced({ input_price: decimal('1.25'), output_price: null })).toBe(false)
    expect(isPriced({ input_price: null, output_price: decimal('0') })).toBe(false)
  })
})
