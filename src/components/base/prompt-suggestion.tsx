import type { ComponentProps } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

function PromptSuggestionRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion" {...props} className={cx('', className)} />
}

function PromptSuggestionItems({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion-items" {...props} className={cx('flex flex-wrap gap-2', className)} />
}

interface PromptSuggestionItemProps extends Omit<AriaButtonProps, 'className'> {
  className?: string
}

function PromptSuggestionItem({ className, ...props }: PromptSuggestionItemProps) {
  return (
    <AriaButton
      data-slot="prompt-suggestion-item"
      {...props}
      className={cx(
        'cursor-pointer rounded-xl border border-border-button-default bg-background-primary-default px-3 py-1.5 text-body-medium text-text-primary',
        'outline-none transition-colors duration-150 ease data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[hovered]:bg-background-primary-hover data-[pressed]:bg-background-primary-active data-[disabled]:cursor-default data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

export const PromptSuggestion = Object.assign(PromptSuggestionRoot, {
  Items: PromptSuggestionItems,
  Item: PromptSuggestionItem,
})
