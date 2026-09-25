// The Tauri CLI refuses to build when an npm package and the Rust crate it
// pairs with are on different major/minor releases:
//
//   Error Found version mismatched Tauri packages. Make sure the NPM package
//   and Rust crate versions are on the same major/minor releases
//
// Nothing else in CI runs the Tauri CLI — `test` is cargo and vitest,
// `frontend-build` is vite — so that refusal surfaced only on a developer's
// `tauri dev` or at release time. It happened when `cargo update` took
// tauri-plugin-notification to 2.4 while package.json held
// @tauri-apps/plugin-notification at ~2.3. `tauri info` prints the same
// error but exits 0, so it cannot stand in for this.
//
// Reads the resolved versions from both lock files, so it needs no install and
// no build. A crate with no npm counterpart (tauri-plugin-fs) is fine; a pair
// that exists on both sides must agree on major.minor.
//
//   node scripts/check-tauri-versions.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** crate name -> set of resolved versions in src-tauri/Cargo.lock */
export function cargoVersions(lock) {
  const out = new Map()
  for (const block of lock.split('[[package]]')) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1]
    const version = /^version = "([^"]+)"/m.exec(block)?.[1]
    if (!name || !version) continue
    if (!out.has(name)) out.set(name, new Set())
    out.get(name).add(version)
  }
  return out
}

/** npm name -> resolved version of the root importer's direct dependencies */
export function npmVersions(lock) {
  const out = new Map()
  const importer = /^importers:\n\n?  \.:\n([\s\S]*?)(?=^\S|^  \S)/m.exec(lock)?.[1] ?? ''
  const entry = /^      '?(@tauri-apps\/[^':]+)'?:\n        specifier: [^\n]+\n        version: ([^\s(]+)/gm
  for (const m of importer.matchAll(entry)) out.set(m[1], m[2])
  return out
}

/** The crate an npm package pairs with, or null for one with no crate. */
export function crateFor(npmName) {
  if (npmName === '@tauri-apps/api') return 'tauri'
  const plugin = /^@tauri-apps\/plugin-(.+)$/.exec(npmName)
  return plugin ? `tauri-plugin-${plugin[1]}` : null
}

const majorMinor = (v) => v.split('.').slice(0, 2).join('.')

export function mismatches(cargo, npm) {
  const problems = []
  for (const [npmName, npmVersion] of npm) {
    const crate = crateFor(npmName)
    if (!crate || !cargo.has(crate)) continue
    for (const crateVersion of cargo.get(crate)) {
      if (majorMinor(crateVersion) !== majorMinor(npmVersion)) {
        problems.push(`${crate} (v${crateVersion}) : ${npmName} (v${npmVersion})`)
      }
    }
  }
  return problems
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cargo = cargoVersions(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'))
  const npm = npmVersions(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
  if (npm.size === 0) {
    console.error('check-tauri-versions: found no @tauri-apps packages in pnpm-lock.yaml; the parser is stale')
    process.exit(1)
  }
  const problems = mismatches(cargo, npm)
  if (problems.length > 0) {
    console.error('Tauri npm packages and Rust crates must share major.minor (the Tauri CLI refuses otherwise):')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`check-tauri-versions: ${npm.size} npm packages agree with their crates`)
}
