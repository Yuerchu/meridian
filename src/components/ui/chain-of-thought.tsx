import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const StreamingContext = React.createContext(false)

interface ChainOfThoughtProps extends Collapsible.Root.Props {
  isStreaming?: boolean
}

function ChainOfThought({ isStreaming = false, className, ...props }: ChainOfThoughtProps) {
  return (
    <StreamingContext.Provider value={isStreaming}>
      <Collapsible.Root
        data-slot="chain-of-thought"
        className={cn("flex w-full flex-col items-start", className)}
        {...props}
      />
    </StreamingContext.Provider>
  )
}

function ChainOfThoughtTrigger({ className, children, ...props }: Collapsible.Trigger.Props) {
  const isStreaming = React.useContext(StreamingContext)
  return (
    <Collapsible.Trigger
      data-slot="chain-of-thought-trigger"
      className={cn(
        "group/cot-trigger flex items-center gap-1 rounded-md text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      <span className={isStreaming ? "shimmer" : undefined}>{children}</span>
      <ChevronDownIcon
        aria-hidden
        className="size-3.5 shrink-0 transition-transform duration-200 group-data-panel-open/cot-trigger:rotate-180"
      />
    </Collapsible.Trigger>
  )
}

function ChainOfThoughtContent({ className, children, ...props }: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel
      data-slot="chain-of-thought-content"
      className="h-(--collapsible-panel-height) w-full overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div className={cn("mt-2 ml-1.5 border-l-2 border-border pl-4", className)}>{children}</div>
    </Collapsible.Panel>
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
