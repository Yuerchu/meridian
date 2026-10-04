import type { AttachedFile } from '@/components/chat/input-bar'
import { uploadAttachment } from '@/lib/upload'
import type { StickerContentPart } from '@/types'

/** One element of the stored envelope, as loosely as the transcript reads it. */
export interface UserContentPart {
  type: string
  text?: string
  image_url?: { url: string }
  file?: { url: string; name: string; mime_type: string }
  sticker_id?: string
  name?: string
}

export interface ParsedUserContent {
  /** The parts, when the content is the envelope; `null` for plain text. */
  parts: UserContentPart[] | null
  /** What was written: the text parts joined, or the content itself. */
  text: string
  /** What copying the row should put on the clipboard. */
  copyText: string
}

/**
 * What a user message is stored as: the text itself, or — with attachments or
 * a sticker — the parts envelope `messages.content` and `queued_prompts.content`
 * both carry, which the backend decodes strictly.
 *
 * Uploads each file on the way, which is also the moment its bytes are frozen:
 * a queued message carries the copy made when it was queued, the way an `@`
 * reference carries the snapshot taken then. Not `api.uploadFile` directly: an
 * attachment picked on a device that is not the one holding the file has bytes
 * rather than a path, and only `uploadAttachment` knows which of the two it is.
 */
export async function buildMessageContent(
  conversationId: string,
  text: string,
  files: AttachedFile[] | undefined,
  sticker: StickerContentPart | undefined,
): Promise<string> {
  if ((!files || files.length === 0) && !sticker) return text
  const parts: unknown[] = []
  if (text.trim()) parts.push({ type: 'text', text })
  if (files) parts.push(...(await Promise.all(files.map((f) => uploadAttachment(conversationId, f)))))
  if (sticker) parts.push(sticker)
  return JSON.stringify(parts)
}

/**
 * Read a stored user message back.
 *
 * Only treated as the envelope when every element actually looks like a part;
 * arbitrary text such as "[null]" or "[1,2,3]" stays plain text. The copy text
 * is what the row communicates rather than the envelope: raw JSON exposes local
 * asset URLs and makes a sticker-only message copy as an implementation detail
 * instead of its name.
 */
export function parseUserContent(content: string): ParsedUserContent {
  const plain = { parts: null, text: content, copyText: content }
  if (!content.startsWith('[')) return plain
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return plain
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((p) => typeof p === 'object' && p !== null && typeof (p as { type?: unknown }).type === 'string')
  ) {
    return plain
  }
  const parts = parsed as UserContentPart[]
  const text = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
  const copyText = parts
    .flatMap((part) => {
      if (part.type === 'text') return part.text ?? ''
      if (part.type === 'file') return part.file?.name ?? ''
      if (part.type === 'sticker') return part.name ?? ''
      return ''
    })
    .filter(Boolean)
    .join('\n')
  return { parts, text, copyText }
}

/** The parts that are not text: what a message attached. */
export function attachedParts(parts: UserContentPart[] | null): UserContentPart[] {
  return parts?.filter((p) => p.type !== 'text') ?? []
}
