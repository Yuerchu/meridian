import { useCallback, useEffect, useRef, useState, type Key, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ListBox, Skeleton } from '@/components/base'
import { useStickerUrl } from '@/lib/sticker-urls'
import { useStickerPlayback } from './sticker-playback'
import { StickerPlaybackProvider, StickerThumb } from './sticker-thumb'

/**
 * Stickers are pictures, not glyphs: three to a row, four once the popover is
 * 21rem wide — decided by the width of the nearest `@container/stickers`, not
 * the window's, so a phone gets three cells of the same size rather than four
 * squeezed ones. `EmojiPicker.Grid`'s eight 32px columns stay for what they
 * are sized for.
 */
const STICKER_COLUMNS = 'grid grid-cols-3 gap-1 @min-[21rem]/stickers:grid-cols-4'

/**
 * How many cells are drawn before the reader scrolls for more. The grid is a
 * window onto the list rather than the list: a collected pack runs to hundreds,
 * and every drawn cell is a collection item, a DOM subtree and — once near — a
 * URL request.
 */
export const STICKER_PAGE = 48

/** How long a finger rests on a sticker before it counts as watching it. */
const HOLD_MS = 350

function StickerName({ name }: { name: string }) {
  return (
    <span
      data-slot="emoji-picker-name"
      className="line-clamp-2 text-center text-caption-1-regular leading-tight text-text-secondary"
    >
      {name}
    </span>
  )
}

/**
 * One cell's picture. Touch has no hover, so a finger resting on a sticker is
 * what plays it there; the press that ends the hold is then a look rather than
 * a choice, which `onHeld` reports so the grid can decline it.
 *
 * The URL is asked for only once the cell is near the grid's viewport, through
 * the cache every sticker surface shares (`useStickerUrl`). A URL the caller
 * already has (`src`) is used as is.
 */
function StickerCell({
  id,
  src,
  name,
  pointed,
  onHeld,
}: {
  id: string
  src?: string
  name: string
  /** Hovered or focused. */
  pointed: boolean
  onHeld: (id: string) => void
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [held, setHeld] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { near, playing } = useStickerPlayback(box, { autoplay: false, explicit: pointed || held })
  const fetched = useStickerUrl(src || !near ? null : id)
  const url = src ?? (fetched.status === 'loaded' ? fetched.url : undefined)
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHeld(false)
  }, [])
  useEffect(() => release, [release])
  return (
    <span
      ref={box}
      data-slot="sticker-cell-body"
      data-url-state={src ? 'loaded' : fetched.status}
      className="flex size-full"
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') return
        timer.current = setTimeout(() => {
          setHeld(true)
          onHeld(id)
        }, HOLD_MS)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      {url ? (
        <StickerThumb src={url} near={near} playing={playing} fallback={<StickerName name={name} />} />
      ) : fetched.status === 'error' ? (
        <StickerName name={name} />
      ) : null}
    </span>
  )
}

export interface StickerGridItem {
  id: string
  name: string
  /** What the grid's typeahead matches: name, tags, pack. */
  textValue: string
  /**
   * Already known — the playground's stickers have no backend. Absent, the
   * cell asks for it once it is near the viewport.
   */
  url?: string
}

/**
 * The picker's grid of stickers.
 *
 * A RAC `ListBox` in grid layout: the arrow keys move in two dimensions, Enter
 * chooses, and every cell is named by the sticker's name. It scrolls inside
 * its own box, draws `STICKER_PAGE` cells at a time and the next page when
 * its end comes near, and a cell asks for its picture only near that box's
 * viewport (`StickerPlaybackProvider`) — and shows it still until it is
 * hovered, focused or held (`StickerThumb`). Nothing in the picker plays by
 * itself.
 */
export function StickerGrid({
  items,
  loading,
  empty,
  onAction,
}: {
  items: StickerGridItem[]
  loading: boolean
  /** What an empty, loaded grid says. */
  empty: ReactNode
  onAction: (id: string) => void
}) {
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null)
  const heldPreview = useRef<string | null>(null)
  const more = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(STICKER_PAGE)
  // A new list — another pack, another search — starts from its first page.
  const [shownFor, setShownFor] = useState(items)
  if (shownFor !== items) {
    setShownFor(items)
    setLimit(STICKER_PAGE)
  }
  const shown = limit >= items.length ? items : items.slice(0, limit)
  const hasMore = shown.length < items.length

  // Observed afresh after every page: an observer reports only a *change*, so
  // a sentinel still in view after the page landed (a short page, a tall
  // popover) would otherwise never ask for the next one.
  useEffect(() => {
    const sentinel = more.current
    if (!hasMore || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setLimit((current) => current + STICKER_PAGE)
      },
      { root: scroller.current, rootMargin: '0px 0px 160px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, limit])

  const handleAction = useCallback(
    (key: Key) => {
      const id = String(key)
      // A touch that was held to watch a sticker play ends in a press like any
      // other; it was a look, not a choice.
      if (heldPreview.current === id) {
        heldPreview.current = null
        return
      }
      onAction(id)
    },
    [onAction],
  )

  return (
    <StickerPlaybackProvider rootRef={scroller}>
      <div
        ref={scroller}
        data-slot="sticker-scroller"
        className="max-h-[min(22rem,45svh)] overflow-y-auto overscroll-contain p-2"
      >
        <ListBox
          aria-label={t('chat.emoji')}
          layout="grid"
          items={shown}
          onAction={handleAction}
          data-slot="sticker-grid"
          renderEmptyState={() =>
            loading ? (
              // The grid that is coming, cell for cell.
              <div
                data-slot="emoji-picker-loading"
                role="status"
                aria-busy
                aria-label={t('chat.emojiLoading')}
                className={STICKER_COLUMNS}
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton
                    key={i}
                    role="none"
                    aria-busy={undefined}
                    aria-hidden
                    className="aspect-square rounded-xl"
                  />
                ))}
              </div>
            ) : (
              empty
            )
          }
          className={STICKER_COLUMNS}
        >
          {(item: StickerGridItem) => (
            <ListBox.Item
              id={item.id}
              textValue={item.textValue}
              aria-label={item.name}
              data-slot="sticker-cell"
              className="aspect-square justify-center rounded-xl p-1.5 data-[hovered]:bg-background-secondary-default"
            >
              {({ isHovered, isFocused }) => (
                <StickerCell
                  id={item.id}
                  src={item.url}
                  name={item.name}
                  pointed={isHovered || isFocused}
                  onHeld={(id) => {
                    heldPreview.current = id
                  }}
                />
              )}
            </ListBox.Item>
          )}
        </ListBox>
        {hasMore && <div ref={more} data-slot="sticker-grid-more" aria-hidden className="h-px" />}
      </div>
    </StickerPlaybackProvider>
  )
}
