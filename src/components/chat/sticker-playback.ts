import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'

/**
 * Which stickers may animate right now, decided in one place.
 *
 * A GIF that is on screen costs a decode per frame whether or not anybody is
 * looking at it, and a long conversation used to have every sticker it had
 * ever sent doing that at once — including the ones scrolled far away, and all
 * of them again on every frame of a scroll. The rule is QQ's:
 *
 * - **Near** (within `nearMargin` of the viewport) is when a sticker may exist
 *   at all: fetch its URL and paint its still first frame. Leaving the
 *   neighbourhood lets go of both.
 * - **Visible** (intersecting the viewport itself) is when it may *play*.
 * - **Nothing plays while the reader scrolls.** Every sticker freezes on its
 *   still frame at the first scroll the reader caused, and the visible ones
 *   resume `settleMs` after the last one. A sticker that comes near *during*
 *   the scroll is not even fetched or decoded until then — measured on
 *   `#playground/stickers?gif`, decoding every still a fling passes cost the
 *   scroll about four times the main-thread time of the bare `<img>` tags this
 *   replaced; deferred, the two are level.
 * - **At most `maxPlaying` play by themselves**, the first ones in document
 *   order; the rest stay still until one of those leaves.
 * - **A sticker somebody points at plays** regardless of the cap (`explicit`)
 *   — hovered, focused, or held — including under `prefers-reduced-motion`,
 *   which turns off only the playing nobody asked for.
 *
 * "The reader caused" is load-bearing. The transcript follows a streaming
 * answer with a programmatic `scrollTo` on every chunk, and pausing on those
 * would freeze every sticker on screen for as long as a model is talking. So a
 * scroll only starts a pause when it comes within `INTENT_MS` of a wheel,
 * touch, key or pointer press; once paused, every scroll extends it, which is
 * what carries a touch fling through its momentum after the finger has left.
 */

export const MAX_PLAYING = 8
export const SCROLL_SETTLE_MS = 200
const INTENT_MS = 1000
const NEAR_MARGIN = '200px 0px'

export interface PlaybackState {
  near: boolean
  playing: boolean
}

export interface PlaybackWish {
  /** Play whenever visible, within the cap. */
  autoplay: boolean
  /** Somebody is pointing at it: play whenever near, ignoring the cap. */
  explicit: boolean
}

interface Entry extends PlaybackWish, PlaybackState {
  el: Element
  visible: boolean
  /** What the sticker was last told, so an unchanged answer is not re-sent. */
  reported: PlaybackState | null
  notify: (state: PlaybackState) => void
}

export interface PlaybackHandle {
  update: (wish: PlaybackWish) => void
  dispose: () => void
}

const INTENT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const

export class StickerPlayback {
  readonly maxPlaying: number
  readonly settleMs: number
  #root: () => Element | null
  #nearMargin: string
  #entries = new Map<Element, Entry>()
  #nearObserver: IntersectionObserver | null = null
  #visibleObserver: IntersectionObserver | null = null
  #scrolling = false
  #settle: ReturnType<typeof setTimeout> | null = null
  #lastIntent = Number.NEGATIVE_INFINITY
  #listening = false

  constructor({
    root = () => null,
    // eslint-disable-next-line meridian-ui/no-invented-domain-default -- this app's own playback cap, not a fact about a model
    maxPlaying = MAX_PLAYING,
    settleMs = SCROLL_SETTLE_MS,
    nearMargin = NEAR_MARGIN,
  }: {
    /** The scroller to measure against; `null` is the viewport. */
    root?: () => Element | null
    maxPlaying?: number
    settleMs?: number
    nearMargin?: string
  } = {}) {
    this.#root = root
    this.maxPlaying = maxPlaying
    this.settleMs = settleMs
    this.#nearMargin = nearMargin
  }

  get scrolling(): boolean {
    return this.#scrolling
  }

  register(el: Element, notify: (state: PlaybackState) => void): PlaybackHandle {
    const observable = typeof IntersectionObserver !== 'undefined'
    // Without the API every sticker counts as near and visible: the degraded
    // case is the old behaviour (capped), not a column of blanks.
    const entry: Entry = {
      el,
      notify,
      near: !observable,
      visible: !observable,
      playing: false,
      autoplay: false,
      explicit: false,
      reported: null,
    }
    this.#entries.set(el, entry)
    this.#listen()
    if (observable) {
      this.#observers().near.observe(el)
      this.#observers().visible.observe(el)
    } else {
      this.#recompute()
    }
    return {
      update: (wish) => {
        if (entry.autoplay === wish.autoplay && entry.explicit === wish.explicit) return
        entry.autoplay = wish.autoplay
        entry.explicit = wish.explicit
        this.#recompute()
      },
      dispose: () => {
        this.#entries.delete(el)
        this.#nearObserver?.unobserve(el)
        this.#visibleObserver?.unobserve(el)
        if (this.#entries.size === 0) this.#teardown()
        // Whatever it held goes back to the pool.
        else if (entry.playing) this.#recompute()
      },
    }
  }

  #observers() {
    const root = this.#root()
    this.#nearObserver ??= new IntersectionObserver((records) => this.#observe(records, 'near'), {
      root,
      rootMargin: this.#nearMargin,
    })
    this.#visibleObserver ??= new IntersectionObserver((records) => this.#observe(records, 'visible'), {
      root,
    })
    return { near: this.#nearObserver, visible: this.#visibleObserver }
  }

  #observe(records: IntersectionObserverEntry[], field: 'near' | 'visible') {
    for (const record of records) {
      const entry = this.#entries.get(record.target)
      if (entry) entry[field] = record.isIntersecting
    }
    this.#recompute()
  }

  #onIntent = () => {
    this.#lastIntent = performance.now()
  }

  #onScroll = () => {
    if (!this.#scrolling && performance.now() - this.#lastIntent > INTENT_MS) return
    if (this.#settle) clearTimeout(this.#settle)
    this.#settle = setTimeout(() => {
      this.#settle = null
      this.#scrolling = false
      this.#recompute()
    }, this.settleMs)
    if (this.#scrolling) return
    this.#scrolling = true
    this.#recompute()
  }

  #listen() {
    if (this.#listening || typeof window === 'undefined') return
    this.#listening = true
    for (const type of INTENT_EVENTS) window.addEventListener(type, this.#onIntent, { capture: true, passive: true })
    // Scroll does not bubble, but it is dispatched through the capture phase
    // of the document, which is how one listener hears every scroller.
    document.addEventListener('scroll', this.#onScroll, { capture: true, passive: true })
  }

  #teardown() {
    this.#nearObserver?.disconnect()
    this.#visibleObserver?.disconnect()
    this.#nearObserver = null
    this.#visibleObserver = null
    if (this.#settle) clearTimeout(this.#settle)
    this.#settle = null
    this.#scrolling = false
    if (!this.#listening) return
    this.#listening = false
    for (const type of INTENT_EVENTS) window.removeEventListener(type, this.#onIntent, { capture: true })
    document.removeEventListener('scroll', this.#onScroll, { capture: true })
  }

  #recompute() {
    const autoplay: Entry[] = []
    const next = new Map<Entry, boolean>()
    for (const entry of this.#entries.values()) {
      let playing = false
      if (!this.#scrolling) {
        if (entry.explicit && entry.near) playing = true
        else if (entry.autoplay && entry.visible) autoplay.push(entry)
      }
      next.set(entry, playing)
    }
    // Document order, so the cap keeps the ones at the top of the screen
    // rather than whichever registered first.
    autoplay.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    for (const entry of autoplay.slice(0, this.maxPlaying)) next.set(entry, true)

    for (const [entry, playing] of next) {
      entry.playing = playing
      // A sticker that comes near *during* a scroll is not told so until the
      // scroll settles: fetching its URL and decoding its still frame is the
      // expensive part of a sticker, and a fling brings a new one near every
      // few frames only for most of them to be gone again before anybody saw
      // them. One that was already near keeps its still frame throughout.
      const near = entry.near && (!this.#scrolling || entry.reported?.near === true)
      if (entry.reported?.near === near && entry.reported.playing === playing) continue
      entry.reported = { near, playing }
      entry.notify(entry.reported)
    }
  }
}

/** A playback scope measured against one scroller; see `StickerPlaybackProvider`. */
export const StickerPlaybackContext = createContext<StickerPlayback | null>(null)

let fallback: StickerPlayback | null = null

/** The transcript's: measured against the viewport, shared by every sticker outside a provider. */
function viewportPlayback(): StickerPlayback {
  fallback ??= new StickerPlayback()
  return fallback
}

export function useStickerPlayback(ref: RefObject<Element | null>, wish: PlaybackWish): PlaybackState {
  const playback = useContext(StickerPlaybackContext) ?? viewportPlayback()
  const [state, setState] = useState<PlaybackState>({ near: false, playing: false })
  const handle = useRef<PlaybackHandle | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const registered = playback.register(el, setState)
    handle.current = registered
    return () => {
      registered.dispose()
      handle.current = null
    }
  }, [playback, ref])

  // Declared after the registration so it runs after it in the same commit,
  // and re-runs with it whenever the scope changes.
  useEffect(() => {
    handle.current?.update({ autoplay: wish.autoplay, explicit: wish.explicit })
  }, [playback, wish.autoplay, wish.explicit])

  return state
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Under reduced motion nothing plays unless somebody points at it. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(REDUCED_MOTION)
      query?.addEventListener?.('change', notify)
      return () => query?.removeEventListener?.('change', notify)
    },
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
  )
}

/** Tests only: forget the viewport scope, so one test's registrations cannot outlive it. */
export function resetViewportPlayback() {
  fallback = null
}

/**
 * Pointing at a sticker that is not otherwise interactive: a mouse or pen
 * resting on it plays it, and a tap toggles it, since touch has no hover.
 */
export function usePointerPlay() {
  const [pointed, setPointed] = useState(false)
  const handlers = {
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType !== 'touch') setPointed(true)
    },
    onPointerLeave: (event: { pointerType: string }) => {
      if (event.pointerType !== 'touch') setPointed(false)
    },
    onPointerUp: (event: { pointerType: string }) => {
      if (event.pointerType === 'touch') setPointed((current) => !current)
    },
  }
  return [pointed, handlers] as const
}
