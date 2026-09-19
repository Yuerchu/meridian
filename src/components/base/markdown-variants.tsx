import type React from 'react'
import { tv } from 'tailwind-variants'

export function Markdown({ className, ...props }: React.ComponentProps<'div'>) {
  const slots = markdownVariants()
  return <div data-slot="markdown" {...props} className={slots.base({ className })} />
}

const proseClasses = [
  'prose prose-sm max-w-none dark:prose-invert',
  'prose-headings:font-semibold prose-headings:text-text-primary',
  'prose-p:text-text-primary prose-p:leading-relaxed',
  'prose-a:text-button-ghost-foreground prose-a:no-underline hover:prose-a:underline',
  // Inline code is filled with a wash of the bubble's ink over its fill, the
  // way `BubbleFoldBadge` is: prose is drawn inside bubbles of either speaker,
  // and a surface token cannot know which — `background-secondary` was the
  // assistant bubble's own colour in the light theme. Outside a bubble the
  // fallbacks give the assistant's wash. The variant outranks a class on the
  // element itself, so this line is the one place inline code is styled.
  'prose-code:rounded-md prose-code:bg-[color-mix(in_oklch,var(--bubble-fill,var(--bubble-assistant)),var(--bubble-ink,var(--color-text-primary))_8%)] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-caption-1-regular prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:rounded-xl prose-pre:bg-background-secondary-default',
  'prose-blockquote:border-l-accent prose-blockquote:text-text-secondary',
  'prose-strong:text-text-primary',
  'prose-li:text-text-primary',
  'prose-table:text-text-primary',
  'prose-th:text-text-primary prose-th:font-semibold',
  'prose-hr:border-separator-border',
]

export const markdownVariants = tv({
  slots: {
    base: proseClasses,
    block: proseClasses,
  },
})
