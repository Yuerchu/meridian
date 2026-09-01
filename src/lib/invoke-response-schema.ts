import { assertDecimal } from './decimal'
import { invokeResponseSchemaDocument } from './invoke-response-schema.generated'

export type InvokeResponseSchema =
  | { readonly kind: 'null' }
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'decimal' }
  | { readonly kind: 'json' }
  | { readonly kind: 'array'; readonly item: InvokeResponseSchema }
  | { readonly kind: 'tuple'; readonly items: readonly InvokeResponseSchema[] }
  | {
      readonly kind: 'object'
      readonly fields: Readonly<Record<string, { readonly optional: boolean; readonly schema: InvokeResponseSchema }>>
      readonly additional: InvokeResponseSchema | null
    }
  | { readonly kind: 'union'; readonly variants: readonly InvokeResponseSchema[] }
  | { readonly kind: 'ref'; readonly id: number }
  | { readonly kind: 'preference' }

export interface InvokeResponseSchemaDocument {
  readonly commands: Readonly<Record<string, InvokeResponseSchema>>
  readonly definitions: readonly InvokeResponseSchema[]
  readonly preferenceValues: Readonly<Record<string, InvokeResponseSchema>>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fail(path: string, expected: string): never {
  throw new TypeError(`${path} must be ${expected}`)
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function validateArrayShape(value: readonly unknown[], path: string): void {
  const keys = Object.keys(value)
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    fail(path, 'a dense JSON array without extra fields')
  }
}

function validateJson(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'a finite JSON number')
    return
  }
  if (Array.isArray(value)) {
    validateArrayShape(value, path)
    value.forEach((item, index) => validateJson(item, `${path}[${index}]`))
    return
  }
  if (!isPlainObject(value)) fail(path, 'a JSON value')
  for (const [key, item] of Object.entries(value)) validateJson(item, `${path}.${key}`)
}

function validatePreference(value: unknown, args: Record<string, unknown> | undefined, path: string): void {
  const request = args?.request
  if (!isPlainObject(request) || typeof request.key !== 'string') {
    throw new TypeError('get_preference request.key is required to validate its correlated response')
  }
  if (!hasOwn(invokeResponseSchemaDocument.preferenceValues, request.key)) {
    throw new TypeError(`get_preference request.key is unknown: ${JSON.stringify(request.key)}`)
  }
  const valueSchema = invokeResponseSchemaDocument.preferenceValues[request.key]
  if (!isPlainObject(value)) fail(path, 'an object')
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'key' || keys[1] !== 'value') {
    fail(path, 'an exact object with keys: key, value')
  }
  if (value.key !== request.key) {
    throw new TypeError(`${path}.key must equal requested key ${JSON.stringify(request.key)}`)
  }
  validate(valueSchema, value.value, `${path}.value`, args)
}

function validate(
  schema: InvokeResponseSchema,
  value: unknown,
  path: string,
  args: Record<string, unknown> | undefined,
): void {
  switch (schema.kind) {
    case 'null':
      if (value !== null) fail(path, 'null')
      return
    case 'string':
      if (typeof value !== 'string') fail(path, 'a string')
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number')
      return
    case 'boolean':
      if (typeof value !== 'boolean') fail(path, 'a boolean')
      return
    case 'literal':
      if (value !== schema.value) fail(path, JSON.stringify(schema.value))
      return
    case 'decimal':
      try {
        assertDecimal(value)
      } catch (error) {
        throw Object.assign(new TypeError(`${path} must be a canonical decimal string`), { cause: error })
      }
      return
    case 'json':
      validateJson(value, path)
      return
    case 'array':
      if (!Array.isArray(value)) fail(path, 'an array')
      validateArrayShape(value, path)
      value.forEach((item, index) => validate(schema.item, item, `${path}[${index}]`, args))
      return
    case 'tuple':
      if (!Array.isArray(value) || value.length !== schema.items.length) {
        fail(path, `an array of length ${schema.items.length}`)
      }
      validateArrayShape(value, path)
      schema.items.forEach((item, index) => validate(item, value[index], `${path}[${index}]`, args))
      return
    case 'object': {
      if (!isPlainObject(value)) fail(path, 'an object')
      for (const [field, fieldSchema] of Object.entries(schema.fields)) {
        if (!hasOwn(value, field)) {
          if (!fieldSchema.optional) fail(`${path}.${field}`, 'present')
          continue
        }
        validate(fieldSchema.schema, value[field], `${path}.${field}`, args)
      }
      for (const field of Object.keys(value)) {
        if (hasOwn(schema.fields, field)) continue
        if (schema.additional === null) throw new TypeError(`${path} contains unknown field ${JSON.stringify(field)}`)
        validate(schema.additional, value[field], `${path}.${field}`, args)
      }
      return
    }
    case 'union': {
      const failures = []
      for (const variant of schema.variants) {
        try {
          validate(variant, value, path, args)
          return
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new TypeError(`${path} does not match any allowed shape: ${failures.join(' | ')}`)
    }
    case 'ref': {
      const target = invokeResponseSchemaDocument.definitions[schema.id]
      if (!target) throw new Error(`response schema references missing definition ${schema.id}`)
      validate(target, value, path, args)
      return
    }
    case 'preference':
      validatePreference(value, args, path)
  }
}

/** Validate a backend answer before either local or remote callers can observe it. */
export function assertInvokeResponse<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  value: unknown,
): asserts value is T {
  if (!hasOwn(invokeResponseSchemaDocument.commands, command)) {
    throw new TypeError(`No response schema is registered for command ${JSON.stringify(command)}`)
  }
  const schema = invokeResponseSchemaDocument.commands[command]
  validate(schema, value, `${command} response`, args)
}
