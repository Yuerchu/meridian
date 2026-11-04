import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertPinnedInvokeCommandCount, pinnedInvokeCommandCount } from './generate-invoke-response-schema.mjs'

const pin = (n) => `expect(INVOKE_RESPONSE_SCHEMA_COMMAND_COUNT).toBe(${n})
    expect(Object.keys(invokeResponseSchemaDocument.commands)).toHaveLength(${n})`

describe('pinnedInvokeCommandCount', () => {
  it('reads both literals', () => {
    assert.deepEqual(pinnedInvokeCommandCount(pin(262)), { toBe: 262, toHaveLength: 262 })
  })

  it('flags a missing pin', () => {
    assert.throws(() => pinnedInvokeCommandCount('expect(true).toBe(true)'), /must pin/)
  })
})

describe('assertPinnedInvokeCommandCount', () => {
  it('accepts a matching pin', () => {
    assert.doesNotThrow(() => assertPinnedInvokeCommandCount(pin(262), 262))
  })

  it('flags a stale pin', () => {
    assert.throws(
      () => assertPinnedInvokeCommandCount(pin(261), 262),
      /pins the command count at 261\/261; api.ts now has 262/,
    )
  })

  it('flags a split pin', () => {
    const source = `expect(INVOKE_RESPONSE_SCHEMA_COMMAND_COUNT).toBe(262)
    expect(Object.keys(invokeResponseSchemaDocument.commands)).toHaveLength(261)`
    assert.throws(() => assertPinnedInvokeCommandCount(source, 262), /262\/261/)
  })
})
