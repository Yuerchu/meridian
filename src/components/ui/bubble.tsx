import * as React from 'react'
import { dom, tv, type VariantProps } from '@heroui/react'

import { cn } from '@/lib/utils'

export type BubblePosition = 'single' | 'first' | 'middle' | 'last'

function BubbleGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="bubble-group" className={cn('flex min-w-0 flex-col gap-2', className)} {...props} />
}

/**
 * The corner treatment of a run of bubbles from one speaker.
 *
 * The corners on the speaker's side tighten where two bubbles meet, so a run
 * reads as one thing said in parts rather than as several unrelated
 * rectangles. Which side that is depends on `align`, so the variants are
 * compound: a `first` bubble on the left tightens its bottom-left corner, on
 * the right its bottom-right. `single` keeps every corner and is the default.
 *
 * `rounded-2xl` is the composer's radius, which is the top of this app's
 * ladder — a keyboard panel inside a bubble column is `rounded-xl`, and a diff
 * or result box inside that is `rounded-lg`.
 */
const bubbleVariants = tv({
  base: 'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  variants: {
    variant: {
      /** What the person said. */
      user: '*:data-[slot=bubble-content]:bg-[var(--bubble-user)] *:data-[slot=bubble-content]:text-[var(--bubble-user-foreground)] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--bubble-user),var(--foreground)_8%)]',
      /** What the model said. A touch wider than the user's: an answer is
       *  usually the longer of the two, and a code block needs the room. */
      assistant:
        'max-w-[85%] *:data-[slot=bubble-content]:bg-[var(--bubble-assistant)] *:data-[slot=bubble-content]:text-[var(--bubble-assistant-foreground)] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--bubble-assistant),var(--foreground)_5%)]',
      muted:
        '*:data-[slot=bubble-content]:bg-default [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--default),var(--foreground)_5%)]',
      outline:
        '*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-default [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-field/30',
      ghost:
        'border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-default [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-default/50',
      destructive:
        '*:data-[slot=bubble-content]:bg-danger-soft *:data-[slot=bubble-content]:text-danger-soft-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--danger-soft),var(--foreground)_8%)]',
    },
    align: {
      start: '',
      end: '',
    },
    position: {
      single: '',
      first: '',
      middle: '',
      last: '',
    },
  },
  compoundVariants: [
    { align: 'start', position: 'first', class: '*:data-[slot=bubble-content]:rounded-bl-md' },
    { align: 'start', position: 'middle', class: '*:data-[slot=bubble-content]:rounded-l-md' },
    { align: 'start', position: 'last', class: '*:data-[slot=bubble-content]:rounded-tl-md' },
    { align: 'end', position: 'first', class: '*:data-[slot=bubble-content]:rounded-br-md' },
    { align: 'end', position: 'middle', class: '*:data-[slot=bubble-content]:rounded-r-md' },
    { align: 'end', position: 'last', class: '*:data-[slot=bubble-content]:rounded-tr-md' },
  ],
  defaultVariants: {
    variant: 'user',
    align: 'start',
    position: 'single',
  },
})

function Bubble({
  variant = 'user',
  align = 'start',
  position = 'single',
  className,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof bubbleVariants>) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      data-position={position}
      className={cn(bubbleVariants({ variant, align, position }), className)}
      {...props}
    />
  )
}

function BubbleContent({ className, render, ...props }: React.ComponentProps<typeof dom.div>) {
  return (
    <dom.div
      data-slot="bubble-content"
      className={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-2xl border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:border-focus [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-focus/50',
        className,
      )}
      render={render}
      {...props}
    />
  )
}

/**
 * When a bubble was sent, drawn the way a messenger draws it: small, muted,
 * and sitting at the end of the last line.
 *
 * Where it goes is decided by whoever renders the prose — `MarkdownContent`'s
 * `trailer` floats it into the final paragraph when there is one, and puts it
 * on its own line under a code block or a table, where a float would land
 * inside the box. This is only the mark itself. `select-none` so a drag
 * across the text does not carry a stray time into the clipboard.
 */
function BubbleTime({ className, ...props }: React.ComponentProps<'time'>) {
  return (
    <time
      data-slot="bubble-time"
      className={cn('text-xs leading-none whitespace-nowrap text-muted select-none', className)}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent, BubbleTime }
