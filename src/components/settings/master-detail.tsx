import './master-detail.css'
import { useCallback, useLayoutEffect, useRef } from 'react'

import { SettingsHeader } from './primitives'
import { SettingsSubPage } from './settings-subpage'
import type { MasterDetailNav } from './use-master-detail'

/**
 * Keeps the list where it was while a detail is open over it.
 *
 * Both layouts share the settings page's one scroller, so a drilldown does not
 * get its own scroll position — it inherits whatever the list had. Open a
 * provider from halfway down and the editor started halfway down too; come back
 * and the list had been clamped to whatever height the shorter detail allowed,
 * so the row that was just being edited was somewhere else entirely.
 *
 * Layout effect, not an effect: this runs against the tree that is replacing the
 * other one, and a frame at the wrong offset is exactly the jump being removed.
 */
function useDrilldownScroll(root: HTMLElement | null, showsDetail: boolean) {
  const savedRef = useRef(0)
  const wasShowing = useRef(showsDetail)

  useLayoutEffect(() => {
    if (wasShowing.current === showsDetail) return
    wasShowing.current = showsDetail
    const scroller = root?.closest<HTMLElement>('[data-slot="settings-scroller"]')
    if (!scroller) return

    if (showsDetail) {
      savedRef.current = scroller.scrollTop
      scroller.scrollTop = 0
      return
    }
    // The list is back but has not been measured yet, so the assignment would be
    // clamped against the detail's height. One frame later it is the list's.
    requestAnimationFrame(() => {
      scroller.scrollTop = savedRef.current
    })
  }, [root, showsDetail])
}

/** Moves focus with the narrow-screen navigation and returns it to its row. */
function useDrilldownFocus(root: HTMLElement | null, showsDetail: boolean) {
  const wasShowing = useRef(showsDetail)
  const returnKey = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (wasShowing.current === showsDetail) return
    wasShowing.current = showsDetail
    if (!root) return

    if (showsDetail) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnKey.current = active?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null
      const frame = requestAnimationFrame(() => {
        const heading = root.querySelector<HTMLElement>('[data-slot="settings-subpage"] h2')
        const target = heading ?? root.querySelector<HTMLElement>('[data-slot="settings-subpage-back"]')
        if (heading) heading.tabIndex = -1
        target?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }

    const frame = requestAnimationFrame(() => {
      const key = returnKey.current
      const row = key
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-key]')).find(
            (candidate) => candidate.dataset.key === key,
          )
        : null
      const heading = root.querySelector<HTMLElement>('h2')
      if (heading) heading.tabIndex = -1
      const target = row ?? heading
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [root, showsDetail])
}

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
  headerPlacement = 'list',
  list,
  detail,
  detailTitle,
  emptyDetail,
  aux,
  auxTitle,
  emptyState,
  className,
}: {
  nav: MasterDetailNav<Aux>
  title: React.ReactNode
  actions?: React.ReactNode
  /**
   * Where the heading sits on a desktop: above the left column, or spanning
   * both. Also explicit rather than unified — the two callers look different
   * today and neither difference is worth a visual change to settle.
   */
  headerPlacement?: 'list' | 'top'
  list: React.ReactNode
  detail?: React.ReactNode
  detailTitle?: React.ReactNode
  /** Shown in the right column when nothing is selected. */
  emptyDetail?: React.ReactNode
  /** Import panels and creation forms — above the columns, not instead of them. */
  aux?: React.ReactNode
  auxTitle?: React.ReactNode
  /** Replaces the columns entirely, for "nothing configured yet". */
  emptyState?: React.ReactNode
  className?: string
}) {
  const atTop = headerPlacement === 'top'

  // The probe's node, kept so the scroller above it can be found. One callback
  // feeding both: `nav.ref` decides the layout, this decides where it starts.
  const rootRef = useRef<HTMLElement | null>(null)
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      nav.ref(node)
    },
    [nav],
  )
  useDrilldownScroll(rootRef.current, nav.showsDetail)
  useDrilldownFocus(rootRef.current, nav.isNarrow && nav.showsDetail)

  return (
    // One root, unconditionally — this is the box `nav.ref` measures, and a node
    // that is torn down whenever the answer changes would start again from no
    // measurement each time it flipped. Its width comes from the parent and
    // never from what is rendered inside it, so the observer cannot be fed its
    // own output. The three layouts differ below this line.
    <div
      data-slot="master-detail"
      ref={setRoot}
      className={className ? `m-master-detail ${className}` : 'm-master-detail'}
    >
      {nav.isNarrow ? (
        nav.showsDetail ? (
          <SettingsSubPage title={nav.aux !== null ? auxTitle : detailTitle} onBack={nav.back}>
            {nav.aux !== null ? aux : detail}
          </SettingsSubPage>
        ) : (
          <div data-slot="master-detail-list-page" className="m-master-detail__page">
            <SettingsHeader title={title} actions={actions} />
            {emptyState ?? (
              <div data-slot="master-detail-list" className="m-master-detail__list">
                {list}
              </div>
            )}
          </div>
        )
      ) : (
        <div data-slot="master-detail-wide" className="m-master-detail__wide">
          {atTop && <SettingsHeader title={title} actions={actions} />}
          {aux}
          {emptyState ?? (
            <div
              data-slot="master-detail-columns"
              className="m-master-detail__columns"
              data-spaced={atTop ? undefined : true}
            >
              <div data-slot="master-detail-list-column" className="m-master-detail__column">
                {!atTop && <SettingsHeader title={title} actions={actions} className="m-master-detail__heading" />}
                {list}
              </div>
              {/* The editor's queries resolve against this column, not against
                  the settings layer: two columns at 560px leaves 352px here,
                  and 208px of that width is one the editor never sees. */}
              <div data-slot="master-detail-detail-column" className="m-master-detail__detail">
                {detail ?? (
                  <div data-slot="master-detail-empty-detail" className="m-master-detail__empty">
                    {emptyDetail}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
