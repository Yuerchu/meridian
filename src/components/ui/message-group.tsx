import * as React from 'react'

import { cx } from '@/utils/cx'

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

const base = 'group/message relative flex w-full min-w-0 text-sm'

/** What the person said: a column against the right edge.
 *
 *  No avatar. The sender is whoever is reading, and naming them on every
 *  message says nothing that the side of the screen has not already said. */
function MessageGroupUser({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group"
      data-align="end"
      className={cx(base, 'flex-col items-end gap-0.5', className)}
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
    <div data-slot="message-group" data-align="start" className={cx(base, 'items-end gap-2', className)} {...props} />
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
    <div
      data-slot="message-group-avatar"
      className={cx(
        'sticky bottom-2 flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-background-secondary-default',
        className,
      )}
      {...props}
    />
  )
}

/** The bubbles of the run, stacked. Tight — the corner treatment between two
 *  bubbles only reads as "the same speaker, continued" when they nearly touch. */
function MessageGroupBubbles({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group-bubbles"
      className={cx('flex w-full min-w-0 flex-col gap-0.5 wrap-break-word', className)}
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
    <div
      data-slot="message-group-header"
      className={cx(
        'mb-0.5 flex max-w-full min-w-0 items-center gap-2 text-xs font-medium text-button-ghost-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** The actions on the run, revealed on hover — and always on a touch screen,
 *  where there is no hover. */
function MessageGroupFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group-footer"
      className={cx(
        'mt-1 flex max-w-full min-w-0 items-center gap-2 text-xs font-medium text-text-secondary opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 pointer-coarse:opacity-100',
        className,
      )}
      {...props}
    />
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
