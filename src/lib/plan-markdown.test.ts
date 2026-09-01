import { describe, expect, it } from 'vitest'

import { parsePlanMarkdown, serializePlanDocument } from './plan-markdown'

describe('plan Markdown codec', () => {
  it('round-trips links, nested lists, and code fences through the closed rich grammar', () => {
    const source = [
      '# Delivery plan',
      '',
      'Read the [design notes](https://example.com/plan "Plan").',
      '',
      '- Parent',
      '  - Nested',
      '  - `inline`',
      '',
      '```ts',
      'const fence = "```"',
      '```',
      '',
    ].join('\n')

    const parsed = parsePlanMarkdown(source)
    expect(parsed.mode).toBe('rich')
    if (parsed.mode !== 'rich') return
    const serialized = serializePlanDocument(parsed.document)
    expect(serialized).toContain('[design notes](https://example.com/plan "Plan")')
    expect(serialized).toMatch(/- Parent\n\n  - Nested/)
    expect(serialized).toContain('````ts\nconst fence = "```"\n````')
    expect(parsePlanMarkdown(serialized).mode).toBe('rich')
  })

  it.each([
    ['raw_html', '<details>hidden</details>'],
    ['image', '![diagram](diagram.png)'],
    ['footnote', 'A note[^1]\n\n[^1]: body'],
    ['heading_level', '#### Deep'],
    ['table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
    ['task_list', '- [ ] work'],
  ] as const)('uses source mode for %s instead of silently dropping syntax', (reason, source) => {
    expect(parsePlanMarkdown(source)).toEqual({ mode: 'source', sourceText: source, reason })
  })

  it.each([
    ['# heading', '\\# heading'],
    ['- item', '\\- item'],
    ['> quote', '\\> quote'],
    ['1. item', '1\\. item'],
  ])('escapes literal paragraph text %s so a save cannot silently change its node type', (text, markdown) => {
    const document = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
    expect(serializePlanDocument(document)).toBe(`${markdown}\n`)
    const reparsed = parsePlanMarkdown(`${markdown}\n`)
    expect(reparsed.mode).toBe('rich')
    if (reparsed.mode === 'rich') expect(reparsed.document).toEqual(document)
  })

  it('escapes ordinary code-like text, strike markers, setext markers, and horizontal rules losslessly', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Keep `raw` and ~~literal~~ ~ with UTF-16 🧪' },
            { type: 'hardBreak' },
            { type: 'text', text: '---' },
            { type: 'hardBreak' },
            { type: 'text', text: '===' },
          ],
        },
      ],
    }

    const markdown = serializePlanDocument(document)
    expect(markdown).toContain('\\`raw\\`')
    expect(markdown).toContain('\\~\\~literal\\~\\~ \\~')
    expect(markdown).toContain('  \n\\---')
    expect(markdown).toContain('  \n\\===')
    const reparsed = parsePlanMarkdown(markdown)
    expect(reparsed.mode).toBe('rich')
    if (reparsed.mode === 'rich') expect(reparsed.document).toEqual(document)
  })

  it('refuses to save a rich value when Markdown would drop a trailing hard break', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Line' }, { type: 'hardBreak' }],
        },
      ],
    }

    expect(() => serializePlanDocument(document)).toThrow('changes the editor document semantics')
  })
})
