import { useTranslation } from 'react-i18next'
import { Hint } from '@/components/ui/hint'
import '@/i18n'

/**
 * Says, in the gutter above the frame where nothing else is drawn, that
 * nothing on screen came from a real backend. Its own root beside the app's,
 * so the app's components do not have to know demo mode exists.
 */
export function DemoBadge() {
  const { t } = useTranslation()
  return (
    <div data-slot="demo-badge-anchor" className="pointer-events-none fixed top-0 right-24 z-50">
      <Hint
        label={t('demo.badgeDescription')}
        data-slot="demo-badge"
        className="pointer-events-auto block h-3 rounded-b-md bg-status-warning-soft px-2 text-caption-2-medium leading-3 text-status-warning-soft-foreground"
      >
        {t('demo.badge')}
      </Hint>
    </div>
  )
}
