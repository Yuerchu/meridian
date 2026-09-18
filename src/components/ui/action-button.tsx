import * as React from 'react'

import { Button, Tooltip, TooltipTrigger } from '@/components/base'

/**
 * An icon button with a tooltip. Lives here rather than beside the message
 * list because the markdown renderer needs it too, and importing it from a
 * message component would put a cycle between the two.
 *
 * `delay={0}` because these sit in dense rows of icons: a tooltip that waits
 * before appearing reads as the interface being slow to answer.
 */
interface ActionButtonProps {
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
  /** Persistent toggle state, such as a message rating. */
  'aria-pressed'?: boolean
  /** `ghost` unless the action is destructive, which is `danger-soft`. */
  variant?: React.ComponentProps<typeof Button>['variant']
}

const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { label, onClick, className, children, 'aria-pressed': ariaPressed, variant = 'ghost' },
  ref,
) {
  return (
    <TooltipTrigger delay={0}>
      {/* The button is the trigger — RAC TooltipTrigger picks it up from
          context, so no wrapper is needed around a real focusable element. */}
      <Button
        ref={ref}
        isIconOnly
        aria-label={label}
        aria-pressed={ariaPressed}
        data-slot="action-button"
        variant={variant}
        onPress={onClick}
        className={className}
      >
        {children}
      </Button>
      <Tooltip placement="top">{label}</Tooltip>
    </TooltipTrigger>
  )
})

export { ActionButton }
