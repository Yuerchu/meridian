import * as React from 'react'
import { Spinner } from '@/components/base'
import { Ban, ChevronLeft, ChevronRight, CircleCheck, CircleExclamation, TriangleExclamation } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'
// Imported rather than restated. This used to be a copy of the union in
// `lib/turns`, structurally identical by luck, which meant a new status had to
// be added in two places and nothing failed if it was added in one.
import type { TurnStatus } from '@/lib/turns'

/** The one glyph a turn's status is drawn as, wherever it is drawn. */
function TurnStatusIcon({ status, className }: { status: TurnStatus; className?: string }) {
  const shared = cn('size-3.5 shrink-0', className)
  switch (status) {
    case 'streaming':
      return <Spinner size="sm" color="current" aria-hidden className={cn('shrink-0 text-muted', className)} />
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

interface TurnBranchPagerProps extends Omit<React.ComponentProps<'div'>, 'onSelect'> {
  /** 1-based, to match what is rendered. */
  index: number
  total: number
  onPrevious?: () => void
  onNext?: () => void
  disabled?: boolean
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
  disabled,
  previousLabel,
  nextLabel,
  className,
  ...props
}: TurnBranchPagerProps) {
  if (total <= 1) return null
  return (
    // `touch-hitbox` on both arrows below: at `p-0.5` around a 14px chevron they
    // are about 22px, and on a touch screen they are the only way to reach a
    // regenerated or edited branch. Nothing here clips, so the expanded box
    // survives — unlike the composer's toolbar, where the shell's
    // `overflow: hidden` cuts it back off.
    <div
      data-slot="turn-branch-pager"
      className={cn('flex items-center gap-0.5 text-xs text-muted', className)}
      {...props}
    >
      <button
        type="button"
        data-slot="turn-branch-pager-prev"
        aria-label={previousLabel}
        disabled={disabled || index <= 1}
        onClick={onPrevious}
        className="touch-hitbox rounded-sm p-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-40"
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
        disabled={disabled || index >= total}
        onClick={onNext}
        className="touch-hitbox rounded-sm p-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

export { TurnStatusIcon, TurnBranchPager, type TurnStatus }
