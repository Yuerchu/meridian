import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { Separator } from '@base-ui/react/separator'

import { cn } from '@/lib/utils'

/**
 * The last thing standing on base-ui.
 *
 * HeroUI's menus are click-triggered and have no right-click equivalent, and
 * Pro's ContextMenu closes on any scroll anywhere (see the plan's Phase A), so
 * this stays until that is fixed upstream. What is here is only what four call
 * sites use — the submenu branch, groups, labels, checkbox items and the
 * shortcut slot were carried for two years and never rendered once.
 */

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            'z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-overlay p-1 text-overlay-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-default focus:text-default-foreground not-data-[variant=destructive]:focus:**:text-default-foreground data-inset:pl-7 data-[variant=destructive]:text-danger data-[variant=destructive]:focus:bg-danger/10 data-[variant=destructive]:focus:text-danger dark:data-[variant=destructive]:focus:bg-danger/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-danger",
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: Separator.Props) {
  return (
    <Separator data-slot="context-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  )
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator }
