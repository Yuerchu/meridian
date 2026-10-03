/**
 * The files a paste carries, or `null` when the paste is text and should go
 * into the field as usual.
 *
 * Text wins whenever there is any. Office puts a rendered picture of the
 * selection on the clipboard beside the text — copy three cells from Excel,
 * or a paragraph from Word, and there is a PNG of them too — so a handler
 * that looked for images first would attach a screenshot of what the user
 * meant to paste as words. Telegram orders its paste handling the same way,
 * for the same reason. An image copied from a browser or a screenshot tool
 * carries no `text/plain`, so it still arrives as a file.
 *
 * Empty files are dropped: a copied folder, or a format the platform could
 * only name, arrives as a zero-byte `File` that would upload as nothing.
 */
export function filesFromPaste(data: DataTransfer | null): File[] | null {
  if (!data) return null
  if (data.getData('text/plain').trim() !== '') return null
  const files: File[] = []
  for (const item of data.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && file.size > 0) files.push(file)
  }
  return files.length > 0 ? files : null
}
