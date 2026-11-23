import * as React from 'react'
import { Focusable } from 'react-aria-components'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import './hint.css'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A piece of inert text with more to say on hover: a truncated path, a
 * shortened name, a figure with its qualifier.
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
    <TooltipTrigger>
      <Focusable excludeFromTabOrder={!focusable}>
        <Tag {...props} className={joinClasses('m-hint', className)}>
          {children}
        </Tag>
      </Focusable>
      <Tooltip placement={placement}>{label}</Tooltip>
    </TooltipTrigger>
  )
}
