import { agentFileDiffs } from './tool-diffs'
import type { ToolCallDiffInfoResponse } from '@/types'

const hunk = (over: Partial<ToolCallDiffInfoResponse> = {}): ToolCallDiffInfoResponse => ({
  path: 'src/lib.rs',
  old_text: 'line1\nold line2\nline3',
  new_text: 'line1\nNEW line2\nline3',
  line: 1,
  ...over,
})

describe('agentFileDiffs', () => {
  /** A Write over an existing file: the arguments alone would draw every
   *  line as added, and the agent's hunk carries what was there before. */
  it('draws a modification with its removed lines, numbered from the hunk', () => {
    const [file] = agentFileDiffs([hunk()])
    expect(file.op).toBe('modify')
    expect(file.lines.map((l) => [l.kind, l.text])).toEqual([
      ['context', 'line1'],
      ['remove', 'old line2'],
      ['add', 'NEW line2'],
      ['context', 'line3'],
    ])
    expect(file.lines[0].oldNo).toBe(1)
    expect(file.lines[3].newNo).toBe(3)
  })

  it('draws a created file as one, unnumbered when the adapter gave no line', () => {
    const [file] = agentFileDiffs([hunk({ old_text: null, new_text: 'first\nsecond', line: null })])
    expect(file.op).toBe('create')
    expect(file.lines.every((l) => l.kind === 'add')).toBe(true)
    expect(file.lines[0].newNo).toBeUndefined()
  })

  /** An Edit with replace_all comes back as several hunks for one path. */
  it('groups the hunks of one file in order', () => {
    const files = agentFileDiffs([
      hunk({ old_text: 'foo', new_text: 'bar', line: 3 }),
      hunk({ old_text: 'foo', new_text: 'bar', line: 15 }),
      hunk({ path: 'other.rs', old_text: null, new_text: 'x', line: null }),
    ])
    expect(files.map((f) => f.path)).toEqual(['src/lib.rs', 'other.rs'])
    expect(files[0].lines.map((l) => l.oldNo ?? l.newNo)).toEqual([3, 3, 15, 15])
    expect(files[1].op).toBe('create')
  })
})
