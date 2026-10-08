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

## 查询构建器里的 SQLite 片段

`Expr::cust` 把一段 SQL 文本原样塞进构建器生成的语句，是 `db/sql.rs` 之外唯一能写出 SQLite
专属 SQL 的口子。每个用到它的文件都要带 `backend: sqlite-only` 标注并登记在下表——模型契约
检查器核对两边：用了没登记、登记了没用、文件里没有标注，都是红。迁移目录（`db/sea/migration/`）
另有上一节的登记，不在此列。

| 文件 | 片段 | 用途 | PostgreSQL 时要做的事 |
|---|---|---|---|
| `core/src/db/sea/ops/turn.rs` | `rowid` | 同一毫秒开始的 turn 按写入顺序排（id 是 uuid，顺序无意义） | 加一列插入序号（`bigserial`）按它排 |

## 依赖 SQLite 语义的构建器查询

构建器能为任一后端渲染，但下面这些查询的**结果**依赖 SQLite 的语义，PostgreSQL 版本要逐条改写。
代码里在函数上方带 `backend: sqlite-only` 注释。

| 位置 | 依赖的语义 | PostgreSQL 时要做的事 |
|---|---|---|
| `core/src/db/sea/ops/conversation.rs` `search_transcripts` | `LIKE` 按 ASCII 折叠大小写，与 Rust 侧复核的折叠一致 | 改用 `ILIKE`（或对两边都做 `lower()`），并确认复核的折叠仍与之一致 |

## `db/sql.rs`：登记的原生 SQL

SeaORM 侧跑的每一条手写 SQL 都在 `core/src/db/sql.rs`，以 `ReadOnly` 常量登记——构造器对模块私有，
模块外造不出一个 `ReadOnly`，模型契约检查器又拒绝桥接/基线文件之外的 `Statement::from_*`，
所以这张表就是全部。每条都用位置 `?` 占位（按出现顺序传值），不用 SQLite 自己的 `?1` 编号。

| 常量 | 用途 | SQLite 专属的部分 | PostgreSQL 时要做的事 |
|---|---|---|---|
| `JOURNAL_CHAINS_UNDER_PREFIX` | 路径前缀下每条链及其头 sha（死头为 NULL），按更新时间倒序，带上限 | 只有占位符与 `DbBackend::Sqlite`；`LIKE … ESCAPE '\'`、相关子查询 `MAX(seq)` 是标准 SQL | 改占位符为 `$1`/`$2`，`LIKE` 的大小写语义按 `norm_path` 的实际需要选 `LIKE`/`ILIKE` |
| `JOURNAL_LIVE_CHAINS_UNDER_PREFIX` | 同上，只要活着的链（`new_sha IS NOT NULL`），上限按活文件计 | 同上 | 同上 |
| `JOURNAL_UNREFERENCED_BLOBS` | 没有任何版本引用的 blob sha | 无（`NOT EXISTS` 是标准 SQL） | 无 |
| `USAGE_BY_TOTAL` | 用量报表按总计分组（键为常量 `''`）：每组的条数、四类 token 求和与二十余个条件计数，价格列与计费方式一并分组 | 位置 `?`；标量两参数 `MAX(a, b)`（取较大值）；`CASE … THEN 1 ELSE 0` 计数 | 占位符改 `$n`；两参数 `MAX` 改 `GREATEST` |
| `USAGE_BY_PROVIDER` | 同上，按 `COALESCE(provider_name, provider_id, '')` 分组 | 同上 | 同上 |
| `USAGE_BY_MODEL` | 同上，按 `COALESCE(model_id, '')` 分组 | 同上 | 同上 |
| `USAGE_BY_BOT` | 同上，按 `COALESCE(CAST(self_id AS TEXT), '')` 分组 | 同上 | 同上（`CAST(… AS TEXT)` 通用） |
| `USAGE_BY_SOURCE` | 同上，按 `COALESCE(source_type \|\| ':' \|\| source_id, '')` 分组 | 同上；`\|\|` 遇 NULL 得 NULL 的语义 | 同上；`\|\|` 在 PostgreSQL 语义相同 |
| `USAGE_BY_CONVERSATION` | 同上，按 `conversation_id` 分组 | 同上 | 同上 |
| `USAGE_BY_DAY` | 同上，按本地日期分组 | 同上；`strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime')` 取的是数据库进程的本地时区 | 同上；改 `to_char(to_timestamp(created_at / 1000) AT TIME ZONE <客户端时区>, 'YYYY-MM-DD')`，时区要由调用方传入——服务端没有「用户的本地时间」 |
| `USAGE_BY_HOUR` | 同上，按本地小时分组 | 同上，格式 `'%Y-%m-%dT%H'` | 同上，格式 `'YYYY-MM-DD"T"HH24'` |
| `USAGE_BY_KIND` | 同上，按 `role` 分组（回答 / 自动审查 / 压缩 / 标题 / 提取） | 同上 | 同上 |
| `USAGE_BY_TURN` | 一个会话按 turn 分组；会话是等值条件而非可空过滤，好让 `(conversation_id, turn_id)` 索引可用（有测试钉住查询计划） | 同上 | 同上；确认 PostgreSQL 的计划同样走复合索引 |
