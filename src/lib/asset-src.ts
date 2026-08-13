import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * Turns a stored attachment URL into one the WebView will actually load.
 *
 * Attachments are kept as `file://` URIs, but the WebView runs on an http
 * origin and blocks `file://` subresources — they have to go through the asset
 * protocol instead. Anything already addressable (http, data, the asset
 * protocol itself) is passed through untouched.
 */
export function assetSrc(url?: string): string | undefined {
  if (!url) return undefined
  if (!url.startsWith('file://')) return url
  let path = url.slice('file://'.length)
  // `file:///C:/x` — the authority is empty and the drive letter follows the
  // third slash, which is not part of the path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return convertFileSrc(decodeURIComponent(path))
}

/** Extensions the WebView will render as an image. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'])

export function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return !!ext && IMAGE_EXTENSIONS.has(ext)
}

/**
 * A preview URL for a file the composer is holding, or nothing.
 *
 * Composer attachments are bare absolute paths rather than URIs — that is what
 * the picker returns and what the backend expects to read. Only what can be
 * addressed is answered: a photo taken on Android arrives as a `content://`
 * URI the asset protocol cannot open, and a preview that fails is worse than
 * the icon it would have replaced.
 */
export function localPreviewSrc(path: string, name: string): string | undefined {
  if (!isImageName(name)) return undefined
  if (path.startsWith('file://')) return assetSrc(path)
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined
  return convertFileSrc(path)
}
