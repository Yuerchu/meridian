import './settings-subpage.css'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ArrowLeft } from '@keyline-icons/react/two-tone'
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
  onBack,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title?: React.ReactNode
  onBack: () => void
}) {
  const { t } = useTranslation()

  return (
    // A `pane` container, like `SettingsPane` and the detail column: the same
    // editor renders in all three, and this is the width it gets in this one.
    <div
      data-slot="settings-subpage"
      className={['m-settings-subpage', className].filter(Boolean).join(' ')}
      {...props}
    >
      <div data-slot="settings-subpage-bar" className="m-settings-subpage__bar">
        <Button icon={<ArrowLeft />} data-slot="settings-subpage-back" variant="ghost" size="sm" onPress={onBack}>
          {t('common.back')}
        </Button>
      </div>
      {title && <SettingsHeader title={title} />}
      {children}
    </div>
  )
}
