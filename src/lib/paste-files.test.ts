import { describe, expect, it } from 'vitest'

import { filesFromPaste } from './paste-files'

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
