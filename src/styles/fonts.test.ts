import { readFileSync } from 'node:fs'

/**
 * The font chain is four files agreeing on names and on an order, and every
 * link fails silently: a variable nobody reads, or a later file that redefines
 * `--font-sans`, all end in some other typeface with no error anywhere.
 * `css: false` means no test renders a glyph, so the text is what is checked.
 *
 *   yuerchu-ui tokens.css   --font-sans / --font-mono (the library's families),
 *                           read by every --text-* composite
 *   fonts.css               the same two names, over the top, as the OS stacks
 *   index.css               imports the library first, fonts.css after it
 *   index.html, fonts.tsx   write a chosen family inline as
 *                           `--font-sans: "Family", var(--font-sans-fallback)`
 */
const read = (path: string) => readFileSync(path, 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const library = stripComments(read('src/components/yuerchu-ui/styles/tokens.css'))
const fonts = stripComments(read('src/styles/fonts.css'))
const entry = stripComments(read('src/index.css'))

function rootVariable(name: string): string {
  const root = /:root\s*\{([^}]*)\}/.exec(fonts)?.[1] ?? ''
  return new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim() ?? ''
}

describe('font chain', () => {
  it('the library still names its families in the two variables fonts.css replaces', () => {
    expect(library).toMatch(/--font-sans:/)
    expect(library).toMatch(/--font-mono:/)
    expect(library).toMatch(/--text-body:[^;]*var\(--font-sans\)/)
  })

  it('fonts.css sits in the library tokens layer, so it wins by order rather than by escaping the layer', () => {
    expect(fonts).toMatch(/@layer theme\s*\{\s*:root\s*\{/)
  })

  it('index.css imports the library before fonts.css, and meridian.css after', () => {
    const library = entry.indexOf("@import './components/yuerchu-ui/styles/index.css'")
    const own = entry.indexOf("@import './styles/fonts.css'")
    const app = entry.indexOf("@import './styles/meridian.css'")
    expect(library).toBeGreaterThanOrEqual(0)
    expect(own).toBeGreaterThan(library)
    expect(app).toBeGreaterThan(own)
  })

  it('ships no @font-face', () => {
    expect(fonts).not.toMatch(/@font-face/)
  })

  it('the product stacks are the fallback variables, generic family last', () => {
    expect(rootVariable('--font-sans')).toBe('var(--font-sans-fallback)')
    expect(rootVariable('--font-mono')).toBe('var(--font-mono-fallback)')
    const sans = rootVariable('--font-sans-fallback')
    const mono = rootVariable('--font-mono-fallback')
    expect(sans).toMatch(/sans-serif\s*$/)
    expect(mono).toMatch(/ui-monospace/)
    expect(sans).toMatch(/system-ui/)
    expect(mono).toMatch(/monospace\s*$/)
  })

  it('nothing after fonts.css replaces --font-sans or --font-mono outright', () => {
    const meridian = stripComments(read('src/styles/meridian.css'))
    expect(meridian.match(/--font-(sans|mono)\s*:[^;]*;/g) ?? []).toEqual([])
  })

  it('the pre-paint script writes the same variables fonts.tsx does', () => {
    const html = read('index.html')
    expect(html).toContain("apply('meridian-font-sans', '--font-sans', '--font-sans-fallback')")
    expect(html).toContain("apply('meridian-font-mono', '--font-mono', '--font-mono-fallback')")
  })
})
