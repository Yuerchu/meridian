import { createContext, useContext, useEffect, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/utils/cx'

interface HoverCardProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  openDelay?: number
  closeDelay?: number
  children?: React.ReactNode
}

interface HoverCardCtx {
  open: boolean
  triggerRef: React.RefObject<HTMLSpanElement | null>
}

const HoverCardContext = createContext<HoverCardCtx>({ open: false, triggerRef: { current: null } })

function HoverCardRoot({ open = false, children }: HoverCardProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  return (
    <HoverCardContext.Provider value={{ open, triggerRef }}>
      <span data-slot="hover-card" className="inline-flex">
        {children}
      </span>
    </HoverCardContext.Provider>
  )
}

function HoverCardTrigger({ className, ...props }: ComponentProps<'span'>) {
  const { triggerRef } = useContext(HoverCardContext)
  return <span ref={triggerRef} data-slot="hover-card-trigger" {...props} className={cx('inline-flex', className)} />
}

interface HoverCardContentProps extends ComponentProps<'div'> {
  placement?: string
}

function HoverCardContent({ className, placement = 'top', children, ...props }: HoverCardContentProps) {
  const { open, triggerRef } = useContext(HoverCardContext)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const contentEl = contentRef.current
    const contentWidth = contentEl?.offsetWidth ?? 256
    const contentHeight = contentEl?.offsetHeight ?? 200

    let top: number
    let left: number

    if (placement === 'top') {
      top = rect.top - contentHeight - 8
      left = rect.left + rect.width / 2 - contentWidth / 2
    } else {
      top = rect.bottom + 8
      left = rect.left + rect.width / 2 - contentWidth / 2
    }

    left = Math.max(8, Math.min(left, window.innerWidth - contentWidth - 8))
    top = Math.max(8, top)

    setPos({ top, left })
  }, [open, placement, triggerRef])

  if (!open) return null

  const content = (
    <div
      ref={contentRef}
      data-slot="hover-card-content"
      {...props}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className={cx(
        'rounded-xl border border-border-button-default bg-background-primary-default shadow-dropdown',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        className,
      )}
    >
      {children}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}

function HoverCardArrow({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="hover-card-arrow" {...props} className={cx('', className)} />
}

export const HoverCard = Object.assign(HoverCardRoot, {
  Trigger: HoverCardTrigger,
  Content: HoverCardContent,
  Arrow: HoverCardArrow,
})
