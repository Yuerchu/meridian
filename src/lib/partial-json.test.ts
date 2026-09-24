import { describe, expect, it } from 'vitest'
import { parsePartialObject } from '@/lib/partial-json'

describe('parsePartialObject', () => {
  it('reads a complete object unchanged', () => {
    expect(parsePartialObject('{"a": 1, "b": [true]}')).toEqual({ a: 1, b: [true] })
  })

  it('keeps a string value that is still being written', () => {
    expect(parsePartialObject('{"path": "a.txt", "content": "line one\\nline tw')).toEqual({
      path: 'a.txt',
      content: 'line one\nline tw',
    })
  })

  it('drops a key that has no value yet', () => {
    expect(parsePartialObject('{"path": "a.txt", "cont')).toEqual({ path: 'a.txt' })
    expect(parsePartialObject('{"path": "a.txt", "content":')).toEqual({ path: 'a.txt' })
  })

  it('drops half a literal and a trailing comma', () => {
    expect(parsePartialObject('{"a": 1, "b": tr')).toEqual({ a: 1 })
    expect(parsePartialObject('{"a": 1,')).toEqual({ a: 1 })
  })

  it('closes nested brackets', () => {
    expect(parsePartialObject('{"todos": [{"content": "x", "status": "pend')).toEqual({
      todos: [{ content: 'x', status: 'pend' }],
    })
  })

  it('does not end an escaped quote early', () => {
    expect(parsePartialObject('{"q": "say \\"hi\\')).toEqual({ q: 'say "hi' })
  })

  it('answers null for what is not an object', () => {
    expect(parsePartialObject('')).toBeNull()
    expect(parsePartialObject('[1, 2')).toBeNull()
    expect(parsePartialObject('not json')).toBeNull()
  })
})
