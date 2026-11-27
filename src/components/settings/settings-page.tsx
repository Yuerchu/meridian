import './settings-page.css'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ArrowLeft } from '@keyline-icons/react/two-tone'
import { SettingsHeader, type SettingsWidth } from './primitives'
import { useSettingsLevel } from './settings-stack'

/**
 * One page of settings, with a way back out of it when there is one.
 *
 * The back bar draws itself from the stack rather than from a prop: a page
 * knows what it is, and whether it has something underneath it is the stack's
 * business. Outside a stack the level is zero and no bar appears, which is what
 * every panel that has not moved over yet still sees.
 *
 * The label is text beside the arrow rather than an arrow alone. Partly because
 * the settings tests find it that way, but mostly because "Back" survives a
 * glance in a dense form better than a glyph does.
 *
 * The named `pane` container lives on the element that also carries the width,
 * so a grid inside resolves against the box it is actually in. Note that
 * `container-type` implies `contain: layout`, which makes this the containing
 * block for any `position: fixed` descendant.
 */
export function SettingsPage({
  title,
  subtitle,
  actions,
  footer,
  width = 'default',
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  /** Draft-and-save pages only: the action row after the form. */
  footer?: React.ReactNode
  width?: SettingsWidth
}) {
  const { t } = useTranslation()
  const { index, pop } = useSettingsLevel()
  return (
    <div
      data-slot="settings-page"
      data-width={width === 'wide' ? 'wide' : undefined}
      className={['m-settings-page', className].filter(Boolean).join(' ')}
      {...props}
    >
      {index > 0 && (
        <div data-slot="settings-page-bar" className="m-settings-page__bar">
          <Button
            icon={<ArrowLeft />}
            data-slot="settings-page-back"
            variant="ghost"
            size="sm"
            onPress={() => void pop()}
          >
            {t('common.back')}
          </Button>
        </div>
      )}
      <SettingsHeader title={title} subtitle={subtitle} actions={actions} />
      <div data-slot="settings-page-body" className="m-settings-page__body">
        {children}
      </div>
      {footer && <SettingsPageFooter>{footer}</SettingsPageFooter>}
    </div>
  )
}

/**
 * Save, and whatever goes beside it, at the end of the form.
 *
 * A plain row, the way the provider editor's Save and the registry's settings
 * pages draw their buttons. It used to be a sticky card (border, radius,
 * `shadow-dropdown`) floating over the form: a card holding nothing but two
 * buttons, drawn over whichever section was underneath, and one more card on
 * a page already made of them. Leaving with unsaved changes is caught by the
 * page's dirty guard, which is what the bar being always in reach was for.
 */
export function SettingsPageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-page-footer"
      className={['m-settings-page__footer', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
