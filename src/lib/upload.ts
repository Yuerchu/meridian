import { api } from '@/api'
import { remoteConnection } from './transport'
import { requireExactKeys, requireRecord } from './strict-json'
import type { UploadFileResponse } from '@/types'

export function parseUploadFileResponse(value: unknown): UploadFileResponse {
  const part = requireRecord(value, 'upload response')
  if (part.type === 'image_url') {
    const exact = requireExactKeys(part, ['type', 'image_url'], 'image upload response')
    const image = requireExactKeys(exact.image_url, ['url'], 'image upload response.image_url')
    if (typeof image.url !== 'string') throw new Error('image upload response.image_url.url must be a string')
    return { type: 'image_url', image_url: { url: image.url } }
  }
  if (part.type === 'file') {
    const exact = requireExactKeys(part, ['type', 'file'], 'file upload response')
    const file = requireExactKeys(exact.file, ['url', 'mime_type', 'name'], 'file upload response.file')
    if (typeof file.url !== 'string' || typeof file.mime_type !== 'string' || typeof file.name !== 'string') {
      throw new Error('file upload response.file has invalid field types')
    }
    return { type: 'file', file: { url: file.url, mime_type: file.mime_type, name: file.name } }
  }
  throw new Error(`unknown upload response type: ${String(part.type)}`)
}

/**
 * One thing the composer is holding, in whichever of the two forms its picker
 * could produce.
 *
 * A desktop picker returns a path and the backend reads the file itself, which
 * is why `upload_file` takes a path at all. Connected to another machine that
 * path names a file on the wrong computer, so the browser's own file input is
 * used instead and hands over the bytes. Exactly one of the two is present.
 */
export interface Attachment {
  /** Absolute path, on the machine whose picker produced it. */
  path?: string
  name: string
  /** The bytes, when the picker was the browser's own. */
  file?: File
  /** Restored from a saved draft whose file is no longer at `path`. Shown as
   *  such and removable; sending is refused while one is held. */
  missing?: boolean
}

/** A `File`'s bytes as bare base64, via the data-URL reader — the one base64
 *  encoder the platform has that neither blows the stack on a large file the
 *  way a spread into `btoa` does, nor needs a manual chunk loop. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(`could not read ${file.name}`)
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Store an attachment and answer with the content part the message will carry.
 *
 * All three routes produce the identical part — `/upload` and
 * `upload_file_bytes` are `upload_file` with the bytes carried rather than
 * named — so nothing downstream of here can tell which one ran, and the
 * composer does not branch on it either. A `File` arrives from the browser's
 * own picker in remote mode and from an HTML5 drop everywhere (the window's
 * native drop handler is off — see `use-file-drop` — so a drop never has a
 * path).
 *
 * Rejections are strings on the local path (Tauri's `Err(String)`) and this
 * keeps that: `use-send-message` reports failures with `String(err)`, and an
 * `Error` there would read as "Error: ..." for one transport and not the other.
 */
export async function uploadAttachment(conversationId: string, attachment: Attachment): Promise<UploadFileResponse> {
  if (!attachment.file) {
    if (attachment.path === undefined) throw `nothing to upload for ${attachment.name}`
    return api.uploadFile({ conversationId, filePath: attachment.path })
  }

  if (!remoteConnection) {
    return api.uploadFileBytes({
      conversationId,
      fileName: attachment.name,
      dataBase64: await fileToBase64(attachment.file),
    })
  }

  const form = new FormData()
  form.append('conversationId', conversationId)
  form.append('file', attachment.file)

  let response: Response
  try {
    response = await fetch(remoteConnection.uploadUrl(), {
      method: 'POST',
      headers: { Authorization: await remoteConnection.authHeader() },
      body: form,
    })
  } catch {
    throw 'Meridian is not reachable'
  }

  const raw: unknown = await response.json().catch(() => null)
  if (raw === null) throw `unreadable upload response (${response.status})`
  const body = requireRecord(raw, 'upload envelope')
  if ('err' in body) {
    const error = requireExactKeys(body, ['err'], 'upload error envelope').err
    if (typeof error !== 'string') throw 'upload error envelope.err must be a string'
    throw error
  }
  const ok = requireExactKeys(body, ['ok'], 'upload success envelope').ok
  return parseUploadFileResponse(ok)
}
