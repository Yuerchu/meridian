import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createTokenReader } from './token-reader'

// From disk rather than through `tokens.ts`: vitest runs with `css: false`,
// which empties a stylesheet's `?raw` import. Same files, same order.
const STYLES = resolvePath(process.cwd(), 'src', 'styles')
const { declared, overriddenInDark, resolve, tokenNames } = createTokenReader(
  ['theme.css', 'typography.css', 'meridian.css', 'globals.css'].map((file) => [
    file,
    readFileSync(resolvePath(STYLES, file), 'utf8'),
  ]),
)

/**
 * The foundations page shows nothing it did not read out of the stylesheets, so
 * a parser that quietly stopped finding declarations would leave it blank and
 * still look like a page. These pin the reader to what the files say.
 */
describe('gallery tokens', () => {
  it('finds the semantic layers the page groups by', () => {
    expect(tokenNames(/^--color-text-/).length).toBeGreaterThan(5)
    expect(tokenNames(/^--color-background-/).length).toBeGreaterThan(5)
    expect(tokenNames(/^--shadow-/)).toContain('--shadow-card')
    expect(tokenNames(/^--color-bubble-/)).toEqual(
      expect.arrayContaining(['--color-bubble-user', '--color-bubble-assistant']),
    )
  })

  it('skips the @theme inline re-export that names itself', () => {
    // theme.css declares `--color-text-primary` in `:root` and re-exports it as
    // `var(--color-text-primary)`; taking the second would resolve to nothing.
    expect(declared('--color-text-primary', 'light')?.value).not.toBe('var(--color-text-primary)')
  })

  it('resolves each theme through its own declarations', () => {
    const light = resolve('--color-bubble-assistant', 'light')
    const dark = resolve('--color-bubble-assistant', 'dark')
    expect(light.chain).toContain('--color-neutral-200')
    expect(dark.chain).toContain('--color-neutral-700')
    expect(light.css).not.toBe(dark.css)
  })

  it('takes the dark elevations from the .dark block', () => {
    expect(overriddenInDark('--shadow-card')).toBe(true)
    expect(resolve('--shadow-card', 'dark').css).not.toBe(resolve('--shadow-card', 'light').css)
  })

  it('reads the composite type scale with its line heights', () => {
    expect(tokenNames(/^--text-body-regular$/)).toEqual(['--text-body-regular'])
    expect(declared('--text-body-regular--line-height', 'light')).toBeDefined()
  })
})
