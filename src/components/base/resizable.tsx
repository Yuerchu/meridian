import { Group, Panel, Separator as PanelSeparator } from 'react-resizable-panels'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

type GroupProps = ComponentProps<typeof Group>
type PanelProps = ComponentProps<typeof Panel>
type HandleProps = ComponentProps<typeof PanelSeparator>

function ResizableRoot({ className, ...props }: GroupProps) {
  return <Group data-slot="resizable" {...props} className={cx('', className)} />
}

function ResizablePanel({ className, ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} className={cx('', className)} />
}

function ResizableHandle({ className, ...props }: HandleProps) {
  return (
    <PanelSeparator
      data-slot="resizable-handle"
      {...props}
      className={cx(
        'relative flex w-px items-center justify-center bg-separator-border after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
        'data-[resize-handle-active]:bg-accent-500',
        className,
      )}
    />
  )
}

export const Resizable = Object.assign(ResizableRoot, {
  Panel: ResizablePanel,
  Handle: ResizableHandle,
})
