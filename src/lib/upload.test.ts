import { describe, expect, it } from 'vitest'
import { parseUploadFileResponse, uploadAttachment } from './upload'

const apiMocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  uploadFileBytes: vi.fn(),
}))

vi.mock('@/api', () => ({ api: apiMocks }))
vi.mock('./transport', () => ({ remoteConnection: null }))

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

describe('uploadAttachment, locally', () => {
  beforeEach(() => {
    apiMocks.uploadFile.mockReset()
    apiMocks.uploadFileBytes.mockReset()
  })

  it('sends a path to upload_file', async () => {
    const part = { type: 'file', file: { url: 'file:///x', mime_type: 'text/plain', name: 'a.txt' } }
    apiMocks.uploadFile.mockResolvedValue(part)

    await expect(uploadAttachment('c1', { name: 'a.txt', path: 'C:/tmp/a.txt' })).resolves.toBe(part)
    expect(apiMocks.uploadFile).toHaveBeenCalledWith({ conversationId: 'c1', filePath: 'C:/tmp/a.txt' })
  })

  /** A dropped file has no path anywhere — see `use-file-drop` — so the local
   *  transport carries the bytes, the way `/upload` always has remotely. */
  it('sends a pathless File as base64 bytes', async () => {
    const part = { type: 'file', file: { url: 'file:///y', mime_type: 'text/plain', name: 'b.txt' } }
    apiMocks.uploadFileBytes.mockResolvedValue(part)

    const file = new File(['hi'], 'b.txt', { type: 'text/plain' })
    await expect(uploadAttachment('c1', { name: 'b.txt', file })).resolves.toBe(part)
    expect(apiMocks.uploadFileBytes).toHaveBeenCalledWith({
      conversationId: 'c1',
      fileName: 'b.txt',
      dataBase64: btoa('hi'),
    })
    expect(apiMocks.uploadFile).not.toHaveBeenCalled()
  })
})
