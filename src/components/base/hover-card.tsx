import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { OverlayArrow, Popover as AriaPopover, type PopoverProps } from 'react-aria-components'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION, OVERLAY_SURFACE } from './overlay-motion'

/**
 * A card that opens on hover and stays open while the pointer is over it, for
 * something a tooltip is too small for — a cost breakdown, a preview. React
 * Aria has no hover card, so the timing is here; the placement, the flip at
 * the viewport edge and Escape come from its `Popover`.
 *
 *   <HoverCard openDelay={300} closeDelay={200}>
 *     <HoverCard.Trigger><Button onPress={…}>1.2k tokens</Button></HoverCard.Trigger>
 *     <HoverCard.Content placement="top"><HoverCard.Arrow />…</HoverCard.Content>
 *   </HoverCard>
 *
 * Hover alone is not an input a keyboard or a touch screen has, so the
 * trigger's child should also be able to open the card itself — a `Button`
 * whose `onPress` sets the controlled `open`.
 */

interface HoverCardContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLSpanElement | null>
  scheduleOpen: () => void
  scheduleClose: () => void
  cancelTimers: () => void
}

const HoverCardContext = createContext<HoverCardContextValue | null>(null)

function useHoverCard() {
  const ctx = useContext(HoverCardContext)
  if (!ctx) throw new Error('HoverCard.* must be rendered inside <HoverCard>')
  return ctx
}

interface HoverCardProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  openDelay?: number
  closeDelay?: number
  children?: ReactNode
}

function HoverCardRoot({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  openDelay = 300,
  closeDelay = 200,
  children,
}: HoverCardProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const open = controlled ?? uncontrolled
  const triggerRef = useRef<HTMLSpanElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const cancelTimers = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }, [])

  const scheduleOpen = useCallback(() => {
    clearTimeout(closeTimer.current)
    if (open) return
    openTimer.current = setTimeout(() => setOpen(true), openDelay)
  }, [open, openDelay, setOpen])

  const scheduleClose = useCallback(() => {
    clearTimeout(openTimer.current)
    if (!open) return
    closeTimer.current = setTimeout(() => setOpen(false), closeDelay)
  }, [open, closeDelay, setOpen])

  useEffect(() => cancelTimers, [cancelTimers])

  return (
    <HoverCardContext.Provider value={{ open, setOpen, triggerRef, scheduleOpen, scheduleClose, cancelTimers }}>
      {children}
    </HoverCardContext.Provider>
  )
}

function HoverCardTrigger({ className, ...props }: ComponentProps<'span'>) {
  const { triggerRef, scheduleOpen, scheduleClose } = useHoverCard()
  return (
    <span
      ref={triggerRef}
      data-slot="hover-card-trigger"
      {...props}
      className={cx('inline-flex', className)}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') scheduleOpen()
        props.onPointerEnter?.(e)
      }}
      onPointerLeave={(e) => {
        scheduleClose()
        props.onPointerLeave?.(e)
      }}
    />
  )
}

interface HoverCardContentProps extends Pick<PopoverProps, 'placement' | 'offset'> {
  className?: string
  children?: ReactNode
}

function HoverCardContent({ className, placement = 'top', offset = 8, children }: HoverCardContentProps) {
  const { open, setOpen, triggerRef, scheduleClose, cancelTimers } = useHoverCard()
  return (
    <AriaPopover
      data-slot="hover-card"
      triggerRef={triggerRef}
      isOpen={open}
      onOpenChange={setOpen}
      isNonModal
      placement={placement}
      offset={offset}
      className={cx('max-w-[calc(100vw-32px)] p-3', OVERLAY_SURFACE, OVERLAY_MOTION, className)}
    >
      <div
        data-slot="hover-card-content"
        onPointerEnter={cancelTimers}
        onPointerLeave={scheduleClose}
        className="contents"
      >
        {children}
      </div>
    </AriaPopover>
  )
}

function HoverCardArrow({ className }: { className?: string }) {
  return (
    <OverlayArrow data-slot="hover-card-arrow" className={cx('group', className)}>
      <svg
        width={12}
        height={7}
        viewBox="0 0 12 7"
        className="block fill-background-primary-default stroke-border-button-default group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
      >
        <path d="M0 0 L6 6 L12 0" />
      </svg>
    </OverlayArrow>
  )
}

export const HoverCard = Object.assign(HoverCardRoot, {
  Trigger: HoverCardTrigger,
  Content: HoverCardContent,
  Arrow: HoverCardArrow,
})
