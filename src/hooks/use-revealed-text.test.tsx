import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RevealHostContext, useRevealedText, type RevealHost } from './use-revealed-text'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => ({ useReducedMotion: () => reduced.value }))

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(10)
let nextKey = 0

describe('useRevealedText', () => {
  beforeEach(() => {
    reduced.value = false
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  })
  afterEach(() => vi.useRealTimers())

  /** Inside a transcript that hydrated `age` ms ago, or outside any transcript. */
  function stream(initial: string, { age, report }: { age?: number; report?: RevealHost['report'] } = {}) {
    const key = `b${nextKey++}`
    const host: RevealHost = {
      mountedAt: age === undefined ? Number.POSITIVE_INFINITY : performance.now() - age,
      report: report ?? (() => {}),
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RevealHostContext value={host}>{children}</RevealHostContext>
    )
    const view = renderHook(({ content, streaming }) => useRevealedText(key, content, streaming), {
      initialProps: { content: initial, streaming: true },
      wrapper,
    })
    return { ...view, key, wrapper }
  }

  it('shows what was there when it mounted with its transcript, without replaying it', () => {
    const { result } = stream('Hello there', { age: 0 })
    expect(result.current.text).toBe('Hello there')
  })

  it('paces the first delivery of a bubble that arrived while the reader watched', () => {
    const { result } = stream(LONG, { age: 5000 })
    expect(result.current.text).toBe('')
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.text.length).toBeGreaterThan(0)
    expect(result.current.text.length).toBeLessThan(LONG.length)
  })

  it('resumes where it was when remounted mid-stream, instead of starting again', () => {
    const first = stream(LONG, { age: 5000 })
    act(() => vi.advanceTimersByTime(800))
    const seen = first.result.current.text.length
    first.unmount()
    const again = renderHook(() => useRevealedText(first.key, LONG, true), { wrapper: first.wrapper })
    expect(again.result.current.text.length).toBeGreaterThanOrEqual(seen - 2)
    expect(again.result.current.text.length).toBeLessThan(LONG.length)
  })

  it('does not draw a new delivery all at once, not even for one render', () => {
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    expect(result.current.text).toBe(LONG.slice(0, 5))
    expect(result.current.revealing).toBe(true)

    act(() => vi.advanceTimersByTime(250))
    expect(result.current.text.length).toBeGreaterThan(5)
    expect(result.current.text.length).toBeLessThan(LONG.length)
  })

  it('finishes after the stream ends, and tells its transcript until it has', () => {
    const report = vi.fn()
    const { result, rerender, key } = stream(LONG.slice(0, 5), { report })
    rerender({ content: LONG, streaming: true })
    act(() => vi.advanceTimersByTime(100))
    rerender({ content: LONG, streaming: false })
    expect(result.current.revealing).toBe(true)
    expect(report).toHaveBeenLastCalledWith(key, true)

    act(() => vi.advanceTimersByTime(1500))
    expect(result.current).toEqual({ text: LONG, revealing: false })
    expect(report).toHaveBeenLastCalledWith(key, false)
  })

  it('tells its transcript it has stopped when it unmounts mid-reveal', () => {
    const report = vi.fn()
    const { rerender, unmount, key } = stream(LONG.slice(0, 5), { report })
    rerender({ content: LONG, streaming: true })
    act(() => vi.advanceTimersByTime(50))
    unmount()
    expect(report).toHaveBeenLastCalledWith(key, false)
  })

  it('stops its frame loop when it unmounts', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { rerender, unmount } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    act(() => vi.advanceTimersByTime(50))
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it('never paces an answer that is not streaming', () => {
    const { result } = renderHook(() => useRevealedText('done', LONG, false))
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('draws text as it arrives under reduced motion', () => {
    reduced.value = true
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('shows everything once reduced motion is switched on mid-reveal', () => {
    const { result, rerender } = stream(LONG.slice(0, 5))
    rerender({ content: LONG, streaming: true })
    act(() => vi.advanceTimersByTime(100))
    reduced.value = true
    rerender({ content: LONG, streaming: true })
    expect(result.current).toEqual({ text: LONG, revealing: false })
  })

  it('takes nothing back, and paces what follows, when reduced motion is switched off mid-stream', () => {
    reduced.value = true
    const { result, rerender } = stream(LONG.slice(0, 20))
    reduced.value = false
    rerender({ content: LONG.slice(0, 20), streaming: true })
    rerender({ content: LONG, streaming: true })
    let longest = result.current.text.length
    expect(longest).toBeGreaterThanOrEqual(20)
    expect(result.current.revealing).toBe(true)
    expect(longest).toBeLessThan(LONG.length)
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(30))
      expect(result.current.text.length).toBeGreaterThanOrEqual(longest)
      longest = result.current.text.length
    }
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
