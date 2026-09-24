/**
 * The arguments of a tool call whose JSON is still streaming, as far as they
 * have got.
 *
 * Mid-stream `{"path": "a.txt", "content": "line one\nline tw` is not JSON,
 * and the card used to show it as the raw text it was — the one place every
 * tool call, whatever its renderer, was drawn as JSON source. This closes what
 * is open (the string being written, then each bracket) and, where that still
 * does not parse, drops the unfinished token at the end — a key with no value
 * yet, half a `true`, a trailing comma — and tries again. What comes back is
 * only ever a prefix of what the model is writing: a field is missing or
 * shorter, never invented.
 *
 * `null` when nothing object-shaped can be recovered, which the caller treats
 * the way it treats `{}`.
 */
export function parsePartialObject(text: string): Record<string, unknown> | null {
  let s = text.trim()
  if (!s.startsWith('{')) return null
  s = closeOpenString(s)
  for (let attempt = 0; attempt < 12 && s.length > 0; attempt++) {
    try {
      const value: unknown = JSON.parse(s + closersFor(s))
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      const trimmed = s.replace(/\s*(?:"(?:[^"\\]|\\.)*"|[^\s,:{}[\]"]+|[,:])\s*$/, '')
      if (trimmed === s) return null
      s = trimmed
    }
  }
  return null
}

/** Ends a string the text stopped in the middle of, dropping a lone escape
 *  character that would otherwise escape the closing quote. */
function closeOpenString(s: string): string {
  let inString = false
  let escaped = false
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    }
  }
  if (!inString) return s
  return `${escaped ? s.slice(0, -1) : s}"`
}

/** The brackets still open at the end of `s`, closed innermost first. */
function closersFor(s: string): string {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  return stack.reverse().join('')
}
