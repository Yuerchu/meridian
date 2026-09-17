import { Group, Panel, Separator as PanelSeparator } from 'react-resizable-panels'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type GroupProps = ComponentProps<typeof Group>
type PanelProps = ComponentProps<typeof Panel>
type HandleProps = ComponentProps<typeof PanelSeparator>

function ResizableRoot({ className, ...props }: GroupProps) {
  return <Group data-slot="resizable" {...props} className={cn('', className)} />
}

function ResizablePanel({ className, ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} className={cn('', className)} />
}

function ResizableHandle({ className, ...props }: HandleProps) {
  return (
    <PanelSeparator
      data-slot="resizable-handle"
      {...props}
      className={cn(
        'relative flex w-px items-center justify-center bg-separator after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
        'data-[resize-handle-active]:bg-accent',
        className,
      )}
    />
  )
}

export const Resizable = Object.assign(ResizableRoot, {
  Panel: ResizablePanel,
  Handle: ResizableHandle,
})
