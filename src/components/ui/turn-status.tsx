import * as React from 'react'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Ban, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, TriangleAlert } from '@keyline-icons/react/two-tone'

// Imported rather than restated. This used to be a copy of the union in
// `lib/turns`, structurally identical by luck, which meant a new status had to
// be added in two places and nothing failed if it was added in one.
import type { TurnStatus } from '@/lib/turns'
import './turn-status.css'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** The one glyph a turn's status is drawn as, wherever it is drawn. */
function TurnStatusIcon({ status, className }: { status: TurnStatus; className?: string }) {
  const iconClass = joinClasses('m-turn-status-icon', className)
  switch (status) {
    case 'streaming':
      return (
        <span aria-hidden>
          <Spinner size="sm" />
        </span>
      )
    case 'awaiting-input':
      return <CircleAlert aria-hidden data-status={status} className={iconClass} />
    // Warning-coloured, unlike `interrupted`, which is grey. A turn the user
    // stopped needs no attention; one that stopped unexpectedly, part way
    // through whatever it was doing, may have left something half-done.
    case 'crashed':
      return <TriangleAlert aria-hidden data-status={status} className={iconClass} />
    case 'interrupted':
      return <Ban aria-hidden data-status={status} className={iconClass} />
    case 'empty':
      return <Ban aria-hidden data-status={status} className={iconClass} />
    case 'complete':
    default:
      return <CircleCheck aria-hidden data-status={status} className={iconClass} />
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
    <div data-slot="turn-branch-pager" className={joinClasses('m-turn-branch-pager', className)} {...props}>
      <button
        type="button"
        data-slot="turn-branch-pager-prev"
        aria-label={previousLabel}
        disabled={disabled || index <= 1}
        onClick={onPrevious}
        className="m-turn-branch-pager__btn"
      >
        <ChevronLeft aria-hidden className="m-turn-branch-pager__chevron" />
      </button>
      <span data-slot="turn-branch-pager-label" className="m-turn-branch-pager__label">
        {index}/{total}
      </span>
      <button
        type="button"
        data-slot="turn-branch-pager-next"
        aria-label={nextLabel}
        disabled={disabled || index >= total}
        onClick={onNext}
        className="m-turn-branch-pager__btn"
      >
        <ChevronRight aria-hidden className="m-turn-branch-pager__chevron" />
      </button>
    </div>
  )
}

export { TurnStatusIcon, TurnBranchPager, type TurnStatus }
