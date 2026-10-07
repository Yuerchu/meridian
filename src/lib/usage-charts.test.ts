import { rankByTokens, weekdayHourGrid } from './usage-charts'

describe('weekdayHourGrid', () => {
  it('puts each hour bucket on its calendar weekday, Monday first', () => {
    // 2026-10-05 is a Monday, 2026-10-11 a Sunday.
    const grid = weekdayHourGrid([
      { key: '2026-10-05T09', messages: 3 },
      { key: '2026-10-11T23', messages: 2 },
      { key: '2026-10-07T00', messages: 1 },
    ])
    expect(grid).toHaveLength(7)
    expect(grid.every((row) => row.length === 24)).toBe(true)
    expect(grid[0][9]).toBe(3)
    expect(grid[6][23]).toBe(2)
    expect(grid[2][0]).toBe(1)
    expect(grid.flat().reduce((sum, value) => sum + value, 0)).toBe(6)
  })

  it('adds up the same weekday and hour across weeks', () => {
    const grid = weekdayHourGrid([
      { key: '2026-09-28T14', messages: 4 },
      { key: '2026-10-05T14', messages: 5 },
    ])
    expect(grid[0][14]).toBe(9)
  })

  it('refuses a key that is not an hour bucket', () => {
    expect(() => weekdayHourGrid([{ key: '2026-10-05', messages: 1 }])).toThrow('Unexpected hour bucket key')
    expect(() => weekdayHourGrid([{ key: '2026-10-05 09', messages: 1 }])).toThrow('Unexpected hour bucket key')
    expect(() => weekdayHourGrid([{ key: '2026-10-05T24', messages: 1 }])).toThrow('Unexpected hour bucket key')
  })
})

describe('rankByTokens', () => {
  const bucket = (key: string, input: number, output: number, label: string | null = key) => ({
    key,
    label,
    input_tokens: input,
    output_tokens: output,
  })

  it('ranks by prompt plus reply tokens and measures bars against the largest', () => {
    const items = rankByTokens([bucket('a', 100, 0), bucket('b', 300, 100), bucket('c', 50, 50)], 10)
    expect(items.map((item) => item.key)).toEqual(['b', 'a', 'c'])
    expect(items.map((item) => item.width)).toEqual(['100%', '25%', '25%'])
    expect(items[0].share).toBeCloseTo(400 / 600)
  })

  it('leaves out buckets without tokens and keeps the share over every ranked item', () => {
    expect(rankByTokens([bucket('a', 0, 0), bucket('b', 30, 10), bucket('c', 40, 20)], 10).map((i) => i.key)).toEqual([
      'c',
      'b',
    ])
    const items = rankByTokens([bucket('a', 0, 0), bucket('b', 30, 10), bucket('c', 40, 20)], 1)
    expect(items.map((item) => item.key)).toEqual(['c'])
    expect(items[0].share).toBeCloseTo(60 / 100)
  })

  it('falls back to the key when a bucket has no label', () => {
    expect(rankByTokens([bucket('local-model', 1, 1, null)], 5)[0].label).toBe('local-model')
  })
})
