import { Editor } from '@tiptap/core'
import { Link } from '@tiptap/extension-link'
import { Underline } from '@tiptap/extension-underline'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { PlanCommentDecorations } from './plan-comment-decorations'
import { normalizePlanEditorDocument, parsePlanMarkdown, serializePlanDocument } from './plan-markdown'

// What RichTextEditor actually builds (`rich-text-editor.js`),
// plus the one extension PlanReviewEditor adds. The codec is otherwise tested
// only against its own generateJSON, which runs no plugins — so nothing else in
// this file can see what the live editor does to a document between two
// keystrokes, and that is exactly where a plan ending in a list used to die.
const liveEditorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false }),
  Placeholder.configure({ placeholder: 'Write the plan…' }),
  CharacterCount.configure({ limit: undefined }),
  PlanCommentDecorations,
]

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

describe('plan Markdown codec against the live editor', () => {
  it('accepts the trailing paragraph StarterKit appends after a list on the first transaction', () => {
    const parsed = parsePlanMarkdown('# Plan\n\n## Out of scope\n\n- no fallback\n- no new fields\n')
    expect(parsed.mode).toBe('rich')
    if (parsed.mode !== 'rich') return

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: liveEditorExtensions,
      content: parsed.document,
    })
    expect(editor.getJSON()).toEqual(parsed.document)
    // A click: a selection-only transaction with no edit in it.
    editor.view.dispatch(editor.state.tr)
    const live = editor.getJSON()
    editor.destroy()

    expect(live.content?.at(-1)).toEqual({ type: 'paragraph' })
    expect(serializePlanDocument(live)).toBe(parsed.normalizedMarkdown)
    expect(normalizePlanEditorDocument(live)).toEqual(parsed.document)
  })

  it('ignores an empty paragraph between blocks, which Markdown cannot write', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'After' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    }
    expect(serializePlanDocument(document)).toBe('Before\n\n## After\n\n-\n')
  })

  it('keeps one paragraph when the whole document is empty', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(serializePlanDocument(empty)).toBe('')
    expect(normalizePlanEditorDocument(empty)).toBe(empty)
    expect(
      normalizePlanEditorDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] }),
    ).toEqual(empty)
  })
})
