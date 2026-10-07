// The design tokens, read out of the stylesheets that define them.
//
// The foundations page must not carry a second copy of any value: a swatch that
// says `neutral-500` because someone typed it here is exactly the drift the
// exported design kit had. So the stylesheets themselves are read as text and
// every custom property is taken from where it is declared — `@theme` and
// `:root` for the light theme, `.dark` for what the dark theme overrides — and
// resolved through its `var()` chain per theme. Rendering then paints the
// resolved expression inline, which is why both themes can sit side by side no
// matter which one the page is in.
export type Theme = 'light' | 'dark'

export interface Declaration {
  value: string
  file: string
}

interface TokenTable {
  light: Map<string, Declaration>
  dark: Map<string, Declaration>
  /** Declaration order of every name, light first, for grouping by prefix. */
  order: string[]
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The top-level rules of a stylesheet: prelude and body, nested blocks kept in the body. */
function topLevelRules(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = []
  let depth = 0
  let start = 0
  let bodyStart = 0
  let prelude = ''
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) {
        prelude = css.slice(start, i).trim()
        bodyStart = i + 1
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        out.push({ prelude, body: css.slice(bodyStart, i) })
        start = i + 1
      }
    } else if (ch === ';' && depth === 0) {
      // `@import`, `@plugin`, `@custom-variant …;` — statements, not rules.
      start = i + 1
    }
  }
  return out
}

/** `prop: value` pairs written directly in a body, skipping any nested block. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0
  let flat = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (depth === 0) flat += ch
    if (ch === '}') {
      depth--
      // A nested block's end also ends whatever was being collected before it.
      if (depth === 0) flat += ';'
    }
  }
  for (const part of flat.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const prop = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (prop && value) out.push([prop, value])
  }
  return out
}

const LIGHT_PRELUDE = /^(@theme(\s+(inline|static))*|:root)$/

function buildTable(sources: [string, string][]): TokenTable {
  const light = new Map<string, Declaration>()
  const dark = new Map<string, Declaration>()
  const order: string[] = []
  const note = (name: string) => {
    if (!order.includes(name)) order.push(name)
  }
  for (const [file, raw] of sources) {
    for (const { prelude, body } of topLevelRules(stripComments(raw))) {
      // Only the theme blocks. `.dark .shadow-*` in globals.css re-points the
      // utilities at the same variables, so the `.dark` block already holds
      // the dark elevations; `.dark[data-accent]` and `@layer` are not tokens.
      const target = LIGHT_PRELUDE.test(prelude) ? light : prelude === '.dark' ? dark : null
      if (!target) continue
      for (const [prop, value] of declarations(body)) {
        if (!prop.startsWith('--')) continue
        // `@theme inline` re-exports a `:root` token under its own name — the
        // declaration that matters is the one it points at.
        if (value === `var(${prop})`) continue
        target.set(prop, { value, file })
        note(prop)
      }
    }
  }
  return { light, dark, order }
}

/** Finds `var(` calls and their balanced argument lists. */
function replaceVars(expr: string, fn: (name: string, fallback: string | undefined) => string): string {
  let out = ''
  let i = 0
  while (i < expr.length) {
    const at = expr.indexOf('var(', i)
    if (at < 0) {
      out += expr.slice(i)
      break
    }
    out += expr.slice(i, at)
    let depth = 0
    let end = at + 3
    let comma = -1
    for (; end < expr.length; end++) {
      const ch = expr[end]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      } else if (ch === ',' && depth === 1 && comma < 0) comma = end
    }
    const inner = expr.slice(at + 4, end)
    const name = (comma < 0 ? inner : expr.slice(at + 4, comma)).trim()
    const fallback = comma < 0 ? undefined : expr.slice(comma + 1, end).trim()
    out += fn(name, fallback)
    i = end + 1
  }
  return out
}

export interface Resolved {
  /** An expression a style attribute can paint; leaves outside our files stay `var()`. */
  css: string
  /** The names walked through, starting with the token itself. */
  chain: string[]
}

/** `--color-text-secondary` → `text-secondary`, for labels. */
export function shortName(name: string): string {
  return name.replace(/^--(color-)?/, '')
}

export interface TokenReader {
  /** Every declared custom property whose name matches, in declaration order. */
  tokenNames(pattern: RegExp): string[]
  declared(name: string, theme: Theme): Declaration | undefined
  /** Whether the dark theme declares its own value for this name. */
  overriddenInDark(name: string): boolean
  resolve(name: string, theme: Theme): Resolved
}

/** A reader over stylesheet sources given as `[file name, text]`, in cascade order. */
export function createTokenReader(sources: [string, string][]): TokenReader {
  const table = buildTable(sources)
  const declared = (name: string, theme: Theme) =>
    (theme === 'dark' ? table.dark.get(name) : undefined) ?? table.light.get(name)
  /**
   * Follows a token through the stylesheets for one theme. A name none of our
   * files declares — Tailwind's own palette, mostly — is left as `var(--…)`:
   * those never change between themes, so the page's own value is the right one.
   */
  function resolve(name: string, theme: Theme): Resolved {
    const chain: string[] = [name]
    const walk = (current: string, depth: number): string => {
      const decl = declared(current, theme)
      if (!decl || depth > 12) return `var(${current})`
      return replaceVars(decl.value, (inner, fallback) => {
        if (!chain.includes(inner)) chain.push(inner)
        if (declared(inner, theme)) return walk(inner, depth + 1)
        return fallback === undefined ? `var(${inner})` : `var(${inner}, ${fallback})`
      })
    }
    return { css: walk(name, 0), chain }
  }
  return {
    tokenNames: (pattern) => table.order.filter((name) => pattern.test(name)),
    declared,
    overriddenInDark: (name) => table.dark.has(name),
    resolve,
  }
}
