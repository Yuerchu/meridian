import * as React from 'react'

import { BUBBLE_RUN_GAP } from './bubble'
import './message-group.css'

/**
 * A run of messages from one speaker, drawn the way a messenger draws one:
 * bubbles stacked with tight corners between them, one avatar for the lot.
 *
 * Two components rather than one with an `align` prop, for the reason
 * `message.tsx` gave before this replaced it: the prop only ever took two
 * values, once each, and every part that had to sit differently on one side
 * read the alignment back off the group. The split is where it belongs — the
 * side of the screen already says who is speaking.
 *
 * The group is a layout, not a state. Which bubble is first, which is last,
 * whether the run is still being written: all of that is decided in
 * `lib/message-groups` and handed down as data. Nothing in here looks at its
 * siblings.
 */

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** What the person said: a column against the right edge.
 *
 *  No avatar. The sender is whoever is reading, and naming them on every
 *  message says nothing that the side of the screen has not already said. */
function MessageGroupUser({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group"
      data-align="end"
      className={joinClasses('m-message-group', BUBBLE_RUN_GAP, className)}
      {...props}
    />
  )
}

/** The answer, with its avatar beside it.
 *
 *  `items-end` rather than `items-start`: the avatar sits at the *bottom* of
 *  the run, where a messenger puts it, and stays there. It used to sit level
 *  with a header at the top, on the argument that a bottom-anchored avatar
 *  beside a page-long answer floats somewhere in the middle of the text. That
 *  is true of a static bottom; `MessageGroupAvatar` is sticky, so it rides the
 *  bottom of the viewport up the run and is beside whatever is being read. */
function MessageGroupAssistant({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group"
      data-align="start"
      className={joinClasses('m-message-group', className)}
      {...props}
    />
  )
}

/**
 * The one avatar of a run.
 *
 * A direct flex child of the group row, and it has to stay one: a sticky
 * element's containing block is its parent, and that parent's height is how
 * far the avatar may travel. Wrapped in a column that only reached as far as
 * the first bubble, it would stop there.
 *
 * `bottom-2` is inside the group's own bottom margin, so at rest — pinned to
 * the bottom of the run rather than the bottom of the viewport — it lines up
 * with the last bubble instead of hanging below it.
 */
function MessageGroupAvatar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="message-group-avatar" className={joinClasses('m-message-group__avatar', className)} {...props} />
  )
}

/** The bubbles of the run, stacked. Tight — the corner treatment between two
 *  bubbles only reads as "the same speaker, continued" when they nearly touch. */
function MessageGroupBubbles({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group-bubbles"
      className={joinClasses('m-message-group__bubbles', BUBBLE_RUN_GAP, className)}
      {...props}
    />
  )
}

/** Who is speaking, inside the first bubble of a run: a model's id, or the
 *  nickname of the person in a group chat. Coloured rather than muted, the way
 *  a messenger names a sender — it is the one line of the bubble that is not
 *  the message. */
function MessageGroupHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="message-group-header" className={joinClasses('m-message-group__header', className)} {...props} />
  )
}

/** The actions on the run, revealed on hover — and always on a touch screen,
 *  where there is no hover. */
function MessageGroupFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="message-group-footer" className={joinClasses('m-message-group__footer', className)} {...props} />
  )
}

export {
  MessageGroupUser,
  MessageGroupAssistant,
  MessageGroupAvatar,
  MessageGroupBubbles,
  MessageGroupHeader,
  MessageGroupFooter,
}
