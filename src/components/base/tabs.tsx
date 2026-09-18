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
import { cx } from '@/utils/cx'

function TabsRoot({ className, ...props }: AriaTabsProps & { className?: string }) {
  return <AriaTabs data-slot="tabs" {...props} className={cx('flex w-full flex-col gap-4', className)} />
}

function TabsListContainer({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="tabs-list-container" {...props} className={cx('relative w-full', className)} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic tab list
function TabsList({ className, ...props }: AriaTabListProps<any> & { className?: string }) {
  return (
    <AriaTabList
      data-slot="tabs-list"
      {...props}
      className={cx('flex w-full items-center gap-1 border-b border-separator-border', className)}
    />
  )
}

function TabsTab({ className, ...props }: AriaTabProps & { className?: string }) {
  return (
    <AriaTab
      data-slot="tabs-tab"
      {...props}
      className={cx(
        'relative inline-flex cursor-pointer items-center gap-2.5 px-2.5 py-2 whitespace-nowrap',
        'outline-none transition-colors duration-150 ease',
        'text-body-regular text-text-primary',
        'data-[selected]:text-body-medium data-[selected]:text-accent-600',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        'focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-focus-ring',
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
      className={cx(
        'absolute inset-x-0 bottom-0 h-0.5 bg-accent-600',
        'opacity-0 group-data-[selected]:opacity-100 data-[selected]:opacity-100',
        className,
      )}
    />
  )
}

function TabsPanel({ className, ...props }: AriaTabPanelProps & { className?: string }) {
  return (
    <AriaTabPanel
      data-slot="tabs-panel"
      {...props}
      className={cx(
        'outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    />
  )
}

export const Tabs = Object.assign(TabsRoot, {
  ListContainer: TabsListContainer,
  List: TabsList,
  Tab: TabsTab,
  Indicator: TabsIndicator,
  Panel: TabsPanel,
})
