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
  'prose-code:rounded prose-code:bg-background-secondary-default prose-code:px-1 prose-code:py-0.5 prose-code:text-body-regular prose-code:before:content-none prose-code:after:content-none',
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
