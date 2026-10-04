/**
 * 壳层里没有 cfg 拦着、却引用了 Android 上不存在的 core 条目的地方。
 * 原理与局限见 scripts/android-cfg-lib.mjs。
 *
 *   node scripts/check-android-cfg.mjs            读工作树
 *   node scripts/check-android-cfg.mjs --staged   读将要提交的快照（含子模块的固定 commit）
 *   node scripts/check-android-cfg.mjs --rev <c>  读某个历史提交（复现旧事故用）
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { collectAndroidAbsent, findViolations } from './android-cfg-lib.mjs'
import { stagedSnapshot } from './staged-snapshot.mjs'

const root = process.cwd()
const SHELL = 'src-tauri/src'
const CORE = 'src-tauri/crates/core/src'

const git = (args, cwd = root) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function fromWorkingTree(base) {
  const files = {}
  for (const full of walk(join(root, base))) {
    if (full.endsWith('.rs')) files[relative(join(root, base), full).replace(/\\/g, '/')] = readFileSync(full, 'utf8')
  }
  return files
}

function fromStaged(base) {
  const snap = stagedSnapshot(root)
  const files = {}
  for (const path of snap.list(base)) {
    if (path.endsWith('.rs')) files[path.slice(base.length + 1)] = snap.read(path)
  }
  return files
}

/** At a commit: the shell from this repository; the core from wherever it lived then. */
function fromRevision(rev, base) {
  let repo = root
  let treeish = rev
  let inner = base
  const link = git(['ls-tree', rev, 'src-tauri/crates']).trim()
  if (base.startsWith('src-tauri/crates/') && link.startsWith('160000')) {
    repo = join(root, 'src-tauri/crates')
    treeish = link.split(/\s+/)[2]
    inner = base.slice('src-tauri/crates/'.length)
  }
  const files = {}
  for (const path of git(['ls-tree', '-r', '--name-only', treeish, '--', inner], repo).split('\n')) {
    if (path.endsWith('.rs')) files[path.slice(inner.length + 1)] = git(['show', `${treeish}:${path}`], repo)
  }
  return files
}

const args = process.argv.slice(2)
const revAt = args.indexOf('--rev')
const read =
  revAt >= 0 ? (base) => fromRevision(args[revAt + 1], base) : args.includes('--staged') ? fromStaged : fromWorkingTree

const absent = collectAndroidAbsent(read(CORE))
const violations = findViolations(read(SHELL), absent)

if (violations.length === 0) {
  console.log(
    `✓ Android cfg：壳层对 ${absent.paths.length} 个模块/函数、${absent.servicesFields.length + absent.fields.length} 个字段的引用都有 cfg 拦着`,
  )
  process.exit(0)
}
console.error(`✗ Android cfg：${violations.length} 处引用了 Android 上不存在的 core 条目，却没有 cfg 拦着：`)
for (const v of violations) console.error(`  ${SHELL}/${v.file}:${v.line}  ${v.what}`)
console.error(
  '  给引用它的语句、块或条目加上 #[cfg(not(target_os = "android"))]（或 desktop），Android 上需要时另写一支。',
)
process.exit(1)
