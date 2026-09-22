import { useTranslation } from 'react-i18next'
import { Button } from '@/components/base'
import { ArrowLeft } from '@gravity-ui/icons'
import { cx } from '@/utils/cx'
import { SettingsHeader } from './primitives'
import { useSettingsLevel } from './settings-stack'

/**
 * Three widths, all centred by the page below and all under the one cap the
 * settings column carries (`--container-settings`).
 *
 * `wide` went from `3xl` to `4xl` when the model list became a table: five
 * columns in 768px left the model's own name about thirty characters, and a
 * wire id like `anthropic/claude-sonnet-5-20260514` is then truncated on every
 * row — the column that identifies the row is the worst place to spend the
 * shortage.
 */
const WIDTH = {
  /** An editor. boardui's settings column, and what most panels want. */
  narrow: 'max-w-lg',
  /** A list, or a table with a few columns beside each row. */
  wide: 'max-w-4xl',
  /** The full column: a table wide enough to need it. */
  full: 'max-w-settings',
} as const

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
 * `@container/pane` is declared here, on the element that also carries the
 * width, so a grid inside resolves against the box it is actually in. Note that
 * `container-type` implies `contain: layout`, which makes this the containing
 * block for any `position: fixed` descendant — the footer below is `sticky`,
 * which is positioned against the scroller instead and so is unaffected.
 */
export function SettingsPage({
  title,
  subtitle,
  actions,
  width = 'narrow',
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  width?: keyof typeof WIDTH
  /** Draft-and-save pages only: a bar that stays put at the bottom. */
  footer?: React.ReactNode
}) {
  const { t } = useTranslation()
  const { index, pop } = useSettingsLevel()
  return (
    <div
      data-slot="settings-page"
      className={cx('@container/pane mx-auto flex w-full flex-col gap-6', WIDTH[width], className)}
      {...props}
    >
      {index > 0 && (
        <div data-slot="settings-page-bar" className="flex items-center gap-2">
          <Button
            data-slot="settings-page-back"
            variant="ghost"
            onPress={() => void pop()}
            // `-ms-2` pulls the ghost button's own padding back to the content
            // edge, so the label lines up with the form below it.
            className="-ms-2 h-9 gap-1 rounded-lg px-2 text-body-regular text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="size-4" />
            {t('common.back')}
          </Button>
        </div>
      )}
      <SettingsHeader title={title} subtitle={subtitle} actions={actions} />
      <div data-slot="settings-page-body" className="flex flex-col gap-6">
        {children}
      </div>
      {footer && <SettingsPageFooter>{footer}</SettingsPageFooter>}
    </div>
  )
}

/**
 * Save, and whatever goes beside it, kept in reach.
 *
 * `sticky`, not `fixed`: a sticky inset is measured from the scrollport, so it
 * rides above the home indicator while the sheet scrolls and comes to rest in
 * the flow at the bottom of the page. `ActionBar` had to be portalled to the
 * body precisely because it was `fixed` inside a container — this is the same
 * bar without that problem.
 */
export function SettingsPageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-page-footer"
      className={cx(
        'sticky bottom-[var(--safe-bottom,0px)] z-10 mt-2 flex items-center gap-2',
        'rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2 shadow-dropdown',
        className,
      )}
      {...props}
    />
  )
}
