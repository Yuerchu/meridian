import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cx } from '@/utils/cx'
import { StickerPlayback, StickerPlaybackContext } from './sticker-playback'

/**
 * A sticker drawn still until it is allowed to move — in the picker, in the
 * transcript and in the settings table alike.
 *
 * A pack is mostly GIFs and animated WebP, and a screen of them all decoding
 * at once is what made both the picker and a long conversation stutter. So a
 * sticker mounts only once it is `near` (see `sticker-playback.tsx`, which
 * decides that and `playing`), and what it mounts is the first frame painted
 * into a `<canvas>` — `drawImage` of an animated image paints whichever frame
 * is current, and right after `decode()` that is the first. That works for
 * GIF, APNG and animated WebP alike without parsing any of them. The live
 * `<img>` is laid over it only while `playing`, and removed again the moment
 * playback stops — which is what actually stops the decoding.
 *
 * The canvas is only ever *displayed*, never read back, so a cross-origin
 * source (a QQ face on `qzonestyle.gtimg.cn`) taints it harmlessly: tainting
 * forbids `getImageData`/`toDataURL`, not drawing. Local stickers arrive as
 * `data:` URLs and do not taint at all.
 */

/** The largest side a still frame is painted at when the box has no size yet, in CSS pixels. */
const STILL_EDGE = 128

type Still = 'pending' | 'drawn' | 'failed'

export function StickerThumb({
  src,
  near,
  playing,
  fallback,
  className,
}: {
  src: string
  /** Close enough to the viewport to hold a still frame at all. */
  near: boolean
  /** Allowed to animate right now (`useStickerPlayback`). */
  playing: boolean
  /** Drawn if the image cannot be decoded at all. */
  fallback: ReactNode
  className?: string
}) {
  const box = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
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
        // Painted at the size the box is drawn at: a 128px transcript
        // sticker and an 88px picker cell both get a sharp still.
        const drawn = Math.max(box.current?.clientWidth ?? 0, box.current?.clientHeight ?? 0) || STILL_EDGE
        const scale = Math.min(1, (drawn * ratio) / edge)
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
      // sticker leaves the neighbourhood or the picker closes.
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

/**
 * A playback scope measured against one scroller — the picker's grid, the
 * settings table. Outside any provider a sticker answers to the viewport.
 */
export function StickerPlaybackProvider({
  rootRef,
  maxPlaying,
  children,
}: {
  rootRef: RefObject<Element | null>
  maxPlaying?: number
  children: ReactNode
}) {
  const [playback] = useState(() => new StickerPlayback({ root: () => rootRef.current, maxPlaying }))
  return <StickerPlaybackContext.Provider value={playback}>{children}</StickerPlaybackContext.Provider>
}
