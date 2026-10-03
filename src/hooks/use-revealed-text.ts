import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { RevealPacer } from '@/lib/reveal-pacer'

/**
 * Not more often than the chunk flush (`CHUNK_FLUSH_MS` in
 * use-global-event-listener): every reveal re-lexes the whole message, and
 * pacing must not cost more renders than streaming already did.
 */
const MIN_RENDER_INTERVAL_MS = 24

/** A cut that does not split a surrogate pair, which would draw half an emoji. */
function cut(text: string, length: number): string {
  if (length >= text.length) return text
  const code = text.charCodeAt(length - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length)
}

/**
 * A streaming answer drawn at an even pace (see `RevealPacer`).
 *
 * `revealing` is true from the first paced frame until everything received has
 * been drawn — including the moment after the stream ends, while the last
 * burst drains. Anything that means "still being written" (the caret, the
 * missing time) has to read `streaming || revealing`, or the time would appear
 * under half a sentence.
 *
 * What was on screen when this mounted is never revealed again: a transcript
 * opened mid-answer, or a row remounted by a reload, starts complete and paces
 * only what arrives afterwards. A finished answer is never paced at all, and
 * neither is anything under reduced motion — text appearing as it arrives is
 * the honest fallback, and the one there was before.
 */
export function useRevealedText(content: string, streaming: boolean): { text: string; revealing: boolean } {
  const reduced = useReducedMotion() ?? false
  // `null` is "show everything"; a number is how much of `content` to show.
  // A stream holds what is on screen from the render it starts in: were it
  // left to the first frame, the render that brings the next delivery would
  // draw all of it once before the pacer cut it back.
  const [shown, setShown] = useState<number | null>(() => (streaming && !reduced ? content.length : null))
  const [wasStreaming, setWasStreaming] = useState(streaming)
  if (streaming !== wasStreaming) {
    setWasStreaming(streaming)
    if (streaming && !reduced && shown === null) setShown(content.length)
  }
  const pacer = useRef<RevealPacer | null>(null)
  const frame = useRef(0)
  const lastRender = useRef(0)

  useEffect(() => {
    const now = performance.now()
    if (!pacer.current) {
      if (!streaming || reduced) return
      pacer.current = new RevealPacer(content.length)
      return
    }
    if (streaming) pacer.current.receive(content.length, now / 1000)
    else pacer.current.finish(content.length)

    if (frame.current) return
    const tick = (time: number) => {
      const active = pacer.current
      if (!active) {
        frame.current = 0
        return
      }
      const { shown: next, done } = active.frame(time / 1000)
      if (done) {
        pacer.current = null
        frame.current = 0
        setShown(null)
        return
      }
      if (time - lastRender.current >= MIN_RENDER_INTERVAL_MS) {
        lastRender.current = time
        setShown(next)
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [content.length, streaming, reduced])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      pacer.current = null
    },
    [],
  )

  if (shown === null) return { text: content, revealing: false }
  return { text: cut(content, shown), revealing: true }
}
