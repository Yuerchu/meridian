import type { ComponentType, Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'

import { Tooltip, TooltipTrigger } from '@/components/base'
import { cx } from '@/utils/cx'

/**
 * An icon button with a tooltip. Lives here rather than beside the message
 * list because the markdown renderer needs it too, and importing it from a
 * message component would put a cycle between the two.
 *
 * The look is boardui's `ACTION_BUTTON`, copied from the AI Chat starter
 * (`components/application/agent-chat/agent-chat-actions.tsx`). Upstream keeps
 * it as a class list inside that component rather than as a `Button` variant,
 * so it is a recipe here too: a 28px `rounded-md` square, icon 18px, the
 * secondary icon ink stepping to primary over a `background-primary-hover`
 * wash, and 40% opacity when disabled. The only change is the element: React
 * Aria's `Button` instead of a native `<button>`, so the `TooltipTrigger`
 * around it (and a `MenuTrigger`, where one is used) reaches it through
 * context — which is also why `hover:`/`disabled:` are spelled as RAC's
 * `data-[hovered]`/`data-[disabled]`.
 *
 * `delay={0}` because these sit in dense rows of icons: a tooltip that waits
 * before appearing reads as the interface being slow to answer.
 */
const ACTION_BUTTON = cx(
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md',
  'text-foreground-icon-secondary transition-colors duration-150 ease',
  'data-[hovered]:bg-background-primary-hover data-[hovered]:text-foreground-icon-primary',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
)

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
    <TooltipTrigger delay={0}>
      {/* The button is the trigger — RAC TooltipTrigger picks it up from
          context, so no wrapper is needed around a real focusable element. */}
      <AriaButton
        ref={ref}
        aria-label={label}
        aria-pressed={ariaPressed}
        data-slot="action-button"
        isDisabled={isDisabled}
        onPress={onClick}
        className={cx(ACTION_BUTTON, className)}
      >
        <Icon aria-hidden className="size-[18px] shrink-0" />
      </AriaButton>
      <Tooltip placement="top">{label}</Tooltip>
    </TooltipTrigger>
  )
}

export { ActionButton }
