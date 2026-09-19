import { useState, type ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ChainOfThoughtProps extends ComponentProps<'div'> {
  defaultExpanded?: boolean
  isStreaming?: boolean
}

function ChainOfThoughtRoot({
  className,
  defaultExpanded = false,
  isStreaming = false,
  ...props
}: ChainOfThoughtProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div
      data-slot="chain-of-thought"
      data-expanded={expanded || undefined}
      data-streaming={isStreaming || undefined}
      onClick={() => setExpanded((v) => !v)}
      {...props}
      className={cx('', className)}
    />
  )
}

function CotTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="chain-of-thought-trigger"
      type="button"
      {...props}
      className={cx('text-caption-1-medium text-text-secondary', className)}
    />
  )
}

function CotContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="chain-of-thought-content"
      {...props}
      className={cx('mt-1 text-body-regular text-text-secondary', className)}
    />
  )
}

function CotSteps({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chain-of-thought-steps" {...props} className={cx('flex flex-col gap-1', className)} />
}

function CotStep({ className, label, ...props }: ComponentProps<'div'> & { label?: string }) {
  return (
    <div data-slot="chain-of-thought-step" {...props} className={cx('text-body-regular', className)}>
      {label && (
        <span data-slot="chain-of-thought-step-label" className="mr-1 text-body-medium text-text-primary">
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
