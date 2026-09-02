import * as React from 'react'
import { tv, type VariantProps } from '@heroui/react'

import { cn } from '@/lib/utils'

/**
 * The inline keyboard under a bubble: one button per tool call, a panel under
 * the row for whichever the reader opens.
 *
 * Two layers, and the reason is the DOM order. A disclosure is a trigger and a
 * panel, and the natural way to lay a row of them out — every trigger and
 * panel in one flex container, panels pushed after the buttons with `order` —
 * puts the Tab sequence at odds with what is on screen: from the first button
 * into its panel's controls, then back *up* to the second button. `order` is
 * the property the accessibility guidelines name for exactly this. It also
 * leaves a hole per collapsed panel, because a collapsed React Aria panel is
 * `hidden="until-found"`, which Chromium renders as a zero-height box rather
 * than nothing at all — and a zero-height flex item on its own line still
 * costs the row's `gap`.
 *
 * So the row is the buttons' home and the stack is where their panels go,
 * carried there by a portal. React context crosses a portal, which is what
 * keeps the disclosure's trigger and panel paired; `aria-controls` is an id and
 * never cared where the panel was. Tab now runs every button, then every open
 * panel, in order.
 */

interface BubbleKeyboardStack {
  /** The element panels are portalled into. Exists from the first render. */
  node: HTMLElement
}

/** Undefined outside any keyboard: a panel rendered there stays where it is. */
const BubbleKeyboardStackContext = React.createContext<BubbleKeyboardStack | undefined>(undefined)

/**
 * The stack is created by hand and adopted into the DOM at commit, rather than
 * rendered and handed out through a ref, and the difference is one frame that
 * matters. A ref is only filled after the children have rendered, so a panel
 * could not reach the stack until the render after — and React Aria decides
 * whether a *collapsed* panel is `hidden` in an effect that runs once, on the
 * panel's first appearance. A panel that appeared a frame late missed it and
 * sat there open. Made up front, the node is there for the first render;
 * portals do not mind that it is not attached to anything yet.
 */
function BubbleKeyboard({ className, children, ...props }: React.ComponentProps<'div'>) {
  const [stack] = React.useState<BubbleKeyboardStack>(() => {
    const node = document.createElement('div')
    node.dataset.slot = 'bubble-keyboard-stack'
    // No `gap` here — see the note above on collapsed panels. An open panel
    // brings its own top margin instead.
    node.className = 'flex w-full min-w-0 flex-col'
    return { node }
  })
  const adopt = React.useCallback(
    (host: HTMLDivElement | null) => {
      if (host) host.appendChild(stack.node)
      else stack.node.remove()
    },
    [stack],
  )
  return (
    <div data-slot="bubble-keyboard" className={cn('flex w-full min-w-0 flex-col', className)} {...props}>
      <BubbleKeyboardStackContext.Provider value={stack}>
        <div data-slot="bubble-keyboard-row" className="flex w-full min-w-0 flex-wrap gap-1">
          {children}
        </div>
        <div ref={adopt} data-slot="bubble-keyboard-stack-host" className="contents" />
      </BubbleKeyboardStackContext.Provider>
    </div>
  )
}

/**
 * The look of one key on the keyboard, shared by the disclosure triggers that
 * `ChatTool` draws in keyboard mode and by a plain button that only navigates.
 *
 * Two keys to a row by default, wrapping to one on a narrow column. A key that
 * `requiresAction` takes the whole row and stops clamping: what an approval
 * rests on is the exact path or command, and a truncated one is a decision
 * made about something the reader could not see.
 */
const keyboardKeyVariants = tv({
  base: [
    'flex min-h-8 min-w-[9rem] flex-1 basis-[calc(50%-0.125rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
    'bg-default/70 text-foreground transition-colors outline-none',
    'hover:bg-default data-[pressed]:bg-default data-[hovered]:bg-default focus-visible:ring-2 focus-visible:ring-focus/50',
    'disabled:opacity-60',
  ],
  variants: {
    state: {
      'input-streaming': '',
      'input-available': '',
      queued: 'text-muted',
      'output-available': '',
      'output-error': 'ring-1 ring-danger/40 ring-inset',
      'requires-action': 'basis-full ring-1 ring-warning/50 ring-inset',
      /** A key that goes somewhere rather than opening something. */
      navigate: 'bg-accent text-accent-foreground hover:bg-accent/90 data-[hovered]:bg-accent/90',
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

type KeyboardKeyState = NonNullable<VariantProps<typeof keyboardKeyVariants>['state']>

/** A plain key, for a keyboard entry with no panel behind it. */
function BubbleKeyboardKey({
  state,
  className,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof keyboardKeyVariants>) {
  return (
    <button
      type="button"
      data-slot="bubble-keyboard-key"
      data-state={state ?? 'input-available'}
      className={cn(keyboardKeyVariants({ state }), className)}
      {...props}
    />
  )
}

/**
 * The panel a key opens, styled. `ChatTool` in keyboard mode renders its
 * disclosure content with these classes; this is exported so a panel that is
 * not a disclosure — a form that is simply always open — can look the same.
 */
const keyboardPanelVariants = tv({
  base: [
    'mt-1 w-full min-w-0 rounded-xl bg-default/50 text-xs',
    // The panel carries the same edge its key does, because the key is what
    // the reader looked at to decide whether to open it.
  ],
  variants: {
    state: {
      'input-streaming': '',
      'input-available': '',
      queued: '',
      'output-available': '',
      'output-error': 'ring-1 ring-danger/40 ring-inset',
      'requires-action': 'ring-1 ring-warning/50 ring-inset',
      navigate: '',
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

/**
/**
/**
/**
/**
 * A badge standing in for keys the reader was not shown: "viewed 10 files".
 *
 * A toggle, not a disclosure. What it opens is not a panel under the row but
 * the keys themselves, drawn into a keyboard of their own under the bubble,
 * each with its own panel behind it — so the badge answers "which ten" and a
 * key answers "what did that one say". `aria-expanded` carries the state; the
 * pressed look reads off the same attribute so the two cannot disagree.
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

export {
  BubbleKeyboard,
  BubbleKeyboardKey,
  BubbleFoldBadge,
  BubbleKeyboardStackContext,
  keyboardKeyVariants,
  keyboardPanelVariants,
  type KeyboardKeyState,
}
