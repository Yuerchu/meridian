/**
 * The two questions a card asks of a path. Kept here rather than beside the
 * diff card so the label that draws a path and the card that draws a diff
 * can share one answer without one importing the other.
 */

/** The file's own name, without the path leading to it. */
export function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

/** The extension a path ends in, or nothing when it has none. */
export function pathExtension(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext || ext === path.toLowerCase()) return undefined
  return ext
}

/** The path split where a label wants it: everything up to and including the
 *  last separator, and the name after it. */
export function splitPath(path: string): { dir: string; name: string } {
  const name = fileNameOf(path)
  return { dir: path.slice(0, path.length - name.length), name }
}
