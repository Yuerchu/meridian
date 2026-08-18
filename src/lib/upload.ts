import { api } from '@/api'
import { remoteConnection } from './transport'

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
}

/**
 * Store an attachment and answer with the content part the message will carry.
 *
 * Both routes produce the identical part — `/upload` is `upload_file` with the
 * bytes carried rather than named — so nothing downstream of here can tell
 * which one ran, and the composer does not branch on it either.
 *
 * Rejections are strings on the local path (Tauri's `Err(String)`) and this
 * keeps that: `use-send-message` reports failures with `String(err)`, and an
 * `Error` there would read as "Error: ..." for one transport and not the other.
 */
export async function uploadAttachment(conversationId: string, attachment: Attachment): Promise<unknown> {
  if (!attachment.file) {
    if (attachment.path === undefined) throw `nothing to upload for ${attachment.name}`
    return api.uploadFile(conversationId, attachment.path)
  }

  if (!remoteConnection) throw `no connection to upload ${attachment.name} over`

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

  const body = (await response.json().catch(() => null)) as { ok?: unknown; err?: string } | null
  if (!body) throw `unreadable upload response (${response.status})`
  if (body.err !== undefined) throw body.err
  return body.ok
}
