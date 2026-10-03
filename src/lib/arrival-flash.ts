/**
 * Marks the turn a jump landed on, briefly, so the reader can see which one
 * it was.
 *
 * Without it a jump from the outline to a turn near the end of a conversation
 * lands with that turn wherever the scroll could put it, not at the top — the
 * transcript cannot scroll past its end — and nothing says which of the turns
 * on screen was meant. Telegram tints the bubble a jump lands on for the same
 * reason.
 *
 * - **After the scroll settles, not when it starts.** A smooth scroll takes a
 *   few hundred milliseconds, and a mark that starts at the press has mostly
 *   faded by the time its turn arrives. Settled means no scroll event for
 *   `QUIET_MS` — not `scrollend`, which not every WebView this ships in has;
 *   a target already in view never scrolls and so is marked after `QUIET_MS`.
 * - **Only the latest jump may clear the mark.** Each jump takes a token, and
 *   a timer ends the mark only if its token is still the element's: a second
 *   jump to the same turn while the first mark is up would otherwise be cut
 *   short by the first one's timer.
 *
 * What the mark looks like is `[data-arrival]` in meridian.css.
 */
const QUIET_MS = 120
/** A scroll that never settles (the reader took over) is marked anyway. */
const LONGEST_SCROLL_MS = 1500
/** The keyframes' length (`meridian-arrival`). */
export const ARRIVAL_MS = 1400

const tokens = new WeakMap<HTMLElement, number>()
let lastToken = 0

export function markArrival(messageId: string): void {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]')).find(
    (el) => el.dataset.messageId === messageId,
  )
  if (!item) return
  const viewport = item.closest<HTMLElement>('[data-slot="message-scroller-viewport"]')
  const token = ++lastToken
  tokens.set(item, token)

  let quiet = 0
  let longest = 0
  const settle = () => {
    window.clearTimeout(quiet)
    window.clearTimeout(longest)
    viewport?.removeEventListener('scroll', onScroll)
    if (tokens.get(item) !== token) return
    // Off and on again, with a style read between, so a repeat jump restarts
    // the keyframes rather than continuing the ones already running.
    delete item.dataset.arrival
    void item.offsetWidth
    item.dataset.arrival = ''
    window.setTimeout(() => {
      if (tokens.get(item) === token) delete item.dataset.arrival
    }, ARRIVAL_MS)
  }
  const onScroll = () => {
    window.clearTimeout(quiet)
    quiet = window.setTimeout(settle, QUIET_MS)
  }
  viewport?.addEventListener('scroll', onScroll, { passive: true })
  quiet = window.setTimeout(settle, QUIET_MS)
  longest = window.setTimeout(settle, LONGEST_SCROLL_MS)
}
