#!/usr/bin/env node
/**
 * 把 migrations/ 在一个真实的内存 SQLite 里跑一遍，和 src/dev/schema-data.ts 对账。
 *
 * 那份数据一半是散文——为什么 parent_id 不建外键、为什么 NULL 和 0 是两个答案——
 * 这半边只能人写。另一半是纯事实：有哪些表、哪些列、什么类型、外键删的时候怎么走。
 * 事实那半边一旦和迁移对不上，整张图就开始骗人，而且骗得很有说服力。
 *
 * **用真实 SQLite 而不是手写 SQL 解析器**,是因为手写的那版会在关键处答错。它把
 * `ALTER TABLE ... RENAME TO` 当成只改表名,而 SQLite 3.25 起会同时改写其它表里
 * 指向它的 REFERENCES 子句——两种 foreign_keys 设置下都会(在 3.50.4 上实测过)。
 * 迁移 24 正是这个形状,后果见下面的 KNOWN_DEVIATIONS。一个会在重命名上答错的
 * 校验器,恰好在最需要它的地方沉默。
 *
 * 重放条件对齐 `db/mod.rs:78`:迁移就是在 `PRAGMA foreign_keys=OFF` 下跑的。
 *
 *   pnpm schema:check            核对工作树
 *   pnpm schema:check --staged   核对暂存区(pre-commit 用这个)
 *   pnpm schema                  打开画布(#playground/schema)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const SELF = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SELF), '..')
const MIG_DIR = 'src-tauri/crates/core/migrations'
const DATA_REL = 'src/dev/schema-data.ts'

const STAGED = process.argv.includes('--staged')

// ── 运行时门槛 ──────────────────────────────────────────────────
// 两个特性:直接 import .ts(类型擦除,Node 22.18 起默认可用)和 node:sqlite。
// 这个脚本挂在 pre-commit 上,所以宁可自己先说清楚,也不要让人对着
// ERR_UNKNOWN_FILE_EXTENSION 猜。
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `✗ 需要 Node >= 22.18（当前 ${process.versions.node}）。\n` +
      `  这个脚本直接 import 一个 .ts 文件，靠的是 Node 自带的类型擦除。\n` +
      `  升级 Node，或临时用 node --experimental-strip-types scripts/check-db-schema.mjs`,
  )
  process.exit(1)
}

// node:sqlite 在 Node 22 上要 flag，23+ 不用。先试，不行就带着 flag 重启自己，
// 这样调用方永远只需要 `node scripts/check-db-schema.mjs`。
let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  if (process.execArgv.includes('--experimental-sqlite')) {
    console.error('✗ 这个 Node 没有 node:sqlite，无法重放迁移。需要 Node >= 22.5。')
    process.exit(1)
  }
  const r = spawnSync(process.execPath, ['--experimental-sqlite', SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  process.exit(r.status ?? 1)
}

// ── 取内容:工作树还是暂存区 ─────────────────────────────────────
// pre-commit 要校验的是**将要提交的东西**。读工作树的话,暂存了迁移、却把
// schema-data.ts 的修改留在工作区没暂存,校验会通过而提交进去的两半对不上。
const git = (args, quiet = false) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // git 自己的 fatal 会直接写到终端，盖过脚本要说的话
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'],
  })

function readAt(relPath) {
  if (!STAGED) return readFileSync(join(ROOT, relPath), 'utf8')
  try {
    return git(['show', `:${relPath}`], true)
  } catch {
    return null // 暂存区里没有这个文件（未跟踪 / 未暂存 / 已删除）
  }
}

function migrationFiles() {
  if (!STAGED) {
    return readdirSync(join(ROOT, MIG_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${MIG_DIR}/${d.name}/up.sql`)
      .sort()
  }
  return git(['ls-files', '--cached', '--', MIG_DIR])
    .split('\n')
    .filter((p) => p.endsWith('/up.sql'))
    .sort()
}

// ── 真实重放 ────────────────────────────────────────────────────
function replayMigrations() {
  const db = new DatabaseSync(':memory:')
  // 和 db/mod.rs 一致:迁移期间外键是关的,好让重建表的 DROP 不触发 ON DELETE。
  db.exec('PRAGMA foreign_keys=OFF')

  for (const file of migrationFiles()) {
    const sql = readAt(file)
    if (sql == null) continue
    try {
      db.exec(sql)
    } catch (e) {
      console.error(`✗ 迁移执行失败：${file}\n  ${e.message}`)
      process.exit(1)
    }
  }

  const tables = new Map()
  const rows = db
    .prepare(
      "select name from sqlite_master where type='table' " +
        "and name not like 'sqlite_%' and name not like '__diesel%' order by name",
    )
    .all()

  for (const { name } of rows) {
    const cols = new Map()
    for (const c of db.prepare(`PRAGMA table_info("${name}")`).all()) {
      cols.set(c.name, {
        name: c.name,
        type: String(c.type || '').toUpperCase(),
        notNull: c.notnull === 1,
        pk: c.pk > 0,
        default: c.dflt_value,
      })
    }
    const fks = db
      .prepare(`PRAGMA foreign_key_list("${name}")`)
      .all()
      .map((f) => ({
        from: f.from,
        to: f.to,
        table: f.table,
        onDelete: (f.on_delete || 'NO ACTION').toUpperCase(),
      }))
    tables.set(name, { name, cols, fks })
  }
  return tables
}

// ── 读画布数据 ──────────────────────────────────────────────────
// 直接 import 那个 .ts:schema-data.ts 全是可擦除语法(interface / type / 注解),
// 没有 enum 和 namespace。--staged 时先把暂存版本落到临时文件,因为类型擦除
// 作用于文件而不是字符串。
async function loadDocData() {
  let file = join(ROOT, DATA_REL)
  let tmp = null
  if (STAGED) {
    const src = readAt(DATA_REL)
    if (src == null) {
      // 迁移进了暂存区、这份数据却没有，正是这个校验存在的理由：两半必须一起提交。
      console.error(
        `✗ ${DATA_REL} 不在暂存区里（未跟踪，或改了没 git add）。\n` +
          `  迁移和这份数据得一起提交，否则提交历史里会出现一个「结构变了但图没变」的版本。\n` +
          `  git add ${DATA_REL}`,
      )
      process.exit(1)
    }
    tmp = mkdtempSync(join(tmpdir(), 'meridian-schema-'))
    file = join(tmp, 'schema-data.ts')
    writeFileSync(file, src)
  }
  try {
    const mod = await import(pathToFileURL(file).href)
    if (!mod.TABLES || !mod.EDGES) throw new Error(`${DATA_REL} 没有导出 TABLES / EDGES`)
    return mod
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * 被 SQLite 改写过目标表的外键。
 *
 * 这**不是**一个「跳过比较」的名单。第一版是那么写的,拿两个 key 把整条边屏蔽掉,
 * 结果是两个洞:修好之后它不会提醒自己该退休,而这条边的 ON DELETE 被人改坏也照样放行
 * ——恰恰是在唯一一处已知有问题的地方停止了检查。
 *
 * 现在它只做一件很窄的事:把 SQL 侧那条边的**目标表名**还原成本意,然后交回去照常比对。
 * 列名、ON DELETE、以及数据侧那条边是否存在,统统还在检查范围内。规则没被用到,说明
 * 库里已经不是这样了,那就该报出来让人删掉它。
 *
 * 相应地,数据里那条边必须标成 `kind: 'broken'` 并写明 `actualTarget`——两边互为对方的
 * 证据:图上说它坏了,库里就必须真的坏着;库里坏着,图上就不许画成一条正常外键。
 */
const REWRITTEN_REFERENCES = [
  {
    from: 'tool_permissions',
    col: 'mcp_server_id',
    /** 库里真实指向的表（迁移 24 之后已不存在）。 */
    actual: 'mcp_servers_old',
    /** 这条外键本来要指的表。 */
    intended: 'mcp_servers',
    why:
      '迁移 24 用 `ALTER TABLE mcp_servers RENAME TO mcp_servers_old` 重建了表，' +
      'SQLite 顺手把这条 REFERENCES 改写成指向 mcp_servers_old，随后那张表被 DROP。\n' +
      '      所以库里这条外键指向一张不存在的表：写 tool_permissions 会直接报 ' +
      '"no such table: main.mcp_servers_old"，\n' +
      '      连不带 mcp_server_id 的内置工具权限也写不进去（DML 准备阶段就要解析目标表）。\n' +
      '      眼下没有影响——全项目只有模型定义，没有任何代码读写这张表。要用它得先加一个迁移重建。',
  },
]

// ── 对账 ────────────────────────────────────────────────────────
const NORM = (t) => (t === 'INT' ? 'INTEGER' : t)

function compare(sqlTables, doc) {
  const problems = []
  const add = (table, what) => problems.push({ table, what })
  const docByName = new Map(doc.TABLES.map((t) => [t.name, t]))

  for (const name of sqlTables.keys()) {
    if (!docByName.has(name)) add(name, '迁移里建了这张表，数据里没有')
  }
  for (const name of docByName.keys()) {
    if (!sqlTables.has(name)) add(name, '数据里有这张表，但迁移跑完后不存在（已被 DROP 或改名？）')
  }

  for (const [name, sqlT] of sqlTables) {
    const docT = docByName.get(name)
    if (!docT) continue
    const docCols = new Map(docT.columns.map((c) => [c.name, c]))

    for (const colName of sqlT.cols.keys()) {
      if (!docCols.has(colName)) add(name, `缺列：${colName}`)
    }
    for (const colName of docCols.keys()) {
      if (!sqlT.cols.has(colName)) add(name, `多列：${colName}（迁移里没有）`)
    }

    for (const [colName, sqlC] of sqlT.cols) {
      const docC = docCols.get(colName)
      if (!docC) continue
      const flags = new Set(docC.flags)

      const st = NORM(sqlC.type)
      const dt = NORM(String(docC.type).toUpperCase())
      if (st !== dt) add(name, `${colName} 类型：迁移 ${st}，数据 ${dt}`)

      // SQLite 的 INTEGER PRIMARY KEY 隐含 NOT NULL，table_info 却报 notnull=0。
      if (sqlC.notNull && !flags.has('NN') && !flags.has('PK')) add(name, `${colName}：迁移是 NOT NULL，数据没标 NN`)
      if (!sqlC.notNull && flags.has('NN') && !sqlC.pk) add(name, `${colName}：数据标了 NN，迁移里可空`)
      if (!sqlC.notNull && !flags.has('NULL') && !flags.has('PK') && !sqlC.pk) {
        add(name, `${colName}：迁移里可空，数据既没标 NULL 也没标 PK`)
      }
      if (sqlC.pk && !flags.has('PK')) add(name, `${colName}：迁移是主键，数据没标 PK`)
      if (!sqlC.pk && flags.has('PK')) add(name, `${colName}：数据标了 PK，迁移里不是`)

      const sqlHasFk = sqlT.fks.some((f) => f.from === colName)
      if (sqlHasFk !== flags.has('FK')) {
        add(name, sqlHasFk ? `${colName}：有外键，数据没标 FK` : `${colName}：数据标了 FK，迁移里没有`)
      }

      // 默认值只比「有没有」。数据里写的是给人看的形式（'{...}'、AUTOINCREMENT），
      // 逐字节比会全是噪音。可空列写「NULL」说的是「没有默认」，不是一个 DEFAULT 子句。
      const docHas = docC.def && !['—', 'NULL', 'AUTOINCREMENT'].includes(docC.def)
      const sqlHas = sqlC.default != null
      if (sqlHas && !docHas) add(name, `${colName}：迁移有 DEFAULT ${sqlC.default}，数据默认列写的是「${docC.def}」`)
      if (!sqlHas && docHas) add(name, `${colName}：数据写了默认 ${docC.def}，迁移里没有 DEFAULT`)
    }
  }

  // 外键：两边互查
  const key = (e) => `${e.from}.${e.col} -> ${e.to}.${e.toCol}`
  const sqlEdges = []
  for (const [name, t] of sqlTables) {
    for (const f of t.fks) {
      // PRAGMA foreign_key_list 的 to 在引用主键时可能为 null
      sqlEdges.push({ from: name, col: f.from, to: f.table, toCol: f.to ?? 'id', act: f.onDelete })
    }
  }

  // 悬空外键：目标表根本不在库里。先算，后面用来核对 broken 标记。
  const dangling = sqlEdges.filter((e) => !sqlTables.has(e.to))

  // 只还原目标表名，其余交回去照常比对。
  const usedRewrite = new Set()
  const normalized = sqlEdges.map((e) => {
    const r = REWRITTEN_REFERENCES.find((r) => r.from === e.from && r.col === e.col && r.actual === e.to)
    if (!r) return e
    usedRewrite.add(r)
    return { ...e, to: r.intended, rewrittenFrom: r.actual }
  })

  for (const r of REWRITTEN_REFERENCES) {
    if (!usedRewrite.has(r)) {
      add(
        r.from,
        `${r.col} 的外键已经不指向 ${r.actual} 了 —— 把这条规则从 REWRITTEN_REFERENCES 删掉，` +
          `数据里那条边的 kind 也要从 'broken' 改回 'fk'`,
      )
    }
  }

  // broken 边参与比对：它对应的正是库里那条被改写的外键。
  const docEdges = doc.EDGES.filter((e) => e.kind === 'fk' || e.kind === 'broken')
  const docByKey = new Map(docEdges.map((e) => [key(e), e]))
  const sqlByKey = new Map(normalized.map((e) => [key(e), e]))

  for (const [k, e] of sqlByKey) {
    const d = docByKey.get(k)
    if (!d) {
      add(e.from, `外键缺失：${k}（ON DELETE ${e.act}）`)
      continue
    }
    // 动作照常比对。`act` 在 fk 和 broken 上都只写 ON DELETE 行为，所以这里不用解析什么。
    if (d.act !== e.act) add(e.from, `外键动作不一致：${k} —— 迁移 ${e.act}，数据 ${d.act}`)

    // 图上说坏 ⇔ 库里真坏。两个方向都查，否则「标成 broken」就成了另一种屏蔽开关。
    const reallyBroken = e.rewrittenFrom != null && !sqlTables.has(e.rewrittenFrom)
    if (reallyBroken && d.kind !== 'broken') {
      add(e.from, `${k} 在库里指向已不存在的 ${e.rewrittenFrom}，数据里却标成了普通外键（应为 kind: 'broken'）`)
    }
    if (!reallyBroken && d.kind === 'broken') {
      add(e.from, `${k} 数据里标成 broken，但库里这条外键是好的`)
    }
    // 只在库里确实坏着时核对目标名。不然「这条边其实是好的」上一条已经说过了，
    // 再补一句 "库里实际是 undefined" 只是把同一件事讲得更难懂。
    if (d.kind === 'broken' && reallyBroken && d.actualTarget !== e.rewrittenFrom) {
      add(e.from, `${k} 的 actualTarget 写的是 ${d.actualTarget}，库里实际是 ${e.rewrittenFrom}`)
    }
  }
  for (const [k, e] of docByKey) {
    if (!sqlByKey.has(k)) add(e.from, `数据声称的外键在迁移里不存在：${k}`)
  }

  return { problems, dangling }
}

// ── 跑 ──────────────────────────────────────────────────────────
const sqlTables = replayMigrations()
const doc = await loadDocData()
const { problems, dangling } = compare(sqlTables, doc)

const where = STAGED ? '暂存区' : '工作树'
const fkTotal = doc.EDGES.filter((e) => e.kind === 'fk').length
const colTotal = doc.TABLES.reduce((n, t) => n + t.columns.length, 0)

if (problems.length === 0) {
  console.log(`✓ ${DATA_REL} 与迁移一致（${where}）：${sqlTables.size} 张表 / ${colTotal} 个字段 / ${fkTotal} 条外键`)
  for (const r of REWRITTEN_REFERENCES) {
    console.log(`  ! ${r.from}.${r.col} 的外键被改写成指向 ${r.actual}（本意是 ${r.intended}）\n      ${r.why}`)
  }
  for (const e of dangling) {
    console.log(`  ! 悬空外键 ${e.from}.${e.col} → ${e.to}.${e.toCol}：目标表不在库里`)
  }
  process.exit(0)
}

console.error(`✗ ${DATA_REL} 与迁移对不上（${where}），共 ${problems.length} 处：\n`)
const byTable = new Map()
for (const p of problems) {
  if (!byTable.has(p.table)) byTable.set(p.table, [])
  byTable.get(p.table).push(p.what)
}
for (const [table, list] of byTable) {
  console.error(`  ${table}`)
  for (const w of list) console.error(`    · ${w}`)
}
console.error(
  `\n  改了 migrations/ 就要同步 ${DATA_REL} —— 结构（表/列/类型/外键）必须对上，` +
    '\n  说明文字（note / rels / rules）是这份数据真正的价值所在，顺手补上新决策背后的理由。' +
    '\n  画布：pnpm schema',
)
process.exit(1)
