/**
 * The tertiary well must differ from every surface it is allowed to sit on.
 *
 * Twice a control vanished for the same reason: in the dark theme boardui's
 * `background-tertiary-default` (the field well, and the off track of a
 * `Switch`) and `background-primary-default` (cards, menus, `Sidebar.Main`)
 * are both neutral-800. First the switch track on a primary card, then every
 * field on the main panel. Neither was wrong in the light theme, and nothing
 * that runs in jsdom draws a pixel, so this reads the stylesheet the app
 * ships, resolves each semantic token through its `var()` chain down to the
 * palette for both themes, and compares the answers.
 *
 * The pairs are read off the components where they can be — the field's fill
 * from the registry input, the track from the registry switch, the row
 * surface from `CellSwitch` — so moving a component onto the wrong surface
 * turns this red without anyone remembering to update a list. The lint rule
 * `meridian-ui/field-fill-follows-surface` is the other half: it stops a
 * caller from painting one field to dodge the problem.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** Declarations of the top-level block whose header is exactly `header`. */
function block(css: string, header: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = css.split(/\r?\n/)
  let depth = 0
  let inside = false
  for (const line of lines) {
    if (depth === 0 && line.trim() === `${header} {`) {
      inside = true
      depth = 1
      continue
    }
    if (inside) {
      depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
      if (depth <= 0) {
        inside = false
        depth = 0
        continue
      }
      const m = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*(?:\/\*.*)?$/.exec(line)
      if (m && depth === 1) out.set(m[1], m[2].trim())
    } else {
      depth = Math.max(0, depth + (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length)
    }
  }
  return out
}

function themes() {
  const tailwind = block(read('node_modules/tailwindcss/theme.css'), '@theme default')
  const css = read('src/styles/theme.css')
  const palette = new Map([...tailwind, ...block(css, '@theme')])
  const light = new Map([...palette, ...block(css, ':root')])
  const dark = new Map([...light, ...block(css, '.dark')])
  return { light, dark }
}

/** Follow `var(--x)` until a value that is not a bare reference. */
function resolveToken(vars: Map<string, string>, name: string, seen: string[] = []): string {
  const raw = vars.get(name)
  if (raw === undefined) throw new Error(`${name} is not defined (via ${seen.join(' → ') || 'direct'})`)
  const ref = /^var\((--[\w-]+)(?:\s*,[^)]*)?\)$/.exec(raw)
  if (!ref) return raw.replace(/\s+/g, ' ').toLowerCase()
  if (seen.includes(ref[1])) throw new Error(`cycle at ${ref[1]}`)
  return resolveToken(vars, ref[1], [...seen, name])
}

const utilityToken = (utility: string) => `--color-${utility.replace(/^bg-/, '')}`

/** The single `bg-background-*-default` utility a component's source gives the named part. */
function fillIn(path: string, anchor: RegExp): string {
  const src = read(path)
  const start = src.search(anchor)
  if (start < 0) throw new Error(`${anchor} not found in ${path}`)
  const m = /\bbg-background-[a-z]+-default\b/.exec(src.slice(start))
  if (!m) throw new Error(`no bg-background-*-default after ${anchor} in ${path}`)
  return m[0]
}

const { light, dark } = themes()
const THEMES = [
  ['light', light],
  ['dark', dark],
] as const

// Read off the components, not restated here.
const FIELD_WELL = fillIn('src/components/base/input/input.tsx', /const inputStyles/)
const SWITCH_OFF_TRACK = fillIn('src/components/base/switch/switch.tsx', /export function SwitchTrack/)
const CELL_SWITCH_SURFACE = fillIn('src/components/base/cell-switch.tsx', /function CellSwitchTrigger/)
// The ring's track: the first `stroke="var(--color-…)"` in the component.
const RING_TRACK = /stroke="var\((--color-[\w-]+)\)"/.exec(read('src/components/base/progress-circle.tsx'))?.[1] ?? ''

describe('surface contrast', () => {
  it('resolves the tokens it compares to palette values', () => {
    expect(FIELD_WELL).toBe('bg-background-tertiary-default')
    expect(SWITCH_OFF_TRACK).toBe('bg-background-tertiary-default')
    for (const [, vars] of THEMES) {
      expect(resolveToken(vars, '--color-background-tertiary-default')).not.toMatch(/var\(/)
    }
  })

  // The surfaces the registry well may sit on: the page, and the secondary
  // panel (settings cards, the sidebar, a secondary data grid).
  it.each(THEMES)('the field well stands off the page and the secondary panel (%s)', (_, vars) => {
    const well = resolveToken(vars, utilityToken(FIELD_WELL))
    expect(well).not.toBe(resolveToken(vars, '--color-background-full'))
    expect(well).not.toBe(resolveToken(vars, '--color-background-secondary-default'))
  })

  // BoardUI's one field fill, for a field on the lighter surface
  // (data-table.tsx / settings-storage.tsx).
  it.each(THEMES)('the secondary field stands off a primary surface (%s)', (_, vars) => {
    expect(resolveToken(vars, '--color-background-secondary-default')).not.toBe(
      resolveToken(vars, '--color-background-primary-default'),
    )
  })

  it.each(THEMES)('a CellSwitch row does not hide its own off track (%s)', (_, vars) => {
    expect(resolveToken(vars, utilityToken(CELL_SWITCH_SURFACE))).not.toBe(
      resolveToken(vars, utilityToken(SWITCH_OFF_TRACK)),
    )
  })

  // A part-filled ring with no visible track is an arc alone, which is what
  // a spinner looks like (the composer's context gauge, 2026-09). The ring
  // sits on the composer and on cards (primary) and on panels (secondary).
  it.each(THEMES)('a progress ring shows its track on the surfaces it sits on (%s)', (_, vars) => {
    expect(RING_TRACK).toMatch(/^--color-/)
    const track = resolveToken(vars, RING_TRACK)
    expect(track).not.toBe(resolveToken(vars, '--color-background-primary-default'))
    expect(track).not.toBe(resolveToken(vars, '--color-background-secondary-default'))
  })

  // Why the rules above exist, pinned: if the palette ever stops colliding,
  // this goes red and the note in CLAUDE.md can be retired rather than kept.
  it('records the dark collision the gates are for', () => {
    expect(resolveToken(dark, '--color-background-tertiary-default')).toBe(
      resolveToken(dark, '--color-background-primary-default'),
    )
  })
})

/*
 * Readable text is `text-secondary`, not `text-tertiary` (owner decision
 * 2026-09-24, CLAUDE.md UI Conventions). The ratio is WCAG 2.x contrast from
 * relative luminance: palette values are `oklch(L% C H)` (Tailwind) or hex
 * (theme.css), converted OKLab → linear sRGB (Björn Ottosson's matrices),
 * clamped to gamut, then 0.2126 R + 0.7152 G + 0.0722 B. The neutrals have no
 * chroma, so gamut clamping never decides an answer here.
 */
function linearRgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+|none)\s+([\d.]+|none)\s*\)$/.exec(value)
  if (!ok) throw new Error(`cannot measure ${value}`)
  const L = Number(ok[1]) / (ok[2] ? 100 : 1)
  const C = ok[3] === 'none' ? 0 : Number(ok[3])
  const H = ok[4] === 'none' ? 0 : (Number(ok[4]) * Math.PI) / 180
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrast(vars: Map<string, string>, fg: string, bg: string): number {
  const lum = (token: string) => {
    const [r, g, b] = linearRgb(resolveToken(vars, token))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const READING_SURFACES = [
  '--color-background-primary-default',
  '--color-background-secondary-default',
  '--color-background-full',
]

describe('readable text contrast', () => {
  it('measures a known pair correctly', () => {
    // neutral-500 (#737373) on white is 4.74:1 by any WCAG calculator.
    expect(contrast(light, '--color-text-secondary', '--color-background-primary-default')).toBeCloseTo(4.74, 1)
  })

  it.each(THEMES.flatMap(([name, vars]) => READING_SURFACES.map((bg) => [name, bg, vars] as const)))(
    'text-secondary reads at >= 3:1 (%s, %s)',
    (_, bg, vars) => {
      expect(contrast(vars, '--color-text-secondary', bg)).toBeGreaterThanOrEqual(3)
    },
  )

  // Why readable text left tertiary, pinned: if BoardUI ever lifts the dark
  // tertiary above 3:1 this goes red, and the deviation can be retired.
  it('records the dark tertiary shortfall the rule is for', () => {
    expect(contrast(dark, '--color-text-tertiary', '--color-background-primary-default')).toBeLessThan(3)
    expect(contrast(dark, '--color-text-tertiary', '--color-background-secondary-default')).toBeLessThan(3)
  })
})
