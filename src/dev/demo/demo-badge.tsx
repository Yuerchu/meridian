import { useTranslation } from 'react-i18next'
import { Hint } from '@/components/ui/hint'
import '@/i18n'

/**
 * Says, hanging from the top edge above the header's empty right half, that
 * nothing on screen came from a real backend. It takes its type's own line
 * height: squeezed into the 12px gutter (`h-3 leading-3`) the glyphs were
 * cut off at the top of the window. Its own root beside the app's,
 * so the app's components do not have to know demo mode exists.
 */
export function DemoBadge() {
  const { t } = useTranslation()
  return (
    <div data-slot="demo-badge-anchor" className="pointer-events-none fixed top-0 right-24 z-50">
      <Hint
        label={t('demo.badgeDescription')}
        data-slot="demo-badge"
        className="pointer-events-auto block rounded-b-md bg-status-warning-soft px-2 pb-0.5 text-caption-2-medium text-status-warning-soft-foreground"
      >
        {t('demo.badge')}
      </Hint>
    </div>
  )
}
