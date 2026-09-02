import * as React from 'react'
import { createPortal } from 'react-dom'
import { Disclosure, Tooltip, tv, type VariantProps } from '@heroui/react'
import { Widget } from '@heroui-pro/react/widget'
import { DisclosureStateContext } from 'react-aria-components'
import { CircleCheck, CircleDashed, CircleExclamation, CircleXmark, Clock } from '@gravity-ui/icons'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { cn } from '@/lib/utils'
import { BubbleKeyboardStackContext, keyboardKeyVariants } from './bubble-keyboard'

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
 * How a tool is drawn: as a card of its own, or as a key on the inline keyboard
 * under a bubble with its panel in the keyboard's stack.
 *
 * One context rather than two component sets, because what changes is only the
 * chrome. The trigger, the panel, the status icon, the approval row and every
 * specialised card built on them keep their structure and their behaviour; the
 * keyboard mode swaps what the trigger looks like and where the panel lands.
 * `card` remains the default so the playground and the tests that exercise the
 * card go on doing so.
 */
type ChatToolPresentation = 'card' | 'keyboard'

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
 * `background-color: var(--surface)` under `variant="inset"` — so a `bg-surface`
 * card is exactly its parent's colour, not one step above the page. And HeroUI
 * sets `--surface-shadow: 0 0 0 0 transparent inset` in dark mode on purpose
 * ("No shadow on dark mode"), which leaves a dark-theme card with no fill
 * difference, no shadow and no border: nothing at all.
 *
 * A ring rather than a border, for the reason the status variants below give —
 * it takes no space, so recolouring it for `output-error` costs no reflow and
 * needs no second mechanism.
 */
const CHAT_TOOL_CARD = 'overflow-hidden rounded-xl bg-surface shadow-surface ring-1 ring-border ring-inset'

const chatToolVariants = tv({
  slots: {
    base: 'flex w-full flex-col text-xs',
    // Mirrors Pro's chat-tool rhythm. The inset focus ring remains visible
    // inside the clipped card and does not add another layout edge.
    trigger: [
      'flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left transition-colors outline-none',
      'hover:bg-default data-[pressed]:bg-default focus-visible:bg-default',
      'focus-visible:ring-2 focus-visible:ring-focus/50 focus-visible:ring-inset',
    ],
  },
  variants: {
    // The ordinary states leave the card's own `ring-border` alone; these two
    // recolour it, which is what makes them worth noticing without adding a
    // second edge beside the first.
    //
    // A ring rather than a border. The alternative measured worse: `.alert`'s
    // way of colouring a status surface is a `-soft` wash, but `--danger-soft`
    // under the trigger drops `text-muted` from 4.74:1 to 3.63:1 in light mode,
    // and the argument summary in a real tool row is muted. A ring sits under no
    // text at all, takes no space, and `ring-inset` keeps it inside the rounded
    // corner.
    state: {
      'input-streaming': {},
      'input-available': {},
      queued: {},
      'output-available': {},
      'output-error': { base: 'ring-1 ring-danger/40 ring-inset' },
      'requires-action': { base: 'ring-1 ring-warning/40 ring-inset' },
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
  return (
    <ChatToolStateContext.Provider value={resolvedState}>
      {/* In keyboard mode the disclosure has no box of its own: its trigger is a
          key in the row and its panel is carried off to the stack, so a wrapper
          with a box would be an empty item in the row's flex. `contents` keeps
          the disclosure as a React tree — which is what pairs the two — without
          giving it a place in the layout. Nothing the animation needs lives on
          this element; React Aria measures the panel itself. */}
      <Disclosure
        data-slot="chat-tool"
        data-state={resolvedState}
        data-active={active || undefined}
        data-presentation={presentation}
        className={
          presentation === 'keyboard'
            ? cn('contents', className)
            : cn(CHAT_TOOL_CARD, chatToolVariants({ state: resolvedState }).base(), className)
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

  if (presentation === 'keyboard') {
    // No `Disclosure.Heading`: React Aria's heading is an `<h3>`, and a row of
    // keys is not a row of headings. The trigger pairs with its panel through
    // the disclosure's own context, so nothing is lost by leaving it off.
    //
    // A key that asks for a decision takes the whole row and clamps nothing —
    // the exact path or command is what the decision rests on — and draws its
    // description under the label the way the card does. An ordinary key is
    // half a row and truncates, with the description as a tooltip: it is a
    // supplement there, not the thing being approved.
    const key = (
      <Disclosure.Trigger
        data-slot="chat-tool-trigger"
        data-state={state}
        className={cn(keyboardKeyVariants({ state }), className)}
        {...props}
      >
        <div data-slot="chat-tool-trigger-lines" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            data-slot="chat-tool-trigger-label"
            className={cn(
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
              className="break-words text-left text-xs leading-snug text-muted [overflow-wrap:anywhere]"
            >
              {subtitle}
            </span>
          )}
        </div>
        <span data-slot="chat-tool-trigger-end" className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          {endContent}
          <Disclosure.Indicator className="ms-0 size-3 shrink-0 text-muted" />
        </span>
      </Disclosure.Trigger>
    )
    // An ordinary key keeps its description as a tooltip: it is a supplement
    // there, not the thing being decided. The trigger is a React Aria button,
    // so `Tooltip` attaches to it directly — no wrapper, no second tab stop —
    // and the disclosure's own context reaches through.
    if (!requiresAction && hasSubtitle) {
      return (
        <Tooltip delay={0}>
          {key}
          <Tooltip.Content placement="top">{subtitle}</Tooltip.Content>
        </Tooltip>
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
        className={cn(chatToolVariants().trigger(), className)}
        {...props}
      >
        <div data-slot="chat-tool-trigger-lines" className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            data-slot="chat-tool-trigger-label"
            className={cn(
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
              className="line-clamp-2 break-words text-left text-xs leading-snug text-muted [overflow-wrap:anywhere]"
            >
              {subtitle}
            </span>
          )}
        </div>
        <span data-slot="chat-tool-trigger-end" className="flex shrink-0 items-center gap-2 text-xs">
          {endContent}
          <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
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
        <CircleDashed
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cn('size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none', className)}
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
          className={cn('size-3.5 shrink-0 text-muted', className)}
        />
      )
    case 'output-available':
      return (
        <CircleCheck
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cn('size-3.5 shrink-0 text-success-soft-foreground', className)}
        />
      )
    case 'output-error':
      return (
        <CircleXmark
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cn('size-3.5 shrink-0 text-danger', className)}
        />
      )
    case 'requires-action':
      return (
        <CircleExclamation
          aria-hidden
          data-slot="chat-tool-status-icon"
          className={cn('size-3.5 shrink-0 text-warning-soft-foreground', className)}
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
  const stack = React.useContext(BubbleKeyboardStackContext)
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
      if (event.defaultPrevented || presentation !== 'keyboard') return
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

  if (presentation === 'keyboard') {
    const panel = (
      // `min-h-0` is load-bearing: the panel sits in a flex column, and a flex
      // item's default `min-height: auto` floors it at its content height — so
      // the panel would take `height: 0` and still render full size.
      //
      // The top margin is conditional on the panel not being `hidden`, which is
      // the attribute React Aria sets once a collapse has finished animating.
      // A collapsed panel is a zero-height box, not nothing, and a margin on it
      // would be a blank line in the stack for every closed key.
      //
      // No fill of its own: the Widget inside is the panel's box. React Aria
      // measures this element's `scrollHeight` for the open/close animation,
      // so the Widget's margins and `overflow: hidden` are inside what it
      // measures. The Body stays for one reason — it is where Escape is
      // listened for — and takes no padding, because the Widget brings its own.
      <Disclosure.Content
        data-slot="chat-tool-content"
        data-presentation="keyboard"
        className="min-h-0 not-[[hidden]]:mt-1"
        {...props}
      >
        <Disclosure.Body className="p-0" onKeyDown={handleKeyDown}>
          <ChatToolFooterContext.Provider value={footer}>
            {/* The status ring is on the Widget rather than on the panel above
                it: `.widget` is an opaque `surface-secondary` box that clips
                its children, and an inset ring painted under it would never
                be seen. `rounded-xl` holds the radius ladder — Widget's own
                `2 × --radius` is the bubble's step, and a panel is one below. */}
            <Widget
              data-slot="chat-tool-panel"
              data-state={state}
              className={cn('w-full min-w-0 rounded-xl text-xs', PANEL_RING[state], className)}
            >
              {children}
              {/* Only while something is in it: an empty `Widget.Footer` is a
                  band of padding with nothing to say. The node the occupants
                  portal into is made up front and adopted here, the same
                  arrangement as the keyboard's stack and for the same reason —
                  a portal target that appears a render late is one the first
                  occupant cannot reach. */}
              {occupants > 0 && (
                <Widget.Footer data-slot="chat-tool-panel-footer" className="flex-col items-stretch gap-2 pt-0">
                  <div ref={adoptFooter} className="contents" />
                </Widget.Footer>
              )}
            </Widget>
          </ChatToolFooterContext.Provider>
        </Disclosure.Body>
      </Disclosure.Content>
    )
    // Inside a keyboard, the panel belongs to the stack. Without one — a tool
    // drawn in keyboard mode with no keyboard around it — it stays where it is.
    if (!stack) return panel
    return createPortal(panel, stack.node)
  }

  return (
    // `min-h-0` is load-bearing: the card is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content data-slot="chat-tool-content" className="min-h-0 w-full" {...props}>
      {/* Pro uses a very tight `p-1`; this keeps that density while leaving
          enough edge around Meridian's diffs and approval controls. */}
      <Disclosure.Body className={cn('flex flex-col gap-2.5 px-3 pb-3 pt-0.5', className)}>{children}</Disclosure.Body>
    </Disclosure.Content>
  )
}

/**
 * The three parts of a panel, in the shape Pro's Widget gives a dashboard
 * card: what the call is (header), what it did (body), and what became of it
 * or what it needs (footer).
 *
 * Blocks compose these rather than the Widget directly, so that a card drawn
 * outside the keyboard — the playground, the tests — gets the same three
 * regions as plain sections and nothing has to branch on the presentation.
 */
function ChatToolPanelHeader({
  title,
  description,
  end,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  /** What the call is: a path, a command, an errand. Wraps, never clips —
   *  a decision rests on it. */
  title?: React.ReactNode
  /** What it is for, in the model's words. */
  description?: React.ReactNode
  /** Chips at the right-hand end: an exit code, a diff stat, a step count. */
  end?: React.ReactNode
}) {
  const presentation = React.useContext(ChatToolPresentationContext)
  // Chips alone — a diff stat over a card, an exit code over a key that
  // already shows the whole command — take a shallower row than a title.
  const bare = title == null && description == null
  const lines = (
    <div data-slot="chat-tool-panel-lines" className="flex min-w-0 flex-1 flex-col gap-0.5">
      {title != null && (
        <Widget.Title
          data-slot="chat-tool-panel-title"
          className="min-w-0 text-xs leading-5 font-medium break-words whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]"
        >
          {title}
        </Widget.Title>
      )}
      {description != null && (
        <Widget.Description data-slot="chat-tool-panel-description" className="min-w-0 leading-4 break-words">
          {description}
        </Widget.Description>
      )}
    </div>
  )
  const tail = end != null && (
    <div data-slot="chat-tool-panel-end" className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
      {end}
    </div>
  )
  if (presentation === 'card') {
    return (
      <div
        data-slot="chat-tool-panel-header"
        className={cn('flex items-start justify-between gap-3 px-3', bare ? 'py-1' : 'pt-2 pb-1', className)}
        {...props}
      >
        {lines}
        {tail}
      </div>
    )
  }
  // `Widget.Header` is one flex row and its title and description are
  // sibling spans, so without the column above they would sit side by side.
  return (
    <Widget.Header
      data-slot="chat-tool-panel-header"
      className={cn('items-start', bare ? 'min-h-0 py-1' : 'py-2', className)}
      {...props}
    >
      {lines}
      {tail}
    </Widget.Header>
  )
}

/** The elevated area. Edge to edge (`p-0`): a diff, a listing or a block of
 *  output brings its own gutter, and a second padding around it would put the
 *  line numbers a step in from the box they belong to. */
function ChatToolPanelBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  const presentation = React.useContext(ChatToolPresentationContext)
  if (presentation === 'card') {
    return (
      <div
        data-slot="chat-tool-panel-body"
        className={cn('flex min-w-0 flex-col gap-2 px-3 pb-3', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
  return (
    <Widget.Content
      data-slot="chat-tool-panel-body"
      className={cn('flex min-w-0 flex-col gap-2 overflow-hidden p-0', className)}
      {...props}
    >
      {children}
    </Widget.Content>
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
  const inFooter = presentation === 'keyboard' && footer !== undefined
  useFooterOccupancy(inFooter ? footer : undefined)
  if (inFooter) {
    return createPortal(
      <div data-slot="chat-tool-panel-footer-item" className={cn('flex min-w-0 flex-col gap-2', className)} {...props}>
        {children}
      </div>,
      footer.node,
    )
  }
  return (
    <div
      data-slot="chat-tool-panel-footer"
      className={cn('flex min-w-0 flex-col gap-2 border-t border-separator px-3 py-2.5', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/** The ring a panel wears for the two states worth noticing, matching its key's. */
const PANEL_RING: Record<ChatToolState, string> = {
  'input-streaming': '',
  'input-available': '',
  queued: '',
  'output-available': '',
  'output-error': 'ring-1 ring-danger/40 ring-inset',
  'requires-action': 'ring-1 ring-warning/50 ring-inset',
}

// Shiki escapes the text it is given, so the markup it returns is safe to
// inject. `inline` because this sits inside a `<code>` that is already styled —
// the classic structure would nest a second `<pre><code>` inside it.
function JsonCode({ code }: { code: string }) {
  const { language, ready } = useShikiLanguage('json')
  const html = React.useMemo(() => (ready ? highlightInline(code, language) : null), [code, language, ready])
  if (html === null) return <code>{code}</code>
  return <code dangerouslySetInnerHTML={{ __html: html }} />
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
      className={cn('scrollbar-gutter-stable max-h-48 overflow-auto rounded-lg bg-default/50 px-3 py-2', className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]">
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
      className={cn('scrollbar-gutter-stable max-h-72 overflow-auto rounded-lg bg-default/50 px-3 py-2', className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]">
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
      className={cn(
        'rounded-lg bg-danger/5 px-2.5 py-2 leading-relaxed whitespace-pre-wrap text-danger [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The decision row. In a card the buttons sit at the right, the way a dialog's
 * do; on a keyboard they share the row equally, the way an inline keyboard's
 * do — each is a key, and a key is as wide as its neighbours.
 */
function ChatToolApproval({ className, children, ...props }: React.ComponentProps<'div'>) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const footer = React.useContext(ChatToolFooterContext)
  // On a keyboard the row belongs at the foot of the panel, whatever rendered
  // it and however deep. See `ChatToolFooterSlot`.
  const inFooter = presentation === 'keyboard' && footer !== undefined
  useFooterOccupancy(inFooter ? footer : undefined)
  const row = (
    <div
      data-slot="chat-tool-approval"
      className={cn('flex min-w-0 flex-col gap-2', presentation === 'card' && 'pt-2.5', className)}
      {...props}
    >
      <div
        data-slot="chat-tool-approval-actions"
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2 [&>button]:min-h-8 [&>button]:max-w-full [&>button]:min-w-0 [&>button]:whitespace-normal',
          presentation === 'keyboard' ? '[&>button]:flex-1' : 'justify-end',
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
