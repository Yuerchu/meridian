import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function PromptSuggestionRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion" {...props} className={cn('', className)} />
}

function PromptSuggestionItems({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-suggestion-items" {...props} className={cn('flex flex-wrap gap-2', className)} />
}

interface PromptSuggestionItemProps extends ComponentProps<'button'> {
  isDisabled?: boolean
  onPress?: () => void
}

function PromptSuggestionItem({ className, isDisabled, onPress, ...props }: PromptSuggestionItemProps) {
  return (
    <button
      data-slot="prompt-suggestion-item"
      type="button"
      disabled={isDisabled}
      onClick={onPress}
      {...props}
      className={cn(
        'rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors',
        'hover:bg-default disabled:opacity-50',
        className,
      )}
    />
  )
}

export const PromptSuggestion = Object.assign(PromptSuggestionRoot, {
  Items: PromptSuggestionItems,
  Item: PromptSuggestionItem,
})
