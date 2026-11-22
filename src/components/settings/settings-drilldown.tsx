import { useState } from 'react'
import { Dialog } from '@/components/yuerchu-ui/components/dialog/dialog'

import { useIsMobile } from '@/hooks/use-mobile'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { SettingsNavRow } from './primitives'
import './settings-drilldown.css'

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
  // The viewport, deliberately, and not the measured container `MasterDetail`
  // moved to: the two branches below share no box to measure — the narrow one
  // is a row plus a portal — so there is nothing to hang a probe on. And the
  // pane this sits in is capped at `max-w-settings`, so the two rulers only disagree
  // in a range where either answer reads fine. Not an oversight.
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const pushes = isMobile

  useHistoryLevel(pushes && open, () => setOpen(false))

  if (!pushes) {
    return (
      <section data-slot="settings-drilldown" className="m-drilldown__inline">
        <h3 data-slot="settings-drilldown-title" className="m-drilldown__title">
          {title}
        </h3>
        {children}
      </section>
    )
  }

  // The library's full-size Dialog, not a page of our own: it draws its heading
  // and a close button where the old screen had a back bar, and in exchange
  // owns the focus trap, the scroll lock and the way back. The back gesture is
  // still `useHistoryLevel`'s.
  return (
    <>
      <SettingsNavRow label={title} value={summary} onPress={() => setOpen(true)} />
      <Dialog heading={title} size="full" isOpen={open} onOpenChange={setOpen} className="m-drilldown">
        <div data-slot="settings-drilldown-body" className="m-drilldown__body">
          {children}
        </div>
      </Dialog>
    </>
  )
}
