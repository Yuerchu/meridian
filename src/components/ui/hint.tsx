import * as React from 'react'
import { Focusable } from 'react-aria-components'
import { Tooltip, TooltipTrigger } from '@/components/base'

import { cx } from '@/utils/cx'

/**
 * A piece of inert text with more to say on hover: a truncated path, a
 * shortened name, a figure with its qualifier.
 *
 * What a native `title` used to do, done with boardui's tooltip. The browser's
 * own tooltip is the one thing on screen not drawn by this app — a different
 * font, a different delay, a different corner — and it is banned by the lint
 * for that reason.
 *
 * The trigger is focusable by default, which is how a keyboard reaches a
 * tooltip at all. Where one text is repeated many times over — every segment
 * of every bar in a chart — that is a tab stop per repetition and nothing for
 * a keyboard to do at any of them, so `focusable={false}` keeps those to hover
 * alone, which is exactly what `title` gave them.
 *
 * `Focusable` is what makes a plain span a tooltip trigger at all: React Aria's
 * `TooltipTrigger` hands its hover and focus handlers down through context, and
 * only a `useFocusable` consumer receives them — an unwrapped span never opens
 * the tooltip, on hover or on focus.
 */
export function Hint({
  label,
  as = 'span',
  focusable = true,
  placement,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'span'>, 'title'> & {
  label: React.ReactNode
  as?: 'span' | 'p' | 'code'
  focusable?: boolean
  placement?: React.ComponentProps<typeof Tooltip>['placement']
}) {
  const Tag = as as 'span'
  return (
    <TooltipTrigger delay={0}>
      <Focusable excludeFromTabOrder={!focusable}>
        <Tag {...props} className={cx('min-w-0', className)}>
          {children}
        </Tag>
      </Focusable>
      <Tooltip placement={placement}>{label}</Tooltip>
    </TooltipTrigger>
  )
}
