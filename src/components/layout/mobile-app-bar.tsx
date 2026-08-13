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
  leading,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  backLabel: string
  onBack?: () => void
  /**
   * Left of the title, where `onBack` would otherwise put its arrow.
   *
   * The navigation control belongs on this side — it is where the desktop
   * sidebar trigger sits, and where a thumb expects it — which leaves the right
   * for actions that belong to the screen itself.
   */
  leading?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    // 56px tall with 48px targets and a 16px text margin, which is the metric
    // Android bars are built to. Left to size itself around a button the row
    // came out at 40px — shorter than every other bar on the device, which is
    // what made it look off before anything in it was wrong.
    <div
      data-slot="mobile-app-bar"
      className={cn(
        'flex min-h-14 shrink-0 items-center gap-1 border-b border-border px-1 select-none',
        'pt-[var(--safe-top)] pl-[max(0.25rem,var(--safe-left))] pr-[max(0.25rem,var(--safe-right))]',
        className,
      )}
      {...props}
    >
      {onBack ? (
        <Button
          isIconOnly
          variant="ghost"
          aria-label={backLabel}
          onClick={onBack}
          className="size-12 shrink-0 rounded-xl"
        >
          <ArrowLeft className="size-5" />
        </Button>
      ) : leading}
      {/* 12px here plus the row's 4px puts the text on the 16px margin, and
          keeps it there whether or not a back arrow precedes it. */}
      <span data-slot="mobile-app-bar-title" className="min-w-0 flex-1 truncate px-3 text-base font-medium">
        {title}
      </span>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}
