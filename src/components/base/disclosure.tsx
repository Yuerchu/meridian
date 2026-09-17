import { useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface DisclosureProps extends ComponentProps<'div'> {
  isExpanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

function DisclosureRoot({
  className,
  isExpanded,
  defaultExpanded = false,
  onExpandedChange: _onExpandedChange,
  children,
  ...props
}: DisclosureProps) {
  const [internal, _setInternal] = useState(defaultExpanded)
  const expanded = isExpanded ?? internal
  return (
    <div data-slot="disclosure" data-expanded={expanded || undefined} {...props} className={cn('', className)}>
      {children}
    </div>
  )
}

function DisclosureTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="disclosure-trigger"
      type="button"
      {...props}
      className={cn('flex w-full items-center gap-2 text-left', className)}
    />
  )
}

function DisclosureIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="disclosure-indicator"
      {...props}
      className={cn('text-muted transition-transform [[data-expanded]_&]:rotate-90', className)}
    />
  )
}

function DisclosureHeading({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-heading" {...props} className={cn('', className)} />
}

function DisclosureContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-content" {...props} className={cn('', className)} />
}

function DisclosureBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-body" {...props} className={cn('', className)} />
}

export const Disclosure = Object.assign(DisclosureRoot, {
  Trigger: DisclosureTrigger,
  Indicator: DisclosureIndicator,
  Heading: DisclosureHeading,
  Content: DisclosureContent,
  Body: DisclosureBody,
})

function DisclosureGroupRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-group" {...props} className={cn('flex flex-col', className)} />
}

export const DisclosureGroup = DisclosureGroupRoot
