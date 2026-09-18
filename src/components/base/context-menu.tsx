import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator as AriaSeparator,
  type MenuItemProps,
} from 'react-aria-components'
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
import { cx } from '@/utils/cx'

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

function ContextMenuTrigger({ className, render, children, ...props }: ContextMenuTriggerProps) {
  const { setOpen, setAnchorPoint } = useContext(ContextMenuContext)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setAnchorPoint({ x: e.clientX, y: e.clientY })
      setOpen(true)
    },
    [setOpen, setAnchorPoint],
  )

  const domProps: ComponentProps<'div'> = {
    ...props,
    className: cx('block', className),
    onContextMenu: handleContextMenu,
    children,
  }

  if (render) return render(domProps)
  return <div data-slot="context-menu-trigger" {...domProps} />
}

function ContextMenuPopover({ children }: { children?: ReactNode }) {
  const { open, anchorPoint, setOpen } = useContext(ContextMenuContext)
  const triggerRef = useRef<HTMLSpanElement>(null)

  return (
    <>
      <span
        ref={triggerRef}
        data-slot="context-menu-anchor"
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
        <Popover
          triggerRef={triggerRef}
          data-slot="context-menu-popover"
          placement="bottom start"
          className={cx(
            'min-w-[12rem] overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-dropdown outline-none',
            'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150',
            'data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100',
          )}
        >
          {children}
        </Popover>
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
  return <Menu data-slot="context-menu" {...props} className={cx('outline-none', className)} />
}

interface ContextMenuItemProps extends MenuItemProps {
  variant?: 'default' | 'danger'
  className?: string
}

function ContextMenuItem({ className, variant, ...props }: ContextMenuItemProps) {
  return (
    <MenuItem
      data-slot="context-menu-item"
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
        'data-[focused]:bg-dropdown-item-hover-background data-[focused]:text-text-primary',
        'data-[disabled]:opacity-50',
        variant === 'danger' &&
          'text-danger-soft-foreground data-[focused]:bg-danger-soft data-[focused]:text-danger-soft-foreground',
        className,
      )}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaSeparator
      data-slot="context-menu-separator"
      {...props}
      className={cx('my-1 h-px bg-separator-border', className)}
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
