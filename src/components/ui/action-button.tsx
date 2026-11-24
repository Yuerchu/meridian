import type { ComponentType, Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'

import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import './action-button.css'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>

interface ActionButtonProps {
  label: string
  onClick?: () => void
  className?: string
  icon: IconComponent
  /** Persistent toggle state, such as a message rating. */
  'aria-pressed'?: boolean
  isDisabled?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * An icon button with a tooltip. Lives here rather than beside the message
 * list because the markdown renderer needs it too, and importing it from a
 * message component would put a cycle between the two.
 */
function ActionButton({
  label,
  onClick,
  className,
  icon: Icon,
  'aria-pressed': ariaPressed,
  isDisabled,
  ref,
}: ActionButtonProps) {
  return (
    <TooltipTrigger>
      {/* The button is the trigger — RAC TooltipTrigger picks it up from
          context, so no wrapper is needed around a real focusable element. */}
      <AriaButton
        ref={ref}
        aria-label={label}
        aria-pressed={ariaPressed}
        data-slot="action-button"
        isDisabled={isDisabled}
        onPress={onClick}
        className={joinClasses('m-action-button', className)}
      >
        <Icon aria-hidden className="m-action-button__icon" />
      </AriaButton>
      <Tooltip placement="top">{label}</Tooltip>
    </TooltipTrigger>
  )
}

export { ActionButton }
