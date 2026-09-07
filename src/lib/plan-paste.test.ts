import { Editor } from '@tiptap/core'
import { Underline } from '@tiptap/extension-underline'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { stripUnsupportedPasteMarks } from './plan-paste'

function marksIn(html: string): string[] {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Underline],
    content: '<p></p>',
  })
  const dom = document.createElement('div')
  dom.innerHTML = html
  const slice = stripUnsupportedPasteMarks(ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(dom))
  const marks = new Set<string>()
  slice.content.descendants((node) => {
    for (const mark of node.marks) marks.add(mark.type.name)
  })
  editor.destroy()
  return [...marks].sort()
}

describe('pasted content', () => {
  it('drops the underline mark the Markdown codec cannot write and keeps the rest', () => {
    // What Word, Docs and most web pages put on the clipboard: the tag and the style.
    expect(marksIn('<p><u>tagged</u> <span style="text-decoration: underline"><b>styled</b></span></p>')).toEqual([
      'bold',
    ])
  })

  it('reaches marks nested inside list items and links', () => {
    expect(marksIn('<ul><li><p><a href="https://example.com"><u>deep</u></a></p></li></ul>')).toEqual(['link'])
  })
})
