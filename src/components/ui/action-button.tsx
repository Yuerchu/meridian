import * as React from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

/**
 * An icon button with a tooltip. Lives here rather than beside the message
 * list because the markdown renderer needs it too, and importing it from a
 * message component would put a cycle between the two.
 */
function ActionButton({ label, onClick, className, children }: {
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button data-slot="action-button" variant="ghost" size="icon" onClick={onClick} className={className}>
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export { ActionButton }
