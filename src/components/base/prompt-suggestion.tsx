import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function PromptSuggestionRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion" {...props} className={cx('', className)} />
}

function PromptSuggestionItems({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion-items" {...props} className={cx('flex flex-wrap gap-2', className)} />
}

interface PromptSuggestionItemProps extends ComponentProps<'button'> {
  disabled?: boolean
  onClick?: () => void
}

function PromptSuggestionItem({ className, disabled, onClick, ...props }: PromptSuggestionItemProps) {
  return (
    <button
      data-slot="prompt-suggestion-item"
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...props}
      className={cx(
        'rounded-xl border border-border-button-default bg-background-primary-default px-3 py-1.5 text-body-medium text-text-primary transition-colors',
        'hover:bg-background-secondary-default disabled:opacity-50',
        className,
      )}
    />
  )
}

export const PromptSuggestion = Object.assign(PromptSuggestionRoot, {
  Items: PromptSuggestionItems,
  Item: PromptSuggestionItem,
})
