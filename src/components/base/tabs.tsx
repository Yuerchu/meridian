import {
  Tabs as AriaTabs,
  TabList as AriaTabList,
  Tab as AriaTab,
  TabPanel as AriaTabPanel,
  type TabsProps as AriaTabsProps,
  type TabListProps as AriaTabListProps,
  type TabProps as AriaTabProps,
  type TabPanelProps as AriaTabPanelProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function TabsRoot({ className, ...props }: AriaTabsProps & { className?: string }) {
  return <AriaTabs data-slot="tabs" {...props} className={cn('flex flex-col', className)} />
}

function TabsListContainer({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="tabs-list-container" {...props} className={cn('', className)} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic tab list
function TabsList({ className, ...props }: AriaTabListProps<any> & { className?: string }) {
  return (
    <AriaTabList
      data-slot="tabs-list"
      {...props}
      className={cn('flex items-center gap-1 border-b border-separator', className)}
    />
  )
}

function TabsTab({ className, ...props }: AriaTabProps & { className?: string }) {
  return (
    <AriaTab
      data-slot="tabs-tab"
      {...props}
      className={cn(
        'relative px-3 py-2 text-sm font-medium text-muted outline-none select-none',
        'data-[selected]:text-foreground',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
        className,
      )}
    />
  )
}

function TabsIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="tabs-indicator"
      {...props}
      className={cn('absolute inset-x-0 bottom-0 h-0.5 bg-accent', className)}
    />
  )
}

function TabsPanel({ className, ...props }: AriaTabPanelProps & { className?: string }) {
  return <AriaTabPanel data-slot="tabs-panel" {...props} className={cn('pt-3 outline-none', className)} />
}

export const Tabs = Object.assign(TabsRoot, {
  ListContainer: TabsListContainer,
  List: TabsList,
  Tab: TabsTab,
  Indicator: TabsIndicator,
  Panel: TabsPanel,
})
