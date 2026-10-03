#!/usr/bin/env node
/**
 * 事务调用图检查器（SeaORM 迁移 Phase 0.1，迁移完成后常驻）。
 *
 * 从每个事务根（Diesel 的 `transaction` / `immediate_transaction` 闭包，SeaORM
 * 能力类型的 `write` / `read` / `nested` 闭包）出发，传递展开它调用到的自由函数，
 * 然后检查：
 *
 *   R1 一个根不能同时用到 Diesel 和 SeaORM——两套连接池，一个事务跨不过去，
 *      原子性会悄无声息地拆成两半。
 *   R2 SeaORM 根的闭包里不能再引用开启它的那个 `Db`——回到连接池会多占一个连接、
 *      读到事务看不见的快照，或者等自己持有的写锁。
 *   R3 Diesel 根里不能传递调用到另一个 `immediate_transaction`——Diesel 不能嵌套
 *      `BEGIN IMMEDIATE`，运行时报 `AlreadyInTransaction`（2026-10-03 queue_enqueue
 *      就是这样在 main 上坏了一个月）。
 *
 * 另外统计两个迁移计数（Diesel ops 调用点、Diesel API 引用）。计数只有在
 * docs/migration-counters.json 存在时才强制"只减不增"：基线在 Phase 2 合入时写入。
 *
 * 用法：node scripts/check-transaction-graph.mjs [--staged] [--write]
 *   --staged  读将要提交的内容（含子模块 pinned commit）
 *   --write   重写 docs/transaction-graph.md
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stagedSnapshot } from './staged-snapshot.mjs'
import { blank, callsIn, functions, lineOf, matching, transactionRoots, useAliases } from './transaction-graph-lib.mjs'

const CRATES = [
  { name: 'core', dir: 'src-tauri/crates/core/src', selfNames: ['meridian_core'] },
  { name: 'shell', dir: 'src-tauri/src', selfNames: [] },
  { name: 'meridiand', dir: 'src-tauri/crates/meridiand/src', selfNames: [] },
]

/** 分析器自检：这些边若找不到，说明解析退化了，而不是代码变干净了。 */
const EXPECTED_EDGES = [
  { file: 'src-tauri/src/commands/provider.rs', module: 'plan_review' },
  { file: 'src-tauri/src/commands/queue.rs', module: 'plan_review' },
]

const DIESEL_SIGNATURE = /\bSqliteConnection\b|\bDbPool\b|\bPooledConn\b/
const DIESEL_BODY = /\bdiesel::|\bschema::/
const SEA_SIGNATURE = /\bWriteTx\b|\bReadTx\b|\bimpl\s+Read\b|&\s*Db\b/
const SEA_BODY = /\bsea_orm::/
/** 闭包文本里直接出现的另一种 ORM。 */
const DIESEL_REGION = /\bdiesel::|\bschema::|\bSqliteConnection\b|\bDbPool\b|\bPooledConn\b/
const SEA_REGION = /\bsea_orm::|\bWriteTx\b|\bReadTx\b/
const DIESEL_API = /\bdiesel::|\bSqliteConnection\b|\bDbPool\b|\bPooledConn\b/g

function modulePath(crateDir, file) {
  const parts = relative(crateDir, file).split(/[\\/]/)
  const last = parts.pop().replace(/\.rs$/, '')
  if (last !== 'mod' && last !== 'lib' && last !== 'main') parts.push(last)
  return parts
}

/** 收集源文件：{ path, crate, module, raw, text } */
export function loadSources(read, list) {
  const files = []
  for (const krate of CRATES) {
    for (const path of list(krate.dir).filter((p) => p.endsWith('.rs'))) {
      const raw = read(path)
      if (raw == null) continue
      files.push({ path, crate: krate, module: modulePath(krate.dir, path), raw, text: blank(raw) })
    }
  }
  // `#[cfg(test)] mod x;` 声明的文件整个算测试代码。
  const testFiles = new Set()
  for (const f of files) {
    for (const m of f.raw.matchAll(/#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g)) {
      const base = [...f.module, m[1]].join('/')
      testFiles.add(`${f.crate.name}|${base}`)
    }
  }
  for (const f of files) f.wholeTest = testFiles.has(`${f.crate.name}|${f.module.join('/')}`)
  return files
}

export function analyze(files) {
  const index = new Map()
  const key = (crate, module, name) => `${crate}|${module.join('::')}|${name}`
  for (const file of files) {
    file.fns = functions(file.text).map((fn) => ({ ...fn, file, test: fn.test || file.wholeTest }))
    file.aliases = useAliases(file.text)
    for (const fn of file.fns) {
      const body = file.text.slice(fn.body[0], fn.body[1])
      fn.diesel = DIESEL_SIGNATURE.test(fn.signature) || DIESEL_BODY.test(body)
      fn.sea = SEA_SIGNATURE.test(fn.signature) || SEA_BODY.test(body)
      fn.immediate = /\.\s*immediate_transaction\s*\(/.test(body)
      fn.opsModule =
        file.crate.name === 'core' && file.module[0] === 'db' && file.module[1] === 'ops' ? file.module[2] : null
      const k = key(file.crate.name, file.module, fn.name)
      if (!index.has(k)) index.set(k, [])
      index.get(k).push(fn)
    }
  }

  const crateByName = (name) => CRATES.find((c) => c.name === name || c.selfNames.includes(name))

  function resolve(file, call, depth = 0) {
    if (depth > 4) return []
    const segs = call.path ? call.path.split('::') : []
    const lookup = (crate, module, name) => index.get(key(crate, module, name)) ?? []
    if (segs.length === 0) {
      const local = lookup(file.crate.name, file.module, call.name)
      if (local.length) return local
      const alias = file.aliases.get(call.name)
      if (alias) return resolveAbsolute(file, alias.split('::'), depth)
      return []
    }
    const alias = file.aliases.get(segs[0])
    if (!['crate', 'super', 'self', ...CRATES.flatMap((c) => c.selfNames)].includes(segs[0]) && alias) {
      return resolveAbsolute(file, [...alias.split('::'), ...segs.slice(1), call.name], depth)
    }
    return resolveAbsolute(file, [...segs, call.name], depth)

    function resolveAbsolute(from, parts, d) {
      let crate = from.crate.name
      let module = [...from.module]
      let rest = [...parts]
      if (rest[0] === 'crate') {
        module = []
        rest.shift()
      } else if (
        crateByName(rest[0]) &&
        rest[0] !== from.crate.name &&
        crateByName(rest[0]).selfNames.includes(rest[0])
      ) {
        crate = crateByName(rest[0]).name
        module = []
        rest.shift()
      } else if (rest[0] === 'self') {
        rest.shift()
      } else if (rest[0] === 'super') {
        while (rest[0] === 'super') {
          module.pop()
          rest.shift()
        }
      } else if (from.aliases.has(rest[0]) && d < 4 && rest.length > 1) {
        return resolveAbsolute(from, [...from.aliases.get(rest[0]).split('::'), ...rest.slice(1)], d + 1)
      } else {
        const name = rest.pop()
        return lookup(crate, [...module, ...rest], name).length
          ? lookup(crate, [...module, ...rest], name)
          : lookup(crate, rest, name)
      }
      const name = rest.pop()
      return lookup(crate, [...module, ...rest], name)
    }
  }

  // 每个调用点解析一次，计数和回调展开都要用。
  const callSites = []
  for (const file of files) {
    for (const fn of file.fns) {
      for (const call of callsIn(file.text, fn.body)) {
        const targets = resolve(file, call)
        if (targets.length) callSites.push({ file, fn, call, targets })
      }
    }
  }

  function innermostFn(file, at) {
    let best = null
    for (const fn of file.fns) if (fn.body[0] < at && at < fn.body[1] && (!best || fn.body[0] > best.body[0])) best = fn
    return best
  }

  /** 从一组种子调用出发的传递闭包。 */
  function reach(seeds) {
    const seen = new Set()
    const queue = [...seeds]
    const reached = []
    while (queue.length) {
      const fn = queue.shift()
      if (seen.has(fn)) continue
      seen.add(fn)
      reached.push(fn)
      for (const call of callsIn(fn.file.text, fn.body)) queue.push(...resolve(fn.file, call))
    }
    return reached
  }

  const roots = []
  for (const file of files) {
    for (const root of transactionRoots(file.text)) {
      const owner = innermostFn(file, root.at)
      const seeds = callsIn(file.text, root.region).flatMap((call) => resolve(file, call))
      const via = []
      // 泛型回调：根里调用了外层函数的某个参数（`f(conn)`），把每个调用点传进来的
      // 那个实参里的调用也算进这个根。
      if (owner) {
        const params = splitArgs(owner.params).map((p) =>
          p
            .split(':')[0]
            .trim()
            .replace(/^mut\s+/, ''),
        )
        for (const call of callsIn(file.text, root.region)) {
          const idx = call.path ? -1 : params.indexOf(call.name)
          if (idx < 0) continue
          // 测试代码里的调用点不进生产根：它传进来的闭包在生产里不会跑。
          for (const site of callSites.filter((s) => s.targets.includes(owner) && !s.fn.test)) {
            const open = site.file.text.indexOf('(', site.call.at)
            const close = matching(site.file.text, open)
            const args = splitArgsWithOffsets(site.file.text, open + 1, close)
            const arg = args[idx - (owner.params.includes('self') ? 1 : 0)]
            if (!arg) continue
            via.push(`${site.file.path}:${lineOf(site.file.text, site.call.at)}`)
            seeds.push(...callsIn(site.file.text, arg).flatMap((c) => resolve(site.file, c)))
          }
        }
      }
      const reached = reach(seeds)
      roots.push({
        ...root,
        file,
        owner,
        test: owner ? owner.test : file.wholeTest,
        reached,
        via,
        modules: [...new Set(reached.map((fn) => fn.opsModule).filter(Boolean))].sort(),
        nestedImmediate:
          /\.\s*immediate_transaction\s*\(/.test(file.text.slice(root.region[0], root.region[1])) ||
          reached.some((fn) => fn.immediate),
      })
    }
  }

  return { files, roots, callSites, resolve }
}

function splitArgs(text) {
  return splitArgsWithOffsets(text, 0, text.length).map(([a, b]) => text.slice(a, b))
}

function splitArgsWithOffsets(text, from, to) {
  const out = []
  let depth = 0
  let start = from
  for (let k = from; k < to; k++) {
    const ch = text[k]
    if ('([{<'.includes(ch) && !(ch === '<' && text[k - 1] === ' ')) depth++
    else if (')]}'.includes(ch) || (ch === '>' && text[k - 1] !== '-' && text[k - 1] !== '=')) depth--
    else if (ch === ',' && depth === 0) {
      out.push([start, k])
      start = k + 1
    }
  }
  if (text.slice(start, to).trim()) out.push([start, to])
  return out
}

export function violations({ roots }) {
  const problems = []
  const where = (root) => `${root.file.path}:${lineOf(root.file.text, root.at)}`
  for (const root of roots) {
    if (root.test) continue
    const sea = root.kind.startsWith('sea-')
    const diesel = root.reached.filter((fn) => fn.diesel && !fn.test)
    const seaFns = root.reached.filter((fn) => fn.sea && !fn.test)
    // 闭包里直接写的另一种 ORM 调用（`sea_orm::…`、`diesel::insert_into`）是外部
    // crate 的函数，解析不到索引里，只能看闭包本身的文本。
    const body = root.file.text.slice(root.body[0], root.body[1])
    if (sea && (diesel.length || DIESEL_REGION.test(body))) {
      problems.push(`R1 ${where(root)}: SeaORM 事务里用到了 Diesel：${names(diesel) || '闭包内直接调用'}`)
    }
    if (!sea && (seaFns.length || SEA_REGION.test(body))) {
      problems.push(`R1 ${where(root)}: Diesel 事务里用到了 SeaORM：${names(seaFns) || '闭包内直接调用'}`)
    }
    // 闭包参数和接收者同名（`tx.nested(async |tx| …)`）时，里面出现的都是参数。
    if (sea && root.receiver && !root.params.includes(root.receiver)) {
      // 路径段（`crate::db::ops`）里的同名标识符不是那个句柄。
      const handle = new RegExp(String.raw`(?<![\w.:])` + escapeRegExp(root.receiver) + String.raw`(?![\w:])`)
      if (handle.test(body)) {
        problems.push(`R2 ${where(root)}: 事务闭包里又引用了开启它的 \`${root.receiver}\`，应该用事务本身`)
      }
    }
    if (!sea && root.nestedImmediate) {
      const culprits = root.reached.filter((fn) => fn.immediate)
      problems.push(
        `R3 ${where(root)}: Diesel 事务里嵌套了 immediate_transaction` +
          (culprits.length ? `（经由 ${names(culprits)}）` : '（在闭包内）') +
          '，运行时会报 AlreadyInTransaction；改调 _in_transaction 变体',
      )
    }
  }
  return problems
}

/** R2 查不了的根：接收者是一次调用的结果，静态上认不出是哪个池。不算失败，但要看得见。 */
export function uncheckedReceivers({ roots }) {
  return roots
    .filter((r) => !r.test && r.kind.startsWith('sea-') && r.receiver === null)
    .map((r) => `${r.file.path}:${lineOf(r.file.text, r.at)}`)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function names(fns) {
  return [...new Set(fns.map((fn) => `${fn.file.module.join('::') || fn.file.crate.name}::${fn.name}`))].join('、')
}

export function counters({ files, callSites }) {
  const dieselOpsCalls = callSites.filter(
    (s) => !s.fn.file.path.includes('/db/ops/') && s.targets.some((t) => t.opsModule && t.diesel),
  ).length
  let dieselApiRefs = 0
  for (const file of files) dieselApiRefs += (file.text.match(DIESEL_API) ?? []).length
  return { dieselOpsCalls, dieselApiRefs }
}

export function expectedEdgeProblems({ roots }) {
  return EXPECTED_EDGES.filter(
    (edge) => !roots.some((r) => r.file.path === edge.file && r.modules.includes(edge.module)),
  ).map((edge) => `分析器自检失败：${edge.file} 应有事务根触及 ops::${edge.module}，没找到——是解析退化了`)
}

export function render({ roots }, counts) {
  const live = roots.filter((r) => !r.test)
  const parent = new Map()
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
  for (const r of live) for (const m of r.modules) if (!parent.has(m)) parent.set(m, m)
  for (const r of live) for (const m of r.modules.slice(1)) parent.set(find(m), find(r.modules[0]))
  const groups = new Map()
  for (const m of parent.keys()) {
    const g = find(m)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(m)
  }
  const components = [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1))

  const rows = live
    .map((r) => {
      const owner = r.owner ? r.owner.name : '(顶层)'
      const via = r.via.length ? ` · 回调来自 ${r.via.length} 处` : ''
      return `| \`${r.file.path}\` › \`${owner}\` | ${r.kind} | ${r.modules.join(', ') || '—'}${via} |`
    })
    .sort()
  const unchecked = live
    .filter((r) => r.kind.startsWith('sea-') && r.receiver === null)
    .map((r) => `\`${r.file.path}\` › \`${r.owner ? r.owner.name : '(顶层)'}\``)
    .sort()

  return [
    '# 事务调用图',
    '',
    '由 `node scripts/check-transaction-graph.mjs --write` 生成，不要手改。',
    '规则与用途见脚本头注释；SeaORM 迁移按这里的连通分量和事务根分期。',
    '',
    `- 事务根（非测试）：${live.length}`,
    `- Diesel ops 调用点（db/ops 之外）：${counts.dieselOpsCalls}`,
    `- Diesel API 引用：${counts.dieselApiRefs}`,
    '',
    '## R2 无法检查的 SeaORM 事务根',
    '',
    '接收者是一次调用的结果（`get_db().write(…)`），静态上认不出闭包里哪个句柄是同一个池。',
    '',
    ...(unchecked.length ? unchecked.map((u) => `- ${u}`) : ['- 无']),
    '',
    '## ops 模块的事务连通分量',
    '',
    ...components.map((c) => `- ${c.length} 个：${c.join(' ')}`),
    '',
    '## 事务根',
    '',
    '| 位置 | 类型 | 触及的 ops 模块 |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function main() {
  const root = join(fileURLToPath(import.meta.url), '..', '..')
  const staged = process.argv.includes('--staged')
  const write = process.argv.includes('--write')
  let read
  let list
  if (staged) {
    ;({ read, list } = stagedSnapshot(root))
  } else {
    read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null)
    list = (dir) => {
      const out = []
      const walk = (d) => {
        for (const name of readdirSync(join(root, d))) {
          const p = `${d}/${name}`
          if (statSync(join(root, p)).isDirectory()) walk(p)
          else out.push(p)
        }
      }
      if (existsSync(join(root, dir))) walk(dir)
      return out
    }
  }

  const graph = analyze(loadSources(read, list))
  const counts = counters(graph)
  const problems = [...violations(graph), ...expectedEdgeProblems(graph)]
  for (const where of uncheckedReceivers(graph)) {
    console.warn(`⚠ R2 无法检查 ${where}：接收者是一次调用的结果，认不出是哪个池`)
  }

  const baselinePath = 'docs/migration-counters.json'
  const baselineRaw = read(baselinePath)
  if (baselineRaw != null) {
    const baseline = JSON.parse(baselineRaw)
    for (const [name, value] of Object.entries(counts)) {
      if (!(name in baseline)) problems.push(`${baselinePath} 缺少计数 ${name}`)
      else if (value > baseline[name]) problems.push(`计数 ${name} 从 ${baseline[name]} 涨到 ${value}：只减不增`)
    }
  }

  const docPath = 'docs/transaction-graph.md'
  const doc = render(graph, counts)
  if (write) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, docPath), doc)
  } else if (read(docPath) !== doc) {
    problems.push(`${docPath} 过期：运行 node scripts/check-transaction-graph.mjs --write 并提交`)
  }

  if (problems.length) {
    console.error(`✗ 事务调用图有 ${problems.length} 个问题：`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(
    `✓ 事务调用图：${graph.roots.filter((r) => !r.test).length} 个事务根，` +
      `Diesel ops 调用点 ${counts.dieselOpsCalls}，Diesel API 引用 ${counts.dieselApiRefs}`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].split(sep).join(sep)) main()
