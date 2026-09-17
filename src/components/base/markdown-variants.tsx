import type React from 'react'
import { tv } from 'tailwind-variants'

export function Markdown({ className, ...props }: React.ComponentProps<'div'>) {
  const slots = markdownVariants()
  return <div data-slot="markdown" {...props} className={slots.base({ className })} />
}

const proseClasses = [
  'prose prose-sm max-w-none dark:prose-invert',
  'prose-headings:font-semibold prose-headings:text-foreground',
  'prose-p:text-foreground prose-p:leading-relaxed',
  'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
  'prose-code:rounded prose-code:bg-surface-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:rounded-xl prose-pre:bg-surface-secondary',
  'prose-blockquote:border-l-accent prose-blockquote:text-muted',
  'prose-strong:text-foreground',
  'prose-li:text-foreground',
  'prose-table:text-foreground',
  'prose-th:text-foreground prose-th:font-semibold',
  'prose-hr:border-separator',
]

export const markdownVariants = tv({
  slots: {
    base: proseClasses,
    block: proseClasses,
  },
})
