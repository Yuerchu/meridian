import { describe, expect, it } from 'vitest'
import {
  parseCommandOutput,
  parseDirectoryListing,
  parseGlobResult,
  parseReadFileOutput,
  parseSearchMatches,
  parseSubAgentResult,
  splitListingFootnote,
  splitTruncation,
} from '@/lib/tool-output'

describe('splitTruncation', () => {
  it('takes the turn-level header off and reports the original size', () => {
    const { body, truncation } = splitTruncation(
      'Warning: truncated output (original token count: 12345)\nTotal output lines: 900\n\nhead\n…11000 tokens truncated…\ntail',
    )
    expect(truncation).toEqual({ originalTokens: 12345, seam: true })
    expect(body).toBe('head\n\ntail')
  })

  it('leaves an untruncated result alone', () => {
    expect(splitTruncation('plain')).toEqual({ body: 'plain', truncation: null })
  })
})

describe('parseCommandOutput', () => {
  /// The contract `run_command.rs` asserts on itself, in full.
  it('splits stdout, stderr and every trailer in the order the backend writes them', () => {
    expect(parseCommandOutput('out\n[stderr] err\n[exit code: 7]\n[output truncated at 256KB]')).toEqual({
      stdout: 'out',
      stderr: 'err',
      exitCode: 7,
      timedOut: false,
      truncated: true,
      noOutput: false,
    })
  })

  it('keeps a multi-line stderr together', () => {
    const out = parseCommandOutput('[stderr] first\nsecond\n[exit code: 1]')
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('first\nsecond')
    expect(out.exitCode).toBe(1)
  })

  /// Absent means unreported. The backend writes the code only when it is
  /// non-zero, and a hosted agent's shell writes none at all — reading either
  /// as `0` would put a green "exit 0" on a command nobody said succeeded.
  it('reports no exit code rather than zero when none is written', () => {
    expect(parseCommandOutput('just output').exitCode).toBeNull()
  })

  it('reads a timeout, which excludes an exit code', () => {
    const out = parseCommandOutput('partial\n[timed out; process tree killed]')
    expect(out.timedOut).toBe(true)
    expect(out.exitCode).toBeNull()
    expect(out.stdout).toBe('partial')
  })

  it('recognises the empty-output sentence', () => {
    expect(parseCommandOutput('(no output)').noOutput).toBe(true)
  })

  it('splits at the first stderr marker, not one the program printed later', () => {
    const out = parseCommandOutput('a\n[stderr] b\n[stderr] c')
    expect(out.stdout).toBe('a')
    expect(out.stderr).toBe('b\n[stderr] c')
  })
})

describe('parseSubAgentResult', () => {
  it('reads a finished run: verdict, steps and the report', () => {
    const r = parseSubAgentResult('Sub-agent finished after 33 steps.\n\n## Findings\n\nnone')
    expect(r).toEqual({ outcome: 'done', steps: 33, body: '## Findings\n\nnone', stranded: null })
  })

  it('tells a stop from an abort by the qualification on the same line', () => {
    expect(
      parseSubAgentResult(
        'Sub-agent was stopped after 5 steps. Anything below is partial and does not answer the task; do not treat it as a conclusion.\n\npartial',
      ),
    ).toMatchObject({ outcome: 'cancelled', steps: 5, body: 'partial' })
    expect(
      parseSubAgentResult(
        'Sub-agent was stopped after 9 steps because it kept repeating itself. Anything below is partial.\n\nloop',
      ),
    ).toMatchObject({ outcome: 'aborted', steps: 9, body: 'loop' })
    expect(parseSubAgentResult('Sub-agent failed after 2 steps.\n\nboom')).toMatchObject({
      outcome: 'failed',
      steps: 2,
      body: 'boom',
    })
  })

  /// The no-text form has no blank line: the note rides the head's own line.
  it('reads a run that returned nothing as an empty body', () => {
    const r = parseSubAgentResult('Sub-agent finished after 1 step. It returned no text.')
    expect(r).toEqual({ outcome: 'done', steps: 1, body: '', stranded: null })
  })

  it('takes the stranded-messages note off the end, whichever of its endings it has', () => {
    const note =
      'The user sent 2 message(s) to the sub-agent after it had stopped reading, so it never saw them. 1 of them could not be written down. Read them before acting on the answer above.'
    const r = parseSubAgentResult(`Sub-agent finished after 4 steps.\n\nreport\n\n${note}`)
    expect(r.body).toBe('report')
    expect(r.stranded).toBe(note)
    const empty = parseSubAgentResult(`Sub-agent finished after 4 steps. It returned no text.\n\n${note}`)
    expect(empty.body).toBe('')
    expect(empty.stranded).toBe(note)
  })

  it('passes anything else through as the body', () => {
    expect(parseSubAgentResult('Error: unknown agent')).toEqual({
      outcome: null,
      steps: null,
      body: 'Error: unknown agent',
      stranded: null,
    })
  })
})

describe('the listing tools', () => {
  it('takes read_file’s cap note off, ellipsis included', () => {
    expect(parseReadFileOutput('abc...\n\n(file truncated at 256KB, total 300000 bytes)')).toEqual({
      content: 'abc',
      truncated: { totalBytes: 300000 },
    })
    expect(parseReadFileOutput('abc')).toEqual({ content: 'abc', truncated: null })
  })

  it('takes the "showing first" cap off a search or glob', () => {
    const { body, footnote } = splitListingFootnote('a:1:x\nb:2:y\n\n(showing first 50 matches)')
    expect(body).toBe('a:1:x\nb:2:y')
    expect(footnote.showingFirst).toBe(50)
  })

  it('reads search matches and nothing else', () => {
    expect(parseSearchMatches('C:/p/a.rs:12:let x\nC:/p/b.rs:3:fn y')).toEqual([
      { file: 'C:/p/a.rs', line: 12, text: 'let x' },
      { file: 'C:/p/b.rs', line: 3, text: 'fn y' },
    ])
    expect(parseSearchMatches('No matches found.')).toBeNull()
  })

  /// glob has never had `:line:` in it; parsed as a search it fell through to
  /// raw text every time, and a path with `:12:` in it would have become a hit.
  it('reads glob as bare paths, with its own no-match sentence', () => {
    expect(parseGlobResult('src/a.ts\nsrc/b.ts')).toEqual({ paths: ['src/a.ts', 'src/b.ts'], empty: false })
    expect(parseGlobResult("No files matching '**/*.zig' found.")).toEqual({ paths: [], empty: true })
  })

  it('reads a directory listing, kind padding and all, and keeps the backend’s order', () => {
    const entries = parseDirectoryListing('dir          -  src\nfile    1.2 KB  README.md\nlink      12 B  latest')
    expect(entries).toEqual([
      { kind: 'dir', size: null, name: 'src' },
      { kind: 'file', size: '1.2 KB', name: 'README.md' },
      { kind: 'link', size: '12 B', name: 'latest' },
    ])
    expect(parseDirectoryListing('(empty directory)')).toEqual([])
    expect(parseDirectoryListing('Error: nope')).toBeNull()
  })
})
