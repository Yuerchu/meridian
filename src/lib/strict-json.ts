/** Parse first-party JSON without compatibility fallbacks. */
export function parseJsonText(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw Object.assign(new Error(`${label} is invalid JSON: ${String(error)}`), { cause: error })
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function requireExactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const object = requireRecord(value, label)
  const actual = Object.keys(object).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
  return object
}

export function requireKnownKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const object = requireRecord(value, label)
  const allowed = new Set(keys)
  const unknown = Object.keys(object).find((key) => !allowed.has(key))
  if (unknown !== undefined) throw new Error(`${label} contains unknown field: ${unknown}`)
  return object
}

export function parseStringArrayText(raw: string, label: string): string[] {
  const parsed = parseJsonText(raw, label)
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error(`${label} must be a JSON string array`)
  }
  return parsed
}

export function parseStringRecordText(raw: string, label: string): Record<string, string> {
  const parsed = requireRecord(parseJsonText(raw, label), label)
  if (Object.values(parsed).some((value) => typeof value !== 'string')) {
    throw new Error(`${label} must be a JSON object with string values`)
  }
  return parsed as Record<string, string>
}
