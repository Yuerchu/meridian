import { convertFileSrc } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))
vi.mock('./transport', () => ({ remoteConnection: null }))

import { assetSrc, isImageName, isRenderableImageType } from './asset-src'

const mockConvertFileSrc = vi.mocked(convertFileSrc)

beforeEach(() => mockConvertFileSrc.mockClear())

it('converts an ordinary Windows file URI to a drive path', () => {
  expect(assetSrc('file:///C:/Users/A/photo.jpg')).toBe('asset://C:/Users/A/photo.jpg')
  expect(mockConvertFileSrc).toHaveBeenCalledWith('C:/Users/A/photo.jpg')
})

it('repairs historical Windows verbatim file URIs before conversion', () => {
  expect(assetSrc('file://///?/C:/Users/A/photo.jpg')).toBe('asset://C:/Users/A/photo.jpg')
  expect(mockConvertFileSrc).toHaveBeenCalledWith('C:/Users/A/photo.jpg')
})

it('names the extensions the WebView can draw', () => {
  expect(isImageName('image.png')).toBe(true)
  expect(isImageName('Photo.JPEG')).toBe(true)
  expect(isImageName('sheet.xlsx')).toBe(false)
  expect(isImageName('a.heic')).toBe(false)
})

it('accepts only renderable image MIME types', () => {
  expect(isRenderableImageType('image/png')).toBe(true)
  expect(isRenderableImageType('image/jpeg; charset=binary')).toBe(true)
  expect(isRenderableImageType('image/heic')).toBe(false)
  expect(isRenderableImageType('')).toBe(false)
})
