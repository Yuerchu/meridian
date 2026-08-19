import { useEffect, useLayoutEffect, useRef } from 'react'

import {
  CX,
  CY,
  DURATION_MS,
  R_RING,
  STATIC_ARC,
  STROKE,
  clamp01,
  frameAt,
  prefersReducedMotion,
  type RingFrame,
} from '@/lib/meridian-ring'
import { cn } from '@/lib/utils'

/**
 * The Meridian mark, optionally arriving as the ring it is a pose of.
 *
 * The geometry lives in `lib/meridian-ring` rather than here because the splash
 * window draws the same animation from a plain script, with no React to import.
 */
export function MeridianMark({
  intro,
  className,
  ...props
}: React.ComponentProps<'svg'> & {
  /** Play the ring's arrival once on mount, then rest on the static shape. */
  intro?: boolean
}) {
  const star = useRef<SVGCircleElement>(null)
  const paths = useRef<(SVGPathElement | null)[]>([])
  const done = useRef(false)

  const apply = (frame: RingFrame) => {
    star.current?.setAttribute('r', frame.rStar.toFixed(2))
    star.current?.setAttribute('opacity', frame.starOpacity.toFixed(3))
    paths.current.forEach((p, i) => p?.setAttribute('d', frame.segments[i] ?? ''))
  }

  /**
   * Come to rest on the written arc, not on the sampled one.
   *
   * The last frame's polyline is the same curve to within a fraction of a
   * pixel, but it is 160 `L` commands that then sit in the DOM for as long as
   * the page is open — and it is a *sample* of the shape the icon is defined
   * as, so the two could drift apart if the step count ever changed.
   */
  const settle = () => {
    done.current = true
    star.current?.setAttribute('r', String(R_RING))
    star.current?.setAttribute('opacity', '1')
    paths.current[0]?.setAttribute('d', STATIC_ARC)
    paths.current[1]?.setAttribute('d', '')
  }

  // Before the first paint, or the empty initial markup shows for a frame.
  useLayoutEffect(() => {
    if (!intro || done.current) return
    apply(frameAt(0))
  }, [intro])

  useEffect(() => {
    if (!intro || done.current) return
    // Someone who asked for less motion gets the mark, not the journey.
    if (prefersReducedMotion()) {
      settle()
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = clamp01((now - start) / DURATION_MS)
      if (t < 1) {
        apply(frameAt(t))
        raf = requestAnimationFrame(tick)
      } else settle()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [intro])

  return (
    <svg
      data-slot="meridian-mark"
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="butt"
      aria-hidden
      className={cn(className)}
      {...props}
    >
      {intro ? (
        <>
          <circle ref={star} cx={CX} cy={CY} r={0} opacity={0} />
          <path ref={(el) => void (paths.current[0] = el)} d="" />
          <path ref={(el) => void (paths.current[1] = el)} d="" />
        </>
      ) : (
        <>
          <circle cx={CX} cy={CY} r={R_RING} />
          <path d={STATIC_ARC} />
        </>
      )}
    </svg>
  )
}
