import { describe, expect, it } from 'vitest'

import {
  activeComposerToken,
  extractComposerReferences,
  insertReferenceToken,
  parseComposerIntent,
  referenceInputs,
  selectExistingReferences,
} from './composer-intent'

describe('composer intent', () => {
  it('extracts quoted, unicode, windows and ranged references in order', () => {
    expect(
      extractComposerReferences('看 @src/main.ts 和 @"docs/设计 稿.md"#L10-20，再看 @C:\\repo\\x.rs#L3'),
    ).toMatchObject([
      { path: 'src/main.ts' },
      { path: 'docs/设计 稿.md', lineStart: 10, lineEnd: 20 },
      { path: 'C:\\repo\\x.rs', lineStart: 3, lineEnd: 3 },
    ])
  })

  it('ignores emails, escaped mentions and duplicate references', () => {
    expect(extractComposerReferences('a@b.com \\@literal @src/a.ts @src/a.ts')).toHaveLength(1)
  })

  it('keeps source ranges within the backend i32 persistence boundary', () => {
    expect(extractComposerReferences('@src/a.ts#L2147483647')).toMatchObject([
      { path: 'src/a.ts', lineStart: 2147483647, lineEnd: 2147483647 },
    ])

    const [overflow] = extractComposerReferences('@src/a.ts#L2147483648')
    expect(overflow).toMatchObject({ path: 'src/a.ts#L2147483648' })
    expect(overflow).not.toHaveProperty('lineStart')
    expect(overflow).not.toHaveProperty('lineEnd')
  })

  it('emits complete nullable workspace reference requests', () => {
    expect(referenceInputs(extractComposerReferences('inspect @src/a.ts and @src/b.ts#L3'))).toEqual([
      { path: 'src/a.ts', lineStart: null, lineEnd: null },
      { path: 'src/b.ts', lineStart: 3, lineEnd: 3 },
    ])
  })

  it('keeps only the mentions the workspace holds, in the order they were written', async () => {
    // A decorator parses as a path exactly as a real mention does, and this is
    // the shape that used to fail a whole turn: the trailing `)` is stripped as
    // prose, leaving an unbalanced quote that the backend then tried to stat.
    const draft = "把 @field_validator('time_created') 的写法挪到 @src/a.ts 参考 @docs/b.md"
    const mentions = extractComposerReferences(draft)
    expect(mentions.map((m) => m.path)).toEqual(["field_validator('time_created'", 'src/a.ts', 'docs/b.md'])

    const held = new Set(['src/a.ts', 'docs/b.md'])
    expect(await selectExistingReferences(mentions, (path) => Promise.resolve(held.has(path)))).toEqual([
      { path: 'src/a.ts', lineStart: null, lineEnd: null },
      { path: 'docs/b.md', lineStart: null, lineEnd: null },
    ])
  })

  // Only the prose that ends a token is stripped, so CJK punctuation written
  // without a space keeps whatever follows it inside the path. Existence is the
  // judge here too: no such file, so the mention is text.
  it('drops a mention that ran into the words after it', async () => {
    const mentions = extractComposerReferences('挪到 @src/a.ts，参考一下')
    expect(mentions.map((m) => m.path)).toEqual(['src/a.ts，参考一下'])
    expect(await selectExistingReferences(mentions, (path) => Promise.resolve(path === 'src/a.ts'))).toEqual([])
  })

  it('treats an unreachable or unprobeable mention as prose rather than a path', async () => {
    const mentions = extractComposerReferences('@dataclass @pytest.mark.asyncio @src/a.ts')
    // A probe answers false for "does not exist" and "not reachable from here"
    // alike; neither is a reference, and neither may fail the turn.
    expect(await selectExistingReferences(mentions, (path) => Promise.resolve(path === 'src/a.ts'))).toEqual([
      { path: 'src/a.ts', lineStart: null, lineEnd: null },
    ])
    expect(await selectExistingReferences(mentions, () => Promise.resolve(false))).toEqual([])
  })

  it('separates shell, slash, paths and escaped prefixes', () => {
    expect(parseComposerIntent('! pnpm test')).toEqual({ kind: 'shell', raw: '! pnpm test', command: 'pnpm test' })
    expect(parseComposerIntent('  /compact focus on files')).toMatchObject({
      kind: 'slash',
      name: 'compact',
      args: 'focus on files',
    })
    expect(parseComposerIntent('/usr/bin/env')).toMatchObject({ kind: 'prompt' })
    expect(parseComposerIntent('\\!literal')).toMatchObject({ kind: 'prompt', text: '!literal' })
    expect(parseComposerIntent('\\/compact')).toMatchObject({ kind: 'prompt', text: '/compact' })
    expect(parseComposerIntent('\\@literal')).toMatchObject({ kind: 'prompt', text: '@literal', references: [] })
    expect(parseComposerIntent('\\@literal @src/a.ts')).toMatchObject({
      kind: 'prompt',
      text: '@literal @src/a.ts',
      references: [{ path: 'src/a.ts' }],
    })
  })

  it('finds a caret-local reference token and inserts directory or file paths', () => {
    const value = 'read @src/co later'
    const token = activeComposerToken(value, 'read @src/co'.length)
    expect(token).toMatchObject({ kind: 'reference', query: 'src/co' })
    expect(insertReferenceToken(value, token!, 'src/components', true)).toEqual({
      value: 'read @src/components/ later',
      caret: 'read @src/components/'.length,
      keepOpen: true,
    })
    expect(insertReferenceToken('read @do', activeComposerToken('read @do', 8)!, 'docs/a b.md', false)).toEqual({
      value: 'read @"docs/a b.md" ',
      caret: 'read @"docs/a b.md" '.length,
      keepOpen: false,
    })
    const spacedDirectory = insertReferenceToken(
      'read @do',
      activeComposerToken('read @do', 8)!,
      'docs/design notes',
      true,
    )
    expect(spacedDirectory).toEqual({
      value: 'read @"docs/design notes/"',
      caret: 'read @"docs/design notes/"'.length,
      keepOpen: true,
    })
    expect(activeComposerToken(spacedDirectory.value, spacedDirectory.caret)).toMatchObject({
      kind: 'reference',
      query: 'docs/design notes/',
    })
  })
})
