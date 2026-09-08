import * as React from 'react'
import { tv, type VariantProps } from '@heroui/react'

import { cn } from '@/lib/utils'
import { BUBBLE_BLOCK } from './bubble'

/**
 * The parts of a bubble that are not prose.
 *
 * A bubble says its part in blocks: what the model wrote is one, and each tool
 * it called for that is another. They are all the same object — same fill, same
 * radius, corners tightened against each other by `bubble.tsx` — because a tool
 * call is something the assistant did while it was talking, not a control
 * parked underneath what it said.
 *
 * This module holds the two blocks that are not disclosures. Everything with a
 * head and a detail behind it is `ChatTool` in `bubble` presentation; what is
 * here is a block that only navigates, and the badge standing in for blocks
 * that were folded away.
 *
 * There used to be an inline keyboard here — a wrapping row of keys with a
 * portal carrying each key's panel into a stack below the row, so that Tab
 * would not run key, panel, key, panel while the screen showed keys then
 * panels. None of that is needed once a tool is one block: its head and its
 * detail are children of the same element, so reading order and DOM order are
 * the same thing by construction.
 */

/**
 * A block that goes somewhere rather than opening something.
 *
 * Sized like a shut tool block — as wide as its content — except where it is
 * still waiting on the reader, which takes the column so it cannot be missed.
 * The ring rather than a fill for that: a filled `bg-accent` block is a solid
 * white bar in the dark theme, louder than an approval sitting beside it.
 */
const bubbleBlockVariants = tv({
  base: [
    BUBBLE_BLOCK,
    'flex w-fit min-h-9 items-center gap-2 px-3 py-2 text-left text-xs transition-colors outline-none',
    'data-[pressed]:bg-[color-mix(in_oklch,var(--bubble-fill,var(--bubble-assistant)),var(--foreground)_8%)]',
    'focus-visible:ring-2 focus-visible:ring-focus/50',
    'disabled:opacity-60',
  ],
  variants: {
    state: {
      'input-streaming': '',
      'input-available': '',
      queued: 'text-muted',
      'output-available': '',
      'output-error': 'ring-1 ring-danger/40 ring-inset',
      'requires-action': 'w-full ring-1 ring-warning/50 ring-inset',
      /** Somewhere to go, while the page it leads to is still waiting on the
       *  reader. Info rather than warning, matching the page. */
      navigate: 'w-full ring-1 ring-info/40 ring-inset',
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

function BubbleBlockButton({
  state,
  className,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof bubbleBlockVariants>) {
  return (
    <button
      type="button"
      data-slot="bubble-block-button"
      data-bubble-block=""
      data-state={state ?? 'input-available'}
      className={cn(bubbleBlockVariants({ state }), className)}
      {...props}
    />
  )
}

/**
 * A badge standing in for blocks the reader was not shown: "viewed 10 files".
 *
 * A toggle, not a disclosure. What it opens is not a panel but the blocks
 * themselves, drawn under the bubble each with its own detail behind it — so
 * the badge answers "which ten" and a block answers "what did that one say".
 * `aria-expanded` carries the state; the pressed look reads off the same
 * attribute so the two cannot disagree.
 */
function BubbleFoldBadge({ expanded, className, ...props }: React.ComponentProps<'button'> & { expanded: boolean }) {
  return (
    <button
      type="button"
      data-slot="bubble-fold-badge"
      aria-expanded={expanded}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-default/70 px-2 text-xs leading-none text-muted transition-colors outline-none select-none',
        'hover:bg-default hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50',
        'aria-expanded:bg-default aria-expanded:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { BubbleBlockButton, BubbleFoldBadge }
