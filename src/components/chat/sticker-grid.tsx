import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Key, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ListBox, Skeleton } from '@/components/base'
import { StickerThumb, StickerVisibilityProvider } from './sticker-thumb'

/**
 * Stickers are pictures, not glyphs: three to a row, four once the popover is
 * 21rem wide — decided by the width of the nearest `@container/stickers`, not
 * the window's, so a phone gets three cells of the same size rather than four
 * squeezed ones. `EmojiPicker.Grid`'s eight 32px columns stay for what they
 * are sized for.
 */
const STICKER_COLUMNS = 'grid grid-cols-3 gap-1 @min-[21rem]/stickers:grid-cols-4'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Under reduced motion a sticker in the picker never plays. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(REDUCED_MOTION)
      query?.addEventListener?.('change', notify)
      return () => query?.removeEventListener?.('change', notify)
    },
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
  )
}

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
 */
function StickerCell({
  id,
  src,
  name,
  playing,
  reducedMotion,
  onHeld,
}: {
  id: string
  src: string
  name: string
  playing: boolean
  reducedMotion: boolean
  onHeld: (id: string) => void
}) {
  const [held, setHeld] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHeld(false)
  }, [])
  useEffect(() => release, [release])
  return (
    <span
      data-slot="sticker-cell-body"
      className="flex size-full"
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch' || reducedMotion) return
        timer.current = setTimeout(() => {
          setHeld(true)
          onHeld(id)
        }, HOLD_MS)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <StickerThumb src={src} playing={playing || held} fallback={<StickerName name={name} />} />
    </span>
  )
}

export interface StickerGridItem {
  id: string
  name: string
  /** What the grid's typeahead matches: name, tags, pack. */
  textValue: string
  /** Absent when the file could not be resolved; the cell is then disabled. */
  url?: string
}

/**
 * The picker's grid of stickers.
 *
 * A RAC `ListBox` in grid layout: the arrow keys move in two dimensions, Enter
 * chooses, and every cell is named by the sticker's name. It scrolls inside
 * its own box, and a cell mounts its picture only near that box's viewport
 * (`StickerVisibilityProvider`) — and shows it still until it is hovered,
 * focused or held (`StickerThumb`).
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
  const reducedMotion = useReducedMotion()

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
    <StickerVisibilityProvider rootRef={scroller}>
      <div
        ref={scroller}
        data-slot="sticker-scroller"
        className="max-h-[min(22rem,45svh)] overflow-y-auto overscroll-contain p-2"
      >
        <ListBox
          aria-label={t('chat.emoji')}
          layout="grid"
          items={items}
          disabledKeys={items.filter((item) => !item.url).map((item) => item.id)}
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
              {({ isHovered, isFocused }) =>
                item.url ? (
                  <StickerCell
                    id={item.id}
                    src={item.url}
                    name={item.name}
                    playing={!reducedMotion && (isHovered || isFocused)}
                    reducedMotion={reducedMotion}
                    onHeld={(id) => {
                      heldPreview.current = id
                    }}
                  />
                ) : (
                  <StickerName name={item.name} />
                )
              }
            </ListBox.Item>
          )}
        </ListBox>
      </div>
    </StickerVisibilityProvider>
  )
}
