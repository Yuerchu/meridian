import { useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ChainOfThoughtProps extends ComponentProps<'div'> {
  defaultExpanded?: boolean
  isStreaming?: boolean
}

function ChainOfThoughtRoot({
  className,
  defaultExpanded = false,
  isStreaming: _isStreaming,
  ...props
}: ChainOfThoughtProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div
      data-slot="chain-of-thought"
      data-expanded={expanded || undefined}
      onClick={() => setExpanded((v) => !v)}
      {...props}
      className={cn('', className)}
    />
  )
}

function CotTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="chain-of-thought-trigger"
      type="button"
      {...props}
      className={cn('text-xs font-medium text-muted', className)}
    />
  )
}

function CotContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chain-of-thought-content" {...props} className={cn('mt-1 text-sm text-muted', className)} />
}

function CotSteps({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chain-of-thought-steps" {...props} className={cn('flex flex-col gap-1', className)} />
}

function CotStep({ className, label, ...props }: ComponentProps<'div'> & { label?: string }) {
  return (
    <div data-slot="chain-of-thought-step" {...props} className={cn('text-sm', className)}>
      {label && (
        <span data-slot="chain-of-thought-step-label" className="mr-1 font-medium text-foreground">
          {label}:
        </span>
      )}
      {props.children}
    </div>
  )
}

export const ChainOfThought = Object.assign(ChainOfThoughtRoot, {
  Trigger: CotTrigger,
  Content: CotContent,
  Steps: CotSteps,
  Step: CotStep,
})

export const ChainOfThoughtTrigger = CotTrigger
export const ChainOfThoughtContent = CotContent
export const ChainOfThoughtSteps = CotSteps
export const ChainOfThoughtStep = CotStep
