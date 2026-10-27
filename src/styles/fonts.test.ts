import { readFileSync } from 'node:fs'

/**
 * The font chain is three files agreeing on names, and every link fails
 * silently: a variable nobody reads, or a later file that redefines
 * `--font-sans`, all end in the system font with no error anywhere.
 * `css: false` means no test renders a glyph, so the text is what is checked.
 *
 *   theme.css         --font-sans: var(--font-inter), …   (vendored, not edited)
 *   fonts.css         --font-inter: var(--font-inter-fallback)  + the OS stacks
 *   meridian.css      must not redefine --font-sans / --font-mono over the top
 *
 * A chosen family is prepended by `src/lib/fonts.tsx`; this file only pins the
 * CSS default.
 */
const read = (path: string) => readFileSync(path, 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const theme = stripComments(read('src/styles/theme.css'))
const fonts = stripComments(read('src/styles/fonts.css'))

function rootVariable(name: string): string {
  const root = /:root\s*\{([^}]*)\}/.exec(fonts)?.[1] ?? ''
  return new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim() ?? ''
}

describe('font chain', () => {
  it('theme.css still reads the two variables fonts.css defines', () => {
    expect(theme).toMatch(/--font-sans:\s*var\(--font-inter\)/)
    expect(theme).toMatch(/--font-mono:\s*var\(--font-mono-source\)/)
  })

  it('ships no @font-face', () => {
    expect(fonts).not.toMatch(/@font-face/)
  })

  it('the product stacks are the fallback variables, generic family last', () => {
    expect(rootVariable('--font-inter')).toBe('var(--font-inter-fallback)')
    expect(rootVariable('--font-mono-source')).toBe('var(--font-mono-source-fallback)')
    const sans = rootVariable('--font-inter-fallback')
    const mono = rootVariable('--font-mono-source-fallback')
    expect(sans).toMatch(/sans-serif\s*$/)
    expect(mono).toMatch(/monospace\s*$/)
    expect(sans).toMatch(/system-ui/)
    expect(mono).toMatch(/ui-monospace/)
  })

  it('nothing after theme.css replaces --font-sans or --font-mono outright', () => {
    // A later `@theme` that sets either one wins, and the variables above stop
    // being read at all — which is exactly what meridian.css did before this file.
    const meridian = stripComments(read('src/styles/meridian.css'))
    expect(meridian.match(/--font-(sans|mono)\s*:[^;]*;/g) ?? []).toEqual([])
  })
})
