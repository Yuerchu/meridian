import { describe, expect, it } from 'vitest'
import { firstHunkStart, numberDiffLines, parsePatchText, type DiffLine } from '@/lib/patch-parse'

const numbers = (lines: DiffLine[]) => lines.map((l) => [l.kind, l.oldNo ?? null, l.newNo ?? null])

describe('numberDiffLines', () => {
  it('numbers a whole file from one', () => {
    const lines: DiffLine[] = [
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]
    expect(numbers(numberDiffLines(lines, { oldStart: 1, newStart: 1 }))).toEqual([
      ['add', null, 1],
      ['add', null, 2],
    ])
  })

  it('keeps two counters, one per side', () => {
    const lines: DiffLine[] = [
      { kind: 'context', text: 'x' },
      { kind: 'remove', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'add', text: 'newer' },
      { kind: 'context', text: 'y' },
    ]
    expect(numbers(numberDiffLines(lines, { oldStart: 10, newStart: 10 }))).toEqual([
      ['context', 10, 10],
      ['remove', 11, null],
      ['add', null, 11],
      ['add', null, 12],
      ['context', 12, 13],
    ])
  })

  /// A multi-hunk patch declares where each hunk starts; counting on from the
  /// first hunk would number the second one from wherever the first happened
  /// to end.
  it('resets both counters at every numeric hunk header', () => {
    const lines: DiffLine[] = [
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'context', text: 'a' },
      { kind: 'hunk', text: '@@ -40 +41 @@ fn trailing() {' },
      { kind: 'remove', text: 'b' },
      { kind: 'hunk', text: '@@ just context, codex style' },
      { kind: 'add', text: 'c' },
    ]
    expect(numbers(numberDiffLines(lines, { oldStart: 1, newStart: 1 }))).toEqual([
      ['hunk', null, null],
      ['context', 1, 1],
      ['hunk', null, null],
      ['remove', 40, null],
      ['hunk', null, null],
      ['add', null, 41],
    ])
  })

  it('does not touch the lines it was given', () => {
    const lines: DiffLine[] = [{ kind: 'add', text: 'a' }]
    numberDiffLines(lines, { oldStart: 1, newStart: 1 })
    expect(lines[0].newNo).toBeUndefined()
  })
})

describe('firstHunkStart', () => {
  it('reads the start off a parsed unified patch', () => {
    const [file] = parsePatchText('--- a/x.ts\n+++ b/x.ts\n@@ -7,2 +7,3 @@\n a\n+b\n c\n')
    expect(firstHunkStart(file.lines)).toEqual({ oldStart: 7, newStart: 7 })
  })

  it('finds nothing in a Codex-style patch, whose headers carry no numbers', () => {
    const [file] = parsePatchText('*** Begin Patch\n*** Update File: x.ts\n@@ fn a\n-old\n+new\n*** End Patch')
    expect(firstHunkStart(file.lines)).toBeNull()
  })
})
