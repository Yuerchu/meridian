import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useAttachmentPreview } from './use-attachment-preview'

const apiMocks = vi.hoisted(() => ({
  messages: {
    readLocalImagePreview: vi.fn(),
  },
}))

const transport = vi.hoisted(() => ({
  isRemote: false,
}))

vi.mock('@/api', () => ({ api: apiMocks }))
vi.mock('@/lib/transport', () => ({
  get isRemote() {
    return transport.isRemote
  },
  remoteConnection: null,
}))

const createObjectURL = vi.fn((blob: Blob) => `blob:test/${blob.size}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  transport.isRemote = false
  apiMocks.messages.readLocalImagePreview.mockReset()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

it('turns a pasted image File into an object URL and revokes it on unmount', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })
  const { result, unmount } = renderHook(() => useAttachmentPreview({ name: 'image.png', file }))
  expect(result.current).toBe('blob:test/3')
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  expect(apiMocks.messages.readLocalImagePreview).not.toHaveBeenCalled()
  unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/3')
})

it('uses the filename when a pasted image has no MIME type', () => {
  const file = new File([new Uint8Array([1])], 'image.png', { type: '' })
  const { result } = renderHook(() => useAttachmentPreview({ name: 'image.png', file }))
  expect(result.current).toBe('blob:test/1')
})

it('does not preview a spreadsheet File', () => {
  const file = new File(['x'], 'sheet.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const { result } = renderHook(() => useAttachmentPreview({ name: 'sheet.xlsx', file }))
  expect(result.current).toBeNull()
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(apiMocks.messages.readLocalImagePreview).not.toHaveBeenCalled()
})

it('does not preview HEIC even when the File type says image', () => {
  const file = new File(['x'], 'a.heic', { type: 'image/heic' })
  const { result } = renderHook(() => useAttachmentPreview({ name: 'a.heic', file }))
  expect(result.current).toBeNull()
  expect(createObjectURL).not.toHaveBeenCalled()
})

it('does not fetch a missing draft image', () => {
  const { result } = renderHook(() => useAttachmentPreview({ name: 'gone.png', path: 'C:/gone.png', missing: true }))
  expect(result.current).toBeNull()
  expect(apiMocks.messages.readLocalImagePreview).not.toHaveBeenCalled()
})

it('loads a picker path through preview_local_image', async () => {
  apiMocks.messages.readLocalImagePreview.mockResolvedValue({
    mime_type: 'image/png',
    data_base64: btoa('PNGDATA'),
  })
  const { result } = renderHook(() => useAttachmentPreview({ name: 'photo.png', path: 'C:/Users/A/photo.png' }))
  await waitFor(() => expect(result.current).toBe(`blob:test/${'PNGDATA'.length}`))
  expect(apiMocks.messages.readLocalImagePreview).toHaveBeenCalledWith({ file_path: 'C:/Users/A/photo.png' })
})

it('does not ask the host to preview a path while remote', () => {
  transport.isRemote = true
  const { result } = renderHook(() => useAttachmentPreview({ name: 'photo.png', path: 'C:/Users/A/photo.png' }))
  expect(result.current).toBeNull()
  expect(apiMocks.messages.readLocalImagePreview).not.toHaveBeenCalled()
})

it('treats a refused preview as no picture', async () => {
  apiMocks.messages.readLocalImagePreview.mockRejectedValue('not a previewable image')
  const { result } = renderHook(() => useAttachmentPreview({ name: 'photo.png', path: 'C:/Users/A/photo.png' }))
  await waitFor(() => expect(apiMocks.messages.readLocalImagePreview).toHaveBeenCalled())
  expect(result.current).toBeNull()
})
