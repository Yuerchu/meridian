import { useContext, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  DisclosureStateContext,
  type ButtonProps as AriaButtonProps,
  type DisclosureGroupProps as AriaDisclosureGroupProps,
  type DisclosurePanelProps as AriaDisclosurePanelProps,
  type DisclosureProps as AriaDisclosureProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * Show / hide a region, on React Aria's `Disclosure`.
 *
 *   <Disclosure isExpanded={open} onExpandedChange={setOpen}>
 *     <Disclosure.Heading>
 *       <Disclosure.Trigger><Disclosure.Indicator /> Details</Disclosure.Trigger>
 *     </Disclosure.Heading>
 *     <Disclosure.Content><Disclosure.Body>…</Disclosure.Body></Disclosure.Content>
 *   </Disclosure>
 *
 * The trigger is `Button slot="trigger"`, which is how RAC gives it
 * `aria-expanded` and `aria-controls` and toggles the state; the panel stays
 * in the DOM and is `hidden="until-found"` when shut, so find-in-page reaches
 * it and `src/test/disclosure.ts` can assert on it. `DisclosureGroup` holds
 * `expandedKeys` for an accordion.
 *
 * Both `Trigger` and `Content` take a `render` prop that receives the DOM props
 * RAC would have put on its own element, for callers whose head or panel is
 * already an element of their own (the tool block in `ui/chat-tool.tsx`).
 */

export interface DisclosureProps extends Omit<AriaDisclosureProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode | ((opts: { isExpanded: boolean }) => ReactNode)
}

function DisclosureRoot({ className, children, ...props }: DisclosureProps) {
  return (
    <AriaDisclosure data-slot="disclosure" {...props} className={cx('group/disclosure', className)}>
      {typeof children === 'function' ? (state) => children({ isExpanded: state.isExpanded }) : children}
    </AriaDisclosure>
  )
}

export interface DisclosureTriggerProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
  render?: (props: ComponentProps<'button'>) => ReactElement
}

function DisclosureTrigger({ className, render, children, ...props }: DisclosureTriggerProps) {
  if (render) {
    // RAC's trigger contract by hand: the same aria wiring `Button slot="trigger"`
    // gets, on an element the caller owns.
    return (
      <RenderedTrigger className={className} render={render}>
        {children}
      </RenderedTrigger>
    )
  }
  return (
    <AriaButton
      slot="trigger"
      data-slot="disclosure-trigger"
      {...props}
      className={cx(
        'flex w-full cursor-[var(--cursor-interactive)] items-center gap-2 text-left outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      {children}
    </AriaButton>
  )
}

function RenderedTrigger({
  className,
  render,
  children,
}: {
  className?: string
  render: (props: ComponentProps<'button'>) => ReactElement
  children?: ReactNode
}) {
  const state = useContext(DisclosureStateContext)
  return render({
    type: 'button',
    'aria-expanded': state?.isExpanded ?? false,
    onClick: () => state?.toggle(),
    className: cx(className),
    children,
  } as ComponentProps<'button'>)
}

function DisclosureIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="disclosure-indicator"
      aria-hidden
      {...props}
      className={cx(
        'flex shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease group-data-[expanded]/disclosure:rotate-90 [&_svg]:size-4',
        className,
      )}
    />
  )
}

function DisclosureHeading({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="disclosure-heading" {...props} className={cx('flex items-center', className)} />
}

export interface DisclosureContentProps extends Omit<AriaDisclosurePanelProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureContent({ className, render, children, ...props }: DisclosureContentProps) {
  if (render) {
    return (
      <RenderedPanel className={className} render={render}>
        {children}
      </RenderedPanel>
    )
  }
  return (
    <AriaDisclosurePanel data-slot="disclosure-content" {...props} className={cx('outline-none', className)}>
      {children}
    </AriaDisclosurePanel>
  )
}

function RenderedPanel({
  className,
  render,
  children,
}: {
  className?: string
  render: (props: ComponentProps<'div'>) => ReactElement
  children?: ReactNode
}) {
  const state = useContext(DisclosureStateContext)
  return render({
    role: 'group',
    hidden: state ? !state.isExpanded : false,
    className: cx(className),
    children,
  })
}

interface DisclosureBodyProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

function DisclosureBody({ className, render, ...props }: DisclosureBodyProps) {
  const domProps = { 'data-slot': 'disclosure-body' as const, ...props, className: cx(className) }
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

export interface DisclosureGroupProps extends Omit<AriaDisclosureGroupProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

export function DisclosureGroup({ className, children, ...props }: DisclosureGroupProps) {
  return (
    <AriaDisclosureGroup data-slot="disclosure-group" {...props} className={cx('flex flex-col', className)}>
      {children}
    </AriaDisclosureGroup>
  )
}
