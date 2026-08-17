import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Two components rather than one with an `align` prop.
 *
 * The prop only ever took two values, once each, at the two call sites in
 * `message-item.tsx` — it parameterised something the caller always knew. What
 * it cost was a contract: every part that had to sit differently on one side
 * read `data-align` back off the group, and `Bubble` ended up saying the same
 * thing twice, once through its own `align` and once through the group's.
 *
 * The shape here follows Pro's `chat-message`, which splits the same way for
 * the same reason. The components are ours because Pro's action button wraps a
 * real button in `Tooltip.Trigger`, which is a second tab stop that does
 * nothing — see `action-button.tsx`, and the tooltip rule in CLAUDE.md.
 */

const base = 'group/message relative flex w-full min-w-0 text-sm'

/**
 * What the person said: a column against the right edge.
 *
 * No avatar. The sender is whoever is reading, and naming them on every message
 * says nothing that the side of the screen has not already said.
 */
function MessageUser({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="message" className={cn(base, 'flex-col items-end gap-2.5', className)} {...props} />
}

/** The answer, with its avatar beside it. */
function MessageAssistant({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="message" className={cn(base, 'items-start gap-2', className)} {...props} />
}

/** Level with the header that names the model, not the bottom of the message.
 *  The bottom-anchored placement instant messengers use assumes short bubbles
 *  and a known correspondent; an answer that runs for pages would leave its
 *  avatar floating somewhere in the middle of the text, attached to nothing. */
function MessageAvatar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        'flex w-fit min-w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-default',
        className,
      )}
      {...props}
    />
  )
}

/** The answer beside the avatar. Only the assistant side needs it: a user
 *  message has nothing to sit next to, so its parts are the column. */
function MessageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-content"
      className={cn('flex w-full min-w-0 flex-col gap-2.5 wrap-break-word', className)}
      {...props}
    />
  )
}

function MessageHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        'flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted group-has-data-[variant=ghost]/message:px-0',
        className,
      )}
      {...props}
    />
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        'flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted group-has-data-[variant=ghost]/message:px-0',
        className,
      )}
      {...props}
    />
  )
}

export { MessageUser, MessageAssistant, MessageAvatar, MessageContent, MessageFooter, MessageHeader }
