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
 * A HeroUI card by value, not by class.
 *
 * `cardVariants({ variant }).base()` would be the documented escape hatch, but
 * it drags `p-4 gap-3 overflow-visible` along and all three are wrong here: the
 * trigger is a full-width hit target, so its padding has to sit inside it or the
 * hover wash stops short of the edges, and the corners have to clip that wash.
 * Overriding three properties off a class costs more than naming the three that
 * actually carry the look, so these are the card's own values —
 * `--radius-3xl` (24px, what `min(32px, var(--radius-3xl))` resolves to at our
 * `--radius: 0.5rem`), `bg-surface`, `shadow-surface`.
 *
 * `bg-surface` is opaque now. The old `bg-surface/30` was compensation from when
 * `--surface` and `--background` were both white and a solid fill would have
 * been invisible; the token ladder puts panels above the page, so the fill is
 * the whole point.
 */
/**
 * 16px, not the 24px a HeroUI `Card` uses. A collapsed tool row is 48px tall,
 * and a 24px radius on a 48px box makes both ends exact semicircles — a column
 * of them reads as loose capsules rather than one run of steps.
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
const CHAT_TOOL_CARD = 'overflow-hidden rounded-2xl bg-surface shadow-surface ring-1 ring-border ring-inset'

const chatToolVariants = tv({
  slots: {
    base: 'flex w-full flex-col text-sm',
    // `p-4` matches `.accordion__trigger` (`px-4 py-4`), and the hover fill is
    // the full-strength `bg-default` that `.accordion--surface` uses — at /30
    // over an opaque panel it barely moved.
    trigger: [
      'flex w-full items-center gap-2 p-4 text-left transition-colors outline-none',
      'hover:bg-default focus-visible:bg-default',
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
  return (
    <ChatToolStateContext.Provider value={state ?? 'input-available'}>
      <Disclosure
        data-slot="chat-tool"
        className={cn(chatToolVariants({ state, nested }).base(), className)}
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
  return (
    <Disclosure.Heading>
      {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto` and
          `shrink-0`, which only mean anything inside a flex container. */}
      <Disclosure.Trigger
        data-slot="chat-tool-trigger"
        className={cn(chatToolVariants().trigger(), className)}
        {...props}
      >
        <div data-slot="chat-tool-trigger-lines" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div data-slot="chat-tool-trigger-label" className="flex min-w-0 items-center gap-2">
            {children}
          </div>
          {subtitle != null && subtitle !== '' && (
            <span data-slot="chat-tool-subtitle" className="truncate text-left text-xs text-muted">
              {subtitle}
            </span>
          )}
        </div>
        {endContent}
        <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function ChatToolStatusIcon({ className }: { className?: string }) {
  const state = React.useContext(ChatToolStateContext)
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return <CircleDashed aria-hidden className={cn('size-3.5 shrink-0 animate-spin text-muted', className)} />
    // The same mark, standing still. Spinning is the claim that something is
    // happening, and for a call that has not started it is the only thing on
    // screen making that claim.
    case 'queued':
      return <Clock aria-hidden className={cn('size-3.5 shrink-0 text-muted', className)} />
    case 'output-available':
      return <CircleCheck aria-hidden className={cn('size-3.5 shrink-0 text-success-soft-foreground', className)} />
    case 'output-error':
      return <CircleXmark aria-hidden className={cn('size-3.5 shrink-0 text-danger', className)} />
    case 'requires-action':
      return (
        <CircleExclamation aria-hidden className={cn('size-3.5 shrink-0 text-warning-soft-foreground', className)} />
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
          `px-4 pt-0 pb-4` is `.accordion__body-inner`; `gap-3` is the card's. */}
      <Disclosure.Body className={cn('flex flex-col gap-3 px-4 pb-4', className)}>{children}</Disclosure.Body>
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
  const code = text ?? (value !== undefined ? JSON.stringify(value) : undefined)
  return (
    <div
      data-slot="chat-tool-args"
      className={cn('max-h-40 overflow-auto rounded-lg bg-default/40 px-3 py-2', className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
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
      className={cn('max-h-60 overflow-auto rounded-lg bg-default/40 px-3 py-2', className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
            <JsonCode code={code} />
          </pre>
        ))}
    </div>
  )
}

function ChatToolError({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="chat-tool-error" className={cn('px-0.5 whitespace-pre-wrap text-danger', className)} {...props} />
  )
}

function ChatToolApproval({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chat-tool-approval"
      className={cn('flex items-center justify-end gap-2 pt-1', className)}
      {...props}
    />
  )
}

function ChatToolGroup({ className, ...props }: React.ComponentProps<typeof Disclosure>) {
  return (
    <Disclosure
      data-slot="chat-tool-group"
      className={cn('flex w-full flex-col text-sm', CHAT_TOOL_CARD, className)}
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
        {children}
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
          rather than cards inside a card. A 24px card nested in a 24px card is
          exactly the rounding a container is not allowed to have, and the gutter
          it would need would only make the double frame more obvious. */}
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
