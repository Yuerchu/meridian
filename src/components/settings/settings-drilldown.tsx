import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@/components/base'
import { ArrowLeft } from '@keyline-icons/react/two-tone'

import { useIsMobile } from '@/hooks/use-mobile'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { SettingsNavRow } from './primitives'

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
  children,
}: {
  title: React.ReactNode
  /** The current value, shown on the row that opens it. */
  summary?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  // The viewport, deliberately, and not the measured container `MasterDetail`
  // moved to: the two branches below share no box to measure — the narrow one
  // is a row plus a portal — so there is nothing to hang a probe on. And the
  // pane this sits in is capped at `max-w-lg`, so the two rulers only disagree
  // in a range where either answer reads fine. Not an oversight.
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const pushes = isMobile

  useHistoryLevel(pushes && open, () => setOpen(false))

  if (!pushes) {
    return (
      // Both branches are `pane` containers, because a grid inside `children`
      // has to resolve against whichever of the two it landed in — and the one
      // below is portalled to `body`, so it is not even a descendant of the
      // pane that rendered it.
      <section data-slot="settings-drilldown" className="@container/pane space-y-2">
        <h3 data-slot="settings-drilldown-title" className="text-body-medium">
          {title}
        </h3>
        {children}
      </section>
    )
  }

  return (
    <>
      <SettingsNavRow label={title} value={summary} onPress={() => setOpen(true)} />
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="full">
          <Modal.Dialog data-slot="settings-drilldown-page" className="p-0">
            <div data-slot="settings-drilldown-frame" className="flex h-full flex-col">
              <div
                data-slot="settings-drilldown-bar"
                className="flex shrink-0 items-center gap-2 border-b border-border-button-default px-1 pt-[var(--safe-top)]"
              >
                <Button
                  variant="secondary"
                  onPress={() => setOpen(false)}
                  className="h-10 gap-1 rounded-xl px-2 text-body-regular text-text-secondary hover:text-text-primary"
                >
                  <ArrowLeft className="size-4" />
                  {t('common.back')}
                </Button>
                <Modal.Heading className="min-w-0 flex-1 truncate text-body-medium">{title}</Modal.Heading>
              </div>
              <div
                data-slot="settings-drilldown-body"
                className="@container/pane flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,var(--safe-bottom))]"
              >
                {children}
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
