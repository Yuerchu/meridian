import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'heroui-theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

function asPreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function applyToDOM(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.setAttribute('data-theme', resolved)
}

type ThemeContextValue = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme | undefined
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => asPreference(localStorage.getItem(STORAGE_KEY)))
  const prefersDark = useMediaQuery(MEDIA_QUERY)

  const resolved: ResolvedTheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

  useEffect(() => {
    applyToDOM(resolved)
  }, [resolved])

  const setTheme = useCallback((next: ThemePreference) => {
    const safe = asPreference(next)
    localStorage.setItem(STORAGE_KEY, safe)
    setPreference(safe)
  }, [])

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
