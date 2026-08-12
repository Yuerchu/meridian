import { useCallback, useMemo, useState } from 'react'

import { useIsMobile } from '@/hooks/use-mobile'
import { useHistoryLevel } from '@/hooks/use-nav'

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
  isMobile: boolean
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
  back: () => void
}

export function useMasterDetail<Aux extends string = never>(): MasterDetailNav<Aux> {
  const isMobile = useIsMobile()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aux, setAux] = useState<Aux | null>(null)

  const openItem = useCallback((id: string) => {
    setAux(null)
    setSelectedId(id)
  }, [])

  const openAux = useCallback((name: Aux) => {
    setAux(name)
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const back = useCallback(() => {
    // Aux sits on top of a selection when both are set, so it unwinds first.
    setAux((current) => {
      if (current !== null) return null
      setSelectedId(null)
      return null
    })
  }, [])

  const showsDetail = isMobile && (selectedId !== null || aux !== null)

  // Claims a history entry for the detail, so the hardware back key returns to
  // the list before it leaves settings. Inert on a desktop, where `showsDetail`
  // can never be true.
  useHistoryLevel(showsDetail, back)

  return useMemo(() => ({
    isMobile,
    selectedId,
    aux,
    showsDetail,
    showsList: !isMobile || !showsDetail,
    openItem,
    openAux,
    select,
    back,
  }), [isMobile, selectedId, aux, showsDetail, openItem, openAux, select, back])
}
