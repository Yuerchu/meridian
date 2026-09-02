import { convertFileSrc } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))
vi.mock('./transport', () => ({ remoteConnection: null }))

import { assetSrc } from './asset-src'

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
