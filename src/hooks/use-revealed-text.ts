import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { RevealPacer } from '@/lib/reveal-pacer'

/**
 * Not more often than the chunk flush (`CHUNK_FLUSH_MS` in
 * use-global-event-listener): every reveal re-lexes the whole message, and
 * pacing must not cost more renders than streaming already did.
 */
const MIN_RENDER_INTERVAL_MS = 24

/**
 * A bubble that mounts this long after its transcript did appeared while the
 * reader was watching: its first delivery has not been seen, and is paced from
 * nothing. One that mounts with the transcript — a conversation opened, a
 * sheet shown — holds text that was already there, and starts complete.
 */
const LIVE_AFTER_MS = 300

/**
 * What a transcript tells the bubbles in it, and hears back from them.
 *
 * `mountedAt` dates the transcript, for `LIVE_AFTER_MS`. `report` is how the
 * transcript learns that text is still being drawn after the stream itself has
 * ended — its end-of-turn scroll has to wait for that (`AnswerSettle`), or it
 * measures a half-drawn answer, finds it fits, and declines for good.
 *
 * Outside a transcript (tests, the playground) nothing is ever live and nobody
 * listens.
 */
export interface RevealHost {
  mountedAt: number
  report: (key: string, revealing: boolean) => void
}
export const RevealHostContext = createContext<RevealHost>({
  mountedAt: Number.POSITIVE_INFINITY,
  report: () => {},
})

/**
 * How much of each bubble has been drawn, by bubble key, for as long as the
 * window lives. A bubble remounted mid-stream — its turn re-keyed, a row
 * swapped — resumes from here instead of being taken for a new one.
 */
const drawn = new Map<string, number>()

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
 * missing time, the transcript's end-of-turn scroll) has to read
 * `streaming || revealing`, or it acts on half a sentence.
 *
 * Text already seen is never revealed again: a transcript opened mid-answer
 * starts complete and paces only what arrives afterwards, and a bubble
 * remounted mid-stream resumes where it was. A bubble born live is paced from
 * its first character, so a relay that buffers a paragraph into the first
 * delivery is drawn at a pace too. A finished answer is never paced, and
 * neither is anything under reduced motion — text appearing as it arrives is
 * the honest fallback, and the one there was before. Turning reduced motion on
 * mid-stream shows everything at once; turning it off holds what is shown and
 * paces from there.
 */
export function useRevealedText(
  key: string,
  content: string,
  streaming: boolean,
): { text: string; revealing: boolean } {
  const reduced = useReducedMotion() ?? false
  const host = useContext(RevealHostContext)
  const paced = streaming && !reduced

  // `null` is "show everything"; a number is how much of `content` to show.
  // Held from the render a stream starts in: left to the first frame, the
  // render that brings the next delivery would draw all of it once before the
  // pacer cut it back.
  const [shown, setShown] = useState<number | null>(() => {
    if (!paced) return null
    const resumed = drawn.get(key)
    if (resumed !== undefined) return Math.min(resumed, content.length)
    return performance.now() - host.mountedAt > LIVE_AFTER_MS ? 0 : content.length
  })
  const [wasPaced, setWasPaced] = useState(paced)
  if (paced !== wasPaced) {
    setWasPaced(paced)
    if (paced && shown === null) setShown(content.length)
    // Reduced motion switched on: everything, now. (A stream that ends keeps
    // its number, and the pacer drains it.)
    if (!paced && reduced) setShown(null)
  }

  const pacer = useRef<RevealPacer | null>(null)
  const lastRender = useRef(0)

  useEffect(() => {
    if (reduced) {
      pacer.current = null
      return
    }
    if (!pacer.current) {
      if (!streaming || shown === null) return
      pacer.current = new RevealPacer(shown)
    }
    if (streaming) pacer.current.receive(content.length, performance.now() / 1000)
    else pacer.current.finish(content.length)

    // One loop per run of this effect, cancelled by its cleanup: a delivery
    // restarts it, which the pacer does not notice (its step is time-based and
    // capped), and unmounting stops it.
    let frame = 0
    const tick = (time: number) => {
      const active = pacer.current
      if (!active) return
      const { shown: next, done } = active.frame(time / 1000)
      drawn.set(key, next)
      if (done) {
        pacer.current = null
        drawn.delete(key)
        setShown(null)
        return
      }
      if (time - lastRender.current >= MIN_RENDER_INTERVAL_MS) {
        lastRender.current = time
        setShown(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` only seeds a new pacer; once there, the pacer owns it
  }, [key, content.length, streaming, reduced])

  const revealing = shown !== null
  const { report } = host
  useEffect(() => {
    report(key, revealing)
    return () => report(key, false)
  }, [report, key, revealing])

  if (shown === null) return { text: content, revealing: false }
  return { text: cut(content, shown), revealing: true }
}
