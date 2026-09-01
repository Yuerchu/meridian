import { describe, expect, it } from 'vitest'
import { parseUploadFileResponse } from './upload'

describe('parseUploadFileResponse', () => {
  it('accepts both exact tagged response variants', () => {
    expect(parseUploadFileResponse({ type: 'image_url', image_url: { url: 'file://image' } })).toEqual({
      type: 'image_url',
      image_url: { url: 'file://image' },
    })
    expect(
      parseUploadFileResponse({
        type: 'file',
        file: { url: 'file://document', mime_type: 'application/pdf', name: 'document.pdf' },
      }),
    ).toEqual({
      type: 'file',
      file: { url: 'file://document', mime_type: 'application/pdf', name: 'document.pdf' },
    })
  })

  it.each([
    null,
    {},
    { type: 'future', file: {} },
    { type: 'image_url' },
    { type: 'image_url', image_url: { url: 'file://image', future: true } },
    { type: 'file', file: { url: 'file://document', mime_type: 'application/pdf' } },
    {
      type: 'file',
      file: { url: 'file://document', mime_type: 'application/pdf', name: 'document.pdf' },
      future: true,
    },
  ])('rejects malformed or extended variants: %j', (value) => {
    expect(() => parseUploadFileResponse(value)).toThrow()
  })
})
