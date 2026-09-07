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
 * 迁移 24 曾因此留下一条悬空外键，直到迁移 48 连同死表一起清掉。一个会在重命名
 * 上答错的校验器，恰好会在最需要它的地方沉默。
 *
 * 重放条件对齐 `db/mod.rs:78`:迁移就是在 `PRAGMA foreign_keys=OFF` 下跑的。
 *
 *   pnpm schema:check            核对工作树
 *   pnpm schema:check --staged   核对暂存区(pre-commit 用这个)
 *   pnpm schema                  打开画布(#playground/schema)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { stagedSnapshot } from './staged-snapshot.mjs'

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
// 迁移在 meridian-core 子模块里,「暂存」在那边指外层将要指向的 commit——
// 见 staged-snapshot.mjs。
const snapshot = STAGED ? stagedSnapshot(ROOT) : null

function readAt(relPath) {
  if (!STAGED) return readFileSync(join(ROOT, relPath), 'utf8')
  return snapshot.read(relPath) // 暂存区里没有这个文件（未跟踪 / 未暂存 / 已删除）时为 null
}

function migrationFiles() {
  if (!STAGED) {
    return readdirSync(join(ROOT, MIG_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${MIG_DIR}/${d.name}/up.sql`)
      .sort()
  }
  return snapshot
    .list(MIG_DIR)
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

  // 悬空外键不能靠图上的目标节点掩盖：库里实际引用的表必须存在。
  const dangling = sqlEdges.filter((e) => !sqlTables.has(e.to))
  for (const e of dangling) add(e.from, `悬空外键：${key(e)}（目标表不在库里）`)

  const docEdges = doc.EDGES.filter((e) => e.kind === 'fk')
  const docByKey = new Map(docEdges.map((e) => [key(e), e]))
  const sqlByKey = new Map(sqlEdges.map((e) => [key(e), e]))

  for (const [k, e] of sqlByKey) {
    const d = docByKey.get(k)
    if (!d) {
      add(e.from, `外键缺失：${k}（ON DELETE ${e.act}）`)
      continue
    }
    if (d.act !== e.act) add(e.from, `外键动作不一致：${k} —— 迁移 ${e.act}，数据 ${d.act}`)
  }
  for (const [k, e] of docByKey) {
    if (!sqlByKey.has(k)) add(e.from, `数据声称的外键在迁移里不存在：${k}`)
  }

  return problems
}

// ── 跑 ──────────────────────────────────────────────────────────
const sqlTables = replayMigrations()
const doc = await loadDocData()
const problems = compare(sqlTables, doc)

const where = STAGED ? '暂存区' : '工作树'
const fkTotal = doc.EDGES.filter((e) => e.kind === 'fk').length
const colTotal = doc.TABLES.reduce((n, t) => n + t.columns.length, 0)

if (problems.length === 0) {
  console.log(`✓ ${DATA_REL} 与迁移一致（${where}）：${sqlTables.size} 张表 / ${colTotal} 个字段 / ${fkTotal} 条外键`)
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
