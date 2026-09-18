import { createContext, useCallback, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'
import { Sheet } from './sheet'

interface SidebarContextValue {
  open: boolean
  isOpen: boolean
  setOpen: (open: boolean) => void
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  isMobile: boolean
  isMobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  collapsible: string
}

const SidebarContext = createContext<SidebarContextValue>({
  open: true,
  isOpen: true,
  setOpen: () => {},
  collapsed: false,
  setCollapsed: () => {},
  isMobile: false,
  isMobileOpen: false,
  setMobileOpen: () => {},
  collapsible: 'icon',
})

export function useSidebar() {
  return useContext(SidebarContext)
}

interface SidebarProviderProps extends ComponentProps<'div'> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultCollapsed?: boolean
  variant?: string
  collapsible?: string
}

function SidebarProvider({
  className,
  open: controlledOpen,
  onOpenChange,
  defaultCollapsed = false,
  variant: _variant,
  collapsible = 'icon',
  children,
  ...props
}: SidebarProviderProps) {
  const [internalOpen, setInternalOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (v: boolean) => {
      setInternalOpen(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )

  return (
    <SidebarContext.Provider
      value={{
        open,
        isOpen: open,
        setOpen,
        collapsed,
        setCollapsed,
        isMobile: false,
        isMobileOpen: mobileOpen,
        setMobileOpen,
        collapsible,
      }}
    >
      <div
        data-slot="sidebar-provider"
        data-sidebar-open={open || undefined}
        data-sidebar-collapsed={collapsed || undefined}
        className={cx('sidebar__provider flex h-full w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function SidebarMain({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main data-slot="sidebar-main" {...props} className={cx('sidebar__main flex min-w-0 flex-1 flex-col', className)} />
  )
}

function MenuIcon({
  className,
  'aria-hidden': ariaHidden,
}: {
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}) {
  return (
    <svg
      className={className}
      aria-hidden={ariaHidden}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  )
}

function SidebarTrigger({ className, ...props }: ComponentProps<'button'> & { 'aria-label'?: string }) {
  const { open, setOpen } = useContext(SidebarContext)
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      iconOnly
      leadingIcon={MenuIcon}
      aria-label={props['aria-label'] ?? 'Toggle sidebar'}
      onClick={() => setOpen(!open)}
      className={cx('', className)}
    />
  )
}

function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      {...props}
      className={cx('flex shrink-0 items-center gap-2 px-3 py-2', className)}
    />
  )
}

function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" {...props} className={cx('flex-1 overflow-y-auto', className)} />
}

function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      {...props}
      className={cx('shrink-0 border-t border-separator-border px-3 py-2', className)}
    />
  )
}

function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" {...props} className={cx('px-2 py-1', className)} />
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      {...props}
      className={cx(
        'sidebar__group-label flex items-center px-2 py-1 text-caption-1-medium text-text-secondary',
        className,
      )}
    />
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any -- generic tree props passthrough */
function SidebarMenu({
  className,
  onAction: _onAction,
  dragAndDropHooks: _dnd,
  selectedKeys: _sk,
  selectionMode: _sm,
  selectionBehavior: _sb,
  shouldSelectOnPressUp: _ssop,
  disallowEmptySelection: _des,
  ...props
}: any) {
  return (
    <div
      data-slot="sidebar-menu"
      role="tree"
      {...props}
      className={cx('sidebar__menu flex flex-col gap-0.5', className)}
    />
  )
}

function SidebarMenuItem({
  className,
  onAction,
  id,
  textValue: _textValue,
  isCurrent: _isCurrent,
  tooltipProps: _tooltipProps,
  ...props
}: any) {
  return (
    <div
      data-slot="sidebar-menu-item"
      data-key={id}
      role="treeitem"
      tabIndex={0}
      onClick={() => onAction?.()}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onAction?.()
        }
      }}
      {...props}
      className={cx(
        'sidebar__menu-item flex cursor-[var(--cursor-interactive)] items-center gap-2 rounded-2lg px-2 py-1.5 outline-none',
        'text-body-medium text-text-secondary',
        'hover:bg-background-secondary-hover',
        'data-[selected=true]:bg-background-secondary-default data-[selected=true]:text-text-primary',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring',
        className,
      )}
    />
  )
}

function SidebarMenuIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-icon"
      {...props}
      className={cx('flex shrink-0 text-foreground-icon-secondary', className)}
    />
  )
}

function SidebarMenuLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-label"
      {...props}
      className={cx('min-w-0 flex-1 truncate text-body-medium', className)}
    />
  )
}

function SidebarMenuChip({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-chip"
      {...props}
      className={cx('ml-auto shrink-0 text-xs text-text-secondary', className)}
    />
  )
}

function SidebarMenuAction({ className, onClick, children, ...props }: any) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-action"
      onClick={onClick}
      className={cx(
        'sidebar__menu-action inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary outline-none',
        'hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function SidebarMenuActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-actions"
      {...props}
      className={cx('sidebar__menu-actions ml-auto flex shrink-0 items-center gap-0.5', className)}
    />
  )
}

interface SidebarMobileProps {
  children?: ReactNode
  className?: string
}

function SidebarMobile({ children }: SidebarMobileProps) {
  const { isMobileOpen, setMobileOpen } = useContext(SidebarContext)
  return (
    <div data-slot="sidebar-mobile" className="sidebar__mobile contents md:hidden">
      <Sheet isOpen={isMobileOpen} placement="left" onOpenChange={setMobileOpen}>
        <Sheet.Backdrop variant="blur">
          <Sheet.Content className="w-[280px]">
            <Sheet.Dialog aria-label="Sidebar">
              <Sheet.Body>{children}</Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    </div>
  )
}

function SidebarRoot({ children, className, ...props }: ComponentProps<'aside'>) {
  return (
    <aside
      data-slot="sidebar"
      {...props}
      className={cx(
        'sidebar flex h-full w-[var(--app-sidebar-width,240px)] shrink-0 flex-col bg-background-secondary-default',
        className,
      )}
    >
      {children}
    </aside>
  )
}

export const Sidebar = Object.assign(SidebarRoot, {
  Provider: SidebarProvider,
  Main: SidebarMain,
  Trigger: SidebarTrigger,
  Header: SidebarHeader,
  Content: SidebarContent,
  Footer: SidebarFooter,
  Group: SidebarGroup,
  GroupLabel: SidebarGroupLabel,
  Menu: SidebarMenu,
  MenuItem: SidebarMenuItem,
  MenuIcon: SidebarMenuIcon,
  MenuLabel: SidebarMenuLabel,
  MenuChip: SidebarMenuChip,
  MenuAction: SidebarMenuAction,
  MenuActions: SidebarMenuActions,
  Mobile: SidebarMobile,
})
