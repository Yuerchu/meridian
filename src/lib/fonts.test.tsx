import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  applySlot,
  asStoredFamily,
  cssStack,
  FontProvider,
  isSafeFamilyName,
  STORAGE_KEY_SANS,
  useAppFonts,
} from './fonts'

describe('isSafeFamilyName', () => {
  it('accepts an ordinary family and rejects injection, untrimmed names, a leading @, and overlong names', () => {
    expect(isSafeFamilyName('Segoe UI')).toBe(true)
    expect(isSafeFamilyName('Microsoft YaHei UI')).toBe(true)
    expect(isSafeFamilyName('; color: red')).toBe(false)
    expect(isSafeFamilyName('Comic "Sans"')).toBe(false)
    expect(isSafeFamilyName('x;}')).toBe(false)
    expect(isSafeFamilyName(' Segoe')).toBe(false)
    expect(isSafeFamilyName('@SimSun')).toBe(false)
    expect(isSafeFamilyName('a'.repeat(121))).toBe(false)
    expect(isSafeFamilyName('')).toBe(false)
  })
})

describe('asStoredFamily', () => {
  it('turns empty and unsafe values into system', () => {
    expect(asStoredFamily(null)).toBeNull()
    expect(asStoredFamily('')).toBeNull()
    expect(asStoredFamily(';color:red')).toBeNull()
    expect(asStoredFamily('Cascadia Code')).toBe('Cascadia Code')
  })
})

describe('cssStack', () => {
  it('quotes the chosen family and keeps the CSS fallback variable', () => {
    expect(cssStack('sans', 'Segoe UI')).toBe('"Segoe UI", var(--font-sans-fallback)')
    expect(cssStack('mono', 'Cascadia Code')).toBe('"Cascadia Code", var(--font-mono-fallback)')
  })
})

describe('applySlot', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-sans')
    document.documentElement.style.removeProperty('--font-mono')
  })

  it('sets the stack and removes it for system', () => {
    applySlot('sans', 'Microsoft YaHei UI')
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(
      '"Microsoft YaHei UI", var(--font-sans-fallback)',
    )
    applySlot('sans', null)
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('')
  })
})

function Probe() {
  const { sans, setSans } = useAppFonts()
  return (
    <button type="button" onClick={() => setSans('Segoe UI')}>
      {sans ?? 'system'}
    </button>
  )
}

describe('FontProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty('--font-sans')
  })

  it('reads a stored family and persists a change', async () => {
    localStorage.setItem(STORAGE_KEY_SANS, 'Microsoft YaHei UI')
    const user = userEvent.setup()
    render(
      <FontProvider>
        <Probe />
      </FontProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Microsoft YaHei UI')
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('Segoe UI')
    expect(localStorage.getItem(STORAGE_KEY_SANS)).toBe('Segoe UI')
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('"Segoe UI", var(--font-sans-fallback)')
  })

  it('treats a junk stored value as system', () => {
    localStorage.setItem(STORAGE_KEY_SANS, '"; color: red')
    render(
      <FontProvider>
        <Probe />
      </FontProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('system')
  })
})
