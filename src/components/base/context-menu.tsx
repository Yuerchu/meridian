import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  type MenuItemProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_POPOVER_SURFACE } from './dropdown/menu-styles'

/**
 * A right-click menu: React Aria's `Menu` in a `Popover` anchored to where the
 * pointer was, not to an element. The anchor is a zero-size fixed span moved to
 * the event's coordinates; RAC positions and flips against it like any trigger.
 *
 *   <ContextMenu>
 *     <ContextMenu.Trigger render={(props) => <Row {...props} />}>…</ContextMenu.Trigger>
 *     <ContextMenu.Popover>
 *       <ContextMenu.Menu aria-label="…">
 *         <ContextMenu.Item id="copy" onAction={…}>Copy</ContextMenu.Item>
 *       </ContextMenu.Menu>
 *     </ContextMenu.Popover>
 *   </ContextMenu>
 *
 * `Trigger` merges its own `onContextMenu` with whatever the caller passes
 * (`onPointerDown`, `onContextMenuCapture`, …) rather than replacing it; the
 * sidebar records which row was hit on those two events before the menu asks
 * to open. Its `render` prop hands the DOM props to a caller's own element so
 * a whole message group can be the trigger without a wrapper changing its
 * layout.
 */

interface ContextMenuState {
  open: boolean
  anchorPoint: { x: number; y: number }
  setOpen: (open: boolean) => void
  setAnchorPoint: (point: { x: number; y: number }) => void
}

const ContextMenuContext = createContext<ContextMenuState>({
  open: false,
  anchorPoint: { x: 0, y: 0 },
  setOpen: () => {},
  setAnchorPoint: () => {},
})

interface ContextMenuRootProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

function ContextMenuRoot({ open: controlledOpen, onOpenChange, children }: ContextMenuRootProps) {
  const [internalOpen, setOpenState] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 })

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )

  return (
    <ContextMenuContext.Provider value={{ open, anchorPoint, setOpen, setAnchorPoint }}>
      {children}
    </ContextMenuContext.Provider>
  )
}

interface ContextMenuTriggerProps extends Omit<ComponentProps<'div'>, 'children'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
  children?: ReactNode
}

function ContextMenuTrigger({ className, render, children, onContextMenu, ...props }: ContextMenuTriggerProps) {
  const { setOpen, setAnchorPoint } = useContext(ContextMenuContext)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onContextMenu?.(e)
      if (e.defaultPrevented) return
      e.preventDefault()
      setAnchorPoint({ x: e.clientX, y: e.clientY })
      setOpen(true)
    },
    [onContextMenu, setOpen, setAnchorPoint],
  )

  const domProps: ComponentProps<'div'> = {
    ...props,
    className: cx(className),
    onContextMenu: handleContextMenu,
    children,
  }

  if (render) return render(domProps)
  return <div data-slot="context-menu-trigger" {...domProps} />
}

function ContextMenuPopover({ className, children }: { className?: string; children?: ReactNode }) {
  const { open, anchorPoint, setOpen } = useContext(ContextMenuContext)
  const anchorRef = useRef<HTMLSpanElement>(null)

  return (
    <>
      <span
        ref={anchorRef}
        data-slot="context-menu-anchor"
        aria-hidden
        style={{
          position: 'fixed',
          left: anchorPoint.x,
          top: anchorPoint.y,
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
      />
      <MenuTrigger isOpen={open} onOpenChange={setOpen}>
        <AriaPopover
          triggerRef={anchorRef}
          data-slot="context-menu-popover"
          placement="bottom start"
          offset={2}
          className={cx('min-w-48', MENU_POPOVER_SURFACE, className)}
        >
          {children}
        </AriaPopover>
      </MenuTrigger>
    </>
  )
}

interface ContextMenuMenuProps {
  'aria-label'?: string
  children?: ReactNode
  className?: string
}

function ContextMenuMenu({ className, ...props }: ContextMenuMenuProps) {
  return <Menu data-slot="context-menu" {...props} className={cx('flex flex-col gap-1 outline-none', className)} />
}

interface ContextMenuItemProps extends Omit<MenuItemProps, 'className' | 'style'> {
  variant?: 'default' | 'danger'
  className?: string
}

function ContextMenuItem({ className, variant = 'default', ...props }: ContextMenuItemProps) {
  return (
    <MenuItem
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
      className={(state) =>
        cx(
          MENU_ITEM,
          'px-2 py-1.5 text-body-medium',
          state.isFocused && MENU_ITEM_ACTIVE,
          state.isDisabled && 'cursor-not-allowed text-text-disabled',
          variant === 'danger' && [
            'text-status-danger-soft-foreground',
            state.isFocused && 'bg-status-danger-soft text-status-danger-soft-foreground',
          ],
          className,
        )
      }
    />
  )
}

function ContextMenuSeparator({ className }: { className?: string }) {
  return (
    <AriaSeparator
      data-slot="context-menu-separator"
      className={cx('-mx-2 my-1 h-px shrink-0 bg-border-button-default', className)}
    />
  )
}

export const ContextMenu = Object.assign(ContextMenuRoot, {
  Trigger: ContextMenuTrigger,
  Popover: ContextMenuPopover,
  Menu: ContextMenuMenu,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
})
