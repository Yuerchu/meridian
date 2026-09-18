// One-shot codemod: HeroUI-era colour utilities → boardui / meridian.css tokens.
//
//   node scripts/codemods/legacy-tokens.mjs            # rewrite src/**
//   node scripts/codemods/legacy-tokens.mjs --dry      # report only
//
// Walks every string literal and template chunk in src/**/*.{ts,tsx} and every
// class-shaped token inside it: strips the variant prefix (`hover:`,
// `data-[selected=true]:`, `group-hover/x:`, `[&_svg]:`…), the `!` important
// marker and the `/NN` opacity suffix, maps the bare utility through TABLE,
// and puts the pieces back. A second pass rewrites `var(--legacy)` inside
// arbitrary values. Anything that still looks legacy afterwards is printed so
// a person finishes it; the script is deleted once the tree is clean and the
// lint rule takes over.
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOT = path.resolve(import.meta.dirname, '../..')

const PREFIXES =
  '(text|bg|border|ring|outline|divide|fill|stroke|from|via|to|decoration|caret|accent|shadow|placeholder)'

/** bare utility → replacement, or a function of (prefix, variants). */
const TABLE = new Map([
  // neutrals
  ['text-muted', 'text-text-secondary'],
  ['placeholder-muted', 'placeholder-text-tertiary'],
  ['border-muted', 'border-border-button-hover'],
  ['text-foreground', 'text-text-primary'],
  ['bg-foreground', 'bg-text-primary'],
  ['border-foreground', 'border-text-primary'],
  ['fill-foreground', 'fill-text-primary'],
  ['stroke-foreground', 'stroke-text-primary'],
  ['text-default-foreground', 'text-text-primary'],
  ['text-surface-foreground', 'text-text-primary'],
  ['text-surface-secondary-foreground', 'text-text-primary'],
  ['text-overlay-foreground', 'text-text-primary'],
  ['text-overlay', 'text-text-primary'],
  ['bg-surface', 'bg-background-primary-default'],
  ['from-surface', 'from-background-primary-default'],
  ['via-surface', 'via-background-primary-default'],
  ['to-surface', 'to-background-primary-default'],
  ['border-surface', 'border-background-primary-default'],
  ['bg-surface-secondary', 'bg-background-secondary-default'],
  ['bg-surface-tertiary', 'bg-background-tertiary-default'],
  ['bg-overlay', 'bg-background-primary-default'],
  ['from-overlay', 'from-background-primary-default'],
  ['via-overlay', 'via-background-primary-default'],
  ['to-overlay', 'to-background-primary-default'],
  ['bg-background', 'bg-background-full'],
  ['bg-background-secondary', 'bg-background-secondary-default'],
  ['bg-background-tertiary', 'bg-background-tertiary-default'],
  ['bg-field', 'bg-background-tertiary-default'],
  [
    'bg-default',
    (variants) =>
      /(^|:)hover$/.test(variants) || /group-hover|peer-hover/.test(variants)
        ? 'bg-background-primary-hover'
        : /selected|active|pressed|current|aria-/.test(variants)
          ? 'bg-background-tertiary-default'
          : 'bg-background-secondary-default',
  ],
  ['border-default', 'border-border-button-default'],
  ['ring-default', 'ring-border-button-default'],
  // edges
  ['border-border', 'border-border-button-default'],
  ['ring-border', 'ring-border-button-default'],
  ['bg-border', 'bg-border-button-default'],
  ['divide-border', 'divide-border-button-default'],
  ['outline-border', 'outline-border-button-default'],
  ['border-field-border', 'border-border-button-default'],
  ['border-separator', 'border-separator-border'],
  ['bg-separator', 'bg-separator-border'],
  ['divide-separator', 'divide-separator-border'],
  ['ring-focus', 'ring-border-focus-ring'],
  ['border-focus', 'border-border-focus-ring'],
  ['outline-focus', 'outline-border-focus-ring'],
  ['bg-focus', 'bg-border-focus-ring'],
  ['shadow-surface', 'shadow-card'],
  ['shadow-overlay', 'shadow-dropdown'],
  // accent
  ['text-accent', 'text-button-ghost-foreground'],
  ['text-accent-foreground', 'text-text-white'],
  ['border-accent-foreground', 'border-text-white'],
  ['text-accent-soft-foreground', 'text-button-ghost-foreground'],
  ['bg-accent', 'bg-button-primary'],
  ['bg-accent-soft', 'bg-button-ghost-background'],
  ['bg-accent-soft-hover', 'bg-button-ghost-hover'],
  ['ring-accent', 'ring-accent-500'],
  ['border-accent', 'border-accent-500'],
  ['outline-accent', 'outline-accent-500'],
  ['from-accent', 'from-accent-500'],
  ['via-accent', 'via-accent-500'],
  ['to-accent', 'to-accent-500'],
  ['fill-accent', 'fill-accent-500'],
  ['stroke-accent', 'stroke-accent-500'],
  ['decoration-accent', 'decoration-accent-500'],
  ['text-link', 'text-accent-600'],
])

// status families: <prefix>-<status>[-foreground|-soft|-soft-foreground|-soft-hover]
const STATUS =
  /^(text|bg|border|ring|outline|divide|fill|stroke|from|via|to|decoration|caret|accent)-(danger|warning|success|info)(-foreground|-soft-foreground|-soft-hover|-soft)?$/

const VAR_TABLE = new Map([
  ['--muted', '--color-text-secondary'],
  ['--foreground', '--color-text-primary'],
  ['--background', '--color-background-full'],
  ['--background-secondary', '--color-background-secondary-default'],
  ['--surface', '--color-background-primary-default'],
  ['--surface-secondary', '--color-background-secondary-default'],
  ['--surface-tertiary', '--color-background-tertiary-default'],
  ['--surface-foreground', '--color-text-primary'],
  ['--overlay', '--color-background-primary-default'],
  ['--overlay-foreground', '--color-text-primary'],
  ['--default', '--color-background-secondary-default'],
  ['--default-foreground', '--color-text-primary'],
  ['--border', '--color-border-button-default'],
  ['--separator', '--color-separator-border'],
  ['--focus', '--color-border-focus-ring'],
  ['--accent', '--color-accent-500'],
  ['--accent-foreground', '--color-text-white'],
  ['--accent-soft', '--color-button-ghost-background'],
  ['--danger', '--color-status-danger'],
  ['--danger-foreground', '--color-status-danger-foreground'],
  ['--danger-soft', '--color-status-danger-soft'],
  ['--danger-soft-foreground', '--color-status-danger-soft-foreground'],
  ['--warning', '--color-status-warning'],
  ['--warning-foreground', '--color-status-warning-foreground'],
  ['--warning-soft', '--color-status-warning-soft'],
  ['--warning-soft-foreground', '--color-status-warning-soft-foreground'],
  ['--success', '--color-status-success'],
  ['--success-foreground', '--color-status-success-foreground'],
  ['--success-soft', '--color-status-success-soft'],
  ['--success-soft-foreground', '--color-status-success-soft-foreground'],
  ['--info', '--color-status-info'],
  ['--info-soft', '--color-status-info-soft'],
  ['--info-soft-foreground', '--color-status-info-soft-foreground'],
  ['--radius', '--radius-lg'],
  ['--chart-1', '--color-chart-1'],
  ['--chart-2', '--color-chart-2'],
  ['--chart-3', '--color-chart-3'],
  ['--chart-4', '--color-chart-4'],
  ['--surface-shadow', '--shadow-card'],
  ['--overlay-shadow', '--shadow-dropdown'],
])

const LEGACY_LEFTOVER = new RegExp(
  `(?<![\\w-])${PREFIXES}-(muted|foreground|surface(-secondary|-tertiary|-foreground)?|overlay(-foreground)?|default(-foreground|-soft)?|field(-border)?|separator|focus|link|accent(-foreground|-soft(-foreground|-hover)?)?|(danger|warning|success|info)(-foreground|-soft(-foreground|-hover)?)?|border)(?![\\w-])`,
)

/** Splits `hover:data-[x=1]:!bg-default/50` into its parts, by scanning rather than by a backtracking regex. */
function splitToken(token) {
  let depth = 0
  let lastColon = -1
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === ':' && depth === 0) lastColon = i
  }
  const variants = lastColon >= 0 ? token.slice(0, lastColon + 1) : ''
  let rest = token.slice(lastColon + 1)
  const bang = rest.startsWith('!') ? '!' : ''
  if (bang) rest = rest.slice(1)
  const slash = rest.indexOf('/')
  const core = slash >= 0 ? rest.slice(0, slash) : rest
  const opacity = slash >= 0 ? rest.slice(slash) : ''
  if (!/^-?[a-z][\w-]*$/.test(core)) return null
  return { bang, variants, core, opacity }
}

function mapToken(token, context) {
  const parts = splitToken(token)
  if (!parts) return null
  const { bang, variants, core, opacity } = parts
  const v = variants.slice(0, -1)
  const entry = TABLE.get(core)
  let next
  if (typeof entry === 'function') next = entry(v)
  else if (entry) next = entry
  else {
    const s = core.match(STATUS)
    if (!s) return null
    next = `${s[1]}-status-${s[2]}${s[3] ?? ''}`
  }
  if (core === 'bg-default' && opacity)
    context.review.push(
      `${context.file}: ${token} → ${bang}${variants}${next}${opacity} (alpha on a neutral — check contrast)`,
    )
  return `${bang}${variants}${next}${opacity}`
}

function rewriteClasses(str, context) {
  return str.replace(/[^\s'"`]+/g, (token) => mapToken(token, context) ?? token)
}

function rewriteVars(str) {
  return str.replace(/var\((--[a-z0-9-]+)(\)|,)/g, (whole, name, tail) => {
    const to = VAR_TABLE.get(name)
    return to ? `var(${to}${tail}` : whole
  })
}

function rewriteFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const context = { file: path.relative(ROOT, file), review: [] }
  // String literals ('…', "…") and template chunks — the same places the lint looks.
  let out = src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (lit) => {
    if (
      !/(^|[\s'"`!:\[])(text|bg|border|ring|outline|divide|fill|stroke|from|via|to|shadow|placeholder|decoration|caret)-/.test(
        lit,
      ) &&
      !lit.includes('var(--')
    )
      return lit
    return rewriteVars(rewriteClasses(lit, context))
  })
  if (out !== src && !DRY) fs.writeFileSync(file, out)
  const leftovers = []
  for (const [i, line] of out.split('\n').entries()) {
    const hit = line.match(LEGACY_LEFTOVER)
    if (hit) leftovers.push(`${context.file}:${i + 1}: ${hit[0]}`)
  }
  return { changed: out !== src, review: context.review, leftovers }
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) acc.push(p)
  }
  return acc
}

const files = walk(path.join(ROOT, 'src')).filter(
  (f) =>
    !f.includes(`${path.sep}styles${path.sep}theme.css`) &&
    !f.includes(`${path.sep}styles${path.sep}typography.css`) &&
    !f.includes(`${path.sep}styles${path.sep}globals.css`),
)
let changed = 0
const review = []
const leftovers = []
for (const f of files) {
  if (process.env.CODEMOD_VERBOSE) console.error(path.relative(ROOT, f))
  const r = rewriteFile(f)
  if (r.changed) changed++
  review.push(...r.review)
  leftovers.push(...r.leftovers)
}
console.log(`${DRY ? 'would change' : 'changed'} ${changed} files`)
if (review.length) console.log(`\nreview (${review.length}):\n  ` + review.join('\n  '))
if (leftovers.length) console.log(`\nstill legacy (${leftovers.length}):\n  ` + leftovers.join('\n  '))
