import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@heroui/react'
import { ArrowLeft } from '@gravity-ui/icons'

import { useIsMobile } from '@/hooks/use-mobile'
import { useHistoryLevel } from '@/hooks/use-nav'
import { SettingsRow } from './primitives'

/**
 * A block of settings that is a section on a desktop and a screen on a phone.
 *
 * Some editors have three or four of these — an assistant carries its tools,
 * its emoji packs and its skills — and stacking them all into one narrow column
 * turns the form into a scroll marathon where nothing is findable. Wide enough,
 * they read better side by side, so the desktop keeps them inline.
 *
 * Rendered through a portal when opened, which does *not* move `children` in
 * the React tree: state declared by the surrounding editor keeps working
 * untouched, so nothing has to be lifted to make this work.
 */
export function SettingsDrilldown({
  title,
  summary,
  mode,
  children,
}: {
  title: React.ReactNode
  /** The current value, shown on the row that opens it. */
  summary?: React.ReactNode
  /** Overrides the breakpoint, for a block that should never split out. */
  mode?: 'inline' | 'push'
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const pushes = mode === 'push' || (mode !== 'inline' && isMobile)

  useHistoryLevel(pushes && open, () => setOpen(false))

  if (!pushes) {
    return (
      <section data-slot="settings-drilldown" className="space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {children}
      </section>
    )
  }

  return (
    <>
      <SettingsRow label={title} value={summary} onClick={() => setOpen(true)} />
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="full">
          <Modal.Dialog data-slot="settings-drilldown-page" className="p-0">
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-1 pt-[var(--safe-top)]">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  className="h-10 gap-1 rounded-xl px-2 text-sm font-normal text-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  {t('common.back')}
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
              </div>
              <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,var(--safe-bottom))]">
                {children}
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
