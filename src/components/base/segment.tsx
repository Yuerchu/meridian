import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import {
  SegmentedControl,
  SegmentedControlItem,
  type SegmentedControlItemProps,
  type SegmentedControlProps,
} from './segmented-control/segmented-control'

/**
 * A single-choice pill row, on the registry's `SegmentedControl` (React Aria
 * `ToggleButtonGroup` underneath). Kept as a key-in / key-out API because
 * every caller holds one selected key, not a `Set`.
 */
export interface SegmentProps extends Omit<SegmentedControlProps, 'selectedKeys' | 'onSelectionChange' | 'className'> {
  size?: 'sm' | 'md'
  selectedKey?: string
  onSelectionChange?: (key: string) => void
  className?: string
  children?: ReactNode
}

function SegmentRoot({ size = 'md', className, selectedKey, onSelectionChange, children, ...props }: SegmentProps) {
  return (
    <SegmentedControl
      data-slot="segment"
      data-size={size}
      selectedKeys={selectedKey === undefined ? undefined : new Set([selectedKey])}
      onSelectionChange={(keys) => {
        const key = [...keys][0]
        if (typeof key === 'string') onSelectionChange?.(key)
      }}
      {...props}
      className={cx(size === 'sm' && '[&_[data-slot=segment-item]]:px-2 [&_[data-slot=segment-item]]:py-1', className)}
    >
      {children}
    </SegmentedControl>
  )
}

export interface SegmentItemProps extends Omit<SegmentedControlItemProps, 'className'> {
  className?: string
}

function SegmentItem({ className, ...props }: SegmentItemProps) {
  return <SegmentedControlItem data-slot="segment-item" {...props} className={cx(className)} />
}

export const Segment = Object.assign(SegmentRoot, { Item: SegmentItem })
