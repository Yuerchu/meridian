/**
 * One entry of a string map being edited. The `id` is only a React key: two
 * rows may briefly share a name while somebody is typing, and keying on it
 * would swap their inputs under the cursor.
 */
export interface KeyValuePair {
  id: string
  key: string
  value: string
}

let nextPairId = 0
function pairId(): string {
  nextPairId += 1
  return `pair-${nextPairId}`
}

export function newPair(): KeyValuePair {
  return { id: pairId(), key: '', value: '' }
}

export function pairsFromRecord(record: Record<string, string> | null | undefined): KeyValuePair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ id: pairId(), key, value }))
}

/** What the draft compares on — the ids are not part of the value. */
export function pairsSignature(pairs: readonly KeyValuePair[]): string {
  return JSON.stringify(pairs.map((pair) => [pair.key, pair.value]))
}

export class KeyValueError extends Error {
  constructor(
    readonly reason: 'emptyKey' | 'duplicateKey',
    readonly key: string,
  ) {
    super(`${reason}: ${key}`)
  }
}

/**
 * The map the rows describe.
 *
 * A row with neither half filled in is a row somebody added and did not use,
 * and is dropped. A value with no name, or a name given twice, is refused
 * rather than guessed at: the last of two `Authorization` rows silently
 * winning is a request sent with a credential nobody chose.
 */
export function recordFromPairs(pairs: readonly KeyValuePair[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const pair of pairs) {
    const key = pair.key.trim()
    if (!key && !pair.value) continue
    if (!key) throw new KeyValueError('emptyKey', '')
    if (Object.prototype.hasOwnProperty.call(record, key)) throw new KeyValueError('duplicateKey', key)
    record[key] = pair.value
  }
  return record
}
