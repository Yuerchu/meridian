import { attachedParts, buildMessageContent, parseUserContent } from './message-content'

const upload = vi.hoisted(() => ({
  uploadAttachment: vi.fn((_conversationId: string, file: { name: string }) =>
    Promise.resolve({
      type: 'file',
      file: { url: `file:///data/files/c1/${file.name}`, mime_type: 'application/pdf', name: file.name },
    }),
  ),
}))
vi.mock('@/lib/upload', () => upload)

describe('buildMessageContent', () => {
  beforeEach(() => {
    upload.uploadAttachment.mockClear()
  })

  it('is the text itself when nothing is attached, and uploads nothing', async () => {
    expect(await buildMessageContent('c1', 'plain', undefined, undefined)).toBe('plain')
    expect(await buildMessageContent('c1', 'plain', [], undefined)).toBe('plain')
    expect(upload.uploadAttachment).not.toHaveBeenCalled()
  })

  it('is the parts envelope in attachment order, with no empty text part', async () => {
    const content = await buildMessageContent('c1', '  ', [{ name: 'a.pdf' }, { name: 'b.pdf' }], {
      type: 'sticker',
      sticker_id: 's1',
      name: 'wave',
    })
    expect(JSON.parse(content)).toEqual([
      { type: 'file', file: { url: 'file:///data/files/c1/a.pdf', mime_type: 'application/pdf', name: 'a.pdf' } },
      { type: 'file', file: { url: 'file:///data/files/c1/b.pdf', mime_type: 'application/pdf', name: 'b.pdf' } },
      { type: 'sticker', sticker_id: 's1', name: 'wave' },
    ])
  })
})

describe('parseUserContent', () => {
  it('reads plain text, including text that merely starts with a bracket', () => {
    for (const content of ['hello', '[QQ] hi', '[null]', '[1,2,3]', '[not json']) {
      expect(parseUserContent(content)).toEqual({ parts: null, text: content, copyText: content })
    }
  })

  it('reads the envelope as what was written and what was attached', () => {
    const content = JSON.stringify([
      { type: 'text', text: 'compare' },
      { type: 'image_url', image_url: { url: 'file:///x.png' } },
      { type: 'file', file: { url: 'file:///r.pdf', mime_type: 'application/pdf', name: 'report.pdf' } },
    ])
    const parsed = parseUserContent(content)
    expect(parsed.text).toBe('compare')
    expect(parsed.copyText).toBe('compare\nreport.pdf')
    expect(attachedParts(parsed.parts).map((p) => p.type)).toEqual(['image_url', 'file'])
  })
})
