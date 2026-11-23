import * as React from 'react'

import './bubble.css'

export type BubblePosition = 'single' | 'first' | 'middle' | 'last'
export type BubbleVariant = 'user' | 'assistant' | 'muted' | 'outline' | 'ghost' | 'destructive'
export type BubbleAlign = 'start' | 'end'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function BubbleGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="bubble-group" className={joinClasses('m-bubble-group', className)} {...props} />
}

/**
 * The one distance between two adjacent blocks of a run, whichever side of a
 * bubble boundary they fall on.
 *
 * A reader cannot see where one bubble ends and the next begins — every block
 * has the same fill and the corner rules tighten both boundaries alike — so
 * two spacings read as noise, not structure. There used to be two: `gap-1`
 * between blocks of one bubble and `gap-0.5` between bubbles, which put a
 * prose block 4px from its tool call and that call 2px from the next bubble.
 * `Bubble`, `MessageGroupBubbles`, `MessageGroupUser` and the bare keyboard
 * of a `tools-only` bubble all read this, and `bubble-spacing.test.tsx`
 * fails if any of them stops. Runs (a model change, the question and the
 * answer) keep their larger gaps; this is the spacing *inside* one.
 */
const BUBBLE_RUN_GAP = 'm-bubble-run-gap'

/**
 * Everything that makes an element one of a bubble's blocks, apart from what it
 * holds and how wide it wants to be.
 *
 * Use it with `data-bubble-block=""`, and make the element a **direct child** of
 * the `Bubble` — the corner rules are the reason, and the development
 * warning is what catches getting it wrong. Width is deliberately not here:
 * `w-fit` for a block that is a label, `w-full` for one that is a table.
 *
 * The fallbacks are for a block drawn outside any bubble — the playground, a
 * test — which should still look like itself rather than like nothing.
 */
const BUBBLE_BLOCK = 'm-bubble-block'

/** The hover wash for a control *inside* a block — a disclosure head, a row —
 *  which cannot use the rule above because it is not the block itself. */
const BUBBLE_BLOCK_HOVER = 'm-bubble-block-hover'

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

/**
 * A bubble, and the blocks it says its part in.
 *
 * **A bubble may have more than one block, and a tool call is one of them.**
 * The prose is a block; so is each tool the model called for it, the sub-agent
 * group, and the output of a `!` command. A tool is something the assistant
 * *did* while it was talking, so it is drawn in the shell it talks in rather
 * than as a key on a keyboard with a card hanging under it.
 */
function Bubble({
  variant = 'user',
  align = 'start',
  position = 'single',
  className,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: BubbleVariant
  align?: BubbleAlign
  position?: BubblePosition
}) {
  const check = React.useCallback((node: HTMLDivElement | null) => warnAboutBuriedBlocks(node), [])
  return (
    <div
      ref={check}
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      data-position={position}
      className={joinClasses('m-bubble', BUBBLE_RUN_GAP, className)}
      {...props}
    />
  )
}

function BubbleContent({
  className,
  render,
  ...props
}: React.ComponentProps<'div'> & {
  render?: (props: React.ComponentProps<'div'>) => React.ReactElement
}) {
  const domProps: React.ComponentProps<'div'> & { 'data-slot': string; 'data-bubble-block': string } = {
    'data-slot': 'bubble-content',
    'data-bubble-block': '',
    className: joinClasses(BUBBLE_BLOCK, 'm-bubble-content', className),
    ...props,
  }
  if (render) return render(domProps)
  return <div {...domProps} />
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
  return <time data-slot="bubble-time" className={joinClasses('m-bubble-time', className)} {...props} />
}

export { BubbleGroup, Bubble, BubbleContent, BubbleTime, BUBBLE_BLOCK, BUBBLE_BLOCK_HOVER, BUBBLE_RUN_GAP }
