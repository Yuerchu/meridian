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
// Specifiers must be `~` (or exact `=`). `^2.11` is what let `pnpm update`
// take @tauri-apps/api to 2.12 while Cargo.lock stayed on tauri 2.11; cargo's
// default `"2.5"` is `^2.5.0` and does the same on `cargo update`.
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

function specAllowsMinorJump(spec) {
  if (typeof spec !== 'string' || spec.length === 0) return true
  return !(spec.startsWith('~') || spec.startsWith('='))
}

/** @tauri-apps packages that pair with a crate, plus the CLI (templates pin it). */
export function looseNpmSpecifiers(pkg) {
  const problems = []
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  for (const [name, spec] of Object.entries(deps)) {
    if (name !== '@tauri-apps/cli' && crateFor(name) == null) continue
    if (specAllowsMinorJump(spec)) {
      problems.push(`${name} specifier ${spec} allows a minor jump; use ~`)
    }
  }
  return problems
}

/** Direct tauri / tauri-build / tauri-plugin-* pins in the shell Cargo.toml. */
export function looseCargoPins(toml) {
  const problems = []
  const re = /^(tauri(?:-build|-plugin-[a-z0-9-]+)?)\s*=\s*(?:\{[^}\n]*version\s*=\s*"([^"]+)"|"([^"]+)")/gm
  for (const m of toml.matchAll(re)) {
    const spec = m[2] ?? m[3]
    if (specAllowsMinorJump(spec)) {
      problems.push(`${m[1]} = ${spec} allows a minor jump; use ~`)
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
  const problems = [
    ...mismatches(cargo, npm),
    ...looseNpmSpecifiers(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))),
    ...looseCargoPins(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')),
  ]
  if (problems.length > 0) {
    console.error(
      'Tauri npm packages and Rust crates must share major.minor (the Tauri CLI refuses otherwise); specifiers must be ~ so an update cannot jump minor alone:',
    )
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`check-tauri-versions: ${npm.size} npm packages agree with their crates`)
}
