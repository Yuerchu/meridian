/**
 * The system clipboard, and the only place that touches it (a lint rule keeps
 * it that way).
 *
 * Both calls can fail: the WebView refuses a write while the window does not
 * have focus, and a page without clipboard permission refuses both. Every call
 * site once did `navigator.clipboard.writeText(text)` without waiting for the
 * answer, so a refused copy drew the same tick as a good one, a cut removed the
 * text it had failed to keep, and the rejection went nowhere. These are `async`
 * so that a missing `navigator.clipboard` — outside a secure context it is
 * absent, not refusing — rejects like any other failure instead of throwing
 * from inside a click handler.
 */
export async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export async function readClipboard(): Promise<string> {
  return navigator.clipboard.readText()
}

/** What the clipboard holds that a paste could use: its text, and any images. */
export interface ClipboardContent {
  text: string
  files: File[]
}

/**
 * The clipboard as the composer's own Paste reads it, files included.
 *
 * `read()` is what sees an image at all — `readText()` answers "" for a
 * screenshot, which the menu then pasted as nothing. Where `read()` is missing
 * (an older WebView), it falls back to the text alone. Images take a generic
 * name, as the browser gives a pasted one.
 */
export async function readClipboardContent(): Promise<ClipboardContent> {
  if (typeof navigator.clipboard.read !== 'function') return { text: await readClipboard(), files: [] }
  const items = await navigator.clipboard.read()
  let text = ''
  const files: File[] = []
  for (const item of items) {
    for (const type of item.types) {
      if (type === 'text/plain') {
        text += await (await item.getType(type)).text()
      } else if (type.startsWith('image/')) {
        const blob = await item.getType(type)
        files.push(new File([blob], `image.${type.slice('image/'.length)}`, { type }))
      }
    }
  }
  return { text, files }
}
