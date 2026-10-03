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
