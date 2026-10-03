import { describe, expect, it } from 'vitest'

import { filesFromPaste, pickPasted } from './paste-files'

/** The parts of a `DataTransfer` a paste handler reads. jsdom has no real one. */
function clipboard(text: string, files: File[]): DataTransfer {
  return {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
  } as unknown as DataTransfer
}

const png = (name = 'image.png', bytes = 3) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

describe('filesFromPaste', () => {
  it('takes the files of a paste that carries no text', () => {
    const shot = png()
    expect(filesFromPaste(clipboard('', [shot]))).toEqual([shot])
  })

  it('leaves a paste with text to the field, even with a picture beside it', () => {
    // What Excel or Word put on the clipboard for a few copied cells.
    expect(filesFromPaste(clipboard('a\tb\n1\t2', [png()]))).toBeNull()
  })

  it('does not count whitespace as text', () => {
    expect(filesFromPaste(clipboard(' \n', [png()]))).toHaveLength(1)
  })

  it('drops empty files, and answers null when nothing is left', () => {
    expect(filesFromPaste(clipboard('', [png('folder', 0)]))).toBeNull()
    expect(filesFromPaste(clipboard('', []))).toBeNull()
    expect(filesFromPaste(null)).toBeNull()
  })
})

describe('pickPasted', () => {
  const png = () => new File([new Uint8Array(3)], 'image.png', { type: 'image/png' })
  const pdf = () => new File([new Uint8Array(3)], 'a.pdf', { type: 'application/pdf' })

  it('takes an image whose only companion is its own address, as older WebKit put it', () => {
    expect(pickPasted('https://example.com/cat.png', [png()])).toHaveLength(1)
  })

  it('keeps a URL as text when what came with it is not an image, or when there is more text', () => {
    expect(pickPasted('https://example.com/a.pdf', [pdf()])).toBeNull()
    expect(pickPasted('see https://example.com/cat.png', [png()])).toBeNull()
    expect(pickPasted('https://a.example\nhttps://b.example', [png()])).toBeNull()
  })
})
