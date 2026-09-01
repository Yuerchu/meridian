import { describe, expect, it } from 'vitest'

import { remapSourceRange, sourceRangeAnchor } from './plan-comment-decorations'

describe('source plan comment anchors', () => {
  it('keeps exact UTF-16 offsets around emoji and maps a unique quote after insertion', () => {
    const source = '😀 alpha target omega'
    const from = source.indexOf('target')
    const anchor = sourceRangeAnchor(source, from, from + 'target'.length)
    expect(anchor).not.toBeNull()
    expect(anchor?.from).toBe(9)

    const edited = `prefix ${source}`
    const mapped = remapSourceRange(edited, anchor!)
    expect(mapped?.quote).toBe('target')
    expect(mapped?.from).toBe(from + 'prefix '.length)
    expect(edited.slice(mapped!.from, mapped!.to)).toBe('target')
  })

  it('does not guess when a moved quote occurs more than once', () => {
    const anchor = sourceRangeAnchor('one target', 4, 10)!
    expect(remapSourceRange('prefix target and target', anchor)).toBeNull()
  })

  it('uses preserved prefix and suffix context to select one repeated quote after a UTF-16 shift', () => {
    const source = '😀 first target / second target end'
    const from = source.lastIndexOf('target')
    const anchor = sourceRangeAnchor(source, from, from + 'target'.length)!
    const edited = `new 😀 prefix ${source}`
    const mapped = remapSourceRange(edited, anchor)
    expect(mapped?.from).toBe(edited.lastIndexOf('target'))
    expect(mapped?.quote).toBe('target')
  })

  it('does not choose the higher-scoring partial context when repeated quotes have no exact context match', () => {
    const anchor = sourceRangeAnchor('AAAA target BBBB', 5, 11)!
    const edited = 'x AAAA target BBBC / x AAAX target BBBB'

    expect(remapSourceRange(edited, anchor)).toBeNull()
  })

  it('does not treat overlapping quote occurrences as a unique match', () => {
    const anchor = sourceRangeAnchor('x aa y', 2, 4)!

    expect(remapSourceRange('aaa', anchor)).toBeNull()
  })

  it('keeps a positional anchor when that exact range still matches, even if the quote repeats elsewhere', () => {
    const source = 'target and target'
    const anchor = sourceRangeAnchor(source, 0, 6)!
    expect(remapSourceRange(source, anchor)).toMatchObject({ from: 0, to: 6, quote: 'target' })
  })
})
