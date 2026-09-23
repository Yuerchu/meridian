import * as React from 'react'
import { dom, tv, type VariantProps } from '@/components/base'

import { cx } from '@/utils/cx'

export type BubblePosition = 'single' | 'first' | 'middle' | 'last'

function BubbleGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="bubble-group" className={cx('flex min-w-0 flex-col gap-2', className)} {...props} />
}

/**
 * A bubble, and the blocks it says its part in.
 *
 * **A bubble may have more than one block, and a tool call is one of them.**
 * The prose is a block; so is each tool the model called for it, the sub-agent
 * group, and the output of a `!` command. A tool is something the assistant
 * *did* while it was talking, so it is drawn in the shell it talks in rather
 * than as a key on a keyboard with a card hanging under it.
 *
 * ## What a block gets, and how it gets it
 *
 * Two mechanisms, and which one a property uses is decided by one question:
 * **does it depend on the block's neighbours?**
 *
 * *No* — the fill, the text colour, the edge, the hover lift and the shadow
 * depend only on whose bubble this is. They travel as the custom properties
 * below (`--bubble-fill`, `--bubble-ink`, `--bubble-edge`, `--bubble-lift`,
 * `--bubble-shadow`), which
 * **inherit**, so they reach a block however deeply it is wrapped and a block
 * outside any bubble falls back to the assistant's. This is deliberate: these
 * were `[&>[data-bubble-block]]:` rules once, and a block that picked up a
 * wrapper lost its fill without a word.
 *
 * *Yes* — the corners. A block's corner treatment is a fact about what is above
 * and below it, so it needs selectors, and they are the one thing here that
 * requires a block to be a **direct child**. `Bubble` says so in development
 * (`warnAboutBuriedBlocks`) rather than leaving it to be noticed on screen.
 *
 * ## The corner rules, in full
 *
 * Only the speaker's side is ever tightened; the far side keeps `rounded-2xl`
 * throughout, which is the messenger convention and what makes a run read as
 * one column of speech. On that side there are exactly two rules, each with two
 * triggers, and they are the whole of it:
 *
 * - the **top** corner tightens when something of the same speaker is directly
 *   above — another block in this bubble, or another bubble in this run
 *   (`position` is `middle` or `last`);
 * - the **bottom** corner tightens when something is directly below — another
 *   block, or another bubble (`position` is `first` or `middle`).
 *
 * They read off `data-position`, which `Bubble` already writes, so there are no
 * compound variants: `position` selects nothing on its own and the four rules
 * below say everything. `~` rather than `:not(:first-child)` because a bubble's
 * children are not all blocks — the odd wrapper sits among them — so "has a
 * block before it" is the question, not "is not the first node".
 *
 * `rounded-2xl` is the composer's radius, the top of this app's ladder; `md` is
 * the tightened corner; a result or diff box *inside* a block is `rounded-lg`.
 */
const bubbleVariants = tv({
  base: [
    'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  ],
  variants: {
    // Each of these sets the inherited properties every block reads. Nothing
    // here selects a block: a variant is about whose bubble this is, which is
    // the same answer for every block in it and at every depth.
    variant: {
      /** What the person said. */
      user: '[--bubble-fill:var(--bubble-user)] [--bubble-ink:var(--bubble-user-foreground)] [--bubble-lift:8%] [--bubble-shadow:var(--bubble-user-shadow)]',
      /** What the model said, and what it did. A touch wider than the user's:
       *  an answer is usually the longer of the two, and a code block needs
       *  the room. */
      assistant:
        'max-w-[85%] [--bubble-fill:var(--bubble-assistant)] [--bubble-ink:var(--bubble-assistant-foreground)]',
      muted: '[--bubble-fill:var(--color-background-secondary-default)] [--bubble-ink:var(--color-text-primary)]',
      // The two that are not a fill with a lift on it: an outline bubble is
      // drawn by its edge, and hovering one changes colour rather than
      // brightening, so both keep a rule of their own.
      outline:
        '[--bubble-fill:var(--color-background-full)] [--bubble-ink:var(--color-text-primary)] [--bubble-edge:var(--color-border-button-default)] [&_[data-bubble-block]:is(button,a):hover]:bg-background-secondary-default [&_[data-bubble-block]:is(button,a):hover]:text-text-primary dark:[&_[data-bubble-block]:is(button,a):hover]:bg-background-tertiary-default/30',
      ghost:
        'border-none [--bubble-fill:transparent] [--bubble-ink:var(--color-text-primary)] [&_[data-bubble-block]]:rounded-none [&_[data-bubble-block]]:p-0 [&_[data-bubble-block]:is(button,a):hover]:bg-background-secondary-default [&_[data-bubble-block]:is(button,a):hover]:text-text-primary dark:[&_[data-bubble-block]:is(button,a):hover]:bg-background-secondary-default/50',
      destructive:
        '[--bubble-fill:var(--color-status-danger-soft)] [--bubble-ink:var(--color-status-danger-soft-foreground)] [--bubble-lift:8%]',
    },
    // The corners, and the only rules here that need a block to be a direct
    // child. Two questions per side: is one of ours directly above, and is one
    // directly below.
    align: {
      start: [
        '[&>[data-bubble-block]~[data-bubble-block]]:rounded-tl-md',
        '[&:is([data-position=middle],[data-position=last])>[data-bubble-block]]:rounded-tl-md',
        '[&>[data-bubble-block]:has(~[data-bubble-block])]:rounded-bl-md',
        '[&:is([data-position=first],[data-position=middle])>[data-bubble-block]]:rounded-bl-md',
      ],
      end: [
        '[&>[data-bubble-block]~[data-bubble-block]]:rounded-tr-md',
        '[&:is([data-position=middle],[data-position=last])>[data-bubble-block]]:rounded-tr-md',
        '[&>[data-bubble-block]:has(~[data-bubble-block])]:rounded-br-md',
        '[&:is([data-position=first],[data-position=middle])>[data-bubble-block]]:rounded-br-md',
      ],
    },
    /** Where this bubble sits in its run. Carried on `data-position` and read
     *  by the corner rules above; it selects nothing by itself. */
    position: {
      single: '',
      first: '',
      middle: '',
      last: '',
    },
  },
  defaultVariants: {
    variant: 'user',
    align: 'start',
    position: 'single',
  },
})

/**
 * Everything that makes an element one of a bubble's blocks, apart from what it
 * holds and how wide it wants to be.
 *
 * Use it with `data-bubble-block=""`, and make the element a **direct child** of
 * the `Bubble` — the corner rules above are the reason, and the development
 * warning is what catches getting it wrong. Width is deliberately not here:
 * `w-fit` for a block that is a label, `w-full` for one that is a table.
 *
 * The fallbacks are for a block drawn outside any bubble — the playground, a
 * test — which should still look like itself rather than like nothing.
 */
const BUBBLE_BLOCK = [
  'max-w-full min-w-0 overflow-hidden rounded-2xl',
  'bg-[var(--bubble-fill,var(--bubble-assistant))] text-[var(--bubble-ink,var(--bubble-assistant-foreground))]',
  // The person's bubble is the registry's white card (`agent-chat-message.tsx`,
  // `shadow-card`); the model's carries none.
  '[box-shadow:var(--bubble-shadow,none)]',
  '[&:is(button,a):hover]:bg-[color-mix(in_oklch,var(--bubble-fill,var(--bubble-assistant)),var(--color-text-primary)_var(--bubble-lift,5%))]',
]

/** The hover wash for a control *inside* a block — a disclosure head, a row —
 *  which cannot use the rule above because it is not the block itself. */
const BUBBLE_BLOCK_HOVER =
  'hover:bg-[color-mix(in_oklch,var(--bubble-fill,var(--bubble-assistant)),var(--color-text-primary)_var(--bubble-lift,5%))]'

/**
 * Says so when a block has been buried under a wrapper, in development only.
 *
 * The corner rules select direct children, so a block one level down keeps its
 * fill (that inherits) and silently loses its corners — which looks like a
 * design choice rather than a bug. Cheap enough to run on mount: one query per
 * bubble, and each message is reported once.
 */
const reportedBuriedBlocks = new Set<string>()

function warnAboutBuriedBlocks(bubble: HTMLElement | null) {
  if (!import.meta.env.DEV || !bubble) return
  for (const block of bubble.querySelectorAll('[data-bubble-block]')) {
    if (block.parentElement === bubble) continue
    // A nested bubble owns its own blocks — a transcript inside a sheet, a
    // preview inside a card. Only blocks this bubble is responsible for.
    if (block.closest('[data-slot="bubble"]') !== bubble) continue
    const slot = block.getAttribute('data-slot') ?? block.tagName.toLowerCase()
    if (reportedBuriedBlocks.has(slot)) continue
    reportedBuriedBlocks.add(slot)
    console.warn(
      `[bubble] "${slot}" carries data-bubble-block but is not a direct child of its bubble, ` +
        'so the corner rules cannot reach it. Render it as a sibling of the other blocks — ' +
        'a fragment rather than a wrapper.',
    )
  }
}

function Bubble({
  variant = 'user',
  align = 'start',
  position = 'single',
  className,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof bubbleVariants>) {
  const check = React.useCallback((node: HTMLDivElement | null) => warnAboutBuriedBlocks(node), [])
  return (
    <div
      ref={check}
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      data-position={position}
      className={cx(bubbleVariants({ variant, align, position }), className)}
      {...props}
    />
  )
}

function BubbleContent({ className, render, ...props }: React.ComponentProps<typeof dom.div>) {
  return (
    <dom.div
      data-slot="bubble-content"
      data-bubble-block=""
      className={cx(
        BUBBLE_BLOCK,
        // `px-3 py-[11px] text-body-regular` is the registry's user message
        // (`agent-chat-message.tsx`); the composite type utility carries its own
        // line height, so no `leading-*` is stacked on it (boardui AGENTS.md).
        'w-fit border border-[var(--bubble-edge,transparent)] px-3 py-[11px] text-body-regular wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:ring-2 [button,a]:focus-visible:ring-border-focus-ring',
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
      className={cx('text-caption-1-regular leading-none whitespace-nowrap text-text-secondary select-none', className)}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent, BubbleTime, BUBBLE_BLOCK, BUBBLE_BLOCK_HOVER }
