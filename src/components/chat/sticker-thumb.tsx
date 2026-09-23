import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cx } from '@/utils/cx'

/**
 * A sticker in the picker, drawn still until somebody is looking at it.
 *
 * A pack is mostly GIFs and animated WebP, and a grid of forty of them all
 * decoding at once is what made the picker stutter. So each cell mounts only
 * once its row is near the grid's viewport, and what it mounts is the first
 * frame painted into a `<canvas>` — `drawImage` of an animated image paints
 * whichever frame is current, and right after `decode()` that is the first.
 * That works for GIF, APNG and animated WebP alike without parsing any of
 * them. The live `<img>` is laid over it only while the cell is hovered,
 * focused or held.
 *
 * The canvas is only ever *displayed*, never read back, so a cross-origin
 * source (a QQ face on `qzonestyle.gtimg.cn`) taints it harmlessly: tainting
 * forbids `getImageData`/`toDataURL`, not drawing. Local stickers arrive as
 * `data:` URLs and do not taint at all.
 */

type Visibility = (el: Element, onChange: (near: boolean) => void) => () => void

const StickerVisibilityContext = createContext<Visibility | null>(null)

/**
 * One `IntersectionObserver` for a whole grid, rooted at its scroller so the
 * margin means "a row or two past the edge you can see". Without a provider,
 * or without the API, every cell counts as near — the degraded case is the
 * old behaviour, not a blank grid.
 */
class StickerVisibility {
  #listeners = new Map<Element, (near: boolean) => void>()
  #observer: IntersectionObserver | null = null
  #root: RefObject<Element | null>

  constructor(root: RefObject<Element | null>) {
    this.#root = root
  }

  observe: Visibility = (el, onChange) => {
    if (typeof IntersectionObserver === 'undefined') {
      onChange(true)
      return () => {}
    }
    this.#observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.#listeners.get(entry.target)?.(entry.isIntersecting)
      },
      { root: this.#root.current, rootMargin: '160px 0px' },
    )
    const io = this.#observer
    this.#listeners.set(el, onChange)
    io.observe(el)
    return () => {
      this.#listeners.delete(el)
      io.unobserve(el)
      if (this.#listeners.size === 0) {
        io.disconnect()
        this.#observer = null
      }
    }
  }
}

export function StickerVisibilityProvider({
  rootRef,
  children,
}: {
  rootRef: RefObject<Element | null>
  children: ReactNode
}) {
  const [visibility] = useState(() => new StickerVisibility(rootRef))
  return <StickerVisibilityContext.Provider value={visibility.observe}>{children}</StickerVisibilityContext.Provider>
}

function useNear(ref: RefObject<Element | null>): boolean {
  const observe = useContext(StickerVisibilityContext)
  const [near, setNear] = useState(observe === null)
  useEffect(() => {
    if (!observe || !ref.current) return
    return observe(ref.current, setNear)
  }, [observe, ref])
  return near
}

/** The largest side a still frame is painted at, in CSS pixels. */
const STILL_EDGE = 112

type Still = 'pending' | 'drawn' | 'failed'

export function StickerThumb({
  src,
  playing,
  fallback,
  className,
}: {
  src: string
  /** Hovered, focused or held — and not under `prefers-reduced-motion`. */
  playing: boolean
  /** Drawn if the image cannot be decoded at all. */
  fallback: ReactNode
  className?: string
}) {
  const box = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const near = useNear(box)
  const [still, setStill] = useState<Still>('pending')
  // The live image is laid over the still, and the still is hidden only once
  // the live one has painted — otherwise a transparent GIF shows its first
  // frame through every later one, and there is a blank flash before that.
  const [liveShown, setLiveShown] = useState(false)
  if (!playing && liveShown) setLiveShown(false)

  useEffect(() => {
    if (!near) return
    const target = canvas.current
    const image = new Image()
    image.decoding = 'async'
    let cancelled = false
    setStill('pending')
    image.src = src
    image
      .decode()
      .then(() => {
        if (cancelled || !target) return
        const ratio = window.devicePixelRatio || 1
        const edge = Math.max(image.naturalWidth, image.naturalHeight) || 1
        const scale = Math.min(1, (STILL_EDGE * ratio) / edge)
        target.width = Math.max(1, Math.round(image.naturalWidth * scale))
        target.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = target.getContext('2d')
        if (!context) throw new Error('no 2d context')
        context.drawImage(image, 0, 0, target.width, target.height)
        setStill('drawn')
      })
      .catch(() => {
        if (!cancelled) setStill('failed')
      })
    return () => {
      cancelled = true
      // Let go of the decoded frames and the backing store as soon as the
      // cell leaves the neighbourhood or the picker closes.
      image.src = ''
      if (target) {
        target.width = 0
        target.height = 0
      }
    }
  }, [near, src])

  return (
    <span
      ref={box}
      data-slot="sticker-thumb"
      data-state={!near ? 'idle' : playing ? 'playing' : still}
      className={cx('relative flex size-full items-center justify-center', className)}
    >
      {near && still === 'failed' ? (
        fallback
      ) : near ? (
        <>
          <canvas
            ref={canvas}
            aria-hidden
            data-slot="sticker-thumb-still"
            className={cx('size-full object-contain', (still !== 'drawn' || liveShown) && 'invisible')}
          />
          {playing && (
            <img
              data-slot="sticker-thumb-live"
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLiveShown(true)}
              className="absolute inset-0 size-full object-contain"
            />
          )}
        </>
      ) : null}
    </span>
  )
}
