import type { SettingsTab } from '@/components/settings/tabs'

/**
 * What the window is showing.
 *
 * Two panes on a desktop, where the sidebar is always there and `page` only
 * decides what fills the rest.
 */
export type Page = 'chat' | 'settings'

/**
 * One screen in the mobile stack.
 *
 * A discriminated union rather than `{ name, params }`: forgetting `tab` on a
 * `settingsTab` entry has to be a compile error, and the host's switch can end
 * in `entry satisfies never` so that adding a screen without rendering it fails
 * the build. There is no URL here, so the one thing a flat shape would buy —
 * serialising params into a path — is worth nothing.
 */
export type NavEntry =
  | { readonly name: 'chat' }
  | { readonly name: 'conversations' }
  | { readonly name: 'settings' }
  | { readonly name: 'settingsTab'; readonly tab: SettingsTab }

/** The bottom of the stack, and the only entry that is always present. */
export const ROOT: NavEntry = { name: 'chat' }

/** Never empty: index 0 is always {@link ROOT}. */
export type NavStack = readonly [NavEntry, ...NavEntry[]]

/**
 * A level that exists inside a screen rather than as one of its own.
 *
 * A provider's detail pane, an open drawer, a non-empty selection — each wants
 * the back gesture to undo it before the screen underneath goes away, but none
 * of them belongs in {@link NavEntry}: they are component state, and lifting
 * them into the route would give the desktop two sources of truth for the same
 * selection.
 */
export interface NavGuard {
  /** From `useId()`, so StrictMode's double mount registers once. */
  readonly id: string
  readonly dismiss: () => void
}

export function entryKey(entry: NavEntry): string {
  return entry.name === 'settingsTab' ? `settingsTab:${entry.tab}` : entry.name
}
