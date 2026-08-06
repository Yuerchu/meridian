import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTheme } from '@heroui/react'
// highlight.js ships one stylesheet per theme, both writing bare `.hljs*`
// selectors with no way to scope them from the outside — `@import`ing both into
// index.css would leave the last one winning in either theme. Pulled in as text
// so the pair can be swapped at runtime instead, which keeps the rules upstream's
// rather than copied into ours. Under the dark sheet a light code block renders
// pale blue on near-white: a contrast ratio of 1.0.
import hljsLight from 'highlight.js/styles/github.css?inline'
import hljsDark from 'highlight.js/styles/github-dark.css?inline'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

// `useTheme` persists to `localStorage['heroui-theme']` and resolves `system`
// through `(prefers-color-scheme: dark)`. The inline script in index.html reads
// the same two — change one and the other has to follow.

const SCHEMES: readonly ResolvedTheme[] = ['light', 'dark']

const HLJS_STYLES: Record<ResolvedTheme, string> = { light: hljsLight, dark: hljsDark }

/**
 * Narrows whatever is in storage to the three settings the app offers. The hook
 * itself accepts any theme name; the inline script in index.html narrows the
 * same way, so both sides agree on what a junk value means.
 */
function asPreference(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/**
 * Keeps both highlight.js sheets parsed and flips which one applies. `media`
 * rather than adding and removing the element: switching back is then a flag
 * change, not a re-parse, and neither sheet can win by insertion order.
 */
function applyHighlightTheme(resolved: ResolvedTheme) {
  for (const scheme of SCHEMES) {
    const id = `hljs-theme-${scheme}`
    let style = document.getElementById(id) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = id
      style.textContent = HLJS_STYLES[scheme]
      document.head.append(style)
    }
    style.media = scheme === resolved ? 'all' : 'not all'
  }
}

type ThemeContextValue = {
  /** The stored intent — may be `system`. */
  theme: ThemePreference
  /** What is actually on `<html>`; undefined only before the first layout effect. */
  resolvedTheme: ResolvedTheme | undefined
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Wraps HeroUI's `useTheme` so the whole app shares one instance of it: the hook
 * keeps its intent in component state, so two callers would drift apart the
 * moment one of them switched.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const preference = asPreference(theme)
  const resolved = resolvedTheme === 'light' || resolvedTheme === 'dark' ? resolvedTheme : undefined
  const strandedClassCleared = useRef(false)

  // Runs after the hook's own layout effect — it is declared first, so it has
  // already written to `<html>` by the time this one fires.
  useLayoutEffect(() => {
    if (!resolved) return

    // `useTheme` tracks the last class *it* wrote, starting from nothing, so its
    // first write only adds. The inline script in index.html has already put a
    // class there; when the two disagree — a stored `light` under a dark OS, or
    // an OS flip between the script and mount — both survive, and
    // `@custom-variant dark (&:is(.dark *))` goes on matching the stale one.
    // Drop the loser once, and only once: after this the hook's own bookkeeping
    // is correct and doing it again would fight it.
    if (!strandedClassCleared.current) {
      strandedClassCleared.current = true
      document.documentElement.classList.remove(resolved === 'dark' ? 'light' : 'dark')
    }

    applyHighlightTheme(resolved)
  }, [resolved])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: preference, resolvedTheme: resolved, setTheme }),
    [preference, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useAppTheme must be used inside <ThemeProvider>')
  return value
}
