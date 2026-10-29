import { convertFileSrc } from '@tauri-apps/api/core'
import { remoteConnection } from './transport'

/**
 * Turns a stored attachment URL into one the WebView will actually load.
 *
 * Attachments are kept as `file://` URIs, but the WebView runs on an http
 * origin and blocks `file://` subresources — they have to go through the asset
 * protocol instead. Anything already addressable (http, data, the asset
 * protocol itself) is passed through untouched.
 *
 * Connected to another machine, the file is not on this one at all and the
 * asset protocol has nothing to open: the URL becomes a request to that
 * machine's `/assets` route. It carries a ticket rather than the bearer token,
 * because this string ends up in an `<img src>` — see `SharedState::tickets`.
 * Before the websocket has finished connecting there is no ticket and so no
 * answer, which reads as the image loading a moment late rather than as a
 * broken one.
 */
export function assetSrc(url?: string): string | undefined {
  if (!url) return undefined
  if (!url.startsWith('file://')) return url
  if (remoteConnection) return remoteConnection.assetUrl(url)
  let path = decodeURIComponent(url.slice('file://'.length))
  // `std::fs::canonicalize` used to leak Windows' verbatim `\\?\C:\...`
  // form into stored URIs as `file://///?/C:/...`. The asset protocol scope
  // contains the ordinary drive path, so repair historical rows before asking
  // Tauri to serve them.
  if (/^\/\/\/\?\/[A-Za-z]:\//.test(path)) path = path.slice('///?/'.length)
  // `file:///C:/x` — the authority is empty and the drive letter follows the
  // third slash, which is not part of the path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return convertFileSrc(path)
}

/** Extensions the WebView will render as an image. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'])

/** MIME types that match `IMAGE_EXTENSIONS`. `image/heic` is not among them. */
const RENDERABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

export function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return !!ext && IMAGE_EXTENSIONS.has(ext)
}

export function isRenderableImageType(type: string): boolean {
  const mime = type.split(';')[0]?.trim().toLowerCase()
  return !!mime && RENDERABLE_IMAGE_TYPES.has(mime)
}
