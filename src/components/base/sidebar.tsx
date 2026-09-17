import { createContext, useCallback, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'
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
        className={cn('sidebar__provider flex h-full w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function SidebarMain({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main data-slot="sidebar-main" {...props} className={cn('sidebar__main flex min-w-0 flex-1 flex-col', className)} />
  )
}

function SidebarTrigger({ className, ...props }: ComponentProps<'button'> & { 'aria-label'?: string }) {
  const { open, setOpen } = useContext(SidebarContext)
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- sidebar toggle
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      isIconOnly
      aria-label={props['aria-label'] ?? 'Toggle sidebar'}
      onPress={() => setOpen(!open)}
      className={cn('', className)}
    >
      <svg
        data-slot="sidebar-trigger-icon"
        className="size-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M2 4h12M2 8h12M2 12h12" />
      </svg>
    </Button>
  )
}

function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      {...props}
      className={cn('flex shrink-0 items-center gap-2 px-3 py-2', className)}
    />
  )
}

function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" {...props} className={cn('flex-1 overflow-y-auto', className)} />
}

function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      {...props}
      className={cn('shrink-0 border-t border-separator px-3 py-2', className)}
    />
  )
}

function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" {...props} className={cn('px-2 py-1', className)} />
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      {...props}
      className={cn('sidebar__group-label flex items-center px-2 py-1 text-xs font-medium text-muted', className)}
    />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic tree props passthrough
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
      className={cn('sidebar__menu flex flex-col gap-0.5', className)}
    />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts many consumer-specific props
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
      className={cn(
        'sidebar__menu-item flex cursor-[var(--cursor-interactive)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none',
        'hover:bg-default/50',
        'data-[selected=true]:bg-default data-[selected=true]:text-default-foreground',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        className,
      )}
    />
  )
}

function SidebarMenuIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="sidebar-menu-icon" {...props} className={cn('flex shrink-0 text-muted', className)} />
}

function SidebarMenuLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="sidebar-menu-label" {...props} className={cn('min-w-0 flex-1 truncate', className)} />
}

function SidebarMenuChip({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="sidebar-menu-chip" {...props} className={cn('ml-auto shrink-0 text-xs text-muted', className)} />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts consumer-specific props
function SidebarMenuAction({ className, onPress, ...props }: any) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- sidebar action
    <Button
      data-slot="sidebar-menu-action"
      variant="ghost"
      isIconOnly
      size="sm"
      onPress={onPress}
      className={cn('sidebar__menu-action size-6 shrink-0 text-muted', className)}
      {...props}
    />
  )
}

function SidebarMenuActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-actions"
      {...props}
      className={cn('sidebar__menu-actions ml-auto flex shrink-0 items-center gap-0.5', className)}
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
      className={cn(
        'sidebar flex h-full w-[var(--app-sidebar-width,240px)] shrink-0 flex-col bg-surface-secondary',
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
