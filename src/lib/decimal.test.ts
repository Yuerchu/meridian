import {
  addDecimals,
  assertDecimal,
  assertDecimal38_18,
  compareDecimals,
  decimal,
  decimal38_18,
  decimalPercent,
  multiplyDecimals,
  roundDecimal,
  sumDecimals,
} from './decimal'

describe('decimal strings', () => {
  it('parses only fixed-point notation and canonicalises it', () => {
    expect(decimal('00012.3400')).toBe('12.34')
    expect(decimal('-0.000')).toBe('0')
    expect(() => decimal('1e-8')).toThrow('Invalid decimal')
    expect(() => decimal(' 1')).toThrow('Invalid decimal')
    expect(() => decimal('Infinity')).toThrow('Invalid decimal')
    expect(assertDecimal('12.34')).toBe('12.34')
    expect(() => assertDecimal('012.340')).toThrow('not canonical')
    expect(() => assertDecimal(12.34)).toThrow('must be a string')
  })

  it('enforces the non-negative DECIMAL(38, 18) input contract', () => {
    expect(decimal38_18('99999999999999999999.999999999999999999')).toBe('99999999999999999999.999999999999999999')
    expect(() => decimal38_18('-0.01')).toThrow('non-negative')
    expect(() => decimal38_18('0.0000000000000000001')).toThrow('scale exceeds 18')
    expect(() => decimal38_18('100000000000000000000')).toThrow('precision exceeds')
    expect(assertDecimal38_18('0.01')).toBe('0.01')
    expect(() => assertDecimal38_18('0.010')).toThrow('not canonical')
  })

  it('adds, sums, compares and multiplies without IEEE-754 intermediates', () => {
    const huge = decimal('9007199254740993.000000000000000001')
    const tiny = decimal('0.000000000000000009')
    expect(addDecimals(huge, tiny)).toBe('9007199254740993.00000000000000001')
    expect(sumDecimals([huge, tiny, decimal('0.9')])).toBe('9007199254740993.90000000000000001')
    expect(compareDecimals(decimal('9007199254740993'), decimal('9007199254740992.999999999999999999'))).toBe(1)
    expect(multiplyDecimals(decimal('0.0000001'), decimal('0.0000002'))).toBe('0.00000000000002')
  })

  it('rounds half to even and makes exact CSS percentages', () => {
    expect(roundDecimal(decimal('1.2345665'), 6)).toBe('1.234566')
    expect(roundDecimal(decimal('1.2345675'), 6)).toBe('1.234568')
    expect(decimalPercent(decimal('0.1'), decimal('0.3'))).toBe('33.333333%')
  })
})
