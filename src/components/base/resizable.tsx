import { Group, Panel, Separator as PanelSeparator } from 'react-resizable-panels'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

type GroupProps = ComponentProps<typeof Group>
type HandleProps = ComponentProps<typeof PanelSeparator>

/**
 * A panel size with its unit spelled out.
 *
 * react-resizable-panels v4 reads a bare number as **pixels** and a unitless
 * string as a percentage — the opposite of v3, where every number was a
 * percentage. `defaultSize={30} minSize={18} maxSize={50}` was written with v3
 * in mind and produced a changes panel 18–50 *pixels* wide, one character per
 * line, for as long as the panel existed. The library's own type is
 * `number | string`, so nothing flagged it; this one refuses both ambiguous
 * spellings and makes the unit part of the value.
 */
export type PanelSize = `${number}%` | `${number}px` | `${number}rem`

type PanelProps = Omit<ComponentProps<typeof Panel>, 'defaultSize' | 'minSize' | 'maxSize' | 'collapsedSize'> & {
  defaultSize?: PanelSize
  minSize?: PanelSize
  maxSize?: PanelSize
  collapsedSize?: PanelSize
}

function ResizableRoot({ className, ...props }: GroupProps) {
  return <Group data-slot="resizable" {...props} className={cx('', className)} />
}

function ResizablePanel({ className, ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} className={cx('', className)} />
}

/**
 * The separator is a native `div` with `tabIndex=0` and the library's own arrow
 * / Home / End handling, so it takes the native `focus-visible:` ring (BoardUI's
 * recipe) rather than React Aria's `data-focus-visible`, which nothing sets
 * here. Its state is `data-separator="inactive|hover|focus|active|disabled"`
 * in v4; the v3 `data-resize-handle-active` it used to be styled from is never
 * written.
 */
function ResizableHandle({ className, ...props }: HandleProps) {
  return (
    <PanelSeparator
      data-slot="resizable-handle"
      {...props}
      className={cx(
        'relative flex w-px items-center justify-center bg-separator-border after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
        'data-[separator=hover]:bg-border-button-hover data-[separator=active]:bg-accent-500',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    />
  )
}

export const Resizable = Object.assign(ResizableRoot, {
  Panel: ResizablePanel,
  Handle: ResizableHandle,
})
