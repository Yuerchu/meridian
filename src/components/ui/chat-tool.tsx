import * as React from 'react'
import { Disclosure, tv, type VariantProps } from '@heroui/react'
import { CircleCheck, CircleDashed, CircleExclamation, CircleXmark, Clock } from '@gravity-ui/icons'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { cn } from '@/lib/utils'

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
 * True for a tool card rendered inside a `ChatToolGroup`. The group is the card;
 * its children are rows in it, the way `.accordion--surface` treats its items.
 */
const ChatToolNestedContext = React.createContext(false)

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
    nested: {
      true: { base: 'border-t border-separator' },
      false: { base: CHAT_TOOL_CARD },
    },
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
    nested: false,
    state: 'input-available',
  },
})

interface ChatToolProps
  extends
    React.ComponentProps<typeof Disclosure>,
    // `nested` is read from context, not passed: only `ChatToolGroup` knows.
    Omit<VariantProps<typeof chatToolVariants>, 'nested'> {}

function ChatTool({ state, className, ...props }: ChatToolProps) {
  const nested = React.useContext(ChatToolNestedContext)
  const resolvedState = state ?? 'input-available'
  const active = resolvedState === 'input-streaming' || resolvedState === 'input-available'
  return (
    <ChatToolStateContext.Provider value={resolvedState}>
      <Disclosure
        data-slot="chat-tool"
        data-state={resolvedState}
        data-active={active || undefined}
        className={cn(chatToolVariants({ state: resolvedState, nested }).base(), className)}
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
  const requiresAction = state === 'requires-action'
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
          {subtitle != null && subtitle !== '' && (
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

function ChatToolContent({ className, children, ...props }: React.ComponentProps<typeof Disclosure.Content>) {
  return (
    // `min-h-0` is load-bearing: the card is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content data-slot="chat-tool-content" className="min-h-0 w-full" {...props}>
      {/* Body, not a plain div: it is what keeps the panel measurable, so
          without it the content never collapses — it just loses its
          `aria-expanded`.
          Pro uses a very tight `p-1`; this keeps that density while leaving
          enough edge around Meridian's diffs and approval controls. */}
      <Disclosure.Body className={cn('flex flex-col gap-2.5 px-3 pb-3 pt-0.5', className)}>{children}</Disclosure.Body>
    </Disclosure.Content>
  )
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

function ChatToolApproval({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="chat-tool-approval" className={cn('flex min-w-0 flex-col gap-2 pt-2.5', className)} {...props}>
      <div
        data-slot="chat-tool-approval-actions"
        className="flex min-w-0 flex-wrap items-center justify-end gap-2 [&>button]:min-h-8 [&>button]:max-w-full [&>button]:min-w-0 [&>button]:whitespace-normal"
      >
        {children}
      </div>
    </div>
  )
}

function ChatToolGroup({ className, ...props }: React.ComponentProps<typeof Disclosure>) {
  return (
    <Disclosure
      data-slot="chat-tool-group"
      className={cn('flex w-full flex-col text-xs', CHAT_TOOL_CARD, className)}
      {...props}
    />
  )
}

function ChatToolGroupTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Disclosure.Trigger>, 'children'> & {
  children?: React.ReactNode
}) {
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        data-slot="chat-tool-group-trigger"
        className={cn(chatToolVariants().trigger(), 'font-medium text-foreground', className)}
        {...props}
      >
        <span data-slot="chat-tool-group-trigger-label" className="min-w-0 flex-1 truncate">
          {children}
        </span>
        {/* The indicator carries `ms-auto` of its own, which is what the hand-
            written chevron used `ml-auto` for. */}
        <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function ChatToolGroupContent({ className, children, ...props }: React.ComponentProps<typeof Disclosure.Content>) {
  return (
    <Disclosure.Content data-slot="chat-tool-group-content" className="min-h-0 w-full" {...props}>
      {/* Flush, not inset: the group is the card, so its children are rows in it
          rather than cards inside a card. Repeating rounded cards inside a
          rounded card adds a second frame and a gutter with no information. */}
      <Disclosure.Body className={cn('flex flex-col', className)}>
        <ChatToolNestedContext.Provider value={true}>{children}</ChatToolNestedContext.Provider>
      </Disclosure.Body>
    </Disclosure.Content>
  )
}

export {
  ChatTool,
  ChatToolTrigger,
  ChatToolStatusIcon,
  ChatToolContent,
  ChatToolArgs,
  ChatToolResult,
  ChatToolError,
  ChatToolApproval,
  ChatToolGroup,
  ChatToolGroupTrigger,
  ChatToolGroupContent,
  type ChatToolState,
}
