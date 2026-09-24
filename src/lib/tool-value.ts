import type { TFunction } from 'i18next'

const LONG_STRING = 120

/** The locale's name for a field, or the field's own name. Shared with the
 *  argument rows in `tool-call-block.tsx`, so a key reads the same wherever it
 *  appears. */
export function fieldLabel(t: TFunction, key: string): string {
  const labelKey = `chat.tool.param.${key}`
  const label = t(labelKey)
  return label === labelKey ? key : label
}

/** An object or an array parsed out of a tool's text, or `null` when the text
 *  is not one. A bare JSON string or number is text, not structure. */
export function parseStructured(text: string): unknown[] | Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null ? (value as unknown[] | Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Short enough for one line beside its label. */
export function isInlineValue(value: unknown): boolean {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return true
  if (typeof value === 'string') return !value.includes('\n') && value.length <= LONG_STRING
  return false
}
