import { readFileSync } from 'node:fs'

/**
 * The font chain is four files agreeing on names, and every link fails
 * silently: a family nobody declared, a variable nobody reads, or a file the
 * fetch script never writes all end in the system font with no error anywhere.
 * `css: false` means no test renders a glyph, so the text is what is checked.
 *
 *   theme.css         --font-sans: var(--font-inter), …   (vendored, not edited)
 *   fonts.css         --font-inter: 'Inter', 'MiSans', …  + the @font-face rules
 *   fetch-fonts.mjs   writes public/fonts/<file>          what the url()s point at
 *   meridian.css      must not redefine --font-sans / --font-mono over the top
 */
const read = (path: string) => readFileSync(path, 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const theme = stripComments(read('src/styles/theme.css'))
const fonts = stripComments(read('src/styles/fonts.css'))
const fetchScript = read('scripts/fetch-fonts.mjs')

const unquote = (name: string) => name.trim().replace(/^['"]|['"]$/g, '')

function declaredFaces(): { family: string; url: string }[] {
  return [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: unquote(/font-family:\s*([^;]+);/.exec(body)?.[1] ?? ''),
    url: /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1] ?? '',
  }))
}

function rootVariable(name: string): string[] {
  const root = /:root\s*\{([^}]*)\}/.exec(fonts)?.[1] ?? ''
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]
  return value ? value.split(',').map(unquote) : []
}

describe('font chain', () => {
  it('theme.css still reads the two variables fonts.css defines', () => {
    expect(theme).toMatch(/--font-sans:\s*var\(--font-inter\)/)
    expect(theme).toMatch(/--font-mono:\s*var\(--font-mono-source\)/)
  })

  it.each(['--font-inter', '--font-mono-source'])('every family in %s is declared by an @font-face', (name) => {
    const families = rootVariable(name)
    expect(families.length).toBeGreaterThan(0)
    const declared = new Set(declaredFaces().map((face) => face.family))
    for (const family of families) expect(declared).toContain(family)
  })

  it('every @font-face url is a file the fetch script writes', () => {
    const written = new Set([...fetchScript.matchAll(/\bto:\s*'([^']+)'/g)].map(([, to]) => `/fonts/${to}`))
    for (const face of declaredFaces()) expect(written).toContain(face.url)
  })

  it('nothing after theme.css replaces --font-sans or --font-mono outright', () => {
    // A later `@theme` that sets either one wins, and the variables above stop
    // being read at all — which is exactly what meridian.css did before this file.
    const meridian = stripComments(read('src/styles/meridian.css'))
    expect(meridian.match(/--font-(sans|mono)\s*:[^;]*;/g) ?? []).toEqual([])
  })
})
