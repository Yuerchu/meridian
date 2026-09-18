import React, { useState, type ComponentProps, type ReactElement } from 'react'
import { cx } from '@/utils/cx'

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
    <div data-slot="disclosure" data-expanded={expanded || undefined} {...props} className={cx('', className)}>
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
    className: cx('flex w-full items-center gap-2 text-left', className),
  }
  if (render) return render(domProps)

  return <button {...domProps} />
}

function DisclosureIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="disclosure-indicator"
      {...props}
      className={cx('text-text-secondary transition-transform [[data-expanded]_&]:rotate-90', className)}
    />
  )
}

function DisclosureHeading({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-heading" {...props} className={cx('', className)} />
}

interface DisclosureContentProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureContent({ className, render, ...props }: DisclosureContentProps) {
  const domProps = { 'data-slot': 'disclosure-content' as const, ...props, className: cx('', className) }
  if (render) return render(domProps)

  return <div {...domProps} />
}

interface DisclosureBodyProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureBody({ className, render, ...props }: DisclosureBodyProps) {
  const domProps = { 'data-slot': 'disclosure-body' as const, ...props, className: cx('', className) }
  if (render) return render(domProps)

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
  return <div data-slot="disclosure-group" {...props} className={cx('flex flex-col', className)} />
}

export const DisclosureGroup = DisclosureGroupRoot
