import { Button } from '@heroui/react'
import { ArrowLeft } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'

/**
 * A title bar with a way back.
 *
 * Hand-written because HeroUI has no navbar: its `Header` is the small label
 * above a group inside a menu, and a Drawer is a modal overlay rather than a
 * screen in a stack.
 */
export function MobileAppBar({
  title,
  backLabel,
  onBack,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  backLabel: string
  onBack?: () => void
  actions?: React.ReactNode
}) {
  return (
    <div
      data-slot="mobile-app-bar"
      className={cn(
        'flex shrink-0 items-center gap-1 border-b border-border px-1 select-none',
        'pt-[var(--safe-top)] pl-[max(0.25rem,var(--safe-left))] pr-[max(0.25rem,var(--safe-right))]',
        className,
      )}
      {...props}
    >
      {onBack && (
        <Button
          isIconOnly
          variant="ghost"
          aria-label={backLabel}
          onClick={onBack}
          className="size-10 shrink-0 rounded-xl"
        >
          <ArrowLeft className="size-4" />
        </Button>
      )}
      <span data-slot="mobile-app-bar-title" className="min-w-0 flex-1 truncate px-2 text-sm font-medium">
        {title}
      </span>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}
