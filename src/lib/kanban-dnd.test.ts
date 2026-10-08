import { describe, expect, it } from 'vitest'
import { dropIndex, moveKeys } from './kanban-dnd'

const order = ['a', 'b', 'c', 'd']

describe('dropIndex', () => {
  it('places before and after a card, counted without the card that moves', () => {
    expect(dropIndex(order, new Set(['a']), 'c', 'before')).toBe(1)
    expect(dropIndex(order, new Set(['a']), 'c', 'after')).toBe(2)
    // Moving down past its own old slot: the index is in the order without it.
    expect(dropIndex(order, new Set(['b']), 'd', 'after')).toBe(3)
  })

  it('appends for a drop on the list itself', () => {
    expect(dropIndex(order, new Set(['x']), null, 'on')).toBe(4)
    expect(dropIndex(order, new Set(['a']), null, 'on')).toBe(3)
  })

  it('refuses a drop onto a card, and a target the column does not hold', () => {
    expect(dropIndex(order, new Set(['a']), 'c', 'on')).toBeNull()
    expect(dropIndex(order, new Set(['a']), 'zz', 'before')).toBeNull()
    // Dropped beside itself: the target is the card that moves.
    expect(dropIndex(order, new Set(['b']), 'b', 'before')).toBeNull()
  })
})

describe('moveKeys', () => {
  it('takes the moving keys out and puts them back at the index', () => {
    expect(moveKeys(order, ['a'], dropIndex(order, new Set(['a']), 'c', 'after')!)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveKeys(order, ['d'], 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('inserts a key from another column', () => {
    expect(moveKeys(order, ['x'], 2)).toEqual(['a', 'b', 'x', 'c', 'd'])
  })
})
