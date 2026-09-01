import { decimal } from './decimal'
import { formatCostAmount, formatCurrencyAmount, formatDecimalAmount } from './cost-format'

describe('exact decimal formatting', () => {
  it('rounds money without converting it to a number', () => {
    expect(formatCostAmount(decimal('9007199254740993.1234565'), 'exact', 'en')).toBe('9,007,199,254,740,993.123456')
    expect(formatCostAmount(decimal('0.5797777'), 'lower_bound', 'en')).toBe('≥ 0.579778')
    expect(formatCostAmount(decimal('0.0000004'), 'exact', 'en')).toBe('4e-7')
    expect(formatCostAmount(decimal('0.00000012351'), 'exact', 'en')).toBe('1.24e-7')
    expect(formatCostAmount(decimal('0.0000001245'), 'exact', 'en')).toBe('1.24e-7')
    expect(formatCostAmount(decimal('0.0000001255'), 'exact', 'en')).toBe('1.26e-7')
  })

  it('keeps locale grouping and currency placement without passing the amount to Intl', () => {
    expect(formatDecimalAmount(decimal('1234567.8'), 'en', 2, 2)).toBe('1,234,567.80')
    expect(formatCurrencyAmount(decimal('1234.5'), 'USD', 'en')).toContain('USD')
    expect(formatCurrencyAmount(decimal('1234.5'), 'USD', 'en')).toContain('1,234.50')
  })
})
