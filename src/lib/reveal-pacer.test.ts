import { describe, expect, it } from 'vitest'

import { RevealPacer } from './reveal-pacer'

const FRAME = 1 / 60

/** Plays `seconds` of frames from `start`, delivering `arrivals` (time → length) as they fall due. */
function play(pacer: RevealPacer, start: number, seconds: number, arrivals: Array<[number, number]> = []) {
  const frames: Array<{ t: number; shown: number; done: boolean }> = []
  const pending = [...arrivals]
  for (let t = start; t <= start + seconds + 1e-9; t += FRAME) {
    while (pending.length > 0 && pending[0][0] <= t) pacer.receive(pending.shift()![1], t)
    frames.push({ t, ...pacer.frame(t) })
  }
  return frames
}

describe('RevealPacer', () => {
  it('never draws again what was on screen when it started', () => {
    const pacer = new RevealPacer(120)
    expect(pacer.frame(0).shown).toBe(120)
  })

  it('reveals the first delivery at a steady rate, before it has gaps to average', () => {
    const pacer = new RevealPacer(0)
    pacer.receive(200, 0)
    const frames = play(pacer, 0, 1)
    // Eased up to 40 chars/s: under 40 after a second, and well past zero.
    expect(frames.at(-1)!.shown).toBeGreaterThan(25)
    expect(frames.at(-1)!.shown).toBeLessThanOrEqual(40)
  })

  it('spreads bursts over the gap between them instead of drawing each at once', () => {
    const pacer = new RevealPacer(0)
    // 120 characters every half second: what a relay buffering a stream sends.
    const arrivals: Array<[number, number]> = Array.from({ length: 12 }, (_, i) => [i * 0.5, (i + 1) * 120])
    const frames = play(pacer, 0, 6, arrivals)
    const steady = frames.filter((f) => f.t > 2 && f.t < 5.5)
    const steps = steady.slice(1).map((f, i) => f.shown - steady[i].shown)

    // No frame draws more than a fraction of a burst...
    expect(Math.max(...steps)).toBeLessThan(30)
    // ...and the text does not sit still waiting for the next one.
    const stalls = steps.reduce(
      (run, step) =>
        step === 0 ? { now: run.now + 1, max: Math.max(run.max, run.now + 1) } : { now: 0, max: run.max },
      { now: 0, max: 0 },
    )
    expect(stalls.max).toBeLessThan(6)
    // ...and it keeps up: it is one delivery behind by design (each burst is
    // drawn over the gap before the next), never more than two.
    expect(frames.find((f) => f.t >= 5.5)!.shown).toBeGreaterThan(12 * 120 - 2 * 120)
  })

  it('drains the rest in about half a second once the stream ends, never slowing down', () => {
    const pacer = new RevealPacer(0)
    pacer.receive(50, 0)
    pacer.receive(2000, 0.1)
    pacer.frame(0.1)
    pacer.finish(2000)
    const frames = play(pacer, 0.1 + FRAME, 1)
    const end = frames.find((f) => f.done)!
    expect(end.shown).toBe(2000)
    // `DRAIN_S` is the aim at each frame; the speed easing up to it makes
    // the whole drain somewhat longer.
    expect(end.t - 0.1).toBeLessThan(0.6)
    const drawn = frames.slice(0, frames.indexOf(end) + 1)
    const steps = drawn.slice(1).map((f, i) => f.shown - drawn[i].shown)
    // Rounding to whole characters may wobble a step by one; the last step is
    // only what was left.
    steps.pop()
    steps.slice(1).forEach((step, i) => expect(step).toBeGreaterThanOrEqual(steps[i] - 1))
  })

  it('catches up over several frames after a long pause in frames, not in one', () => {
    const pacer = new RevealPacer(0)
    pacer.receive(100, 0)
    pacer.receive(5000, 0.2)
    play(pacer, 0, 0.3)
    const before = pacer.frame(0.3).shown
    // A hidden window gets no frames for two seconds.
    const after = pacer.frame(2.3).shown
    expect(after - before).toBeLessThan(2500)
    expect(after).toBeLessThan(5000)
  })

  it('never shows more than it has, even when the text gets shorter', () => {
    const pacer = new RevealPacer(100)
    pacer.receive(40, 0)
    expect(pacer.frame(0).shown).toBe(40)
  })
})
