import type { ComponentProps, ReactNode } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * A rail of bars at the edge of a long page, one per heading, that turns into
 * a list of the headings when the pointer reaches it or focus enters it.
 *
 *   <FloatingToc placement="right">
 *     <FloatingToc.Trigger aria-label="Outline">{bars}</FloatingToc.Trigger>
 *     <FloatingToc.Content>{items}</FloatingToc.Content>
 *   </FloatingToc>
 *
 * The rail is the affordance and the list is the control: bars carry
 * `active`, items are RAC buttons with `onPress`. The list is a hover/focus
 * reveal of the root, so keyboard users reach it by tabbing to the first item.
 */

interface FloatingTocProps extends ComponentProps<'div'> {
  placement?: 'left' | 'right'
}

function FloatingTocRoot({ className, placement = 'right', ...props }: FloatingTocProps) {
  return (
    <div
      data-slot="floating-toc"
      data-placement={placement}
      {...props}
      className={cx(
        'group/toc relative flex items-center',
        placement === 'right' ? 'justify-end' : 'justify-start',
        className,
      )}
    />
  )
}

function FloatingTocTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="floating-toc-trigger"
      {...props}
      className={cx(
        'flex flex-col items-end gap-1 py-1 transition-opacity duration-150 group-hover/toc:opacity-0 group-focus-within/toc:opacity-0',
        className,
      )}
    />
  )
}

function FloatingTocBar({ className, active, ...props }: ComponentProps<'div'> & { active?: boolean }) {
  return (
    <div
      data-slot="floating-toc-bar"
      data-active={active || undefined}
      aria-hidden
      {...props}
      className={cx(
        'h-0.5 w-3 rounded-full bg-border-button-default transition-colors data-[active]:w-4 data-[active]:bg-accent-500',
        className,
      )}
    />
  )
}

function FloatingTocContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="floating-toc-content"
      {...props}
      className={cx(
        'pointer-events-none absolute top-1/2 flex max-h-[60vh] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto p-2 opacity-0',
        'rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown',
        'transition duration-150 ease-out group-hover/toc:pointer-events-auto group-hover/toc:opacity-100 group-focus-within/toc:pointer-events-auto group-focus-within/toc:opacity-100',
        'group-data-[placement=right]/toc:right-0 group-data-[placement=left]/toc:left-0',
        className,
      )}
    />
  )
}

interface FloatingTocItemProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  active?: boolean
  className?: string
  children?: ReactNode
}

function FloatingTocItem({ className, active, children, ...props }: FloatingTocItemProps) {
  return (
    <AriaButton
      data-slot="floating-toc-item"
      data-active={active || undefined}
      aria-current={active ? 'true' : undefined}
      {...props}
      className={cx(
        'cursor-pointer rounded-lg px-2 py-1 text-left text-caption-1-medium whitespace-nowrap text-text-secondary outline-none',
        'data-[hovered]:bg-background-secondary-hover data-[hovered]:text-text-primary data-[active]:text-text-primary',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      {children}
    </AriaButton>
  )
}

export const FloatingToc = Object.assign(FloatingTocRoot, {
  Trigger: FloatingTocTrigger,
  Bar: FloatingTocBar,
  Content: FloatingTocContent,
  Item: FloatingTocItem,
})
