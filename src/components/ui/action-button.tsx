import * as React from 'react'

import { Button, Tooltip } from '@heroui/react'

/**
 * An icon button with a tooltip. Lives here rather than beside the message
 * list because the markdown renderer needs it too, and importing it from a
 * message component would put a cycle between the two.
 *
 * `delay={0}` because these sit in dense rows of icons: a tooltip that waits
 * before appearing reads as the interface being slow to answer.
 */
function ActionButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip delay={0}>
      {/* The button is the trigger. `Tooltip.Trigger` is for children that
          cannot take focus themselves — it wraps them in a focusable
          `role="button"` div, and around a real button that div becomes a
          second tab stop that does nothing when pressed. */}
      <Button
        isIconOnly
        aria-label={label}
        data-slot="action-button"
        variant="ghost"
        onClick={onClick}
        className={className}
      >
        {children}
      </Button>
      <Tooltip.Content placement="top">{label}</Tooltip.Content>
    </Tooltip>
  )
}

export { ActionButton }
