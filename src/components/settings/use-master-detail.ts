import { useCallback, useEffect, useMemo, useState } from 'react'

import { useIsMobile } from '@/hooks/use-mobile'
import { useIsNarrow } from '@/hooks/use-narrow'
import { useHistoryLevel } from '@/hooks/use-history-level'

// The left column at its widest (`w-48`, which MCP asks for), the wider of the
// two gaps (`gap-6`), and 320px for the detail. That last number is a labelled
// `text-xs` field plus the model editor's own `px-3` shell and border — below
// it the list column takes more than it gives back, and the drilldown, which
// hands the detail the whole container, is simply the better layout.
//
// One number rather than one per caller: two panels in the same settings layer
// flipping at different window widths would leave one drilled down while its
// neighbour is still two columns.
//
// What it buys, beyond the 769px window that prompted it: collapsing the
// sidebar to icons now wins two columns back at ~650px, where before this the
// sidebar's own width was invisible to the layout it was squeezing.
const TWO_COLUMN_MIN = 536

/**
 * A list beside its detail on a desktop, one behind the other on a phone.
 *
 * The selection is a single piece of state feeding both layouts, which is what
 * keeps the two honest: there is no "mobile selection" to fall out of step with
 * a "desktop selection", and narrowing the window mid-edit keeps you on the
 * same item. That last one is load-bearing — it is the behaviour the settings
 * test pins down by shrinking the viewport while a provider is open.
 *
 * `aux` is a second kind of detail that is not an item: importing JSON, or a
 * creation form. On a phone it replaces the list like any other detail; on a
 * desktop it does *not*, because there it renders above a list that stays
 * visible. So `showsList` is derived separately rather than being "no detail
 * open".
 *
 * Auto-selecting the first row is left to the caller, at the point where the
 * data lands. Doing it here would need the list threaded in, and the two
 * existing callers disagree anyway: providers open on the first one, MCP
 * servers never do.
 */
export interface MasterDetailNav<Aux extends string = never> {
  /**
   * Too narrow for two columns — which is not the same question as "is this a
   * phone", and is why this is no longer called `isMobile`.
   */
  isNarrow: boolean
  /** Hang this on the box whose width decides the layout. See {@link useIsNarrow}. */
  ref: (node: HTMLElement | null) => void
  selectedId: string | null
  aux: Aux | null
  /** The phone is showing a detail rather than the list. */
  showsDetail: boolean
  /** The list is on screen: always on a desktop, only at the top level here. */
  showsList: boolean
  openItem: (id: string) => void
  openAux: (name: Aux) => void
  /** Sets the selection directly — for falling back after a delete. */
  select: (id: string | null) => void
  back: () => Promise<boolean>
}

export function useMasterDetail<Aux extends string = never>({
  beforeLeave,
}: {
  beforeLeave?: () => boolean | Promise<boolean>
} = {}): MasterDetailNav<Aux> {
  // The viewport is only the fallback. A box that has never been laid out has
  // no width to offer, and there the viewport is the last thing that still
  // knows anything — but once the box answers, it wins: the same 769px window
  // fits two columns with the sidebar collapsed and does not with it open, and
  // the viewport cannot tell those apart.
  const { ref, isNarrow } = useIsNarrow(TWO_COLUMN_MIN, useIsMobile())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aux, setAux] = useState<Aux | null>(null)
  const [historyClaimed, setHistoryClaimed] = useState(true)

  const afterLeaveCheck = useCallback(
    async (action: () => void): Promise<boolean> => {
      if (beforeLeave && !(await beforeLeave())) return false
      action()
      return true
    },
    [beforeLeave],
  )

  const openItem = useCallback(
    (id: string) => {
      if (id === selectedId && aux === null) return
      void afterLeaveCheck(() => {
        setAux(null)
        setSelectedId(id)
      })
    },
    [afterLeaveCheck, aux, selectedId],
  )

  const openAux = useCallback(
    (name: Aux) => {
      if (name === aux) return
      void afterLeaveCheck(() => setAux(name))
    },
    [afterLeaveCheck, aux],
  )

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const back = useCallback(() => {
    return afterLeaveCheck(() => {
      // Aux sits on top of a selection when both are set, so it unwinds first.
      if (aux !== null) setAux(null)
      else setSelectedId(null)
    })
  }, [afterLeaveCheck, aux])

  const showsDetail = isNarrow && (selectedId !== null || aux !== null)

  useEffect(() => {
    // Reset the mirror while there is no level to claim, so the next detail
    // registers in the same render instead of waiting an extra effect pass.
    if (!showsDetail) setHistoryClaimed(true)
  }, [showsDetail])

  const handleHistoryBack = useCallback(() => {
    // The store retires a history level before invoking its dismiss callback.
    // If an unsaved-draft prompt vetoes the navigation, toggle this mirror so
    // useHistoryLevel observes a fresh false→true edge and claims a replacement
    // entry instead of letting the next Back escape past the still-open detail.
    setHistoryClaimed(false)
    void back().then((closed) => {
      if (!closed) requestAnimationFrame(() => setHistoryClaimed(true))
    })
  }, [back])

  // Claims a history entry for the detail, so the hardware back key returns to
  // the list before it leaves settings. Inert while there is room for two
  // columns, where `showsDetail` can never be true.
  useHistoryLevel(showsDetail && historyClaimed, handleHistoryBack)

  return useMemo(
    () => ({
      isNarrow,
      ref,
      selectedId,
      aux,
      showsDetail,
      showsList: !isNarrow || !showsDetail,
      openItem,
      openAux,
      select,
      back,
    }),
    [isNarrow, ref, selectedId, aux, showsDetail, openItem, openAux, select, back],
  )
}
