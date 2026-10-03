import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRevealedText } from './use-revealed-text'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => ({ useReducedMotion: () => reduced.value }))

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(10)

describe('useRevealedText', () => {
  beforeEach(() => {
    reduced.value = false
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  })
  afterEach(() => vi.useRealTimers())

  function stream(initial: string) {
    return renderHook(({ content, streaming }) => useRevealedText(content, streaming), {
      initialProps: { content: initial, streaming: true },
    })
  }

  it('shows what was there when it mounted, without replaying it', () => {
    const { result } = stream('Hello there')
    expect(result.current.text).toBe('Hello there')
  })

  it('does not draw a new delivery all at once, not even for one render', () => {
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    expect(result.current.text).toBe(LONG.slice(0, 5))
    expect(result.current.revealing).toBe(true)

    act(() => vi.advanceTimersByTime(250))
    expect(result.current.text.length).toBeGreaterThan(5)
    expect(result.current.text.length).toBeLessThan(LONG.length)
    expect(LONG.startsWith(result.current.text)).toBe(true)
  })

  it('finishes the text after the stream ends, and only then stops revealing', () => {
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    act(() => vi.advanceTimersByTime(100))
    rerender({ content: LONG, streaming: false })
    expect(result.current.revealing).toBe(true)

    act(() => vi.advanceTimersByTime(1500))
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('never paces an answer that is not streaming', () => {
    const { result } = renderHook(() => useRevealedText(LONG, false))
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('draws text as it arrives under reduced motion', () => {
    reduced.value = true
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('does not cut an emoji in half', () => {
    const { result, rerender } = stream('a')
    const text = 'a' + '😀'.repeat(200)
    rerender({ content: text, streaming: true })
    for (let i = 0; i < 20; i++) {
      act(() => vi.advanceTimersByTime(30))
      const last = result.current.text.charCodeAt(result.current.text.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })
})
