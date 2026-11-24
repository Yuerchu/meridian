import { draftToNumber, numberToDraft } from './number-draft'

describe('number drafts', () => {
  it('an empty or blank draft is an empty field, not zero', () => {
    expect(draftToNumber('')).toBeNaN()
    expect(draftToNumber('  ')).toBeNaN()
    expect(draftToNumber('0')).toBe(0)
  })

  it('an emptied field is an empty draft, and zero stays zero', () => {
    expect(numberToDraft(Number.NaN)).toBe('')
    expect(numberToDraft(0)).toBe('0')
    expect(numberToDraft(8765)).toBe('8765')
    expect(numberToDraft(0.7)).toBe('0.7')
  })

  it('round-trips what the field hands back', () => {
    for (const value of [1, 65535, 0.1, 128000]) expect(draftToNumber(numberToDraft(value))).toBe(value)
  })
})
