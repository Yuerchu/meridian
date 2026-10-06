#!/usr/bin/env node
/**
 * 把 schema.snapshot.sql 装进一个真实的内存 SQLite，和 src/dev/schema-data.ts 对账。
 *
 * 那份数据一半是散文——为什么 parent_id 不建外键、为什么 NULL 和 0 是两个答案——
 * 这半边只能人写。另一半是纯事实：有哪些表、哪些列、什么类型、外键删的时候怎么走。
 * 事实那半边一旦和库对不上，整张图就开始骗人，而且骗得很有说服力。
 *
 * **现行 schema 的唯一出处是 `src-tauri/crates/core/schema.snapshot.sql`**：SeaORM 基线
 * 在一个新库上建出来的东西，按 SQLite 自己存的样子导出成 DDL，由
 * `cargo run -p meridian-core --example gen_schema_snapshot --features test-support` 生成、
 * core 的一个测试钉住（`introspect::ddl`，快照和迁移对不上那边先红）。65 个 Diesel 迁移
 * 是冻结的历史，只给旧库的桥接重放；读它们的校验器守的是历史文本，不是现行的库。
 *
 * **仍然用真实 SQLite 而不是解析 SQL 文本**：快照是可执行的 DDL，装进去再用
 * `PRAGMA table_info` / `foreign_key_list` 读回来，比在正则里重造一遍 SQLite 的语法
 * 可靠得多。这条教训来自它的前身：手写解析器那版把 `ALTER TABLE ... RENAME TO` 当成
 * 只改表名，而 SQLite 3.25 起会同时改写其它表里指向它的 REFERENCES 子句——迁移 24
 * 曾因此留下一条悬空外键，直到迁移 48 连同死表一起清掉。那个重命名今天已经折叠在
 * 快照里了（快照记录的是它的*结果*），但一个会在语法上答错的校验器，恰好会在最需要它
 * 的地方沉默，所以执行的还是 SQLite 本身。
 *
 * 装载条件对齐基线的建库方式：`PRAGMA foreign_keys=OFF`，建表顺序由快照决定。
 *
 *   pnpm schema:check            核对工作树
 *   pnpm schema:check --staged   核对暂存区(pre-commit 用这个)
 *   pnpm schema                  打开画布(#playground/schema)
 */
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { stagedSnapshot } from './staged-snapshot.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SELF), '..')
const SNAPSHOT_REL = 'src-tauri/crates/core/schema.snapshot.sql'
const DATA_REL = 'src/dev/schema-data.ts'
const REGENERATE = 'cargo run -p meridian-core --example gen_schema_snapshot --features test-support'

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
    console.error('✗ 这个 Node 没有 node:sqlite，无法装载 schema 快照。需要 Node >= 22.5。')
    process.exit(1)
  }
  const r = spawnSync(process.execPath, ['--experimental-sqlite', SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  process.exit(r.status ?? 1)
}

// ── 取内容:工作树还是暂存区 ─────────────────────────────────────
// pre-commit 要校验的是**将要提交的东西**。读工作树的话,暂存了 core 指针、却把
// schema-data.ts 的修改留在工作区没暂存,校验会通过而提交进去的两半对不上。
// 快照在 meridian-core 子模块里,「暂存」在那边指外层将要指向的 commit——
// 见 staged-snapshot.mjs。
const snapshot = STAGED ? stagedSnapshot(ROOT) : null

function readAt(relPath) {
  if (!STAGED) return existsSync(join(ROOT, relPath)) ? readFileSync(join(ROOT, relPath), 'utf8') : null
  return snapshot.read(relPath) // 暂存区里没有这个文件（未跟踪 / 未暂存 / 已删除）时为 null
}

// ── 装载快照 ────────────────────────────────────────────────────
function loadSnapshot() {
  const sql = readAt(SNAPSHOT_REL)
  if (sql == null) {
    // 没有快照就没有可核对的 schema。它随 core 的提交走：改了基线的那次提交必须带上
    // 重新生成的快照（core 的测试会先拦住一次没带的）。
    console.error(
      `✗ 缺少 ${SNAPSHOT_REL}${STAGED ? '（外层指向的 core 提交里没有它）' : ''}。\n` +
        `  现行 schema 只从这份快照读；core 的提交必须带上它：在 src-tauri/crates 里运行\n` +
        `  ${REGENERATE}`,
    )
    process.exit(1)
  }

  const db = new DatabaseSync(':memory:')
  // 和基线建库时一致:外键关着,建表顺序不必按引用关系排。
  db.exec('PRAGMA foreign_keys=OFF')
  try {
    db.exec(sql)
  } catch (e) {
    console.error(`✗ 快照装载失败：${SNAPSHOT_REL}\n  ${e.message}\n  它不是手写的；重新生成：${REGENERATE}`)
    process.exit(1)
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
      // core 指针进了暂存区、这份数据却没有，正是这个校验存在的理由：两半必须一起提交。
      console.error(
        `✗ ${DATA_REL} 不在暂存区里（未跟踪，或改了没 git add）。\n` +
          `  schema 和这份数据得一起提交，否则提交历史里会出现一个「结构变了但图没变」的版本。\n` +
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
// 类型按 SQLite 的亲和比，不按拼写：Diesel 迁移写的是 BIGINT / REAL，桥接过来的旧库
// 就是那样存的；sea-query 给新库渲染的是 integer / double。两种拼写在 SQLite 里是同一
// 回事（datatype3 §3.1 的规则），画布上的 BIGINT 和快照里的 integer 没有可报的差别。
// 真正的类型漂移——整数列变成文本列——照样红。
const NORM = (t) => {
  const type = String(t).toUpperCase()
  if (type.includes('INT')) return 'INTEGER'
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT'
  if (type === '' || type.includes('BLOB')) return 'BLOB'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'REAL'
  return 'NUMERIC'
}

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
      const dt = NORM(docC.type)
      if (st !== dt) add(name, `${colName} 类型：快照 ${sqlC.type}（${st} 亲和），数据 ${docC.type}（${dt} 亲和）`)

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
const sqlTables = loadSnapshot()
const doc = await loadDocData()
const problems = compare(sqlTables, doc)

const where = STAGED ? '暂存区' : '工作树'
const fkTotal = doc.EDGES.filter((e) => e.kind === 'fk').length
const colTotal = doc.TABLES.reduce((n, t) => n + t.columns.length, 0)

if (problems.length === 0) {
  console.log(
    `✓ ${DATA_REL} 与 schema 快照一致（${where}）：${sqlTables.size} 张表 / ${colTotal} 个字段 / ${fkTotal} 条外键`,
  )
  process.exit(0)
}

console.error(`✗ ${DATA_REL} 与 schema 快照对不上（${where}），共 ${problems.length} 处：\n`)
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
  `\n  改了 SeaORM 迁移（db/sea/migration/）就要在 src-tauri/crates 里重新生成快照：` +
    `\n    ${REGENERATE}` +
    `\n  再同步 ${DATA_REL} —— 结构（表/列/类型/外键）必须对上，` +
    '\n  说明文字（note / rels / rules）是这份数据真正的价值所在，顺手补上新决策背后的理由。' +
    '\n  画布：pnpm schema',
)
process.exit(1)
