import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Button as AriaButton,
  Disclosure,
  DisclosurePanel,
  DisclosureStateContext,
  type ButtonProps as AriaButtonProps,
  type DisclosurePanelProps as AriaDisclosurePanelProps,
  type DisclosureProps as AriaDisclosureProps,
} from 'react-aria-components'
import { ChevronRight, CircleAlert, CircleCheck, CircleX, Clock } from '@keyline-icons/react/two-tone'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { BUBBLE_BLOCK, BUBBLE_BLOCK_HOVER } from './bubble'
import './chat-tool.css'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

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
 */
type ChatToolPresentation = 'card' | 'bubble'

const ChatToolPresentationContext = React.createContext<ChatToolPresentation>('card')

function ChatToolPresentationProvider({ value, children }: { value: ChatToolPresentation; children: React.ReactNode }) {
  return <ChatToolPresentationContext.Provider value={value}>{children}</ChatToolPresentationContext.Provider>
}

interface ChatToolProps extends Omit<AriaDisclosureProps, 'className' | 'children'> {
  state?: ChatToolState
  className?: string
  children?: React.ReactNode
}

function ChatTool({ state, className, children, ...props }: ChatToolProps) {
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
        className={joinClasses('m-chat-tool', asBubble && BUBBLE_BLOCK, className)}
        {...props}
      >
        {children}
      </Disclosure>
    </ChatToolStateContext.Provider>
  )
}

interface ChatToolTriggerProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
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
   * what it is for.
   */
  subtitle?: React.ReactNode
  children?: React.ReactNode
}

function ChatToolTrigger({ className, children, endContent, subtitle, ...props }: ChatToolTriggerProps) {
  const state = React.useContext(ChatToolStateContext)
  const presentation = React.useContext(ChatToolPresentationContext)
  const requiresAction = state === 'requires-action'
  const hasSubtitle = subtitle != null && subtitle !== ''

  const trigger = (
    <AriaButton
      slot="trigger"
      data-slot="chat-tool-trigger"
      data-state={state}
      data-presentation={presentation}
      className={joinClasses('m-chat-tool__trigger', presentation === 'bubble' && BUBBLE_BLOCK_HOVER, className)}
      {...props}
    >
      <div data-slot="chat-tool-trigger-lines" data-presentation={presentation} className="m-chat-tool__trigger-lines">
        <div
          data-slot="chat-tool-trigger-label"
          data-presentation={presentation}
          data-requires-action={requiresAction || undefined}
          className="m-chat-tool__trigger-label"
        >
          {children}
        </div>
        {(presentation === 'card' ? hasSubtitle : requiresAction && hasSubtitle) && (
          <span data-slot="chat-tool-subtitle" data-presentation={presentation} className="m-chat-tool__subtitle">
            {subtitle}
          </span>
        )}
      </div>
      <span data-slot="chat-tool-trigger-end" data-presentation={presentation} className="m-chat-tool__trigger-end">
        {endContent}
        <span data-slot="disclosure-indicator" aria-hidden className="m-chat-tool__indicator">
          <ChevronRight aria-hidden className="m-chat-tool__chevron" />
        </span>
      </span>
    </AriaButton>
  )

  if (presentation === 'bubble') {
    // An ordinary head keeps its description as a tooltip: it is a supplement
    // there, not the thing being decided. The trigger is a React Aria button,
    // so `Tooltip` attaches to it directly — no wrapper, no second tab stop —
    // and the disclosure's own context reaches through.
    if (!requiresAction && hasSubtitle) {
      return (
        <TooltipTrigger>
          {trigger}
          <Tooltip placement="top">{subtitle}</Tooltip>
        </TooltipTrigger>
      )
    }
    return trigger
  }

  return (
    <div data-slot="disclosure-heading" className="m-chat-tool__heading">
      {trigger}
    </div>
  )
}

function ChatToolStatusIcon({ className }: { className?: string }) {
  const state = React.useContext(ChatToolStateContext)
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return (
        <span aria-hidden data-slot="chat-tool-status-icon">
          <Spinner size="sm" />
        </span>
      )
    // The same mark, standing still. Spinning is the claim that something is
    // happening, and for a call that has not started it is the only thing on
    // screen making that claim.
    case 'queued':
      return (
        <Clock
          aria-hidden
          data-slot="chat-tool-status-icon"
          data-state="queued"
          className={joinClasses('m-chat-tool__status-icon', className)}
        />
      )
    case 'output-available':
      return (
        <CircleCheck
          aria-hidden
          data-slot="chat-tool-status-icon"
          data-state="output-available"
          className={joinClasses('m-chat-tool__status-icon', className)}
        />
      )
    case 'output-error':
      return (
        <CircleX
          aria-hidden
          data-slot="chat-tool-status-icon"
          data-state="output-error"
          className={joinClasses('m-chat-tool__status-icon', className)}
        />
      )
    case 'requires-action':
      return (
        <CircleAlert
          aria-hidden
          data-slot="chat-tool-status-icon"
          data-state="requires-action"
          className={joinClasses('m-chat-tool__status-icon', className)}
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

interface ChatToolContentProps extends Omit<AriaDisclosurePanelProps, 'className' | 'children'> {
  className?: string
  children?: React.ReactNode
}

function ChatToolContent({ className, children, ...props }: ChatToolContentProps) {
  const presentation = React.useContext(ChatToolPresentationContext)
  const state = React.useContext(ChatToolStateContext)
  const disclosure = React.useContext(DisclosureStateContext)

  const [occupants, setOccupants] = React.useState(0)
  const [footer] = React.useState<ChatToolFooterSlot>(() => {
    const node = document.createElement('div')
    node.dataset.slot = 'chat-tool-footer-host'
    node.className = 'm-chat-tool__footer-host'
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
      <DisclosurePanel
        data-slot="chat-tool-content"
        data-presentation="bubble"
        className="m-chat-tool__content"
        {...props}
      >
        <div
          data-slot="disclosure-body"
          data-presentation="bubble"
          className="m-chat-tool__body"
          onKeyDown={handleKeyDown}
        >
          <ChatToolFooterContext.Provider value={footer}>
            <div
              data-slot="chat-tool-panel"
              data-state={state}
              className={joinClasses('m-chat-tool__panel', className)}
            >
              {children}
              {occupants > 0 && (
                <div
                  data-slot="chat-tool-panel-footer"
                  data-presentation="bubble"
                  className="m-chat-tool__panel-footer"
                >
                  <div
                    ref={adoptFooter}
                    data-slot="chat-tool-panel-footer-slot"
                    className="m-chat-tool__panel-footer-slot"
                  />
                </div>
              )}
            </div>
          </ChatToolFooterContext.Provider>
        </div>
      </DisclosurePanel>
    )
  }

  return (
    <DisclosurePanel data-slot="chat-tool-content" className="m-chat-tool__content" {...props}>
      <div data-slot="disclosure-body" data-presentation="card" className={joinClasses('m-chat-tool__body', className)}>
        {children}
      </div>
    </DisclosurePanel>
  )
}

/**
 * The three parts of a panel. Each is a plain section with padding: the panel
 * is a bubble continuation, not a dashboard card, and they are one on top of
 * the other with nothing between them.
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
      data-bare={bare || undefined}
      className={joinClasses('m-chat-tool__panel-header', className)}
      {...props}
    >
      <div data-slot="chat-tool-panel-lines" className="m-chat-tool__panel-lines">
        {title != null && (
          <span data-slot="chat-tool-panel-title" className="m-chat-tool__panel-title">
            {title}
          </span>
        )}
        {description != null && (
          <span data-slot="chat-tool-panel-description" className="m-chat-tool__panel-description">
            {description}
          </span>
        )}
      </div>
      {end != null && (
        <div data-slot="chat-tool-panel-end" className="m-chat-tool__panel-end">
          {end}
        </div>
      )}
    </div>
  )
}

function ChatToolPanelBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="chat-tool-panel-body" className={joinClasses('m-chat-tool__panel-body', className)} {...props}>
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
 * while somebody has.
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
      <div
        data-slot="chat-tool-panel-footer-item"
        className={joinClasses('m-chat-tool__panel-footer-item', className)}
        {...props}
      >
        {children}
      </div>,
      footer.node,
    )
  }
  return (
    <div
      data-slot="chat-tool-panel-footer"
      data-presentation="card"
      className={joinClasses('m-chat-tool__panel-footer', className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ChatToolError({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="chat-tool-error" className={joinClasses('m-chat-tool__error', className)} {...props} />
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
      data-presentation={presentation}
      className={joinClasses('m-chat-tool__approval', className)}
      {...props}
    >
      <div
        data-slot="chat-tool-approval-actions"
        data-presentation={presentation}
        className="m-chat-tool__approval-actions"
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
  ChatToolError,
  ChatToolApproval,
  ChatToolPresentationProvider,
  ChatToolPresentationContext,
  type ChatToolState,
  type ChatToolPresentation,
}
