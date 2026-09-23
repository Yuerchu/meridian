import { createContext, useCallback, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import {
  Button as AriaButton,
  Focusable,
  Tree,
  TreeItem,
  TreeItemContent,
  type ButtonProps as AriaButtonProps,
  type TreeItemProps,
  type TreeProps,
} from 'react-aria-components'
import { useIsMobile } from '@/hooks/use-mobile'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'
import { Sheet } from './sheet'
import { Tooltip, TooltipTrigger, type TooltipProps } from './tooltip/tooltip'

/**
 * The app frame's sidebar: boardui's floating panel (radius 24, hairline,
 * `shadow-sidebar`, `background/secondary`) holding React Aria `Tree`s.
 *
 *   <Sidebar.Provider open={open} onOpenChange={setOpen}>
 *     <Sidebar>…panel…</Sidebar>                 // ≥ 768px
 *     <Sidebar.Mobile>…the same tree…</Sidebar.Mobile>   // < 768px, a Sheet
 *     <Sidebar.Main>…page…</Sidebar.Main>
 *   </Sidebar.Provider>
 *
 * **A row is not a button.** `Sidebar.Menu` is a `Tree` and `Sidebar.MenuItem`
 * a `TreeItem`: rows are chosen with `onAction`, walked with the arrow keys
 * under one tab stop, and the drag-and-drop hooks a caller builds with
 * `useDragAndDrop` land on the tree that owns the rows. Buttons inside a row
 * (`Sidebar.MenuAction`) are RAC buttons, so pressing one does not also choose
 * the row, and `slot="drag"` is the tree's keyboard drag handle.
 *
 * Below 768px the panel is not drawn; the same tree is rendered a second time
 * inside `Sidebar.Mobile`, and `Sidebar.Trigger` opens that sheet instead of
 * collapsing the panel. Anything stateful inside the tree therefore exists
 * twice — see `useDraft` in `app-sidebar.tsx`.
 */

interface SidebarContextValue {
  isOpen: boolean
  setOpen: (open: boolean) => void
  isMobile: boolean
  isMobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  collapsible: 'icon' | 'none'
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: true,
  setOpen: () => {},
  isMobile: false,
  isMobileOpen: false,
  setMobileOpen: () => {},
  collapsible: 'icon',
})

export function useSidebar() {
  return useContext(SidebarContext)
}

interface SidebarProviderProps extends Omit<ComponentProps<'div'>, 'children'> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** `icon` keeps a 60px rail when closed; `none` removes the panel entirely. */
  collapsible?: 'icon' | 'none'
  children?: ReactNode
}

function SidebarProvider({
  className,
  open: controlledOpen,
  onOpenChange,
  collapsible = 'icon',
  children,
  ...props
}: SidebarProviderProps) {
  const [internalOpen, setInternalOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isMobile = useIsMobile()
  const isOpen = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (v: boolean) => {
      setInternalOpen(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )

  return (
    <SidebarContext.Provider
      value={{ isOpen, setOpen, isMobile, isMobileOpen: mobileOpen, setMobileOpen, collapsible }}
    >
      <div
        data-slot="sidebar-provider"
        data-sidebar-open={isOpen || undefined}
        {...props}
        // `gap-4` between the panel and the page, as the registry's AI Chat
        // frame spaces its sidebar from the chat (`agent-chat.tsx`).
        className={cx('sidebar__provider flex h-full w-full gap-4 bg-background-full p-3', className)}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function SidebarMain({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-main"
      {...props}
      className={cx(
        // The registry's AI Chat surface (`agent-chat.tsx`): a `rounded-3xl`
        // card on `background-secondary`, no hairline and no shadow — the
        // frame's `bg-background-full` is what sets it off.
        'sidebar__main flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background-secondary-default',
        className,
      )}
    />
  )
}

function MenuGlyph({
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

/** Opens the mobile sheet below 768px; collapses the panel above it. */
function SidebarTrigger({
  className,
  'aria-label': ariaLabel = 'Toggle sidebar',
}: {
  className?: string
  'aria-label'?: string
}) {
  const { isOpen, setOpen, isMobile, isMobileOpen, setMobileOpen } = useContext(SidebarContext)
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="neutral"
      iconOnly
      size="small"
      leadingIcon={MenuGlyph}
      aria-label={ariaLabel}
      aria-expanded={isMobile ? isMobileOpen : isOpen}
      onPress={() => (isMobile ? setMobileOpen(!isMobileOpen) : setOpen(!isOpen))}
      className={className}
    />
  )
}

function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" {...props} className={cx('flex shrink-0 flex-col gap-3', className)} />
}

function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      {...props}
      className={cx('-mx-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 [scrollbar-width:none]', className)}
    />
  )
}

function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" {...props} className={cx('flex shrink-0 flex-col gap-3', className)} />
}

function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" {...props} className={cx('flex flex-col gap-1', className)} />
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      {...props}
      className={cx(
        'sidebar__group-label flex min-h-7 items-center px-2 text-body-medium text-text-secondary',
        className,
      )}
    />
  )
}

/* ------------------------------------------------------------------- tree */

interface SidebarMenuProps<T extends object> extends Omit<TreeProps<T>, 'className' | 'style'> {
  className?: string
}

function SidebarMenu<T extends object>({ className, selectionMode = 'none', children, ...props }: SidebarMenuProps<T>) {
  return (
    <Tree
      data-slot="sidebar-menu"
      selectionMode={selectionMode}
      {...props}
      className={cx('sidebar__menu flex flex-col gap-1 outline-none', className)}
    >
      {children}
    </Tree>
  )
}

/**
 * What collapses when the panel becomes the icon rail: the label, the chip and
 * the actions blur and shrink to nothing while the icon stays where it was, so
 * nothing jumps to the centre — boardui's `Collapsible` slot, expressed as
 * classes keyed on the panel's `data-state` rather than as a wrapper.
 */
const COLLAPSIBLE = cx(
  'max-w-full transition-[max-width,opacity,filter] duration-300 ease-in-out',
  'group-data-[state=collapsed]/sidebar:max-w-0 group-data-[state=collapsed]/sidebar:opacity-0 group-data-[state=collapsed]/sidebar:blur-[3px]',
)

interface SidebarMenuItemProps extends Omit<TreeItemProps, 'className' | 'style' | 'children'> {
  /** The row for what is on screen now. Drawn filled; announced `aria-current`. */
  isCurrent?: boolean
  /**
   * `pill` is boardui's quick-search affordance: fully rounded on the tertiary
   * fill, for the one row that opens something rather than going somewhere.
   *
   * `thread` is a conversation, drawn as the registry's AI Chat history draws
   * one (`agent-chat-history.tsx`, `ThreadRow`): `text-body-2-regular` in
   * secondary ink, and the current row is the neutral hover fill
   * (`bg-background-secondary-hover`) rather than the accent gradient — which
   * boardui keeps for navigation. Selection and hover share the fill, "so
   * hovering previews selecting". The row carries `data-active` instead of
   * `data-current`, so none of the white-on-accent ink below applies to it.
   */
  appearance?: 'row' | 'pill' | 'thread'
  /** A tooltip on the row — for a title the row had to truncate. */
  tooltipProps?: Pick<TooltipProps, 'placement' | 'className'> & { content: ReactNode; delay?: number }
  className?: string
  children?: ReactNode
}

function SidebarMenuItem({
  className,
  isCurrent = false,
  appearance = 'row',
  tooltipProps,
  children,
  ...props
}: SidebarMenuItemProps) {
  const thread = appearance === 'thread'
  const row = (
    <div
      data-slot="sidebar-menu-item-content"
      data-current={(isCurrent && !thread) || undefined}
      data-active={(isCurrent && thread) || undefined}
      data-appearance={appearance}
      aria-current={isCurrent ? 'page' : undefined}
      className={cx(
        // boardui's NavItem: `p-2` around a 20px icon is the 36px row, and the
        // rail's row is the same element at `w-9` with its label collapsed.
        'sidebar__menu-item-content group/menu-item flex min-h-9 w-full items-center gap-2 overflow-hidden p-2',
        'text-text-secondary transition-[width,background-color] duration-300 ease-in-out',
        thread ? 'text-body-2-regular' : 'text-body-medium',
        'group-data-[state=collapsed]/sidebar:w-9',
        appearance === 'pill'
          ? 'rounded-full bg-background-tertiary-default group-data-[hovered]/tree-item:bg-background-tertiary-hover/55'
          : 'rounded-2lg group-data-[hovered]/tree-item:bg-background-secondary-hover',
        'data-[active]:bg-background-secondary-hover',
        'data-[current]:bg-linear-to-b data-[current]:from-accent-500 data-[current]:to-accent-600 data-[current]:text-text-white data-[current]:shadow-nav-selected',
      )}
    >
      {children}
    </div>
  )
  return (
    <TreeItem
      data-slot="sidebar-menu-item"
      {...props}
      className={cx(
        'sidebar__menu-item group/tree-item cursor-pointer rounded-2lg outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[drop-target]:ring-2 data-[drop-target]:ring-accent-500',
        className,
      )}
    >
      <TreeItemContent>
        {tooltipProps ? (
          <TooltipTrigger delay={tooltipProps.delay ?? 500}>
            <Focusable excludeFromTabOrder>{row}</Focusable>
            <Tooltip placement={tooltipProps.placement} className={tooltipProps.className}>
              {tooltipProps.content}
            </Tooltip>
          </TooltipTrigger>
        ) : (
          row
        )}
      </TreeItemContent>
    </TreeItem>
  )
}

function SidebarMenuIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-icon"
      {...props}
      className={cx(
        'flex shrink-0 text-foreground-icon-secondary group-data-[current]/menu-item:text-text-white [&_svg]:size-5',
        className,
      )}
    />
  )
}

function SidebarMenuLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-label"
      {...props}
      className={cx(
        'min-w-0 flex-1 truncate whitespace-nowrap group-data-[current]/menu-item:text-text-white',
        COLLAPSIBLE,
        className,
      )}
    />
  )
}

function SidebarMenuChip({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-chip"
      {...props}
      className={cx(
        'ml-auto flex shrink-0 items-center text-caption-1-medium text-text-tertiary group-data-[current]/menu-item:text-text-white/70',
        COLLAPSIBLE,
        className,
      )}
    />
  )
}

interface SidebarMenuActionProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
}

/** A small button inside a row. Pressing it does not choose the row. */
function SidebarMenuAction({ className, children, ...props }: SidebarMenuActionProps) {
  return (
    <AriaButton
      data-slot="sidebar-menu-action"
      {...props}
      className={cx(
        // `-my-0.5`: a 24px button in a row whose padding is sized for a 20px
        // icon would make every row carrying one 40px tall, and the rows
        // without one 36px.
        'sidebar__menu-action -my-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary outline-none',
        'transition-colors duration-150 ease data-[hovered]:bg-background-secondary-hover',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'group-data-[current]/menu-item:text-text-white/70 group-data-[current]/menu-item:data-[hovered]:bg-foreground-full/10',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
    >
      {children}
    </AriaButton>
  )
}

function SidebarMenuActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-actions"
      {...props}
      className={cx('sidebar__menu-actions ml-auto flex shrink-0 items-center gap-0.5', COLLAPSIBLE, className)}
    />
  )
}

/* ------------------------------------------------------------------ frame */

function SidebarMobile({ children, className }: { children?: ReactNode; className?: string }) {
  const { isMobileOpen, setMobileOpen } = useContext(SidebarContext)
  return (
    <div data-slot="sidebar-mobile" className="sidebar__mobile contents md:hidden">
      <Sheet isOpen={isMobileOpen} placement="left" onOpenChange={setMobileOpen}>
        <Sheet.Backdrop>
          {/* The panel's own surface, so the tree and its inline forms read the
              same in the drawer as beside the chat: on the sheet's default
              primary fill a field's tertiary well vanishes in dark. */}
          <Sheet.Content className={cx('w-[min(100vw-3rem,20rem)] bg-background-secondary-default', className)}>
            <Sheet.Dialog aria-label="Sidebar" className="p-3">
              {children}
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    </div>
  )
}

function SidebarRoot({ children, className, ...props }: ComponentProps<'aside'>) {
  const { isOpen, collapsible } = useContext(SidebarContext)
  const rail = !isOpen && collapsible === 'icon'
  if (!isOpen && collapsible === 'none') return null
  return (
    <aside
      data-slot="sidebar"
      data-state={rail ? 'collapsed' : 'expanded'}
      {...props}
      className={cx(
        'sidebar group/sidebar hidden h-full shrink-0 flex-col gap-3 overflow-hidden md:flex',
        'rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar',
        'transition-[width] duration-300 ease-in-out',
        // boardui's 12px, plus whatever the device cuts off. The insets are
        // added here rather than passed as `pt-[var(--safe-top)]` from outside:
        // a padding utility on the same side *replaces* this one under `cx()`,
        // and on a desktop the inset is 0px — which is how the panel lost all
        // three edges once. The rail keeps its 11px so its column stays 36px.
        'pt-[calc(0.75rem+var(--safe-top,0px))] pb-[calc(0.75rem+var(--safe-bottom,0px))]',
        rail
          ? 'w-[60px] pl-[calc(11px+var(--safe-left,0px))] pr-[11px]'
          : 'w-[var(--app-sidebar-width,260px)] pl-[calc(0.75rem+var(--safe-left,0px))] pr-3',
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
