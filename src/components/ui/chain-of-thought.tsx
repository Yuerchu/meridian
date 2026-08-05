import * as React from "react"
import { Disclosure } from "@heroui/react"

import { cn } from "@/lib/utils"

/**
 * The model's reasoning, folded away behind a line of text.
 *
 * Built on HeroUI's Disclosure rather than a collapsible of our own: what this
 * adds is the shimmer while reasoning streams and the rule down the left of the
 * panel, and neither of those is a reason to reimplement the folding.
 */

const StreamingContext = React.createContext(false)

interface ChainOfThoughtProps extends React.ComponentProps<typeof Disclosure> {
  isStreaming?: boolean
}

function ChainOfThought({ isStreaming = false, className, ...props }: ChainOfThoughtProps) {
  return (
    <StreamingContext.Provider value={isStreaming}>
      <Disclosure
        data-slot="chain-of-thought"
        className={cn("flex w-full flex-col items-start", className)}
        {...props}
      />
    </StreamingContext.Provider>
  )
}

function ChainOfThoughtTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Disclosure.Trigger>, "children"> & {
  // Narrower than HeroUI's, which also accepts a render function: this trigger
  // wraps its label in a shimmer span, and a function has nothing to wrap.
  children?: React.ReactNode
}) {
  const isStreaming = React.useContext(StreamingContext)
  return (
    <Disclosure.Heading>
      {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto` and
          `shrink-0`, which only mean anything inside a flex container, and
          Tailwind's preflight makes the svg a block. Without it the chevron
          drops onto its own line. */}
      <Disclosure.Trigger
        data-slot="chain-of-thought-trigger"
        className={cn(
          "flex items-center gap-1 rounded-md text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50",
          className
        )}
        {...props}
      >
        <span className={isStreaming ? "shimmer" : undefined}>{children}</span>
        <Disclosure.Indicator className="size-3.5 shrink-0" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function ChainOfThoughtContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Disclosure.Content>) {
  return (
    // `min-h-0` is load-bearing: the root is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content
      data-slot="chain-of-thought-content"
      className="min-h-0 w-full"
      {...props}
    >
      {/* Body, not a plain div: it is what measures the panel and feeds
          `--disclosure-panel-height`, so without it the content never collapses
          — it just loses its `aria-expanded`. */}
      <Disclosure.Body className={cn("mt-2 ml-1.5 border-l-2 border-border pl-4", className)}>
        {children}
      </Disclosure.Body>
    </Disclosure.Content>
  )
}

function ChainOfThoughtSteps({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chain-of-thought-steps"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

interface ChainOfThoughtStepProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode
}

function ChainOfThoughtStep({ label, className, children, ...props }: ChainOfThoughtStepProps) {
  return (
    <div data-slot="chain-of-thought-step" className={cn("text-sm", className)} {...props}>
      {label && (
        <div
          data-slot="chain-of-thought-step-label"
          className="mb-1 flex items-center gap-2 text-xs text-muted"
        >
          <span aria-hidden className="size-1 shrink-0 rounded-full bg-muted/60" />
          {label}
        </div>
      )}
      <div data-slot="chain-of-thought-step-content">{children}</div>
    </div>
  )
}

export {
  ChainOfThought,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtSteps,
  ChainOfThoughtStep,
}
