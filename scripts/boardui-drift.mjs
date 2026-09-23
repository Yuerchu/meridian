#!/usr/bin/env node
// What the vendored BoardUI files differ from the registry by, and whether the
// registry has moved since they were installed.
//
// `boardui.json` records, per registry item, the local files it installed, the
// sha256 of each file's registry content at install time, and the patches this
// project deliberately carries (the React Aria interaction contract, and the
// few API additions that have callers). This script fetches every item again
// and reports two things:
//
//   upstream updated  — the registry content no longer matches the recorded
//                       sha: someone should re-install and re-apply patches.
//   local drift       — a diff of registry vs local, both run through the
//                       repository's Prettier config, so a reviewer can check
//                       that what remains is only what `patches` lists.
//
// A network failure is an error, never a pass: a drift check that cannot see
// the registry has checked nothing.
//
//   node scripts/boardui-drift.mjs            # all items
//   node scripts/boardui-drift.mjs button tabs

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'boardui.json'), 'utf8'))
const registry = manifest.registry.replace(/\/$/, '')
const only = process.argv.slice(2)

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** Registry paths are `components/…`, `styles/…`, `utils/…`; local ones sit under `src/`. */
const localPathOf = (registryPath) => `src/${registryPath}`

async function fetchItem(name) {
  const url = `${registry}/${name}.json`
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(`cannot reach ${url}: ${error.cause?.message ?? error.message}`)
  }
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  const json = await response.json()
  if (!Array.isArray(json.files)) throw new Error(`${url} has no files[]`)
  return json
}

async function format(text, filepath) {
  const options = (await prettier.resolveConfig(join(root, filepath))) ?? {}
  return prettier.format(text, { ...options, filepath: join(root, filepath) })
}

function diff(upstream, local) {
  const dir = mkdtempSync(join(tmpdir(), 'boardui-drift-'))
  try {
    writeFileSync(join(dir, 'upstream'), upstream)
    writeFileSync(join(dir, 'local'), local)
    const result = spawnSync('git', ['diff', '--no-index', '--no-color', 'upstream', 'local'], {
      cwd: dir,
      encoding: 'utf8',
    })
    if (result.error) throw result.error
    // 0 = identical, 1 = differs; anything else is git failing.
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr)
    return result.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let updated = 0
let drifted = 0
let failed = 0

for (const [name, item] of Object.entries(manifest.items)) {
  if (only.length > 0 && !only.includes(name)) continue
  let remote
  try {
    remote = await fetchItem(name)
  } catch (error) {
    console.error(`✖ ${name}: ${error.message}`)
    failed++
    continue
  }

  console.log(`\n■ ${name}`)
  for (const patch of item.patches ?? []) console.log(`  patch: ${patch}`)

  const remoteByLocal = new Map(remote.files.map((file) => [localPathOf(file.target ?? file.path), file]))
  for (const localPath of item.files) {
    const file = remoteByLocal.get(localPath)
    if (!file) {
      console.log(`  ✖ ${localPath}: no longer part of the registry item`)
      updated++
      continue
    }
    const recorded = item.upstream?.[localPath]
    const current = sha256(file.content)
    if (recorded !== current) {
      console.log(
        `  ▲ upstream updated: ${localPath} (recorded ${recorded?.slice(0, 12)}…, now ${current.slice(0, 12)}…)`,
      )
      updated++
    }
    let local
    try {
      local = readFileSync(join(root, localPath), 'utf8')
    } catch {
      console.log(`  ✖ ${localPath}: missing locally`)
      drifted++
      continue
    }
    const patch = diff(await format(file.content, localPath), await format(local, localPath))
    if (patch.trim() === '') {
      console.log(`  = ${localPath}: identical to the registry`)
    } else {
      drifted++
      console.log(`  ≠ ${localPath}: local drift (review against the patches above)`)
      console.log(
        patch
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      )
    }
  }
  for (const file of remote.files) {
    const localPath = localPathOf(file.target ?? file.path)
    if (!item.files.includes(localPath)) console.log(`  + registry now also ships ${localPath}`)
  }
}

console.log(`\n${updated} upstream update(s), ${drifted} file(s) with local drift, ${failed} item(s) unreachable`)
if (failed > 0) process.exit(2)
if (updated > 0) process.exit(1)
