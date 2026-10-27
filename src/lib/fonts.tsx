import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type FontSlot = 'sans' | 'mono'

// Read by the pre-paint script in index.html as well; the two must agree.
export const STORAGE_KEY_SANS = 'meridian-font-sans'
export const STORAGE_KEY_MONO = 'meridian-font-mono'

const UNSAFE = /["';{}\\\n\r]/

export function isSafeFamilyName(name: string): boolean {
  if (name.length < 1 || name.length > 120) return false
  if (name !== name.trim()) return false
  if (name.startsWith('@')) return false
  if (UNSAFE.test(name)) return false
  return true
}

export function asStoredFamily(raw: string | null): string | null {
  if (raw === null) return null
  if (raw === '') return null
  if (!isSafeFamilyName(raw)) return null
  return raw
}

export function cssStack(slot: FontSlot, family: string): string {
  const fallback = slot === 'sans' ? '--font-inter-fallback' : '--font-mono-source-fallback'
  return `"${family}", var(${fallback})`
}

export function applySlot(slot: FontSlot, family: string | null): void {
  const prop = slot === 'sans' ? '--font-inter' : '--font-mono-source'
  if (family === null) {
    document.documentElement.style.removeProperty(prop)
    return
  }
  document.documentElement.style.setProperty(prop, cssStack(slot, family))
}

function persist(key: string, family: string | null): void {
  if (family === null) {
    localStorage.removeItem(key)
    return
  }
  localStorage.setItem(key, family)
}

type FontsContextValue = {
  sans: string | null
  mono: string | null
  setSans: (family: string | null) => void
  setMono: (family: string | null) => void
}

const FontsContext = createContext<FontsContextValue | null>(null)

export function FontProvider({ children }: { children: ReactNode }) {
  const [sans, setSansState] = useState<string | null>(() => asStoredFamily(localStorage.getItem(STORAGE_KEY_SANS)))
  const [mono, setMonoState] = useState<string | null>(() => asStoredFamily(localStorage.getItem(STORAGE_KEY_MONO)))

  useEffect(() => {
    applySlot('sans', sans)
  }, [sans])

  useEffect(() => {
    applySlot('mono', mono)
  }, [mono])

  const setSans = useCallback((next: string | null) => {
    const safe = next === null ? null : asStoredFamily(next)
    persist(STORAGE_KEY_SANS, safe)
    setSansState(safe)
  }, [])

  const setMono = useCallback((next: string | null) => {
    const safe = next === null ? null : asStoredFamily(next)
    persist(STORAGE_KEY_MONO, safe)
    setMonoState(safe)
  }, [])

  const value = useMemo<FontsContextValue>(() => ({ sans, mono, setSans, setMono }), [sans, mono, setSans, setMono])

  return <FontsContext.Provider value={value}>{children}</FontsContext.Provider>
}

export function useAppFonts(): FontsContextValue {
  const value = useContext(FontsContext)
  if (!value) throw new Error('useAppFonts must be used inside <FontProvider>')
  return value
}
