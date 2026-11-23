import * as React from 'react'

import { BUBBLE_BLOCK } from './bubble'
import './bubble-block.css'

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

export type BubbleBlockState =
  | 'input-streaming'
  | 'input-available'
  | 'queued'
  | 'output-available'
  | 'output-error'
  | 'requires-action'
  | 'navigate'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A block that goes somewhere rather than opening something.
 *
 * Sized like a shut tool block — as wide as its content — except where it is
 * still waiting on the reader, which takes the column so it cannot be missed.
 * The ring rather than a fill for that: a filled primary block is a solid
 * white bar in the dark theme, louder than an approval sitting beside it.
 */
function BubbleBlockButton({
  state,
  className,
  ...props
}: React.ComponentProps<'button'> & { state?: BubbleBlockState }) {
  return (
    <button
      type="button"
      data-slot="bubble-block-button"
      data-bubble-block=""
      data-state={state ?? 'input-available'}
      className={joinClasses(BUBBLE_BLOCK, 'm-bubble-block-button', className)}
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
 *
 * The fill is a wash of the bubble's ink over the bubble's fill, the way a
 * block's hover is, rather than a surface token: it sits *on* a bubble, and a
 * surface token has no idea which. `background-secondary` was a dark hole in
 * the assistant's bubble in the dark theme and the bubble's own colour in the
 * light one.
 */
function BubbleFoldBadge({ expanded, className, ...props }: React.ComponentProps<'button'> & { expanded: boolean }) {
  return (
    <button
      type="button"
      data-slot="bubble-fold-badge"
      aria-expanded={expanded}
      className={joinClasses('m-bubble-fold-badge', className)}
      {...props}
    />
  )
}

export { BubbleBlockButton, BubbleFoldBadge }
