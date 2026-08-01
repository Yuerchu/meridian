import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

/**
 * Components allowed in the playground with no caller in the product.
 *
 * Every entry needs a reason, and the list is meant to shrink: an entry is a
 * promise that something will use this, not a place to park things that turned
 * out to be unwanted. When the caller lands, delete the entry — the check will
 * then keep the component honest on its own.
 *
 * These are all slots of a compound component whose parent *is* in use, which
 * is why deleting them would be the wrong call: the playground assembles a full
 * `Turn` to show what the component supports, and `turn-item.tsx` currently
 * renders a subset of that.
 */
const ALLOWED_WITHOUT_CALLER = new Map<string, string>([
  ['TurnResult', 'Turn slot: the answer area, for when turn-item renders results separately from steps'],
  ['TurnFooter', 'Turn slot: per-turn footer, staged for token counts and the branch pager'],
  ['TurnActions', 'Turn slot: copy/regenerate row, not yet moved off message-item'],
  ['ChainOfThoughtSteps', 'ChainOfThought slot: the step list, pending reasoning-stream rendering'],
  ['ChainOfThoughtStep', 'ChainOfThought slot: a single step, same'],
])

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

function moduleToFile(module: string): string | null {
  if (!module.startsWith('@/')) return null
  const base = join(SRC, module.slice(2))
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
    const playground = readFileSync(PLAYGROUND, 'utf8')
    const previewed = parseNamedImports(playground).filter((i) => i.module.startsWith('@/components/'))
    expect(previewed.length, 'expected the playground to import some components').toBeGreaterThan(0)

    // Anything the product imports by name is in use. Import is the signal
    // rather than JSX usage, because a component can be handed to
    // `motion.create()` or a `render` prop and never appear as a tag.
    const productFiles = walk(SRC).filter(
      (f) => f !== PLAYGROUND && !/\.test\.tsx?$/.test(f),
    )
    const importedByProduct = new Set<string>()
    for (const file of productFiles) {
      for (const { name } of parseNamedImports(readFileSync(file, 'utf8'))) {
        importedByProduct.add(name)
      }
    }

    const orphans = previewed.filter(({ name, module }) => {
      if (importedByProduct.has(name)) return false
      if (ALLOWED_WITHOUT_CALLER.has(name)) return false
      // A component can also be used by a sibling inside its own file without
      // ever being imported anywhere — `TodoBar` renders `TodoBarView` that
      // way. Missing this is what makes a naive version of this check delete
      // live code.
      const file = moduleToFile(module)
      if (!file) return true
      const source = readFileSync(file, 'utf8')
      return !new RegExp(`<${name}[\\s/>]`).test(source)
    })

    expect(
      orphans.map((o) => `${o.name} (${o.module})`),
      'These are previewed in the playground but nothing in the product uses them. ' +
        'Delete the component and its playground section, or wire it up. If it is ' +
        'deliberately staged ahead of its caller, add it to ALLOWED_WITHOUT_CALLER ' +
        'with a reason.',
    ).toEqual([])
  })
})
