import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ActionBarProps extends ComponentProps<'div'> {
  isOpen?: boolean
}

function ActionBarRoot({ className, isOpen, ...props }: ActionBarProps) {
  if (!isOpen) return null
  return (
    <div
      data-slot="action-bar"
      {...props}
      className={cx(
        'fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2 shadow-dropdown',
        'motion-safe:animate-[meridian-rise-in_200ms_ease-out]',
        className,
      )}
    />
  )
}

function ActionBarPrefix({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-prefix" {...props} className={cx('text-sm text-text-secondary', className)} />
}

function ActionBarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-content" {...props} className={cx('flex items-center gap-1', className)} />
}

function ActionBarSuffix({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-suffix" {...props} className={cx('flex items-center gap-1', className)} />
}

export const ActionBar = Object.assign(ActionBarRoot, {
  Prefix: ActionBarPrefix,
  Content: ActionBarContent,
  Suffix: ActionBarSuffix,
})
