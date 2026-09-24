import type { InvokeResponseSchema } from '@/lib/invoke-response-schema'
import { invokeResponseSchemaDocument } from '@/lib/invoke-response-schema.generated'

/**
 * What a command the fixtures do not cover answers with, derived from its
 * response schema rather than written by hand.
 *
 * Only the answers that are honestly "nothing" are synthesised: `null` for a
 * void command or a nullable one, `[]` for a list. Anything that would need a
 * made-up object is refused instead — an invented settings row full of empty
 * strings is worse than an error the page already knows how to draw.
 */
export type EmptyAnswer = { value: null | [] } | null

function resolve(schema: InvokeResponseSchema): InvokeResponseSchema {
  let current = schema
  while (current.kind === 'ref') current = invokeResponseSchemaDocument.definitions[current.id]
  return current
}

function emptyOf(schema: InvokeResponseSchema): EmptyAnswer {
  const resolved = resolve(schema)
  if (resolved.kind === 'null') return { value: null }
  if (resolved.kind === 'array') return { value: [] }
  if (resolved.kind === 'union') {
    const variants = resolved.variants.map(resolve)
    if (variants.some((variant) => variant.kind === 'null')) return { value: null }
    if (variants.some((variant) => variant.kind === 'array')) return { value: [] }
  }
  return null
}

export function emptyAnswerFor(command: string): EmptyAnswer {
  const schema = invokeResponseSchemaDocument.commands[command]
  return schema ? emptyOf(schema) : null
}

/** Whether a command's answer is `null` and nothing else — a write that returns nothing. */
export function isVoidCommand(command: string): boolean {
  const schema = invokeResponseSchemaDocument.commands[command]
  return schema !== undefined && resolve(schema).kind === 'null'
}

/** Rejected the way Tauri rejects an `Err(String)`, so every existing
 *  `catch (err) { String(err) }` shows it as an ordinary error. */
export function demoUnsupported(command: string): string {
  return `DemoUnsupported: ${command} is not available with demo data`
}
