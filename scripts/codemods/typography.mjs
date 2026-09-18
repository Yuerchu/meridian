// One-shot codemod: Tailwind type sizes → boardui composite text utilities.
//
//   node scripts/codemods/typography.mjs          # rewrite src/**
//   node scripts/codemods/typography.mjs --dry    # report only
//
// boardui's type scale is a set of composite utilities — `text-body-medium`
// sets size, line-height, letter-spacing and weight together — and its rule is
// that they are never rebuilt from `text-sm font-medium`. So each Tailwind size
// token maps to a family, the literal's own `font-*` token supplies the weight
// (regular when there is none), and the consumed weight token is removed:
//
//   'text-xs font-medium text-text-secondary' → 'text-caption-1-medium text-text-secondary'
//   'md:text-sm'                                → 'md:text-body-regular'
//
// A weight token that no size in the same literal can absorb is left alone
// and listed, as is a size with a prefix the weight does not share; those are
// read by a person. Runs over string literals and template chunks, the same
// places the lint reads.
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOT = path.resolve(import.meta.dirname, '../..')

const FAMILY = {
  xs: 'caption-1',
  sm: 'body',
  base: 'headline',
  lg: 'title-3',
  xl: 'title-2',
  '2xl': 'title-1',
  '3xl': 'display-4',
}
const WEIGHT = { normal: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' }

function split(token) {
  let depth = 0
  let lastColon = -1
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === ':' && depth === 0) lastColon = i
  }
  return { prefix: lastColon >= 0 ? token.slice(0, lastColon + 1) : '', core: token.slice(lastColon + 1) }
}

function rewriteLiteral(lit, report) {
  const tokens = lit.match(/[^\s'"`]+|\s+|['"`]/g)
  if (!tokens) return lit
  const sizes = []
  const weights = []
  tokens.forEach((t, i) => {
    if (/\s/.test(t) || /^['"`]$/.test(t)) return
    const { prefix, core } = split(t)
    const s = core.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)$/)
    if (s) sizes.push({ i, prefix, size: s[1] })
    const w = core.match(/^font-(normal|medium|semibold|bold)$/)
    if (w) weights.push({ i, prefix, weight: w[1] })
  })
  if (!sizes.length) {
    if (weights.length) report.push(`weight without a size: ${lit.trim()}`)
    return lit
  }
  const out = [...tokens]
  const consumed = new Set()
  for (const s of sizes) {
    // A weight with the same prefix, else the unprefixed one.
    const w = weights.find((x) => x.prefix === s.prefix) ?? weights.find((x) => x.prefix === '')
    const weight = w ? WEIGHT[w.weight] : 'regular'
    if (w) consumed.add(w.i)
    out[s.i] = `${s.prefix}text-${FAMILY[s.size]}-${weight}`
  }
  for (const w of weights) if (!consumed.has(w.i)) report.push(`weight not absorbed: ${lit.trim()}`)
  for (const i of consumed) out[i] = ''
  return out
    .join('')
    .replace(/(['"`])\s+/g, '$1')
    .replace(/\s+(['"`])/g, '$1')
    .replace(/\s{2,}/g, ' ')
}

function rewriteFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const report = []
  const out = src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (lit) =>
    /\btext-(xs|sm|base|lg|xl|2xl|3xl)\b|\bfont-(normal|medium|semibold|bold)\b/.test(lit)
      ? rewriteLiteral(lit, report)
      : lit,
  )
  if (out !== src && !DRY) fs.writeFileSync(file, out)
  return { changed: out !== src, report: report.map((r) => `${path.relative(ROOT, file)}: ${r}`) }
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) acc.push(p)
  }
  return acc
}

let changed = 0
const report = []
for (const f of walk(path.join(ROOT, 'src'))) {
  const r = rewriteFile(f)
  if (r.changed) changed++
  report.push(...r.report)
}
console.log(`${DRY ? 'would change' : 'changed'} ${changed} files`)
if (report.length) console.log(`\nfor a person (${report.length}):\n  ` + report.join('\n  '))
