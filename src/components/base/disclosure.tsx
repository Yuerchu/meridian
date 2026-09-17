import React, { useState, type ComponentProps, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

type DisclosureChildren = React.ReactNode | ((opts: { isExpanded: boolean }) => React.ReactNode)

interface DisclosureProps extends Omit<ComponentProps<'div'>, 'children'> {
  isExpanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  variant?: string
  children?: DisclosureChildren
}

function DisclosureRoot({
  className,
  isExpanded,
  defaultExpanded = false,
  onExpandedChange: _onExpandedChange,
  variant: _variant,
  children,
  ...props
}: DisclosureProps) {
  const [internal, _setInternal] = useState(defaultExpanded)
  const expanded = isExpanded ?? internal
  return (
    <div data-slot="disclosure" data-expanded={expanded || undefined} {...props} className={cn('', className)}>
      {typeof children === 'function' ? children({ isExpanded: expanded }) : children}
    </div>
  )
}

interface DisclosureTriggerProps extends ComponentProps<'button'> {
  render?: (props: ComponentProps<'button'>) => ReactElement
}

function DisclosureTrigger({ className, render, ...props }: DisclosureTriggerProps) {
  const domProps = {
    'data-slot': 'disclosure-trigger' as const,
    type: 'button' as const,
    ...props,
    className: cn('flex w-full items-center gap-2 text-left', className),
  }
  if (render) return render(domProps)
  // eslint-disable-next-line meridian-ui/intrinsic-needs-data-slot -- data-slot is in domProps
  return <button {...domProps} />
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

interface DisclosureContentProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureContent({ className, render, ...props }: DisclosureContentProps) {
  const domProps = { 'data-slot': 'disclosure-content' as const, ...props, className: cn('', className) }
  if (render) return render(domProps)
  // eslint-disable-next-line meridian-ui/intrinsic-needs-data-slot -- data-slot is in domProps
  return <div {...domProps} />
}

interface DisclosureBodyProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureBody({ className, render, ...props }: DisclosureBodyProps) {
  const domProps = { 'data-slot': 'disclosure-body' as const, ...props, className: cn('', className) }
  if (render) return render(domProps)
  // eslint-disable-next-line meridian-ui/intrinsic-needs-data-slot -- data-slot is in domProps
  return <div {...domProps} />
}

export const Disclosure = Object.assign(DisclosureRoot, {
  Trigger: DisclosureTrigger,
  Indicator: DisclosureIndicator,
  Heading: DisclosureHeading,
  Content: DisclosureContent,
  Body: DisclosureBody,
})

interface DisclosureGroupProps extends ComponentProps<'div'> {
  expandedKeys?: Iterable<string>
  onExpandedChange?: (keys: Set<string>) => void
}

function DisclosureGroupRoot({ className, expandedKeys: _ek, onExpandedChange: _oec, ...props }: DisclosureGroupProps) {
  return <div data-slot="disclosure-group" {...props} className={cn('flex flex-col', className)} />
}

export const DisclosureGroup = DisclosureGroupRoot
