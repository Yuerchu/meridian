/**
 * The mark, and the ring it is a pose of.
 *
 * The resting shape is a circle and one off-centre arc, and that arc is a half
 * *ellipse* (`A21,40`) rather than the bézier that looks identical at icon
 * sizes. That is load-bearing: a circular ring seen from any angle projects to
 * an ellipse, so once the far half is hidden behind the star what remains is
 * exactly this arc. The intro is therefore not a shape morphing into the logo
 * — it is a ring turning, and the logo is where it stops.
 *
 * Framework-free on purpose: the React component and the splash window's plain
 * script both draw from here, and the splash cannot import React.
 */

export const CX = 50
export const CY = 50
export const R_RING = 40
export const STROKE = 6.5
/** Points around the full ring. Below ~120 the ellipse visibly facets. */
const STEPS = 160

export const DURATION_MS = 1800
/** When the orbiting point has come all the way round. */
const DRAW_END = 0.38

/** The resting arc, written out rather than sampled at `t = 1`. */
export const STATIC_ARC = `M${CX},${CY - R_RING} A21,${R_RING} 0 0 1 ${CX},${CY + R_RING}`

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * The ring's attitude at `t`, as one curve rather than two.
 *
 * Interpolating in two segments puts the slow end of one easing against the
 * slow end of the next and the angular velocity hits zero there — the ring
 * visibly stops at the Saturn pose before carrying on. Both angles read the
 * same progress `u` instead.
 *
 * `gamma` turns about the view axis, +90° → −90°, monotone, so head-on it is
 * one clockwise rotation throughout, fastest at the midpoint. `alpha` tilts
 * about the horizontal axis and sets how flat the ellipse is; it has to be
 * non-monotone — 25° nearly circular, 75° the Saturn ring, 58.3° at rest — so
 * it follows a quadratic bézier rather than a polyline, control point 108
 * lifting the midpoint to 75° with a derivative that never stalls.
 *
 * 58.3° is not free: rx = 40·cos 58.3° = 21, which is the resting arc.
 */
function pose(t: number) {
  const u = easeInOut(t)
  const v = 1 - u
  return {
    alpha: v * v * 25 + 2 * v * u * 108 + u * u * 58.3,
    gamma: lerp(90, -90, u),
  }
}

interface Point {
  x: number
  y: number
  /** Depth. Positive is in front of the star. */
  z: number
}

function ringPoints(t: number, from: number, to: number): Point[] {
  const { alpha, gamma } = pose(t)
  const ca = Math.cos((alpha * Math.PI) / 180)
  const sa = Math.sin((alpha * Math.PI) / 180)
  const cg = Math.cos((gamma * Math.PI) / 180)
  const sg = Math.sin((gamma * Math.PI) / 180)

  const steps = Math.max(2, Math.round((STEPS * (to - from)) / (Math.PI * 2)))
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    const x = R_RING * Math.cos(a)
    const y0 = R_RING * Math.sin(a)
    const y1 = y0 * ca
    points.push({ x: CX + (x * cg - y1 * sg), y: CY + (x * sg + y1 * cg), z: y0 * sa })
  }
  return points
}

/**
 * Split into what the star does not hide.
 *
 * Hidden means behind it *and* within its disc — geometry, not a coloured
 * shape laid on top, which would show through on any background the mark is
 * not drawn on. A convex occluder cuts a closed curve in at most two places,
 * so two segments is the ceiling and callers can allocate exactly two paths.
 */
function visibleSegments(points: Point[], rStar: number): [string, string] {
  const out: string[] = []
  let current: Point[] = []
  const flush = () => {
    if (current.length > 1) {
      out.push(current.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(''))
    }
    current = []
  }
  for (const p of points) {
    if (p.z < 0 && Math.hypot(p.x - CX, p.y - CY) < rStar) flush()
    else current.push(p)
  }
  flush()
  return [out[0] ?? '', out[1] ?? '']
}

export interface RingFrame {
  rStar: number
  starOpacity: number
  segments: [string, string]
}

export function frameAt(t: number): RingFrame {
  // Linear: this is a point going round an orbit, not a line being extruded.
  // Eased, it looks like it is coasting to a halt while the ring still turns.
  const grow = span(t, 0, DRAW_END)
  const starOpacity = easeOut(span(t, 0.28, 0.5))
  const rStar = starOpacity === 0 ? 0 : lerp(14, 40, easeInOut(span(t, 0.28, 1)))
  const from = -Math.PI / 2
  return {
    rStar,
    starOpacity,
    segments: visibleSegments(ringPoints(t, from, from + Math.PI * 2 * grow), rStar),
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
