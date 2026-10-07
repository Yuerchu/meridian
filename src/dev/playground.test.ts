import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * The playground previews components; it must not be the only thing keeping one
 * alive.
 *
 * A component that nothing in the product renders is dead code, but with a
 * playground section pointing at it, it never looks dead: the import is real,
 * the preview works, and `tsc` is happy. Three toolbar controls survived that
 * way after the composer stopped using them, and were only noticed by hand.
 *
 * So the rule is mechanical: everything the playground imports from
 * `@/components` must be reachable from the product too.
 */

const SRC = resolve(process.cwd(), 'src')
const PLAYGROUND = join(SRC, 'dev', 'playground.tsx')
/** The gallery pages the router lazy-loads; each previews components too. */
const GALLERY = join(SRC, 'dev', 'gallery')

/**
 * Directories that are not the product.
 *
 * `src/dev` is the whole point of the check — counting a sibling lab as a
 * caller would let the playground vouch for itself. `src/test` is scaffolding;
 * a component alive only because a helper imports it is still dead.
 */
const NOT_PRODUCT = [join(SRC, 'dev'), join(SRC, 'test')]

/**
 * Components allowed in the playground with no caller in the product.
 *
 * Every entry needs a reason, and the list is meant to shrink: an entry is a
 * promise that something will use this, not a place to park things that turned
 * out to be unwanted. When the caller lands, delete the entry — the check will
 * then keep the component honest on its own.
 */
const ALLOWED_WITHOUT_CALLER = new Map<string, string>([])

/** `import { A, B as C }` / `import type { … }` / multi-line forms. */
const IMPORT_RE = /import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g

interface Imported {
  name: string
  module: string
}

function parseNamedImports(source: string): Imported[] {
  const out: Imported[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const [, typeOnly, names, module] = match
    if (typeOnly) continue
    for (const raw of names.split(',')) {
      const entry = raw.trim()
      // `type Foo` inside a value import is still a type.
      if (!entry || entry.startsWith('type ')) continue
      const name = entry.split(/\s+as\s+/)[0].trim()
      if (name) out.push({ name, module })
    }
  }
  return out
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** Resolves an import specifier to the file it names, or null for a package.
 *  Relative specifiers are resolved against the file that wrote them, which is
 *  what makes `Button` from a component library's exports and `Button` from
 *  `./ui/button` two different things. */
function moduleToFile(module: string, from: string): string | null {
  const base = module.startsWith('@/')
    ? join(SRC, module.slice(2))
    : module.startsWith('.')
      ? resolve(dirname(from), module)
      : null
  if (base === null) return null
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      // try the next shape
    }
  }
  return null
}

describe('playground', () => {
  it('only previews components the product still uses', () => {
    const pages = [PLAYGROUND, ...walk(GALLERY).filter((f) => !/\.test\.tsx?$/.test(f))]
    const previewed = pages.flatMap((page) =>
      parseNamedImports(readFileSync(page, 'utf8'))
        .filter((i) => i.module.startsWith('@/components/'))
        .map((i) => ({ ...i, page })),
    )
    expect(previewed.length, 'expected the gallery to import some components').toBeGreaterThan(0)

    // Anything the product imports by name is in use. Import is the signal
    // rather than JSX usage, because a component can be handed to
    // `motion.create()` or a `render` prop and never appear as a tag.
    //
    // Keyed by the file the name resolves to, not by the bare name: half of
    // a component library's exports are called `Button`, `Select`, `Avatar` or
    // `Spinner` too, and matching on the identifier alone would let any of them
    // vouch for a local component of the same name that nothing renders.
    const productFiles = walk(SRC).filter(
      (f) => !NOT_PRODUCT.some((dir) => f.startsWith(dir)) && !/\.test\.tsx?$/.test(f),
    )
    // `webview-lab.tsx` and `scroll-lab.tsx` used to land in here, which let the
    // playground's own neighbours vouch for what it previews.
    expect(productFiles.filter((f) => f.startsWith(join(SRC, 'dev')))).toEqual([])

    const importedByProduct = new Set<string>()
    for (const file of productFiles) {
      for (const { name, module } of parseNamedImports(readFileSync(file, 'utf8'))) {
        // Through the barrel to the defining file, on both sides: the gallery
        // imports `@/components/base`, a sibling component imports `./x`.
        const target = moduleToFile(module, file)
        if (target) importedByProduct.add(`${definingFile(target, name) ?? target}::${name}`)
      }
    }

    const orphans = previewed.filter(({ name, module, page }) => {
      if (ALLOWED_WITHOUT_CALLER.has(name)) return false
      // A component can also be used by a sibling inside its own file without
      // ever being imported anywhere — `TodoBar` renders `TodoBarView` that
      // way. Missing this is what makes a naive version of this check delete
      // live code.
      const target = moduleToFile(module, page)
      if (!target) return true
      const file = definingFile(target, name) ?? target
      if (importedByProduct.has(`${file}::${name}`)) return false
      const source = readFileSync(file, 'utf8')
      return !new RegExp(`<${name}[\\s/>]`).test(source)
    })

    expect(
      orphans.map((o) => `${o.name} (${o.module}, previewed in ${o.page.slice(SRC.length + 1)})`),
      'These are previewed in the playground but nothing in the product uses them. ' +
        'Delete the component and its playground section, or wire it up. If it is ' +
        'deliberately staged ahead of its caller, add it to ALLOWED_WITHOUT_CALLER ' +
        'with a reason.',
    ).toEqual([])
  })
})

/**
 * The other direction: what the product renders from the design-system layers
 * has to be on show in the playground.
 *
 * The playground replaced a standalone recreation of the components
 * (docs/design, exported by Claude Design) because a second copy was wrong on
 * the day it was made. The gallery only stays the one place to look if a
 * component cannot reach the product without reaching it too — otherwise it
 * drifts the same way, one unshown component at a time.
 *
 * Scope is the reusable layers: `base/`, `ui/`, `application/` and `foundations/`. Feature
 * screens (`chat/`, `settings/`, `layout/`, …) are composites with stores and a
 * backend behind them, and the visual suite photographs those in place.
 *
 * "Used" means a file *outside* those layers imports the component and renders
 * it as JSX. A part another base component renders internally (a menu's item
 * shell, a tooltip's arrow) is on show through its parent and is not counted;
 * importing a constant (`BUBBLE_BLOCK`) or a type is not rendering anything.
 * Barrels (`@/components/base`) are followed to the file that defines the
 * name, so `Button` from the barrel and `Button` from `./buttons/button` are
 * the same component and a same-named export elsewhere is not.
 */

const DS_DIRS = ['base', 'ui', 'application', 'foundations'].map((d) => join(SRC, 'components', d))
const inDs = (file: string) => DS_DIRS.some((dir) => file.startsWith(dir + sep))

/**
 * Rendered by the product, deliberately not in the playground. A reason is
 * required, and an entry that is no longer needed fails the check, so the list
 * can only shrink by itself.
 */
const ALLOWED_UNPREVIEWED = new Map<string, string>([
  ['CopyAnnouncement', 'an sr-only live region: there is nothing on screen to look at'],
  ['FileInput', 'a hidden <input type="file"> opened imperatively; it draws nothing'],
  [
    'MessageScroller',
    'on show at #playground/scroll inside ChatTranscript, the harness that drives it; a bare copy in the gallery ' +
      'reads the platform through Tauri and only logs invoke errors in a browser',
  ],
])

const REEXPORT_RE = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g
const STAR_RE = /export\s+\*\s+from\s*['"]([^'"]+)['"]/g
const DEFAULT_IMPORT_RE = /import\s+([A-Z][\w$]*)\s*(?:,\s*\{[\s\S]*?\})?\s*from\s*['"]([^'"]+)['"]/g

/** Names a file re-exports from elsewhere, mapped to [module, original name]. */
function reexports(source: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>()
  for (const [, typeOnly, names, module] of source.matchAll(REEXPORT_RE)) {
    if (typeOnly) continue
    for (const raw of names.split(',')) {
      const entry = raw.trim()
      if (!entry || entry.startsWith('type ')) continue
      const [orig, alias] = entry.split(/\s+as\s+/).map((s) => s.trim())
      out.set(alias ?? orig, [module, orig])
    }
  }
  return out
}

/** The file that actually defines `name` as exported from `file`, through any
 *  number of barrels; `null` when a star re-export chain does not have it. */
function definingFile(file: string, name: string, seen = new Set<string>()): string | null {
  if (seen.has(file)) return null
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  const named = reexports(source).get(name)
  if (named) {
    const target = moduleToFile(named[0], file)
    // Passed through from a package (`Collection as TreeViewCollection`): this
    // file is as far as it goes in the source tree.
    return target ? definingFile(target, named[1], seen) : file
  }
  const local = new RegExp(
    String.raw`export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+${name}\b|export\s*\{[^}]*\b${name}\b[^}]*\}(?!\s*from)`,
  )
  if (local.test(source)) return file
  for (const [, module] of source.matchAll(STAR_RE)) {
    const target = moduleToFile(module, file)
    const found = target && definingFile(target, name, seen)
    if (found) return found
  }
  return null
}

/** Value imports of a file, named and default, resolved to `definingFile::name`. */
function resolvedImports(file: string, unresolved?: string[]): { key: string; name: string; local: string }[] {
  const source = readFileSync(file, 'utf8')
  const out: { key: string; name: string; local: string }[] = []
  const add = (name: string, local: string, module: string) => {
    const target = moduleToFile(module, file)
    if (!target) return
    const def = name === 'default' ? target : definingFile(target, name)
    if (def) out.push({ key: `${def}::${name}`, name, local })
    // A name that cannot be followed would drop out of both sides of the
    // comparison at once and pass unnoticed; say so instead.
    else if (inDs(target)) unresolved?.push(`${name} from ${module} in ${file.slice(SRC.length + 1)}`)
  }
  for (const [, typeOnly, names, module] of source.matchAll(IMPORT_RE)) {
    if (typeOnly) continue
    for (const raw of names.split(',')) {
      const entry = raw.trim()
      if (!entry || entry.startsWith('type ')) continue
      const [orig, alias] = entry.split(/\s+as\s+/).map((s) => s.trim())
      add(orig, alias ?? orig, module)
    }
  }
  for (const [, local, module] of source.matchAll(DEFAULT_IMPORT_RE)) add('default', local, module)
  return out
}

describe('playground coverage', () => {
  it('shows every design-system component the product renders', () => {
    const product = walk(SRC).filter(
      (f) => !NOT_PRODUCT.some((dir) => f.startsWith(dir)) && !/\.test\.tsx?$/.test(f) && !inDs(f),
    )
    const used = new Map<string, string>()
    const unresolved: string[] = []
    for (const file of product) {
      const source = readFileSync(file, 'utf8')
      for (const { key, name, local } of resolvedImports(file, unresolved)) {
        const def = key.slice(0, key.lastIndexOf('::'))
        if (!inDs(def) || !/^[A-Z]/.test(local)) continue
        if (!new RegExp(String.raw`<${local}[\s/>.]`).test(source)) continue
        if (!used.has(key))
          used.set(key, `${name} (${def.slice(SRC.length + 1)}, rendered in ${file.slice(SRC.length + 1)})`)
      }
    }
    expect(used.size, 'expected the product to render some design-system components').toBeGreaterThan(20)

    // The gallery and the `#playground/<lab>` sub-pages: the scroll harness is
    // where the transcript's scroller is on show, and it is a playground page.
    const labs = readdirSync(join(SRC, 'dev'))
      .filter((f) => /-lab\.tsx$/.test(f))
      .map((f) => join(SRC, 'dev', f))
    const pages = [PLAYGROUND, ...labs, ...walk(GALLERY).filter((f) => !/\.test\.tsx?$/.test(f))]
    const previewed = new Set(pages.flatMap((page) => resolvedImports(page, unresolved).map((i) => i.key)))
    expect(
      unresolved,
      'Imports from the design-system layers that could not be followed to the file defining them. ' +
        'Teach definingFile the export form, or the comparison below silently skips them.',
    ).toEqual([])

    const label = (key: string) => key.slice(key.lastIndexOf('::') + 2)
    const fileOf = (key: string) => key.slice(0, key.lastIndexOf('::'))
    // A compound's parts are on show with their root: `TreeViewItem` beside a
    // previewed `TreeView` from the same file, `MessageGroupHeader` beside
    // `MessageGroup`. Same file and the root's name as a prefix, both.
    const shown = (key: string) =>
      previewed.has(key) ||
      [...previewed].some((p) => fileOf(p) === fileOf(key) && label(key).startsWith(label(p)) && label(p) !== 'default')
    // An entry covers a compound family the same way: `MessageScroller` covers
    // `MessageScrollerItem`.
    const allowedBy = (key: string) => [...ALLOWED_UNPREVIEWED.keys()].find((name) => label(key).startsWith(name))
    const missing = [...used].filter(([key]) => !shown(key) && !allowedBy(key))
    expect(
      missing.map(([, where]) => where),
      'These are rendered by the product but not shown in the playground. Add a ' +
        'section for each to the matching src/dev/gallery page. If one genuinely ' +
        'cannot be shown there, add it to ALLOWED_UNPREVIEWED with the reason.',
    ).toEqual([])

    // Stale: it excuses nothing that is rendered and not otherwise shown.
    const stale = [...ALLOWED_UNPREVIEWED].filter(
      ([name]) => ![...used.keys()].some((k) => allowedBy(k) === name && !shown(k)),
    )
    expect(
      stale.map(([name]) => name),
      'ALLOWED_UNPREVIEWED entries no longer needed — delete them',
    ).toEqual([])
    const unexplained = [...ALLOWED_UNPREVIEWED].filter(([, reason]) => !reason.trim())
    expect(
      unexplained.map(([name]) => name),
      'every ALLOWED_UNPREVIEWED entry needs a reason',
    ).toEqual([])
  })
})
