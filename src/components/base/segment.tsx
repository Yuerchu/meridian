import { ToggleButton, ToggleButtonGroup, type ToggleButtonProps } from 'react-aria-components'
import { cn } from '@/lib/utils'

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
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl bg-default p-0.5',
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
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-muted outline-none transition-all select-none',
        'data-[selected]:bg-surface data-[selected]:text-foreground data-[selected]:shadow-surface',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

export const Segment = Object.assign(SegmentRoot, { Item: SegmentItem })
