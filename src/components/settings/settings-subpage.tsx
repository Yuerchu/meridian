import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { ArrowLeft } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'
import { SettingsHeader } from './primitives'

/**
 * A settings screen with a way back out of it.
 *
 * Only ever rendered on a narrow screen: where the list sits beside its detail
 * there is nothing to return to, and a back button there would be a control
 * that undoes nothing. Callers branch on that themselves rather than passing a
 * flag, so the button is simply absent from the desktop tree.
 *
 * The label is text, not an icon alone. Partly because the settings tests find
 * it that way, but mostly because "Back" beside an arrow survives a glance in a
 * dense form better than an arrow on its own.
 *
 * Replaces three hand-written versions of this row that had already drifted
 * apart — different icons, different sizes, different muted shades.
 */
export function SettingsSubPage({
  title,
  subtitle,
  onBack,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  onBack: () => void
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div data-slot="settings-subpage" className={cn('space-y-4', className)} {...props}>
      <div data-slot="settings-subpage-bar" className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onBack}
          // `-ms-2` pulls the ghost button's own padding back to the content
          // edge, so the label lines up with the form below it.
          className="-ms-2 h-9 gap-1 rounded-lg px-2 text-sm font-normal text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('common.back')}
        </Button>
        {actions && <div className="ms-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {title && <SettingsHeader title={title} subtitle={subtitle} />}
      {children}
    </div>
  )
}
