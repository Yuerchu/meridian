import { useEffect, useSyncExternalStore } from 'react'

import type { SettingsTab } from './tabs'

const dirtySources = new Map<SettingsTab, Set<string>>()
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSettingsTabDirty(tab: SettingsTab, source: string, dirty: boolean): void {
  const sources = dirtySources.get(tab)
  if (dirty) {
    if (sources?.has(source)) return
    const next = sources ?? new Set<string>()
    next.add(source)
    dirtySources.set(tab, next)
    emitChange()
    return
  }

  if (!sources?.delete(source)) return
  if (sources.size === 0) dirtySources.delete(tab)
  emitChange()
}

export function clearSettingsTabDirty(tab: SettingsTab): void {
  if (!dirtySources.delete(tab)) return
  emitChange()
}

export function isSettingsTabDirty(tab: SettingsTab): boolean {
  return (dirtySources.get(tab)?.size ?? 0) > 0
}

/** Reactive state for the shell that owns tab and Settings-page navigation. */
export function useSettingsTabDirty(tab: SettingsTab): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSettingsTabDirty(tab),
    () => false,
  )
}

/** Register one independently saved editor for as long as its draft is dirty. */
export function useSettingsDirtyRegistration(tab: SettingsTab, source: string, dirty: boolean): void {
  useEffect(() => {
    setSettingsTabDirty(tab, source, dirty)
    return () => setSettingsTabDirty(tab, source, false)
  }, [dirty, source, tab])
}
