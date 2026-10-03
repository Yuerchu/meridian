const keys = new WeakMap<object, number>()
let lastKey = 0

/**
 * A React key for an object that has nothing unique about it but itself — an
 * attachment, where the same file can be attached twice.
 *
 * A cache, not render state: an object asked for twice gets the same key, so
 * a render React replays or discards changes nothing that a committed one
 * would not, which is what kept this out of a component ref. The `WeakMap`
 * lets a removed object take its key with it.
 */
export function objectKey(value: object): number {
  let key = keys.get(value)
  if (key === undefined) {
    key = ++lastKey
    keys.set(value, key)
  }
  return key
}
