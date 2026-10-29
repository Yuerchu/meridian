import { useEffect, useState } from 'react'

import { api } from '@/api'
import { isImageName, isRenderableImageType } from '@/lib/asset-src'
import { isRemote } from '@/lib/transport'
import type { Attachment } from '@/lib/upload'

function fileLooksLikeImage(file: File): boolean {
  if (file.type !== '' && isRenderableImageType(file.type)) return true
  return isImageName(file.name)
}

function blobUrlFromPreview(dataBase64: string, mimeType: string): string {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

/**
 * Object URL of a picture the composer is holding, or `null`.
 *
 * A paste or drop already has a `File`: that becomes a blob URL immediately.
 * A desktop/Android picker only has a path, which the asset protocol cannot
 * open outside `$APPDATA/files`, so the bytes come from `preview_local_image`.
 * Remote composers never take that command — they hold a `File` already.
 */
export function useAttachmentPreview(file: Attachment): string | null {
  const [src, setSrc] = useState<string | null>(null)
  const blob = file.file
  const path = file.path
  const name = file.name
  const missing = file.missing

  useEffect(() => {
    if (missing === true || !((blob && fileLooksLikeImage(blob)) || isImageName(name))) {
      setSrc(null)
      return
    }

    if (blob && fileLooksLikeImage(blob)) {
      const url = URL.createObjectURL(blob)
      setSrc(url)
      return () => {
        URL.revokeObjectURL(url)
        setSrc(null)
      }
    }

    if (typeof path !== 'string' || path === '' || isRemote) {
      setSrc(null)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setSrc(null)
    void api
      .previewLocalImage({ filePath: path })
      .then((preview) => {
        if (cancelled) return
        const url = blobUrlFromPreview(preview.data_base64, preview.mime_type)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
      })
      .catch(() => {
        if (cancelled) return
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- display-only object URL; a refused sniff shows the type icon and never writes the attachment
        setSrc(null)
      })

    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [blob, path, name, missing])

  return src
}
