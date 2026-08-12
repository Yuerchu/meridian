import { cn } from '@/lib/utils'
import { SettingsHeader } from './primitives'
import { SettingsSubPage } from './settings-subpage'
import type { MasterDetailNav } from './use-master-detail'

/**
 * Renders {@link MasterDetailNav} as two columns or as two screens.
 *
 * Both callers had grown their own copy of this, hand-synchronised and already
 * diverging — different back arrows, different heading weights, and one of them
 * had a state you could enter but not leave. The list and the editor were
 * always shared between the two layouts; only the frame around them was
 * duplicated, so only the frame lives here.
 */
export function MasterDetail<Aux extends string = never>({
  nav,
  title,
  actions,
  listWidth = 'w-44',
  headerPlacement = 'list',
  list,
  detail,
  detailTitle,
  detailActions,
  emptyDetail,
  aux,
  auxTitle,
  emptyState,
  className,
}: {
  nav: MasterDetailNav<Aux>
  title: React.ReactNode
  actions?: React.ReactNode
  /** Left column width. The two callers disagree, so it stays explicit. */
  listWidth?: string
  /**
   * Where the heading sits on a desktop: above the left column, or spanning
   * both. Also explicit rather than unified — the two callers look different
   * today and neither difference is worth a visual change to settle.
   */
  headerPlacement?: 'list' | 'top'
  list: React.ReactNode
  detail?: React.ReactNode
  detailTitle?: React.ReactNode
  detailActions?: React.ReactNode
  /** Shown in the right column when nothing is selected. */
  emptyDetail?: React.ReactNode
  /** Import panels and creation forms — above the columns, not instead of them. */
  aux?: React.ReactNode
  auxTitle?: React.ReactNode
  /** Replaces the columns entirely, for "nothing configured yet". */
  emptyState?: React.ReactNode
  className?: string
}) {
  if (nav.isMobile) {
    if (nav.showsDetail) {
      const showingAux = nav.aux !== null
      return (
        <div data-slot="master-detail" className={cn('max-w-3xl', className)}>
          <SettingsSubPage
            title={showingAux ? auxTitle : detailTitle}
            onBack={nav.back}
            actions={showingAux ? undefined : detailActions}
          >
            {showingAux ? aux : detail}
          </SettingsSubPage>
        </div>
      )
    }
    return (
      <div data-slot="master-detail" className={cn('max-w-3xl space-y-3', className)}>
        <SettingsHeader title={title} actions={actions} />
        {emptyState ?? <div className="space-y-2">{list}</div>}
      </div>
    )
  }

  const atTop = headerPlacement === 'top'
  return (
    <div data-slot="master-detail" className={cn('max-w-3xl space-y-4', className)}>
      {atTop && <SettingsHeader title={title} actions={actions} />}
      {aux}
      {emptyState ?? (
        <div className={cn('flex', atTop ? 'gap-4' : 'gap-6')}>
          <div className={cn('shrink-0 space-y-2', listWidth)}>
            {!atTop && <SettingsHeader title={title} actions={actions} className="mb-3" />}
            {list}
          </div>
          <div className="min-w-0 flex-1">
            {detail ?? <div className="text-sm text-muted">{emptyDetail}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
