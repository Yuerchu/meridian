#!/usr/bin/env node
// A release build carries no demo fixtures.
//
// `src/dev/demo/` is a fixture backend for `pnpm dev` in a plain browser. It is
// reached only through a dynamic import in `src/lib/transport.ts` guarded by
// `import.meta.env.DEV`, which is a literal `false` in a release build — so the
// whole branch folds away and the chunk is never emitted. Nothing but that
// guard keeps a few hundred KB of fake conversations out of the installer, and
// until this script it was confirmed by grepping `dist/` by hand.
//
// Run after `vite build`: it scans `dist/**/*.{js,css,html}` for strings that
// exist only in the fixtures. They are string literals rather than identifiers
// because a minifier renames identifiers (`createDemoTransport` would not
// survive) but keeps literals. None of them is UI text: the demo badge's copy
// is in the i18n bundles, which do ship.
//
// The sentinels check themselves first. A sentinel renamed in the fixtures
// would turn this into a search for a string nobody writes any more — green
// for ever — so each one must still occur under `src/dev/demo/`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const demoDir = join(root, 'src', 'dev', 'demo')
const distDir = join(root, process.argv[2] ?? 'dist')

const SENTINELS = [
  // conversations.ts: conversation, project and approval ids.
  'demo-conv-scroller',
  'demo-project-meridian',
  'demo-approval-run-command',
  'demo-plan-review',
  // fallback.ts: the rejection every unsupported command gets.
  'DemoUnsupported: ',
]

function walk(dir, accept) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path, accept))
    else if (accept(name)) out.push(path)
  }
  return out
}

function fail(message) {
  console.error(`check-dist-no-demo: ${message}`)
  process.exit(1)
}

// 1. The sentinels still name something in the fixtures.
const demoSources = walk(demoDir, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).map((path) =>
  readFileSync(path, 'utf8'),
)
const stale = SENTINELS.filter((sentinel) => !demoSources.some((source) => source.includes(sentinel)))
if (stale.length > 0) {
  fail(
    `sentinel(s) no longer found under src/dev/demo/: ${stale.map((s) => JSON.stringify(s)).join(', ')}.\n` +
      'Pick replacements that exist only in the fixtures (string literals, not identifiers or UI text).',
  )
}

// 2. None of them is in the build.
if (!existsSync(distDir)) fail(`${relative(root, distDir)} does not exist; run \`vite build\` first.`)
const files = walk(distDir, (name) => /\.(js|css|html)$/.test(name))
if (files.length === 0) fail(`${relative(root, distDir)} holds no .js/.css/.html files; is this a build output?`)

const hits = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const sentinel of SENTINELS) {
    let at = text.indexOf(sentinel)
    while (at !== -1) {
      hits.push({ file: relative(root, file), sentinel, at })
      at = text.indexOf(sentinel, at + sentinel.length)
    }
  }
}

if (hits.length > 0) {
  for (const { file, sentinel, at } of hits) console.error(`  ${file}@${at}: ${JSON.stringify(sentinel)}`)
  fail(
    `${hits.length} demo fixture string(s) found in the build. The \`import.meta.env.DEV\` guard around ` +
      "`import('@/dev/demo')` in src/lib/transport.ts (or another import of src/dev/demo) is leaking fixtures " +
      'into a release.',
  )
}

console.log(`check-dist-no-demo: ${files.length} files, ${SENTINELS.length} sentinels, no demo fixtures.`)
