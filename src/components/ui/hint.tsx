import * as React from 'react'
import { Tooltip } from '@heroui/react'

import { cn } from '@/lib/utils'

/**
 * A piece of inert text with more to say on hover: a truncated path, a
 * shortened name, a figure with its qualifier.
 *
 * What a native `title` used to do, done with HeroUI's tooltip. The browser's
 * own tooltip is the one thing on screen not drawn by this app — a different
 * font, a different delay, a different corner — and it is banned by the lint
 * for that reason. This composes `Tooltip` around a `Tooltip.Trigger` rendered
 * as the text's own element, so there is no wrapper in the flow: the span
 * *is* the trigger.
 *
 * The trigger is focusable by default, which is how a keyboard reaches a
 * tooltip at all. Where one text is repeated many times over — every segment
 * of every bar in a chart — that is a tab stop per repetition and nothing for
 * a keyboard to do at any of them, so `focusable={false}` keeps those to hover
 * alone, which is exactly what `title` gave them.
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
  placement?: React.ComponentProps<typeof Tooltip.Content>['placement']
}) {
  // Typed as a span whichever tag it is: the three take the same props, and
  // the trigger's ref is typed for a span.
  const Tag = as as 'span'
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger
        tabIndex={focusable ? undefined : -1}
        render={(triggerProps) => <Tag {...(triggerProps as React.ComponentProps<'span'>)} {...props} />}
        className={cn('min-w-0', className)}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content placement={placement}>{label}</Tooltip.Content>
    </Tooltip>
  )
}
