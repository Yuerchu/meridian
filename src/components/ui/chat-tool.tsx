import * as React from 'react'
import { createPortal } from 'react-dom'
import { Disclosure, Spinner, Tooltip, TooltipTrigger, tv, type VariantProps } from '@/components/base'
import { DisclosureStateContext } from 'react-aria-components'
import { CircleCheck, CircleExclamation, CircleXmark, Clock } from '@gravity-ui/icons'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { cx } from '@/utils/cx'
import { BUBBLE_BLOCK, BUBBLE_BLOCK_HOVER } from './bubble'

/**
 * The first four mirror the states an assistant-UI tool part goes through.
 * `queued` is ours: a call the model asked for that has not started, because the
 * one before it in the same reply has not finished. Nothing upstream models it,
 * and without it a call that is waiting its turn is drawn exactly like the one
 * doing the work.
 */
type ChatToolState =
  'input-streaming' | 'input-available' | 'queued' | 'output-available' | 'output-error' | 'requires-action'

const ChatToolStateContext = React.createContext<ChatToolState>('input-available')

/**
 * How a tool is drawn: as a card of its own, or as one of the blocks of the
 * bubble it belongs to.
 *
 * **A tool call is a message.** It is something the assistant did in the middle
 * of saying something, so it is drawn in the same shell as what it said: a
 * block in the same bubble, taking the same corner treatment, the same fill and
 * the same avatar. `bubble` is that.
 *
 * It replaces an inline keyboard — a row of keys under the bubble, each opening
 * a panel — which cost two things. On screen it was two objects in two nearly
 * identical greys with a gap between them, reading as a card inside a card
 * beside a bubble that was neither. And in the DOM the panel could not stay
 * next to its key: keys sat two to a row, so a panel had to be carried into a
 * stack below the row by a portal, with a hand-built node adopted at commit to
 * beat a React Aria effect. One block removes both — the head and the detail
 * are the same element's children, so DOM order *is* reading order and the Tab
 * sequence needs nothing done to it.
 *
 * One context rather than two component sets, because what changes is only the
 * chrome. The trigger, the panel sections, the status icon, the approval row
 * and every specialised card built on them keep their structure and their
 * behaviour. `card` remains the default so the playground and the tests that
 * exercise the card go on doing so.
 */
type ChatToolPresentation = 'card' | 'bubble'

const ChatToolPresentationContext = React.createContext<ChatToolPresentation>('card')

function ChatToolPresentationProvider({ value, children }: { value: ChatToolPresentation; children: React.ReactNode }) {
  return <ChatToolPresentationContext.Provider value={value}>{children}</ChatToolPresentationContext.Provider>
}

/**
 * The Pro ChatTool's 12px corner and compact row, with Meridian's surface and
 * inset ring. A generic HeroUI Card is deliberately not used: its padding sits
 * outside the full-width trigger and stops the hover wash before the edge.
 *
 * **The edge is not decoration here, and dropping it made these cards vanish.**
 * A HeroUI card carries none because it is told apart by being lighter than the
 * *page* plus `--surface-shadow`, and both halves of that fail in the one place
 * these are drawn. The transcript is inside `Sidebar.Main`, which Pro paints
 * `background-color: var(--color-background-primary-default)` under `variant="inset"` — so a `bg-background-primary-default`
 * card is exactly its parent's colour, not one step above the page. And HeroUI
 * sets `--surface-shadow: 0 0 0 0 transparent inset` in dark mode on purpose
 * ("No shadow on dark mode"), which leaves a dark-theme card with no fill
 * difference, no shadow and no border: nothing at all.
 *
 * A ring rather than a border, for the reason the status variants below give —
 * it takes no space, so recolouring it for `output-error` costs no reflow and
 * needs no second mechanism.
 */
const CHAT_TOOL_CARD =
  'overflow-hidden rounded-xl bg-background-primary-default shadow-card ring-1 ring-border-button-default ring-inset'

const chatToolVariants = tv({
  slots: {
    base: 'flex w-full flex-col text-caption-1-regular',
    // Mirrors Pro's chat-tool rhythm. The inset focus ring remains visible
    // inside the clipped card and does not add another layout edge.
    trigger: [
      'flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left transition-colors outline-none',
      'hover:bg-background-primary-hover data-[pressed]:bg-background-tertiary-default focus-visible:bg-background-secondary-default',
      'focus-visible:ring-2 focus-visible:ring-border-focus-ring/50 focus-visible:ring-inset',
    ],
  },
  variants: {
    // The ordinary states leave the card's own `ring-border-button-default` alone; these two
    // recolour it, which is what makes them worth noticing without adding a
    // second edge beside the first.
    //
    // A ring rather than a border. The alternative measured worse: `.alert`'s
    // way of colouring a status surface is a `-soft` wash, but `--danger-soft`
    // under the trigger drops `text-text-secondary` from 4.74:1 to 3.63:1 in light mode,
    // and the argument summary in a real tool row is muted. A ring sits under no
    // text at all, takes no space, and `ring-inset` keeps it inside the rounded
    // corner.
    state: {
      'input-streaming': {},
      'input-available': {},
      queued: {},
      'output-available': {},
      'output-error': { base: 'ring-1 ring-status-danger/40 ring-inset' },
      'requires-action': { base: 'ring-1 ring-status-warning/40 ring-inset' },
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

/**
 * The tool as a bubble block.
 *
 * As wide as it needs to be while shut — a shut tool is a label, and a column
 * of full-width labels reads as a form rather than as a conversation — and the
 * column's full width once open, because what is inside is a diff, a result or
 * a decision, and all three want the room. `data-expanded` is React Aria's, on
 * the disclosure root, which is this element.
 *
 * `rounded-2xl` rather than the panel's old `rounded-xl`: this *is* a bubble
 * now, so it takes the bubble's radius and lets `bubble.tsx` tighten the
 * corners where it meets the block above or below it. The fill is stated here
 * rather than left to `bubble.tsx` so that a tool drawn outside any bubble —
 * the playground, a fold panel — still looks like itself.
 */
const toolBubbleVariants = tv({
  base: [BUBBLE_BLOCK, 'w-fit flex-col text-caption-1-regular', 'data-[expanded]:w-full'],
  variants: {
    state: {
      'input-streaming': '',
      'input-available': '',
      queued: 'text-text-secondary',
      'output-available': '',
      'output-error': 'ring-1 ring-status-danger/40 ring-inset',
      // Never a label: a decision rests on the exact path or command, so it
      // takes the width whether or not it is open.
      'requires-action': 'w-full ring-1 ring-status-warning/50 ring-inset',
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

/**
 * The head row of a block: what the call is, and the control that opens it.
 *
 * The hover wash lifts from the bubble's own fill (`BUBBLE_BLOCK_HOVER`)
 * rather than being taken from `--default`, which is what the key it replaced
 * used: a key was a control sitting on the transcript and washed towards the
 * neutral hover colour, while this is a row inside a bubble — `bg-background-secondary-default`
 * here would be a second, slightly different grey over the first, and it would
 * be the assistant's grey even in the person's bubble.
 */
const toolHeadVariants = tv({
  base: [
    'flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors',
    BUBBLE_BLOCK_HOVER,
    'data-[pressed]:bg-[color-mix(in_oklch,var(--bubble-fill,var(--bubble-assistant)),var(--color-text-primary)_8%)]',
    'focus-visible:ring-2 focus-visible:ring-border-focus-ring/50 focus-visible:ring-inset',
    'disabled:opacity-60',
  ],
  variants: {
    state: {
      'input-streaming': '',
      'input-available': '',
      queued: '',
      'output-available': '',
      'output-error': '',
      'requires-action': '',
    },
  },
  defaultVariants: {
    state: 'input-available',
  },
})

interface ChatToolProps extends React.ComponentProps<typeof Disclosure>, VariantProps<typeof chatToolVariants> {}

function ChatTool({ state, className, ...props }: ChatToolProps) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const resolvedState = state ?? 'input-available'
  const active = resolvedState === 'input-streaming' || resolvedState === 'input-available'
  const asBubble = presentation === 'bubble'
  return (
    <ChatToolStateContext.Provider value={resolvedState}>
      <Disclosure
        data-slot="chat-tool"
        data-state={resolvedState}
        data-active={active || undefined}
        data-presentation={presentation}
        // What makes `bubble.tsx` treat it as one of the bubble's own blocks:
        // the fill, the corner tightening against its neighbours and the run's
        // position all follow from this one attribute.
        data-bubble-block={asBubble ? '' : undefined}
        className={
          asBubble
            ? cx(toolBubbleVariants({ state: resolvedState }), className)
            : cx(CHAT_TOOL_CARD, chatToolVariants({ state: resolvedState }).base(), className)
        }
        {...props}
      />
    </ChatToolStateContext.Provider>
  )
}

interface ChatToolTriggerProps extends Omit<React.ComponentProps<typeof Disclosure.Trigger>, 'children'> {
  /**
   * Pinned to the right edge, just left of the chevron — a progress count, a
   * duration, a badge. Use this rather than an `ml-auto` child: the label row
   * already absorbs the free space, and a second auto margin would split it
   * between the two instead of pushing everything over.
   */
  endContent?: React.ReactNode
  /**
   * A second line under the label, for prose about the call.
   *
   * Its own line rather than another item in the label row, because the two
   * say different things and both are wanted. A path or a command identifies
   * *which* call this is and is what an approval rests on; a description says
   * what it is for. Competing for one row of a narrow card, two truncating
   * strings leave neither readable — and whichever lost would be missing from
   * a collapsed card entirely.
   */
  subtitle?: React.ReactNode
  // Narrower than HeroUI's, which also accepts a render function: this trigger
  // lays its children out in a label row, and a function has nothing to lay out.
  children?: React.ReactNode
}

function ChatToolTrigger({ className, children, endContent, subtitle, ...props }: ChatToolTriggerProps) {
  const state = React.useContext(ChatToolStateContext)
  const presentation = React.useContext(ChatToolPresentationContext)
  const requiresAction = state === 'requires-action'
  const hasSubtitle = subtitle != null && subtitle !== ''

  if (presentation === 'bubble') {
    // No `Disclosure.Heading`: React Aria's heading is an `<h3>`, and a
    // transcript is not an outline of headings. The trigger pairs with its
    // panel through the disclosure's own context, so nothing is lost.
    //
    // A block that asks for a decision clamps nothing — the exact path or
    // command is what the decision rests on — and draws its description under
    // the label the way the card does. An ordinary one truncates, with the
    // description as a tooltip: it is a supplement there, not the thing being
    // approved.
    const key = (
      <Disclosure.Trigger
        data-slot="chat-tool-trigger"
        data-state={state}
        className={cx(toolHeadVariants({ state }), className)}
        {...props}
      >
        <div data-slot="chat-tool-trigger-lines" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            data-slot="chat-tool-trigger-label"
            className={cx(
              'flex min-w-0 items-center gap-1.5',
              '[&_[data-slot=tool-arg]]:min-w-0 [&_[data-slot=tool-arg]]:flex-1',
              requiresAction
                ? '[&_[data-slot=tool-arg]]:whitespace-pre-wrap [&_[data-slot=tool-arg]]:break-words [&_[data-slot=tool-arg]]:[overflow-wrap:anywhere]'
                : '[&_[data-slot=tool-arg]]:truncate',
            )}
          >
            {children}
          </div>
          {requiresAction && hasSubtitle && (
            <span
              data-slot="chat-tool-subtitle"
              className="break-words text-left text-caption-1-regular leading-snug text-text-secondary [overflow-wrap:anywhere]"
            >
              {subtitle}
            </span>
          )}
        </div>
        <span
          data-slot="chat-tool-trigger-end"
          className="flex shrink-0 items-center gap-1.5 text-caption-1-regular text-text-secondary"
        >
          {endContent}
          <Disclosure.Indicator className="ms-0 size-3 shrink-0 text-text-secondary" />
        </span>
      </Disclosure.Trigger>
    )
    // An ordinary head keeps its description as a tooltip: it is a supplement
    // there, not the thing being decided. The trigger is a React Aria button,
    // so `Tooltip` attaches to it directly — no wrapper, no second tab stop —
    // and the disclosure's own context reaches through.
    if (!requiresAction && hasSubtitle) {
      return (
        <TooltipTrigger delay={0}>
          {key}
          <Tooltip placement="top">{subtitle}</Tooltip>
        </TooltipTrigger>
      )
    }
    return key
  }

  return (
    <Disclosure.Heading>
      {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto` and
          `shrink-0`, which only mean anything inside a flex container. */}
      <Disclosure.Trigger
        data-slot="chat-tool-trigger"
        className={cx(chatToolVariants().trigger(), className)}
        {...props}
      >
        <div data-slot="chat-tool-trigger-lines" className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            data-slot="chat-tool-trigger-label"
            className={cx(
              'flex min-w-0 items-center gap-2',
              // The identifying value is supplied by `ToolArgsSummary`. Two
              // lines make paths and commands legible on touch devices where a
              // title tooltip is unavailable; an approval shows the full value.
              '[&_[data-slot=tool-arg]]:min-w-0 [&_[data-slot=tool-arg]]:flex-1',
              '[&_[data-slot=tool-arg]]:break-words [&_[data-slot=tool-arg]]:[overflow-wrap:anywhere]',
              requiresAction
                ? '[&_[data-slot=tool-arg]]:line-clamp-none [&_[data-slot=tool-arg]]:whitespace-pre-wrap'
                : '[&_[data-slot=tool-arg]]:line-clamp-2 [&_[data-slot=tool-arg]]:whitespace-pre-wrap',
            )}
          >
            {children}
          </div>
          {hasSubtitle && (
            <span
              data-slot="chat-tool-subtitle"
              className="line-clamp-2 break-words text-left text-caption-1-regular leading-snug text-text-secondary [overflow-wrap:anywhere]"
            >
              {subtitle}
            </span>
          )}
        </div>
        <span data-slot="chat-tool-trigger-end" className="flex shrink-0 items-center gap-2 text-caption-1-regular">
          {endContent}
          <Disclosure.Indicator className="size-3.5 shrink-0 text-text-secondary" />
        </span>
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function ChatToolStatusIcon({ className }: { className?: string }) {
  const state = React.useContext(ChatToolStateContext)
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return (
        <Spinner
          size="sm"
          color="current"
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cx('shrink-0 text-text-secondary', className)}
        />
      )
    // The same mark, standing still. Spinning is the claim that something is
    // happening, and for a call that has not started it is the only thing on
    // screen making that claim.
    case 'queued':
      return (
        <Clock
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cx('size-3.5 shrink-0 text-text-secondary', className)}
        />
      )
    case 'output-available':
      return (
        <CircleCheck
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cx('size-3.5 shrink-0 text-status-success-soft-foreground', className)}
        />
      )
    case 'output-error':
      return (
        <CircleXmark
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cx('size-3.5 shrink-0 text-status-danger', className)}
        />
      )
    case 'requires-action':
      return (
        <CircleExclamation
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cx('size-3.5 shrink-0 text-status-warning-soft-foreground', className)}
        />
      )
  }
}

function isFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Whether something is drawn over the page that owns Escape ahead of a panel. */
function overlayIsOpen(doc: Document): boolean {
  const candidates = doc.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]')
  for (const el of candidates) {
    if (typeof el.checkVisibility !== 'function' || el.checkVisibility()) return true
  }
  return false
}

function ChatToolContent({ className, children, ...props }: React.ComponentProps<typeof Disclosure.Content>) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const state = React.useContext(ChatToolStateContext)
  const disclosure = React.useContext(DisclosureStateContext)

  const [occupants, setOccupants] = React.useState(0)
  const [footer] = React.useState<ChatToolFooterSlot>(() => {
    const node = document.createElement('div')
    node.dataset.slot = 'chat-tool-footer-host'
    node.className = 'flex w-full min-w-0 flex-col gap-2'
    return {
      node,
      occupy: () => {
        setOccupants((n) => n + 1)
        return () => setOccupants((n) => n - 1)
      },
    }
  })
  const adoptFooter = React.useCallback(
    (host: HTMLDivElement | null) => {
      if (host) host.appendChild(footer.node)
      else footer.node.remove()
    },
    [footer],
  )

  // Escape closes the panel and hands focus back to its key — but only when
  // nothing else has a better claim on the key. A field inside the panel (the
  // reason for a refusal being typed) keeps it; an overlay drawn over the page
  // keeps it; and a panel that is not actually on screen has nothing to close.
  //
  // Listened for on the body, since React Aria's panel takes no key handler
  // of its own; the panel — the element that carries the id a key names in
  // `aria-controls` — is the body's parent.
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || presentation !== 'bubble') return
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isFormControl(event.target)) return
      const panel = event.currentTarget.closest<HTMLElement>('[data-slot="chat-tool-content"]')
      if (!panel) return
      if (overlayIsOpen(panel.ownerDocument)) return
      if (typeof panel.checkVisibility === 'function' && !panel.checkVisibility()) return
      event.preventDefault()
      event.stopPropagation()
      disclosure?.collapse()
      // React Aria's ids are safe in a selector as they are; `CSS.escape` is
      // belt and braces where the environment has it (jsdom does not).
      const id = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(panel.id) : panel.id
      panel.ownerDocument.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus()
    },
    [disclosure, presentation],
  )

  if (presentation === 'bubble') {
    return (
      // `min-h-0` is load-bearing: the block is a flex column, and a flex
      // item's default `min-height: auto` floors it at its content height — so
      // the panel would take `height: 0` and still render full size.
      //
      // The rule above the detail is conditional on the panel not being
      // `hidden`, which is the attribute React Aria sets once a collapse has
      // finished animating. A collapsed panel is a zero-height box rather than
      // nothing at all, and a border on it would be a hairline under the head
      // of every shut block.
      //
      // No fill, no radius and no ring of its own: this is the lower half of
      // the block above it, which carries all three. That is the whole of what
      // "a tool call is a message" buys — the head and the detail are one
      // object, so there is nothing to align, nothing to portal, and no second
      // edge inside the first.
      <Disclosure.Content
        data-slot="chat-tool-content"
        data-presentation="bubble"
        className="min-h-0 w-full not-[[hidden]]:border-t not-[[hidden]]:border-border-button-default/50"
        {...props}
      >
        <Disclosure.Body className="p-0" onKeyDown={handleKeyDown}>
          <ChatToolFooterContext.Provider value={footer}>
            <div data-slot="chat-tool-panel" data-state={state} className={cx('w-full min-w-0', className)}>
              {children}
              {occupants > 0 && (
                <div
                  data-slot="chat-tool-panel-footer"
                  className="flex flex-col items-stretch gap-2 border-t border-text-primary/5 px-3 pt-2.5 pb-3"
                >
                  <div ref={adoptFooter} data-slot="chat-tool-panel-footer-slot" className="contents" />
                </div>
              )}
            </div>
          </ChatToolFooterContext.Provider>
        </Disclosure.Body>
      </Disclosure.Content>
    )
  }

  return (
    // `min-h-0` is load-bearing: the card is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content data-slot="chat-tool-content" className="min-h-0 w-full" {...props}>
      {/* Pro uses a very tight `p-1`; this keeps that density while leaving
          enough edge around Meridian's diffs and approval controls. */}
      <Disclosure.Body className={cx('flex flex-col gap-2.5 px-3 pb-3 pt-0.5', className)}>{children}</Disclosure.Body>
    </Disclosure.Content>
  )
}

/**
 * The three parts of a panel. Each is a plain section with padding: the panel
 * is a bubble continuation, not a dashboard card, and they are one on top of
 * the other with nothing between them.
 *
 * Blocks compose these so that a card drawn outside the keyboard — the
 * playground, the tests — gets the same three regions without branching.
 */
function ChatToolPanelHeader({
  title,
  description,
  end,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  end?: React.ReactNode
}) {
  const bare = title == null && description == null
  return (
    <div
      data-slot="chat-tool-panel-header"
      className={cx('flex items-start justify-between gap-3 px-3', bare ? 'py-1' : 'pt-2.5 pb-1', className)}
      {...props}
    >
      <div data-slot="chat-tool-panel-lines" className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title != null && (
          <span
            data-slot="chat-tool-panel-title"
            className="min-w-0 text-caption-1-medium leading-5 break-words whitespace-pre-wrap text-text-primary [overflow-wrap:anywhere]"
          >
            {title}
          </span>
        )}
        {description != null && (
          <span
            data-slot="chat-tool-panel-description"
            className="min-w-0 text-caption-1-regular leading-4 break-words text-text-secondary"
          >
            {description}
          </span>
        )}
      </div>
      {end != null && (
        <div
          data-slot="chat-tool-panel-end"
          className="flex shrink-0 items-center gap-1.5 text-caption-1-regular text-text-secondary"
        >
          {end}
        </div>
      )}
    </div>
  )
}

function ChatToolPanelBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chat-tool-panel-body"
      className={cx('flex min-w-0 flex-col gap-2 overflow-hidden', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Where the panel's footer occupants go.
 *
 * A node made before the first render and a count of who is in it. The
 * decision row is rendered deep inside `PendingApproval`, under the notice
 * and the reason field it belongs with, so it cannot be moved to the footer
 * by rearranging JSX; it portals there instead, and the footer is drawn only
 * while somebody has. The same slot serves an outcome line a block places
 * explicitly, so a panel never grows two footers.
 */
interface ChatToolFooterSlot {
  node: HTMLElement
  /** Says something is in the footer; returns the call that says it left. */
  occupy: () => () => void
}

const ChatToolFooterContext = React.createContext<ChatToolFooterSlot | undefined>(undefined)

function useFooterOccupancy(footer: ChatToolFooterSlot | undefined) {
  React.useEffect(() => footer?.occupy(), [footer])
}

function ChatToolPanelFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const footer = React.useContext(ChatToolFooterContext)
  const inFooter = presentation === 'bubble' && footer !== undefined
  useFooterOccupancy(inFooter ? footer : undefined)
  if (inFooter) {
    return createPortal(
      <div data-slot="chat-tool-panel-footer-item" className={cx('flex min-w-0 flex-col gap-2', className)} {...props}>
        {children}
      </div>,
      footer.node,
    )
  }
  return (
    <div
      data-slot="chat-tool-panel-footer"
      className={cx('flex min-w-0 flex-col gap-2 border-t border-separator-border px-3 py-2.5', className)}
      {...props}
    >
      {children}
    </div>
  )
}

// Shiki escapes the text it is given, so the markup it returns is safe to
// inject. `inline` because this sits inside a `<code>` that is already styled —
// the classic structure would nest a second `<pre><code>` inside it.
function JsonCode({ code }: { code: string }) {
  const { language, ready } = useShikiLanguage('json')
  const html = React.useMemo(() => (ready ? highlightInline(code, language) : null), [code, language, ready])
  if (html === null) return <code data-slot="chat-tool-json">{code}</code>
  return <code data-slot="chat-tool-json" dangerouslySetInnerHTML={{ __html: html }} />
}

interface ChatToolPayloadProps extends React.ComponentProps<'div'> {
  // Structured value, rendered as JSON.
  value?: unknown
  // Preformatted text, useful while streaming partial JSON. Takes precedence.
  text?: string
}

function ChatToolArgs({ value, text, className, children, ...props }: ChatToolPayloadProps) {
  const code = text ?? (value !== undefined ? JSON.stringify(value, null, 2) : undefined)
  return (
    <div
      data-slot="chat-tool-args"
      className={cx(
        'scrollbar-gutter-stable max-h-48 overflow-auto rounded-lg bg-background-secondary-default/50 px-3 py-2',
        className,
      )}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre
            data-slot="chat-tool-args-code"
            className="font-mono text-caption-1-regular leading-relaxed whitespace-pre-wrap text-text-primary/90 [overflow-wrap:anywhere]"
          >
            <JsonCode code={code} />
          </pre>
        ))}
    </div>
  )
}

function ChatToolResult({ value, text, className, children, ...props }: ChatToolPayloadProps) {
  const code = text ?? (value !== undefined ? JSON.stringify(value, null, 2) : undefined)
  return (
    <div
      data-slot="chat-tool-result"
      className={cx(
        'scrollbar-gutter-stable max-h-72 overflow-auto rounded-lg bg-background-secondary-default/50 px-3 py-2',
        className,
      )}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre
            data-slot="chat-tool-result-code"
            className="font-mono text-caption-1-regular leading-relaxed whitespace-pre-wrap text-text-primary/90 [overflow-wrap:anywhere]"
          >
            <JsonCode code={code} />
          </pre>
        ))}
    </div>
  )
}

function ChatToolError({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chat-tool-error"
      className={cx(
        'rounded-lg bg-status-danger-soft px-2.5 py-2 leading-relaxed whitespace-pre-wrap text-status-danger-soft-foreground [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The decision row. In a card the buttons sit at the right, the way a dialog's
 * do; in a bubble they share the row equally, because the block is as wide as
 * the column and two buttons huddled at its right edge would be a long way from
 * the command they answer for.
 */
function ChatToolApproval({ className, children, ...props }: React.ComponentProps<'div'>) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const footer = React.useContext(ChatToolFooterContext)
  // On a keyboard the row belongs at the foot of the panel, whatever rendered
  // it and however deep. See `ChatToolFooterSlot`.
  const inFooter = presentation === 'bubble' && footer !== undefined
  useFooterOccupancy(inFooter ? footer : undefined)
  const row = (
    <div
      data-slot="chat-tool-approval"
      className={cx('flex min-w-0 flex-col gap-2', presentation === 'card' && 'pt-2.5', className)}
      {...props}
    >
      <div
        data-slot="chat-tool-approval-actions"
        className={cx(
          'flex min-w-0 flex-wrap items-center gap-2 [&>button]:min-h-8 [&>button]:max-w-full [&>button]:min-w-0 [&>button]:whitespace-normal',
          presentation === 'bubble' ? '[&>button]:flex-1' : 'justify-end',
        )}
      >
        {children}
      </div>
    </div>
  )
  return inFooter ? createPortal(row, footer.node) : row
}

export {
  ChatTool,
  ChatToolTrigger,
  ChatToolStatusIcon,
  ChatToolContent,
  ChatToolPanelHeader,
  ChatToolPanelBody,
  ChatToolPanelFooter,
  ChatToolArgs,
  ChatToolResult,
  ChatToolError,
  ChatToolApproval,
  ChatToolPresentationProvider,
  ChatToolPresentationContext,
  type ChatToolState,
  type ChatToolPresentation,
}
