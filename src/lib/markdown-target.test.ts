import {
  classifyMarkdownTarget,
  markdownFileCandidateHref,
  markdownFileReferenceHref,
  remarkFileReferences,
  splitTextFileReferences,
} from './markdown-target'

describe('classifyMarkdownTarget', () => {
  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    ['//example.com/docs', 'https://example.com/docs'],
    ['www.example.com/docs', 'https://www.example.com/docs'],
  ])('normalizes public URL %s', (input, expected) => {
    expect(classifyMarkdownTarget(input)).toEqual({ kind: 'external', url: expected })
  })

  it('parses relative, absolute, Windows and file URI paths with locations', () => {
    expect(classifyMarkdownTarget('src/chat.ts#L10-20')).toEqual({
      kind: 'file',
      reference: { path: 'src/chat.ts', line: 10, endLine: 20 },
    })
    expect(classifyMarkdownTarget('/repo/src/chat.ts:8:4')).toEqual({
      kind: 'file',
      reference: { path: '/repo/src/chat.ts', line: 8, column: 4 },
    })
    expect(classifyMarkdownTarget('C:\\repo\\src\\chat.ts:3')).toEqual({
      kind: 'file',
      reference: { path: 'C:\\repo\\src\\chat.ts', line: 3 },
    })
    expect(classifyMarkdownTarget('file:///C:/repo/src/chat.ts#L7')).toEqual({
      kind: 'file',
      reference: { path: 'C:/repo/src/chat.ts', line: 7 },
    })
  })

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'mailto:user@example.com', 'not a link'])(
    'refuses unsupported target %s',
    (input) => expect(classifyMarkdownTarget(input)).toEqual({ kind: 'unsupported' }),
  )

  it.each(['条件1/条件2/条件3', 'and/or', '输入/输出'])(
    'does not mistake slash-separated prose %s for a relative file',
    (input) => expect(classifyMarkdownTarget(input)).toEqual({ kind: 'unsupported' }),
  )

  it('still accepts explicit extensionless paths', () => {
    expect(classifyMarkdownTarget('./bin/tool')).toEqual({
      kind: 'file',
      reference: { path: './bin/tool' },
    })
    expect(classifyMarkdownTarget('/etc/hosts')).toEqual({
      kind: 'file',
      reference: { path: '/etc/hosts' },
    })
  })

  it('round-trips generated file reference markers', () => {
    const reference = { path: '含 空格/file.ts', line: 4, column: 2 }
    expect(classifyMarkdownTarget(markdownFileReferenceHref(reference))).toEqual({ kind: 'file', reference })
  })

  it('keeps automatic candidates distinct from explicit file targets', () => {
    const reference = { path: 'fastapi/__init__.md' }
    expect(classifyMarkdownTarget(markdownFileCandidateHref(reference))).toEqual({
      kind: 'file-candidate',
      reference,
    })
  })

  it('keeps source locations within the backend i32 persistence boundary', () => {
    expect(classifyMarkdownTarget('src/chat.ts#L2147483647')).toEqual({
      kind: 'file',
      reference: { path: 'src/chat.ts', line: 2147483647 },
    })
    expect(classifyMarkdownTarget('src/chat.ts#L2147483648')).toEqual({ kind: 'unsupported' })
    expect(classifyMarkdownTarget('src/chat.ts:2147483648')).toEqual({ kind: 'unsupported' })
    expect(
      classifyMarkdownTarget(
        `#meridian-file=${encodeURIComponent(JSON.stringify({ path: 'src/chat.ts', line: 2147483648 }))}`,
      ),
    ).toEqual({ kind: 'unsupported' })
  })
})

describe('file mentions in Markdown text nodes', () => {
  it('finds high-confidence paths without consuming punctuation or URL paths', () => {
    const parts = splitTextFileReferences('See src/chat.ts, README.md and https://example.com/main.ts.')
    expect(parts).toEqual([
      'See ',
      { reference: { path: 'src/chat.ts' }, source: 'src/chat.ts' },
      ', ',
      { reference: { path: 'README.md' }, source: 'README.md' },
      ' and https://example.com/main.ts.',
    ])
  })

  it('emits ambiguous slash-separated text as candidates for workspace validation', () => {
    expect(splitTextFileReferences('按 (条件1/条件2/条件3) 处理，保留 输入/输出 和 and/or。')).toEqual([
      '按 (',
      { reference: { path: '条件1/条件2/条件3' }, source: '条件1/条件2/条件3' },
      ') 处理，保留 ',
      { reference: { path: '输入/输出' }, source: '输入/输出' },
      ' 和 ',
      { reference: { path: 'and/or' }, source: 'and/or' },
      '。',
    ])
  })

  it('does not transform code or existing links in the remark tree', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Open src/a.ts.' }] },
        { type: 'inlineCode', value: 'src/b.ts' },
        { type: 'link', url: 'src/c.ts', children: [{ type: 'text', value: 'src/c.ts' }] },
      ],
    }
    remarkFileReferences()(tree)
    expect(tree.children[0]).toMatchObject({
      children: [
        { type: 'text', value: 'Open ' },
        { type: 'link', children: [{ type: 'text', value: 'src/a.ts' }] },
        { type: 'text', value: '.' },
      ],
    })
    expect(tree.children[1]).toEqual({ type: 'inlineCode', value: 'src/b.ts' })
    expect(tree.children[2]).toEqual({
      type: 'link',
      url: 'src/c.ts',
      children: [{ type: 'text', value: 'src/c.ts' }],
    })
  })
})
