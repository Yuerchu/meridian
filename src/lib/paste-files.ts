/**
 * Which a paste is: files to attach, or text for the field.
 *
 * Text wins whenever there is any. Office puts a rendered picture of the
 * selection on the clipboard beside the text — copy three cells from Excel,
 * or a paragraph from Word, and there is a PNG of them too — so a handler
 * that looked for images first would attach a screenshot of what the user
 * meant to paste as words. Telegram orders its paste handling the same way,
 * for the same reason. An image copied from a browser or a screenshot tool
 * carries no `text/plain`, so it still arrives as a file.
 *
 * One exception: text that is nothing but a single URL beside images only.
 * WebKit's Copy Image put the image's address on the clipboard with it until
 * late 2025, so a remote client in an older Safari would paste the link
 * instead of the picture. Cells and paragraphs are not a lone URL, and a copied
 * link carries no image beside it.
 *
 * Empty files are dropped: a copied folder, or a format the platform could
 * only name, arrives as a zero-byte `File` that would upload as nothing.
 */
export function pickPasted(text: string, files: readonly File[]): File[] | null {
  const kept = files.filter((file) => file.size > 0)
  if (kept.length === 0) return null
  const trimmed = text.trim()
  if (trimmed === '') return kept
  const imagesOnly = kept.every((file) => file.type.startsWith('image/'))
  return imagesOnly && /^https?:\/\/\S+$/i.test(trimmed) ? kept : null
}

/** `pickPasted` over a paste event's clipboard data. */
export function filesFromPaste(data: DataTransfer | null): File[] | null {
  if (!data) return null
  const files: File[] = []
  for (const item of data.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return pickPasted(data.getData('text/plain'), files)
}
