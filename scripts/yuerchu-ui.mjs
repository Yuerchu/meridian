#!/usr/bin/env node
// Copies Yuerchu UI (github.com/Yuerchu/ui, private) into src/components/yuerchu-ui
// and keeps the copy honest.
//
//   node scripts/yuerchu-ui.mjs sync [--commit <rev>] [--add <entry>...] [--remove <entry>...]
//   node scripts/yuerchu-ui.mjs check [--staged] [--upstream]
//
// `sync` reads the library from a local checkout (YUERCHU_UI_DIR, default ../yuerchu-ui)
// at a fixed commit — never its working tree, which another session may be editing —
// follows every relative import from the entries in yuerchu-ui.json, and writes exactly
// that closure. `check` needs no checkout and no network, so CI and forks can run it:
// every copied file still hashes to what the ledger recorded, nothing else is in the
// directory, every relative import resolves inside it, and every package it imports is a
// dependency of this app. `--staged` reads all of that from the index instead of the
// working tree (the pre-commit hook), `--upstream` additionally recomputes the closure from the
// checkout and compares.
//
// There are no patches. A copied file is the library's file; a fix goes to the library
// and comes back with the next sync.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'yuerchu-ui.json')
const TARGET = path.join(ROOT, 'src/components/yuerchu-ui')
const SOURCE_PREFIX = 'packages/ui/src'
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Every module specifier a file imports, in order of appearance. */
export function importSpecifiers(file, text) {
  const found = []
  const patterns = file.endsWith('.css')
    ? [/@import\s+(?:url\(\s*)?["']([^"']+)["']/g]
    : [
        /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*["']([^"']+)["']/g,
        /\bimport\s*["']([^"']+)["']/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push({ index: match.index, spec: match[1] })
  }
  return found.sort((a, b) => a.index - b.index).map((m) => m.spec)
}

export function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../')
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
export function packageName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Resolves a relative specifier the way a bundler does, against a set of known files. */
export function resolveRelative(fromFile, spec, has) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  const candidates = [base]
  for (const ext of SOURCE_EXTENSIONS) candidates.push(base + ext)
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${base}/index${ext}`)
  return candidates.find((candidate) => has(candidate)) ?? null
}

export function licenceFor(file) {
  return file.replace(/\.[^./]+$/, '.LICENSE')
}

/**
 * The files reachable from `entries` through relative imports, and the packages they
 * import. `read(file)` returns the file's text; `has(file)` says whether it exists.
 */
export function closure(entries, read, has) {
  const files = new Set()
  const packages = new Set()
  const unresolved = []
  const queue = []
  for (const entry of entries) {
    if (!has(entry)) unresolved.push({ from: 'yuerchu-ui.json', spec: entry })
    else queue.push(entry)
  }
  while (queue.length > 0) {
    const file = queue.shift()
    if (files.has(file)) continue
    files.add(file)
    // Third-party code carries its licence beside it (lib/icons.tsx → lib/icons.LICENSE).
    // Nothing imports it, so it travels with the file that needs it.
    const licence = licenceFor(file)
    if (has(licence)) files.add(licence)
    for (const spec of importSpecifiers(file, read(file))) {
      if (!isRelative(spec)) {
        if (!spec.startsWith('node:')) packages.add(packageName(spec))
        continue
      }
      const resolved = resolveRelative(file, spec, has)
      if (resolved === null) unresolved.push({ from: file, spec })
      else if (!files.has(resolved)) queue.push(resolved)
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort(), unresolved }
}

/** Where `check` reads this repository from: the working tree, or the index. */
function repoView(staged) {
  const relTarget = path.relative(ROOT, TARGET).split(path.sep).join('/')
  if (!staged) {
    return {
      text: (rel) => readFileSync(path.join(ROOT, rel), 'utf8'),
      bytes: (rel) => readFileSync(path.join(ROOT, rel)),
      copied: localFiles,
    }
  }
  return {
    text: (rel) => git(ROOT, ['show', `:${rel}`]),
    bytes: (rel) => git(ROOT, ['show', `:${rel}`], 'buffer'),
    copied: () =>
      git(ROOT, ['ls-files', '--cached', '--', `${relTarget}/`])
        .split('\n')
        .filter(Boolean)
        .map((file) => file.slice(relTarget.length + 1))
        .sort(),
  }
}

function readLedger() {
  return JSON.parse(readFileSync(LEDGER, 'utf8'))
}

function writeLedger(ledger) {
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`)
}

function sourceDir() {
  return path.resolve(ROOT, process.env.YUERCHU_UI_DIR ?? '../yuerchu-ui')
}

function git(dir, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', dir, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 })
}

/** A read-only view of the library at one commit. */
function upstreamAt(rev) {
  const dir = sourceDir()
  if (!existsSync(path.join(dir, '.git'))) {
    throw new Error(`no Yuerchu UI checkout at ${dir} (set YUERCHU_UI_DIR)`)
  }
  const commit = git(dir, ['rev-parse', '--verify', `${rev}^{commit}`]).trim()
  const listed = git(dir, ['ls-tree', '-r', '--name-only', commit, `${SOURCE_PREFIX}/`])
    .split('\n')
    .filter(Boolean)
    .map((file) => file.slice(SOURCE_PREFIX.length + 1))
  const known = new Set(listed)
  const cache = new Map()
  const bytes = (file) => {
    if (!cache.has(file)) cache.set(file, git(dir, ['show', `${commit}:${SOURCE_PREFIX}/${file}`], 'buffer'))
    return cache.get(file)
  }
  const upstreamPackage = JSON.parse(git(dir, ['show', `${commit}:packages/ui/package.json`]))
  return {
    commit,
    has: (file) => known.has(file),
    read: (file) => bytes(file).toString('utf8'),
    bytes,
    dependencies: upstreamPackage.dependencies ?? {},
  }
}

function localFiles() {
  if (!existsSync(TARGET)) return []
  return readdirSync(TARGET, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(TARGET, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
}

/** Packages the copy imports that this app does not depend on, or pins differently. */
function dependencyProblems(packages, upstreamDependencies, app = appDependencies(repoView(false))) {
  const problems = []
  for (const name of packages) {
    if (name === 'react' || name === 'react-dom') {
      if (!(name in app)) problems.push(`${name} is imported but not a dependency`)
      continue
    }
    if (!(name in app)) {
      const wanted = upstreamDependencies?.[name]
      problems.push(`${name} is imported but not a dependency${wanted ? ` (the library uses ${wanted})` : ''}`)
      continue
    }
    const wanted = upstreamDependencies?.[name]
    if (wanted !== undefined && wanted !== app[name]) {
      problems.push(`${name}: the library pins ${wanted}, this app has ${app[name]}`)
    }
  }
  return problems
}

function appDependencies(view) {
  return JSON.parse(view.text('package.json')).dependencies ?? {}
}

function sync(args) {
  const ledger = readLedger()
  const rev = option(args, '--commit') ?? ledger.source.commit
  const upstream = upstreamAt(rev)
  const entries = new Set(ledger.entries)
  for (const entry of options(args, '--add')) entries.add(entry)
  for (const entry of options(args, '--remove')) entries.delete(entry)
  const sorted = [...entries].sort()

  const result = closure(sorted, upstream.read, upstream.has)
  if (result.unresolved.length > 0) {
    for (const { from, spec } of result.unresolved) console.error(`unresolved: ${spec} (from ${from})`)
    throw new Error('the closure has unresolved imports; nothing was written')
  }

  const keep = new Set(result.files)
  for (const file of localFiles()) {
    if (!keep.has(file)) rmSync(path.join(TARGET, file))
  }
  const files = {}
  for (const file of result.files) {
    const bytes = upstream.bytes(file)
    const destination = path.join(TARGET, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
    files[file] = sha256(bytes)
  }
  removeEmptyDirectories(TARGET)

  const dependencies = {}
  for (const name of result.packages) {
    if (upstream.dependencies[name] !== undefined) dependencies[name] = upstream.dependencies[name]
  }
  writeLedger({
    ...ledger,
    source: { ...ledger.source, commit: upstream.commit },
    entries: sorted,
    dependencies,
    files,
  })
  console.log(`yuerchu-ui: ${result.files.length} files from ${upstream.commit.slice(0, 12)}`)
  const problems = dependencyProblems(result.packages, upstream.dependencies)
  for (const problem of problems) console.error(`dependency: ${problem}`)
  if (problems.length > 0) process.exitCode = 1
}

function check(args) {
  const view = repoView(args.includes('--staged'))
  const ledger = JSON.parse(view.text('yuerchu-ui.json'))
  const relTarget = path.relative(ROOT, TARGET).split(path.sep).join('/')
  const failures = []
  const recorded = ledger.files ?? {}
  const present = view.copied()
  const presentSet = new Set(present)

  for (const file of present) {
    if (!(file in recorded)) failures.push(`${file} is not in yuerchu-ui.json (copied by hand?)`)
  }
  for (const [file, hash] of Object.entries(recorded)) {
    if (!presentSet.has(file)) {
      failures.push(`${file} is in yuerchu-ui.json but missing`)
      continue
    }
    if (sha256(view.bytes(`${relTarget}/${file}`)) !== hash) {
      failures.push(`${file} differs from Yuerchu UI ${ledger.source.commit.slice(0, 12)} — fix it upstream and sync`)
    }
  }

  const read = (file) => view.text(`${relTarget}/${file}`)
  const local = closure(ledger.entries, read, (file) => presentSet.has(file))
  for (const { from, spec } of local.unresolved) failures.push(`unresolved: ${spec} (from ${from})`)
  for (const file of present) {
    if (!local.files.includes(file)) failures.push(`${file} is not reachable from any entry`)
  }
  failures.push(
    ...dependencyProblems(local.packages, ledger.dependencies, appDependencies(view)).map((p) => `dependency: ${p}`),
  )

  if (args.includes('--upstream')) {
    const upstream = upstreamAt(ledger.source.commit)
    const expected = closure(ledger.entries, upstream.read, upstream.has)
    const expectedSet = new Set(expected.files)
    for (const file of expected.files) {
      if (!(file in recorded)) failures.push(`upstream closure has ${file}, the ledger does not`)
      else if (sha256(upstream.bytes(file)) !== recorded[file]) failures.push(`${file}: ledger hash is not upstream's`)
    }
    for (const file of Object.keys(recorded)) {
      if (!expectedSet.has(file)) failures.push(`the ledger has ${file}, the upstream closure does not`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`yuerchu-ui: ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`yuerchu-ui: ${present.length} files match ${ledger.source.commit.slice(0, 12)}`)
}

function removeEmptyDirectories(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(dir, entry.name))
  }
  if (dir !== TARGET && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

function option(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function options(args, name) {
  const values = []
  args.forEach((arg, index) => {
    if (arg === name && args[index + 1] !== undefined) values.push(args[index + 1])
  })
  return values
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'sync') sync(args)
    else if (command === 'check') check(args)
    else {
      console.error(
        'usage: yuerchu-ui.mjs sync [--commit <rev>] [--add <entry>] [--remove <entry>] | check [--staged] [--upstream]',
      )
      process.exitCode = 2
    }
  } catch (error) {
    console.error(`yuerchu-ui: ${error.message}`)
    process.exitCode = 1
  }
}
