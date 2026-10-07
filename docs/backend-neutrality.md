# 后端无关性登记

SeaORM 侧的新代码只用查询构建器和 `sea_query`，原生 SQL 只经 `db/sql.rs`。现有的
SQLite 专属构造在迁移到 SeaORM 时打 `// backend: sqlite-only` 标记并登记在这里，
PostgreSQL 服务端版本动工时按这份清单逐项给出对应实现。

## 基线 `m0001_baseline`

`core/src/db/sea/migration/m0001_baseline.rs` 由 `examples/gen_baseline.rs` 从 65 个 Diesel
迁移建出的库生成。表、列、主键、外键、索引是 sea-query 构建器，可为任一后端渲染；
下面三类是原样透传的 SQLite 文本，由 `migration/mod.rs` 里带 `backend: sqlite-only`
注释的三个辅助函数接收：

| 构造 | 数量 | 透传方式 | PostgreSQL 时要做的事 |
|---|---|---|---|
| 触发器（`messages` 的 `sort_order` 推进、`conversations.message_count` 增减） | 3 | `trigger(sql)` | 改写为 PL/pgSQL 触发器函数 |
| 部分索引的 `WHERE` 过滤 | 12 | `index(.., Some(filter))` | 语法基本通用，逐条核对引号与函数 |
| `CHECK` 表达式（`json_valid`、`typeof`、`GLOB`、`instr`、枚举 `IN`、金额格式） | 75 | `check(expr)` | `json_valid`→`jsonb` 类型、`GLOB`→正则、`typeof`→列类型本身保证 |

数量由 `db/sea/equivalence_tests.rs` 里的常量钉住，改了基线会先在那里红。

## 基线之后的迁移

基线之后的每个迁移整文件是 SQLite 文本（`sqlite_statements()`，`diesel_test_db` 执行同一份），
非 SQLite 后端在 `up` 里直接拒绝：PostgreSQL 的 schema 从约束完整的形状起步，不需要这些改表步骤。

| 迁移 | SQLite 专属的部分 | PostgreSQL 时要做的事 |
|---|---|---|
| `m0002_skill_keys` | 建新表、拷贝、删旧表、改名的重建（SQLite 不能给已有列补 `NOT NULL`/`CHECK`）；`CHECK` 用 `GLOB '*[^-a-z0-9]*'`；`PRAGMA foreign_keys` 守卫与 `foreign_key_check` 收尾检查 | 建表时直接写 `dir_name text NOT NULL PRIMARY KEY CHECK (dir_name ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')`，不需要迁移 |

## 等价验收怎么证明基线对

- 结构：`introspect::Schema` 读 `pragma_table_info` / `foreign_key_list` / `index_list` /
  `index_xinfo`，声明类型归一到亲和性后逐表比对回放库与基线库。
- 文本：`CHECK` 子句、部分索引过滤、触发器正文从 `sqlite_master.sql` 提取（去注释、
  归一空白）后比对；另统计 `CREATE TABLE` 里 `CHECK` 记号数等于提取数，防提取器两边同漏。
- 行为：一组每条约束各一行的反例在两个库上都必须被同一类约束拒绝，另有一组去掉唯一
  缺陷的对照行在两边都必须被接受。
- 生成器：`render(读回放库)` 的文本必须与入库文件逐字相同。

## `db/sql.rs`：登记的原生 SQL

SeaORM 侧跑的每一条手写 SQL 都在 `core/src/db/sql.rs`，以 `ReadOnly` 常量登记——构造器对模块私有，
模块外造不出一个 `ReadOnly`，模型契约检查器又拒绝桥接/基线文件之外的 `Statement::from_*`，
所以这张表就是全部。每条都用位置 `?` 占位（按出现顺序传值），不用 SQLite 自己的 `?1` 编号。

| 常量 | 用途 | SQLite 专属的部分 | PostgreSQL 时要做的事 |
|---|---|---|---|
| `JOURNAL_CHAINS_UNDER_PREFIX` | 路径前缀下每条链及其头 sha（死头为 NULL），按更新时间倒序，带上限 | 只有占位符与 `DbBackend::Sqlite`；`LIKE … ESCAPE '\'`、相关子查询 `MAX(seq)` 是标准 SQL | 改占位符为 `$1`/`$2`，`LIKE` 的大小写语义按 `norm_path` 的实际需要选 `LIKE`/`ILIKE` |
| `JOURNAL_LIVE_CHAINS_UNDER_PREFIX` | 同上，只要活着的链（`new_sha IS NOT NULL`），上限按活文件计 | 同上 | 同上 |
| `JOURNAL_UNREFERENCED_BLOBS` | 没有任何版本引用的 blob sha | 无（`NOT EXISTS` 是标准 SQL） | 无 |
