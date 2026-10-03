/**
 * How much of a streaming answer to show, so that text arriving in bursts is
 * drawn at an even pace instead of a paragraph at a time.
 *
 * A provider — and more so a relay in front of one — delivers text unevenly:
 * a run of small deltas, a pause, then half a paragraph at once. Drawing it as
 * it lands makes the answer lurch. The pacer keeps a revealed count that
 * chases the received length, and aims to have drawn everything received just
 * as the next delivery is due: the speed is the backlog divided by the time
 * until the next arrival, predicted from a moving average of the gaps between
 * arrivals. Each burst therefore finishes as the next one lands, and the reader
 * sees neither a stall nor a jump.
 *
 * The approach and its tuning follow Telegram's streaming bot answers
 * (`StreamingTextReveal`): learned from, written here from scratch.
 *
 * - The speed eases toward its target (`SPEED_EASE_S`) rather than switching,
 *   so a change of pace is not itself a visible jolt.
 * - One frame's step is capped (`MAX_STEP_S`): after a hitch — or a window
 *   that was hidden and stopped getting frames — the text catches up over a
 *   few frames instead of in one.
 * - The prediction never allows less than `MIN_LEAD_S`, or a late arrival
 *   would ask for an unbounded speed.
 * - Until a second arrival there are no gaps to average, so it reveals at a
 *   flat `FIRST_RATE`.
 * - Once the stream has ended (`finish`), whatever is left is drawn within
 *   about `DRAIN_S`, and never slower than it was already going.
 */
const GAP_WEIGHT = 0.4
const FIRST_GAP_S = 0.5
const FIRST_RATE = 40
const MIN_LEAD_S = 0.1
const SPEED_EASE_S = 0.12
const MAX_STEP_S = 0.05
const DRAIN_S = 0.3

export class RevealPacer {
  private revealed: number
  private received: number
  private speed = 0
  private meanGap = FIRST_GAP_S
  private arrivals = 0
  private lastArrival: number | null = null
  private nextArrival: number | null = null
  private lastFrame: number | null = null
  private finished = false

  /** `shown`: what is already on screen, which is never drawn a second time. */
  constructor(shown: number) {
    this.revealed = shown
    this.received = shown
  }

  /** The text is now `length` long, as of `now` (seconds). */
  receive(length: number, now: number): void {
    if (length > this.received) {
      if (this.lastArrival !== null) {
        const gap = Math.max(now - this.lastArrival, 0.001)
        this.meanGap = GAP_WEIGHT * gap + (1 - GAP_WEIGHT) * this.meanGap
      }
      this.lastArrival = now
      this.nextArrival = now + this.meanGap
      this.arrivals += 1
    }
    this.received = length
    this.revealed = Math.min(this.revealed, length)
  }

  /** Nothing more is coming; `length` is the final text. */
  finish(length: number): void {
    this.received = length
    this.revealed = Math.min(this.revealed, length)
    this.finished = true
  }

  /** Advances to `now` (seconds) and answers how much to show. */
  frame(now: number): { shown: number; done: boolean } {
    const step = Math.min(now - (this.lastFrame ?? now), MAX_STEP_S)
    this.lastFrame = now
    const backlog = Math.max(0, this.received - this.revealed)
    let target: number
    if (this.finished) target = Math.max(this.speed, backlog / DRAIN_S)
    else if (this.arrivals < 2 || this.nextArrival === null) target = backlog > 0 ? FIRST_RATE : 0
    else target = backlog / Math.max(MIN_LEAD_S, this.nextArrival - now)
    this.speed += (target - this.speed) * Math.min(1, step / SPEED_EASE_S)
    this.revealed = Math.min(this.received, this.revealed + this.speed * step)
    const shown = Math.floor(this.revealed)
    return { shown, done: this.finished && shown >= this.received }
  }
}
