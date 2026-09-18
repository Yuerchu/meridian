import { ToggleButton, ToggleButtonGroup, type ToggleButtonProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

type SegmentSize = 'sm' | 'md'

interface SegmentProps {
  size?: SegmentSize
  selectedKey?: string
  onSelectionChange?: (key: string) => void
  className?: string
  children?: React.ReactNode
  'aria-label'?: string
}

function SegmentRoot({ size = 'md', className, selectedKey, onSelectionChange, children, ...props }: SegmentProps) {
  const selectedKeys = selectedKey ? new Set([selectedKey]) : undefined
  return (
    <ToggleButtonGroup
      data-slot="segment"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={selectedKeys}
      onSelectionChange={(keys) => {
        const key = [...keys][0]
        if (typeof key === 'string') onSelectionChange?.(key)
      }}
      {...props}
      className={cx(
        'inline-flex items-center gap-0.5 rounded-xl bg-background-secondary-default p-0.5',
        size === 'sm' && 'rounded-lg',
        className,
      )}
    >
      {children}
    </ToggleButtonGroup>
  )
}

interface SegmentItemProps extends ToggleButtonProps {
  className?: string
}

function SegmentItem({ className, ...props }: SegmentItemProps) {
  return (
    <ToggleButton
      data-slot="segment-item"
      {...props}
      className={cx(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary outline-none transition-all select-none',
        'data-[selected]:bg-background-primary-default data-[selected]:text-text-primary data-[selected]:shadow-xs',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

export const Segment = Object.assign(SegmentRoot, { Item: SegmentItem })
