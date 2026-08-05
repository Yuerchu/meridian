import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  Loader2Icon,
} from "lucide-react"

import { cn } from "@/lib/utils"

type TurnStatus =
  | "streaming"
  | "complete"
  | "interrupted"
  | "awaiting-input"
  | "empty"

const TurnStatusContext = React.createContext<TurnStatus>("complete")

interface TurnProps extends Collapsible.Root.Props {
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
    <TurnStatusContext.Provider value={status ?? "complete"}>
      <Collapsible.Root
        data-slot="turn-collapsible"
        data-status={status ?? "complete"}
        className={cn("flex w-full min-w-0 flex-col", className)}
        {...props}
      />
    </TurnStatusContext.Provider>
  )
}

interface TurnTriggerProps extends Collapsible.Trigger.Props {
  /** Sits between the label and the chevron — a duration, a step count. Mirrors
   *  `ChatToolTrigger`'s slot of the same name; an `ml-auto` child would fight
   *  the label row, which already absorbs the free space. */
  endContent?: React.ReactNode
}

function TurnTrigger({ className, children, endContent, ...props }: TurnTriggerProps) {
  const status = React.useContext(TurnStatusContext)
  return (
    <Collapsible.Trigger
      data-slot="turn-trigger"
      className={cn(
        "group/turn-trigger flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50",
        className
      )}
      {...props}
    >
      <span
        data-slot="turn-trigger-label"
        className={cn("min-w-0 truncate", status === "streaming" && "shimmer")}
      >
        {children}
      </span>
      {endContent}
      <ChevronDownIcon
        aria-hidden
        className="size-3.5 shrink-0 transition-transform duration-200 group-data-panel-open/turn-trigger:rotate-180"
      />
    </Collapsible.Trigger>
  )
}

function TurnStatusIcon({ className }: { className?: string }) {
  const status = React.useContext(TurnStatusContext)
  const shared = cn("size-3.5 shrink-0", className)
  switch (status) {
    case "streaming":
      return <Loader2Icon aria-hidden className={cn(shared, "animate-spin text-muted")} />
    case "awaiting-input":
      return <CircleAlertIcon aria-hidden className={cn(shared, "text-warning")} />
    case "interrupted":
      return <CircleSlashIcon aria-hidden className={cn(shared, "text-muted")} />
    case "empty":
      return <CircleSlashIcon aria-hidden className={cn(shared, "text-muted")} />
    case "complete":
    default:
      return <CircleCheckIcon aria-hidden className={cn(shared, "text-muted")} />
  }
}

interface TurnContentProps extends Collapsible.Panel.Props {
  /** Set while a collapse is being height-compensated by hand, so the panel
   *  snaps instead of animating and the correction lands in one layout pass. */
  disableTransition?: boolean
}

function TurnContent({ className, children, disableTransition, ...props }: TurnContentProps) {
  return (
    <Collapsible.Panel
      data-slot="turn-content"
      data-no-transition={disableTransition ? "" : undefined}
      className={cn(
        "h-(--collapsible-panel-height) w-full overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0",
        "data-[no-transition]:transition-none"
      )}
      {...props}
    >
      {/* gap rather than space-y: children may zero out their own margins, and
          Tailwind v4's space-y sits inside `:where()`, so a plain `my-0` wins. */}
      <div className={cn("mt-2 ml-1.5 flex flex-col gap-3 border-l-2 border-border pl-4", className)}>
        {children}
      </div>
    </Collapsible.Panel>
  )
}

/** Steps that stay outside the panel because they are waiting on the user —
 *  an approval prompt hidden behind a collapsed header cannot be answered. */
function TurnPinned({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="turn-pinned" className={cn("mt-3 flex flex-col gap-3", className)} {...props} />
  )
}

function TurnResult({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="turn-result" className={cn("mt-3 min-w-0", className)} {...props} />
  )
}

function TurnFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="turn-footer"
      className={cn("mt-1 flex min-w-0 items-center gap-1 text-xs text-muted", className)}
      {...props}
    />
  )
}

/** Hover-revealed half of the footer. The pager sits outside it: it carries
 *  information, not an action, so it has to stay legible at rest. */
function TurnActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="turn-actions"
      className={cn(
        "flex items-center gap-1 opacity-0 transition-opacity group-hover/turn:opacity-100 pointer-coarse:opacity-100",
        className
      )}
      {...props}
    />
  )
}

interface TurnBranchPagerProps extends Omit<React.ComponentProps<"div">, "onSelect"> {
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
      className={cn("flex items-center gap-0.5 text-xs text-muted", className)}
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
        <ChevronLeftIcon aria-hidden className="size-3.5" />
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
        <ChevronRightIcon aria-hidden className="size-3.5" />
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
