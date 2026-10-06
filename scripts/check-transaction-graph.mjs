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
 *   R0 Diesel 事务的实参必须是闭包字面量。具名闭包和函数项跟不进去，与其当它不存在，
 *      不如拒绝这种写法。
 *
 * 它是近似解析（正则 + 括号匹配），不是 Rust 解析器。看不见的东西，按设计：
 *   - 方法调用和 trait 分派（`.save(conn)`、`store.write(..)`）——要类型信息；
 *   - SeaORM 的 `db.write(op)` 这种具名闭包——`.write(` 与 io::Write 同名，非 async
 *     闭包字面量的实参无法确认是事务，所以不能像 R0 那样一律拒绝；
 *   - 接收者是调用结果的 SeaORM 根（`get_db().write(..)`）——R2 查不了，列在生成的
 *     文档里并告警；
 *   - 宏展开出来的代码。
 * 能力类型（写只能经 WriteTx）和运行时守卫是另外两层防线，这里是第三层。
 *
 * 另外统计迁移进度：两个计数（Diesel ops 调用点、Diesel API 引用）、还没有 entity 的表
 * （db/entity/mod.rs 的 PENDING_TABLES），和双实现登记（docs/dual-impl.md：db/ops 与
 * db/sea/ops 里同名的一对 pub fn，带 Diesel 那边剩余的调用点数）。计数和表单只有在
 * docs/migration-counters.json 存在时才强制"只减不增、只认已知的名字"：基线在 Phase 2c 写入。
 *
 * 用法：node scripts/check-transaction-graph.mjs [--staged] [--write]
 *   --staged  读将要提交的内容（含子模块 pinned commit）
 *   --write   重写 docs/transaction-graph.md
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stagedSnapshot } from './staged-snapshot.mjs'
import { aliasScopes, blank, callsIn, functions, lineOf, matching, transactionRoots } from './transaction-graph-lib.mjs'

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
// `impl Read` 不在这里：`std::io::Read` 同名，要看导入的是哪一个（见 isSeaReadBound）。
const SEA_SIGNATURE = /\bWriteTx\b|\bReadTx\b|\bimpl\s+(?:[\w:]*::)?cap::Read\b|&\s*Db\b/
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
    file.aliases = aliasScopes(file.text)
    for (const fn of file.fns) {
      const body = file.text.slice(fn.body[0], fn.body[1])
      fn.diesel = DIESEL_SIGNATURE.test(fn.signature) || DIESEL_BODY.test(body)
      fn.sea = SEA_SIGNATURE.test(fn.signature) || isSeaReadBound(file, fn) || SEA_BODY.test(body)
      fn.immediate = /\.\s*immediate_transaction\s*\(/.test(body)
      // db/ops/<m> and db/sea/ops/<m> both count as ops module <m>: the graph
      // names the table a root touches, and the kind column says which pool.
      fn.opsModule =
        file.crate.name === 'core' && file.module[0] === 'db'
          ? file.module[1] === 'ops'
            ? file.module[2]
            : file.module[1] === 'sea' && file.module[2] === 'ops'
              ? file.module[3]
              : null
          : null
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
    const aliasOf = (name) => file.aliases.get(name, call.at)
    if (segs.length === 0) {
      const local = lookup(file.crate.name, file.module, call.name)
      if (local.length) return local
      const alias = aliasOf(call.name)
      if (alias) return resolveAbsolute(file, alias.split('::'), depth)
      return []
    }
    const alias = aliasOf(segs[0])
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
      } else if (aliasOf(rest[0]) && d < 4 && rest.length > 1) {
        return resolveAbsolute(from, [...aliasOf(rest[0]).split('::'), ...rest.slice(1)], d + 1)
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
      const direct = directOrm(file, root.body)
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
            // 实参里直接写的 ORM 调用解析不到索引，和闭包本身一样按文本和导入看。
            const fromArg = directOrm(site.file, arg)
            direct.diesel ||= fromArg.diesel
            direct.sea ||= fromArg.sea
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
        direct,
        modules: [...new Set(reached.map((fn) => fn.opsModule).filter(Boolean))].sort(),
        nestedImmediate:
          /\.\s*immediate_transaction\s*\(/.test(file.text.slice(root.region[0], root.region[1])) ||
          reached.some((fn) => fn.immediate),
      })
    }
  }

  return { files, roots, callSites, resolve }
}

/**
 * 一段代码里直接用到的 ORM：文本里的 `diesel::`/`sea_orm::` 等标记，加上经 `use`
 * 导入后裸调用的外部函数（`use diesel::insert_into; insert_into(…)`）。
 */
function directOrm(file, [from, to]) {
  const text = file.text.slice(from, to)
  const found = { diesel: DIESEL_REGION.test(text), sea: SEA_REGION.test(text) }
  for (const call of callsIn(file.text, [from, to])) {
    const segs = call.path ? call.path.split('::') : [call.name]
    const alias = file.aliases.get(segs[0], call.at)
    const full = alias ? [alias, ...segs.slice(1)].join('::') : segs.join('::')
    if (/^(?:::)?diesel::/.test(full) || /^(?:::)?diesel$/.test(full)) found.diesel = true
    if (/^(?:::)?sea_orm::/.test(full) || /^(?:::)?sea_orm$/.test(full)) found.sea = true
  }
  return found
}

/** `impl Read` 是不是能力类型那个 `Read`：看这个函数所在位置导入的 `Read` 来自哪里。 */
function isSeaReadBound(file, fn) {
  if (!/\bimpl\s+Read\b/.test(fn.signature)) return false
  const path = file.aliases.get('Read', fn.at)
  return Boolean(path && /(?:^|::)cap::Read$/.test(path))
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
    if (root.opaque) {
      problems.push(`R0 ${where(root)}: 事务的实参不是闭包字面量（具名闭包或函数项），检查器跟不进去；改成内联闭包`)
      continue
    }
    const sea = root.kind.startsWith('sea-')
    const diesel = root.reached.filter((fn) => fn.diesel && !fn.test)
    const seaFns = root.reached.filter((fn) => fn.sea && !fn.test)
    // 闭包（和回调实参）里直接用的另一种 ORM 是外部 crate 的函数，解析不到索引里，
    // 由 directOrm 按文本和导入另看。
    const body = root.file.text.slice(root.body[0], root.body[1])
    if (sea && (diesel.length || root.direct.diesel)) {
      problems.push(`R1 ${where(root)}: SeaORM 事务里用到了 Diesel：${names(diesel) || '闭包内直接调用'}`)
    }
    if (!sea && (seaFns.length || root.direct.sea)) {
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

const PENDING_TABLES_FILE = 'src-tauri/crates/core/src/db/entity/mod.rs'

/**
 * `PENDING_TABLES` 的内容：`pub const PENDING_TABLES: &[&str] = &[` 之后每行一个
 * `    "name",`。找不到、格式不对、没排序、有重复都是硬错误——这个常量就是为了被
 * 解析才写成那样，解析不了就不能假装它是空的。读的是原文，不是抹掉字符串的那份。
 */
export function parsePendingTables(source) {
  const match = /pub const PENDING_TABLES: &\[&str\] = &\[([\s\S]*?)\];/.exec(source)
  if (!match) {
    throw new Error(
      `${PENDING_TABLES_FILE} 里找不到 \`pub const PENDING_TABLES: &[&str] = &[ … ];\`，检查器按这个写法解析`,
    )
  }
  const names = []
  for (const line of match[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const item = /^"([a-z][a-z0-9_]*)",$/.exec(line)
    if (!item) throw new Error(`PENDING_TABLES 的每一项必须是 \`"table_name",\` 一行一个，这一行不是：${line}`)
    names.push(item[1])
  }
  for (let k = 1; k < names.length; k++) {
    if (names[k - 1] >= names[k]) throw new Error(`PENDING_TABLES 必须排序且不重复：${names[k - 1]} 后面是 ${names[k]}`)
  }
  return names
}

export function counters({ files, callSites }) {
  const dieselOpsCalls = callSites.filter(
    (s) => !s.fn.file.path.includes('/db/ops/') && s.targets.some((t) => t.opsModule && t.diesel),
  ).length
  let dieselApiRefs = 0
  for (const file of files) dieselApiRefs += (file.text.match(DIESEL_API) ?? []).length
  const entityMod = files.find((f) => f.path === PENDING_TABLES_FILE)
  if (!entityMod)
    throw new Error(`找不到 ${PENDING_TABLES_FILE}：PENDING_TABLES 是迁移进度的一部分，没有它就没有可比的基线`)
  return { dieselOpsCalls, dieselApiRefs, pendingTables: parsePendingTables(entityMod.raw) }
}

/**
 * 计数必须等于提交的基线：涨了是倒退；降了也要把基线跟下去，否则 100 → 80
 * 之后再涨回 99 也能通过，"只减不增"就只剩一个天花板。
 *
 * 数组（pendingTables）按集合比：现在的每个名字都得在基线里——共存期新建的表自带
 * entity，不进待办；少了名字就把基线更新成当前列表。同样是"只减"，减的是名字。
 */
export function baselineProblems(counts, baseline, baselinePath) {
  const problems = []
  for (const [name, value] of Object.entries(counts)) {
    if (!(name in baseline)) {
      problems.push(`${baselinePath} 缺少计数 ${name}`)
      continue
    }
    const expected = baseline[name]
    if (Array.isArray(value)) {
      if (!Array.isArray(expected)) {
        problems.push(`${baselinePath} 里的 ${name} 必须是数组`)
        continue
      }
      const known = new Set(expected)
      const strangers = value.filter((item) => !known.has(item))
      for (const item of strangers) {
        problems.push(`\`${item}\` 不在基线里：共存期新建的表必须带 entity，不得进 PENDING_TABLES`)
      }
      if (strangers.length === 0 && value.length < expected.length) {
        const gone = expected.filter((item) => !value.includes(item))
        problems.push(
          `${name} 从 ${expected.length} 降到 ${value.length}（${gone.join('、')} 有 entity 了）：把 ${baselinePath} 里的基线更新为当前列表`,
        )
      }
      continue
    }
    if (value > expected) problems.push(`计数 ${name} 从 ${expected} 涨到 ${value}：只减不增`)
    else if (value < expected) {
      problems.push(`计数 ${name} 从 ${expected} 降到 ${value}：把 ${baselinePath} 里的基线更新为 ${value}`)
    }
  }
  return problems
}

export const DUAL_IMPL_DOC = 'docs/dual-impl.md'

/** `fn` 前面是不是 `pub`（含 `pub(crate)`），中间允许 `async` / `unsafe` / `const`。 */
function isPub(text, at) {
  return /\bpub(?:\([^)]*\))?\s+(?:(?:async|unsafe|const)\s+)*$/.test(text.slice(Math.max(0, at - 60), at))
}

/**
 * 双实现：db/sea/ops/<module>.rs 里的 pub fn，在 db/ops/<module>.rs 里有同名的那一个
 * （Diesel 版本）。每一对记下 Diesel 版本在 db/ops 之外还剩多少调用点——和 dieselOpsCalls
 * 同一口径，含测试代码：测试还在调它，它就还删不掉。
 *
 * 看不见的绕法：SeaORM 版本换个名字写就不是一对，这张表看不见它。兜住它的只有
 * dieselOpsCalls 只减不增——新的 Diesel 调用点进不来，旧的只能往 SeaORM 挪。
 */
export function dualImplementations({ files, callSites }) {
  const isModule = (file, ...prefix) =>
    file.crate.name === 'core' &&
    file.module.length === prefix.length + 1 &&
    prefix.every((segment, k) => file.module[k] === segment)
  const pairs = []
  for (const file of files) {
    if (!isModule(file, 'db', 'sea', 'ops')) continue
    const module = file.module[3]
    const dieselFns = files
      .filter((f) => isModule(f, 'db', 'ops') && f.module[2] === module)
      .flatMap((f) => f.fns.filter((fn) => !fn.test))
    for (const fn of file.fns) {
      if (fn.test || !isPub(file.text, fn.at)) continue
      const diesel = dieselFns.filter((twin) => twin.name === fn.name)
      if (!diesel.length) continue
      const remaining = callSites.filter(
        (s) => !s.fn.file.path.includes('/db/ops/') && s.targets.some((t) => diesel.includes(t)),
      ).length
      pairs.push({ module, name: fn.name, remaining })
    }
  }
  return pairs.sort((a, b) => (`${a.module}::${a.name}` < `${b.module}::${b.name}` ? -1 : 1))
}

/**
 * docs/dual-impl.md 必须恰好登记这些对：一行 `| module::name | 剩余 Diesel 调用点 |`。
 * 少一行、多一行、数字不对都是红；剩余调用点为 0 的那一对也是红——那时该删掉
 * Diesel 版本，而不是让两份永远并存。
 */
export function dualImplProblems(pairs, doc) {
  if (doc == null) return [`${DUAL_IMPL_DOC} 不存在：双实现登记表必须在，哪怕是空的`]
  const problems = []
  const rows = new Map()
  for (const m of doc.matchAll(/^\|\s*(\w+::\w+)\s*\|\s*(\d+)\s*\|\s*$/gm)) {
    if (rows.has(m[1])) problems.push(`${DUAL_IMPL_DOC} 里 ${m[1]} 登记了两次`)
    rows.set(m[1], Number(m[2]))
  }
  const seen = new Set()
  for (const { module, name, remaining } of pairs) {
    const key = `${module}::${name}`
    seen.add(key)
    if (!rows.has(key)) {
      problems.push(
        `${DUAL_IMPL_DOC} 缺少 ${key}（剩余 Diesel 调用点 ${remaining}）：加一行 \`| ${key} | ${remaining} |\``,
      )
    } else if (rows.get(key) !== remaining) {
      problems.push(`${DUAL_IMPL_DOC} 里 ${key} 的剩余 Diesel 调用点写的是 ${rows.get(key)}，实际 ${remaining}`)
    }
    if (remaining === 0) {
      problems.push(
        `${key} 的 Diesel 版本已经没有调用点：删掉 db/ops/${module}.rs 里的 ${name}（和登记表里的这一行），不要让两份永远并存`,
      )
    }
  }
  for (const key of rows.keys()) {
    if (!seen.has(key)) problems.push(`${DUAL_IMPL_DOC} 多出 ${key}：db/sea/ops 与 db/ops 里不是一对同名 pub fn`)
  }
  return problems
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
  let counts
  try {
    counts = counters(graph)
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exit(1)
  }
  const problems = [...violations(graph), ...expectedEdgeProblems(graph)]
  for (const where of uncheckedReceivers(graph)) {
    console.warn(`⚠ R2 无法检查 ${where}：接收者是一次调用的结果，认不出是哪个池`)
  }

  const baselinePath = 'docs/migration-counters.json'
  const baselineRaw = read(baselinePath)
  if (baselineRaw != null) problems.push(...baselineProblems(counts, JSON.parse(baselineRaw), baselinePath))
  problems.push(...dualImplProblems(dualImplementations(graph), read(DUAL_IMPL_DOC)))

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
      `Diesel ops 调用点 ${counts.dieselOpsCalls}，Diesel API 引用 ${counts.dieselApiRefs}，` +
      `待迁移的表 ${counts.pendingTables.length}，双实现 ${dualImplementations(graph).length} 对`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].split(sep).join(sep)) main()
