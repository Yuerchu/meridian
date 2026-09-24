'use client'

import type { ReactNode } from 'react'
import { Bell } from '@keyline-icons/react/two-tone'
import { useRef, useState } from 'react'
import { Dialog, Popover } from 'react-aria-components'

import {
  NotificationCenter,
  type NotificationCenterItem,
  type NotificationCenterProps,
} from '@/components/application/notification-center/notification-center'
import { Button } from '@/components/base/buttons/button'
import { OVERLAY_MOTION } from '@/components/base/overlay-motion'
import { cx } from '@/utils/cx'
import { useDismissOnOutsidePress } from '@/utils/use-dismiss-on-outside-press'

/** The header's bell: unread count on the glyph, the notification center in a popover. */
export function NotificationBell({
  notifications,
  triggerLabel = 'Notifications',
  dialogLabel = 'Notifications',
  centerProps,
  before,
  dialogClassName,
  isOpen: controlledOpen,
  onOpenChange,
}: {
  notifications: NotificationCenterItem[]
  /** The bell's accessible name. */
  triggerLabel?: string
  /** The popover dialog's accessible name. */
  dialogLabel?: string
  /** Everything the center takes besides its items. */
  centerProps?: Omit<NotificationCenterProps, 'notifications'>
  /** Drawn in the popover above the center. */
  before?: ReactNode
  /** Merged into the popover's dialog, e.g. to bound it to the popover's own max-height. */
  dialogClassName?: string
  isOpen?: boolean
  onOpenChange?: (isOpen: boolean) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = (open: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(open)
    onOpenChange?.(open)
  }
  const unread = notifications.filter((item) => item.unread).length

  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef])

  return (
    <>
      <span className="group relative inline-flex">
        <Button
          ref={triggerRef}
          iconOnly
          leadingIcon={Bell}
          size="small"
          variant="neutral"
          className="size-11 md:size-8"
          aria-label={triggerLabel}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onPress={() => setIsOpen(!isOpen)}
        />
        {unread > 0 && (
          <span className="pointer-events-none absolute top-1/2 right-1/2 -mt-3.5 -mr-4.5 flex h-4 min-w-4 items-center justify-center rounded-full border-[1.5px] border-background-primary-default bg-red-600 px-0.5 group-hover:border-0 group-active:border-0">
            <span className="text-center text-[10px] leading-4 font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          </span>
        )}
      </span>
      <Popover
        ref={popoverRef}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        placement="bottom end"
        offset={8}
        isNonModal
        className={cx('z-50 w-[440px] max-w-[calc(100vw-24px)] outline-none', OVERLAY_MOTION)}
      >
        <Dialog aria-label={dialogLabel} className={cx('outline-none', dialogClassName)}>
          {before}
          <NotificationCenter {...centerProps} notifications={notifications} />
        </Dialog>
      </Popover>
    </>
  )
}
