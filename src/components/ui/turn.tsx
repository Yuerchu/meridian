import * as React from 'react'
import { Disclosure } from '@heroui/react'
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleExclamation,
  TriangleExclamation,
} from '@gravity-ui/icons'

import { cn } from '@/lib/utils'

// Imported rather than restated. This used to be a copy of the union in
// `lib/turns`, structurally identical by luck, which meant a new status had to
// be added in two places and nothing failed if it was added in one.
import type { TurnStatus } from '@/lib/turns'

const TurnStatusContext = React.createContext<TurnStatus>('complete')

interface TurnProps extends React.ComponentProps<typeof Disclosure> {
  status?: TurnStatus
}

/**
 * The collapsed record of everything an agent did to answer one question.
 *
 * Styled as a bare line rather than a bordered card: the steps inside are
 * already cards, and wrapping them in another one reads as a second nesting
 * level that is not really there.
 */
function Turn({ status, className, ...props }: TurnProps) {
  return (
    <TurnStatusContext.Provider value={status ?? 'complete'}>
      <Disclosure
        data-slot="turn-collapsible"
        data-status={status ?? 'complete'}
        className={cn('flex w-full min-w-0 flex-col', className)}
        {...props}
      />
    </TurnStatusContext.Provider>
  )
}

interface TurnTriggerProps extends Omit<React.ComponentProps<typeof Disclosure.Trigger>, 'children'> {
  /** Sits between the label and the chevron — a duration, a step count. Mirrors
   *  `ChatToolTrigger`'s slot of the same name; an `ml-auto` child would fight
   *  the label row, which already absorbs the free space. */
  endContent?: React.ReactNode
  // Narrower than HeroUI's, which also accepts a render function: this trigger
  // wraps its label in a span the status shimmers on, and a function has
  // nothing to wrap.
  children?: React.ReactNode
}

function TurnTrigger({ className, children, endContent, ...props }: TurnTriggerProps) {
  const status = React.useContext(TurnStatusContext)
  return (
    <Disclosure.Heading>
      {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto` and
          `shrink-0`, which only mean anything inside a flex container. */}
      <Disclosure.Trigger
        data-slot="turn-trigger"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50',
          className,
        )}
        {...props}
      >
        <span data-slot="turn-trigger-label" className={cn('min-w-0 truncate', status === 'streaming' && 'shimmer')}>
          {children}
        </span>
        {endContent}
        {/* `ms-0` undoes the indicator's own `ms-auto`: this chevron reads as
            punctuation on the end of the label, not as a control parked at the
            far edge of a full-width row. */}
        <Disclosure.Indicator className="ms-0 size-3.5 shrink-0" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function TurnStatusIcon({ className }: { className?: string }) {
  const status = React.useContext(TurnStatusContext)
  const shared = cn('size-3.5 shrink-0', className)
  switch (status) {
    case 'streaming':
      return <CircleDashed aria-hidden className={cn(shared, 'animate-spin text-muted')} />
    case 'awaiting-input':
      return <CircleExclamation aria-hidden className={cn(shared, 'text-warning-soft-foreground')} />
    // Warning-coloured, unlike `interrupted`, which is grey. A turn the user
    // stopped needs no attention; one that stopped unexpectedly, part way
    // through whatever it was doing, may have left something half-done.
    case 'crashed':
      return <TriangleExclamation aria-hidden className={cn(shared, 'text-warning-soft-foreground')} />
    case 'interrupted':
      return <Ban aria-hidden className={cn(shared, 'text-muted')} />
    case 'empty':
      return <Ban aria-hidden className={cn(shared, 'text-muted')} />
    case 'complete':
    default:
      return <CircleCheck aria-hidden className={cn(shared, 'text-muted')} />
  }
}

interface TurnContentProps extends React.ComponentProps<typeof Disclosure.Content> {
  /** Set while a collapse is being height-compensated by hand, so the panel
   *  snaps instead of animating and the correction lands in one layout pass. */
  disableTransition?: boolean
}

function TurnContent({ className, children, disableTransition, ...props }: TurnContentProps) {
  return (
    // `min-h-0` is load-bearing: the turn is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content
      data-slot="turn-content"
      data-no-transition={disableTransition ? '' : undefined}
      className="min-h-0 w-full data-[no-transition]:transition-none"
      {...props}
    >
      {/* Body, not a plain div: it is what keeps the panel measurable, so
          without it the content never collapses — it just loses its
          `aria-expanded`.
          gap rather than space-y: children may zero out their own margins, and
          Tailwind v4's space-y sits inside `:where()`, so a plain `my-0` wins. */}
      <Disclosure.Body className={cn('mt-2 ml-1.5 flex flex-col gap-3 border-l-2 border-border pl-4', className)}>
        {children}
      </Disclosure.Body>
    </Disclosure.Content>
  )
}

/** Steps that stay outside the panel because they are waiting on the user —
 *  an approval prompt hidden behind a collapsed header cannot be answered. */
function TurnPinned({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="turn-pinned" className={cn('mt-3 flex flex-col gap-3', className)} {...props} />
}

function TurnResult({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="turn-result" className={cn('mt-3 min-w-0', className)} {...props} />
}

function TurnFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="turn-footer"
      className={cn('mt-1 flex min-w-0 items-center gap-1 text-xs text-muted', className)}
      {...props}
    />
  )
}

/** Hover-revealed half of the footer. The pager sits outside it: it carries
 *  information, not an action, so it has to stay legible at rest. */
function TurnActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="turn-actions"
      className={cn(
        'flex items-center gap-1 opacity-0 transition-opacity group-hover/turn:opacity-100 pointer-coarse:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

interface TurnBranchPagerProps extends Omit<React.ComponentProps<'div'>, 'onSelect'> {
  /** 1-based, to match what is rendered. */
  index: number
  total: number
  onPrevious?: () => void
  onNext?: () => void
  isDisabled?: boolean
  previousLabel?: string
  nextLabel?: string
}

/** The `‹ 2/3 ›` control for switching between regenerated answers. Renders
 *  nothing at all when there is only one version. */
function TurnBranchPager({
  index,
  total,
  onPrevious,
  onNext,
  isDisabled,
  previousLabel,
  nextLabel,
  className,
  ...props
}: TurnBranchPagerProps) {
  if (total <= 1) return null
  return (
    <div
      data-slot="turn-branch-pager"
      className={cn('flex items-center gap-0.5 text-xs text-muted', className)}
      {...props}
    >
      <button
        type="button"
        data-slot="turn-branch-pager-prev"
        aria-label={previousLabel}
        disabled={isDisabled || index <= 1}
        onClick={onPrevious}
        className="rounded-sm p-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </button>
      <span data-slot="turn-branch-pager-label" className="tabular-nums">
        {index}/{total}
      </span>
      <button
        type="button"
        data-slot="turn-branch-pager-next"
        aria-label={nextLabel}
        disabled={isDisabled || index >= total}
        onClick={onNext}
        className="rounded-sm p-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

export {
  Turn,
  TurnTrigger,
  TurnStatusIcon,
  TurnContent,
  TurnPinned,
  TurnResult,
  TurnFooter,
  TurnActions,
  TurnBranchPager,
  type TurnStatus,
}
