import { Fragment } from 'react'
import { Button, Drawer, Separator } from '@heroui/react'

import { cn } from '@/lib/utils'
import type { RowAction } from './row-actions'

/**
 * The actions for one row, as a sheet from the bottom of the screen.
 *
 * HeroUI's Drawer already sizes itself against the visual viewport and caps at
 * 85vh, so a soft keyboard and a long list are both handled; all this adds is
 * the row of buttons.
 *
 * One instance per page rather than one per row — a list of two hundred
 * conversations should not carry two hundred portals — so the caller keeps the
 * target in state and passes the actions for whichever row is open.
 */
export function ActionSheet({
  title,
  actions,
  isOpen,
  onOpenChange,
}: {
  title: string
  actions: RowAction[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="bottom">
        <Drawer.Dialog
          data-slot="row-action-sheet"
          aria-label={title}
          className="px-2 pt-2 pb-[max(1.5rem,var(--safe-bottom))]"
        >
          <Drawer.Handle />
          <Drawer.Header className="px-3">
            {/* The row's own name, so there is no doubt which one is about to
                be deleted when two titles read alike. */}
            <Drawer.Heading className="truncate text-sm">{title}</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-0.5">
            {actions.map((action) => (
              <Fragment key={action.key}>
                {action.variant === 'destructive' && <Separator className="my-2" />}
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Closed first, and synchronously. Exporting opens the
                    // system file picker, and leaving the sheet mounted across
                    // that keeps a focus trap and a scroll lock alive under
                    // native UI, with nowhere sensible to return focus to.
                    onOpenChange(false)
                    void action.run()
                  }}
                  className={cn(
                    'h-12 w-full justify-start gap-3 rounded-xl px-3 font-normal',
                    action.variant === 'destructive' && 'text-danger',
                  )}
                >
                  <action.icon className="size-4 shrink-0" />
                  {action.label}
                </Button>
              </Fragment>
            ))}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
