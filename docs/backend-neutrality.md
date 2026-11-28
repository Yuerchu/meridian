# 后端无关性登记

SeaORM 侧的新代码只用查询构建器和 `sea_query`，原生 SQL 只经 `db/sql.rs`。现有的
SQLite 专属构造在迁移到 SeaORM 时打 `// backend: sqlite-only` 标记并登记在这里，
PostgreSQL 服务端版本动工时按这份清单逐项给出对应实现。

**ops 层已经跑在 PostgreSQL 上（S0b，2026-11-28）。** `db::sea::ops`、`agent::*` 与 `db::sql`
的测试在两个后端上各跑一遍，CI 有独立的 postgres job（core `postgres` feature +
`MERIDIAN_PG_URL`，另跑该 feature 的 clippy）；
测试库由 `db/sea/migration/pg.rs` 从迁移后的 SQLite schema 读回并翻译。下面「查询构建器里的 SQLite 片段」
与「依赖 SQLite 语义的构建器查询」两节因此清空了，`db/sql.rs` 一节的待办也已兑现——留着表头是
因为模型契约检查器按节名核对，新增一条 SQLite 专属构造时它仍然要求登记在原位。

还没做的在 S0c：PostgreSQL 的**迁移器**。今天的 PG schema 是测试翻译器建的，75 条 `CHECK`、
12 条部分索引过滤、3 个触发器里凡 PostgreSQL 拒绝的都被跳过并打印，而不是给出对应文本。

三处两个后端故意不同，都不是待办：
- **事务**（`db/sea/cap.rs`）：`Db::write` 在 PostgreSQL 上首句取 `pg_advisory_xact_lock(lock_key)`，
  等价于 SQLite 的 `BEGIN IMMEDIATE`「一次一个写者」；`Db::read` 用 `REPEATABLE READ`，对应
  deferred 读的单快照语义。键按 schema 取，所以不同用户的写者互不阻塞。去掉这一句，
  `db::sea::ops` 的 4 个并发测试在 PostgreSQL 上变红。
- **延迟外键**（`db/sea/migration/pg.rs` 的 `DEFERRED_FOREIGN_KEYS`）：`conversations.head_message_id` 在
  PostgreSQL 上是 `DEFERRABLE INITIALLY DEFERRED`。删子树时它指向正在消失的行，修正它的
  `ON DELETE SET NULL` 还没跑，而 message-count 触发器已经更新了同一条 conversation；
  PostgreSQL 会在那次更新上校验这个键，SQLite 不会（更新没碰键列）。
- **注入失败的测试手段**（`db/sea/mod.rs` 的 `refuse_message_writes_for_tests` /
  `refuse_tool_message_rows_for_tests`）：SQLite 有 `PRAGMA query_only` 没有 `ADD CONSTRAINT`，
  PostgreSQL 反之。两种写法都在那里，测试只说意图。

## 基线 `m0001_baseline`

`core/src/db/sea/migration/m0001_baseline.rs` 由 `examples/gen_baseline.rs` 从 65 个 Diesel
迁移建出的库生成。表、列、主键、外键、索引是 sea-query 构建器，可为任一后端渲染；
下面三类是原样透传的 SQLite 文本，由 `migration/mod.rs` 里带 `backend: sqlite-only`
注释的三个辅助函数接收：

| 构造 | 数量 | 透传方式 | PostgreSQL 时要做的事 |
|---|---|---|---|
| 触发器（`messages` 的 `sort_order` 推进、`conversations.message_count` 增减） | 3 | `trigger(sql)` | 改写为 PL/pgSQL 触发器函数——测试翻译器（`db/sea/migration/pg.rs` 的 `TRIGGERS`）已有这三条的 PL/pgSQL 版本，S0c 的迁移器搬过去即可；翻译器遇到没登记的触发器会 panic |
| 部分索引的 `WHERE` 过滤 | 12 | `index(.., Some(filter))` | 语法基本通用，逐条核对引号与函数。翻译器当前把它们当「可选」语句：PostgreSQL 拒绝就跳过并打印，所以测试库少的是索引而不是约束 |
| `CHECK` 表达式（`json_valid`、`typeof`、`GLOB`、`instr`、枚举 `IN`、金额格式） | 75 | `check(expr)` | `json_valid`→`jsonb` 类型、`GLOB`→正则、`typeof`→列类型本身保证。同上按「可选」跳过——**所以今天 PG 测试库的约束比 SQLite 弱，S0c 之前别把它当等价** |

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

空表。曾经只有一条：`ops/turn.rs` 用 `rowid` 给同一毫秒开始的 turn 排序。`m0019_turn_sequence`
把它换成 `turns.seq` 列，由 `ops::turn::begin_triggered` 在写事务里取 `MAX(seq) + 1` 填入——
写者已经串行，所以读与插入之间挤不进第二个写者。PostgreSQL 的 `ctid` 是物理位置、一更新就变，
而一个 turn 在结束前要被更新好几次，所以这里必须是列而不是物理行序。

## 依赖 SQLite 语义的构建器查询

构建器能为任一后端渲染，但有些查询的**结果**会依赖 SQLite 的语义。这里也空了。

曾经只有一条：`ops/conversation.rs` 的 `search_transcripts` 靠 `LIKE` 折叠 ASCII 大小写，
而 PostgreSQL 的 `LIKE` 不折叠、`ILIKE` 又带不了保留字面 `%` 所需的 `ESCAPE`。现在预筛是
两个析取项——`LOWER(content) LIKE <ASCII 小写的模式>` 加上原样大小写的 `LIKE`——在两个后端上
都是 Rust 侧复核的超集。门禁是 `a_search_finds_a_row_whatever_case_it_was_typed_in`：去掉
`LOWER`，它在 PostgreSQL 上红、在 SQLite 上仍绿，正是这个缺陷会有的形状。

另有三处排序曾经靠物理行序，`created_at` 相同时就没有定义：`sub_agent_runs`、
`sub_agent_conversation_ids`、`descendants`。一轮里委派两个子 agent 会写出同一毫秒的两行，
现在都以 id 收尾——id 是 uuid，排出来的次序没有含义，有含义的是每次读都一样。

## `db/sql.rs`：登记的原生 SQL

SeaORM 侧跑的每一条手写 SQL 都在 `core/src/db/sql.rs`，以 `ReadOnly` 常量登记——构造器对模块私有，
模块外造不出一个 `ReadOnly`，模型契约检查器又拒绝桥接/基线文件之外的 `Statement::from_*`，
所以这张表就是全部。每条都用位置 `?` 占位（按出现顺序传值），不用 SQLite 自己的 `?1` 编号。

这些语句现在**一份文本跑两个后端**，`ReadOnly` 只在方言别无选择时才带第二份文本（今天只有
日/小时报表的日历表达式）。三条规则让单份文本成立，`db/sql.rs` 的模块注释是权威版本：

1. **占位符 `?` 在运行时按后端编号。** PostgreSQL 要 `$1`、`$2`，`numbered()` 按出现顺序改写并
   跳过引号里的字面——`ESCAPE '\'` 和 `'%Y-%m-%d'` 都在这些语句里，把它们里面的 `?` 数进去会让
   之后每个编号错位，那是把每个值绑到错误的列上，而不是报错。
2. **不用两参数 `MAX`。** 它在 SQLite 是标量取大、在 PostgreSQL 是语法错误（那边叫 `GREATEST`）。
   `CASE WHEN … THEN … ELSE 0 END` 两边都认，而与 0 比大小根本不需要取大。
3. **读取方当 `i64` 解的整数列在这里写成 `CAST(… AS BIGINT)`。** sqlx 在 PostgreSQL 上拒绝把
   `int4` 读成 `i64`，SQLite 从不计较；读取方拿到多宽，由语句自己声明。聚合不在此列，
   `SUM(int4)` 本来就是 `bigint`。

下表「PostgreSQL 时要做的事」一列留着当记录：写着「改占位符」的那些由第 1 条统一兑现了。

| 常量 | 用途 | SQLite 专属的部分 | PostgreSQL 时要做的事 |
|---|---|---|---|
| `JOURNAL_CHAINS_UNDER_PREFIX` | 路径前缀下每条链及其头 sha（死头为 NULL），按更新时间倒序，带上限 | `LIKE … ESCAPE '\'`、相关子查询 `MAX(seq)` 是标准 SQL | **已做**（占位符见第 1 条）。`norm_path` 的大小写折叠没有改：journal 不上服务端 |
| `JOURNAL_LIVE_CHAINS_UNDER_PREFIX` | 同上，只要活着的链（`new_sha IS NOT NULL`），上限按活文件计 | 同上 | 同上 |
| `JOURNAL_UNREFERENCED_BLOBS` | 没有任何版本引用的 blob sha | 无（`NOT EXISTS` 是标准 SQL） | 无 |
| `USAGE_BY_TOTAL` | 用量报表按总计分组（键为常量 `''`）：每组的条数、四类 token 求和与二十余个条件计数，价格列与计费方式一并分组 | 曾有标量两参数 `MAX(a, b)` | **已做**：`MAX` 改写成 `CASE`（见上文第 2 条），占位符见第 1 条 |
| `USAGE_BY_PROVIDER` | 同上，按 `COALESCE(provider_name, provider_id, '')` 分组 | 同上 | 同上 |
| `USAGE_BY_MODEL` | 同上，按 `COALESCE(model_id, '')` 分组 | 同上 | 同上 |
| `USAGE_BY_LOGICAL_MODEL` | 同上，按 `COALESCE(logical_model_id, model_id, '')` 跨供应商按逻辑模型聚合 | 同上 | 同上 |
| `USAGE_BY_BOT` | 同上，按 `COALESCE(CAST(self_id AS TEXT), '')` 分组 | 同上 | 同上（`CAST(… AS TEXT)` 通用） |
| `USAGE_BY_SOURCE` | 同上，按 `COALESCE(source_type \|\| ':' \|\| source_id, '')` 分组 | 同上；`\|\|` 遇 NULL 得 NULL 的语义 | 同上；`\|\|` 在 PostgreSQL 语义相同 |
| `USAGE_BY_CONVERSATION` | 同上，按 `conversation_id` 分组 | 同上 | 同上 |
| `USAGE_BY_DAY` | 同上，按本地日期分组 | `strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime')` 取的是数据库进程的本地时区 | **已做**：带第二份文本 `to_char(to_timestamp(created_at / 1000), 'YYYY-MM-DD')`。「本地」在两边都是会话的时区——SQLite 的 `localtime` 读进程时区，`to_char` 按连接的 `TimeZone` 渲染 `timestamptz`。服务端给别的时区的人服务，是那条连接的设置，不是语句绑的值 |
| `USAGE_BY_HOUR` | 同上，按本地小时分组 | 同上，格式 `'%Y-%m-%dT%H'` | **已做**，格式 `'YYYY-MM-DD"T"HH24'` |
| `USAGE_BY_KIND` | 同上，按 `role` 分组（回答 / 自动审查 / 压缩 / 标题 / 提取） | 同上 | 同上 |
| `USAGE_BY_TURN` | 一个会话按 turn 分组；会话是等值条件而非可空过滤，好让 `(conversation_id, turn_id)` 索引可用（有测试钉住查询计划） | 同上 | 同上；确认 PostgreSQL 的计划同样走复合索引 |
| `USAGE_GAPS` | 同上，按 `id` 分组（一条回复一组），只取缺用量或缺价格快照的候选行；哪条真有缺口由累加器判定 | 同上 | 同上 |
| `USAGE_GAP_DETAILS` | 与 `USAGE_GAPS` 同一组候选行的定位信息（时间、会话、服务商/模型、`LENGTH(content)`），按时间倒序 | `LENGTH` 按字符计 | **已做**：`LENGTH` 在 PostgreSQL 同样按字符计，外面包了 `CAST(… AS BIGINT)`（第 3 条） |
| `USAGE_CACHE_MISS_ROWS` | 窗口内每个会话的每条回复与每次压缩，按会话和时间排序；逐条比较相邻请求的 prompt 大小算缓存未命中，压缩行只作重置标记 | `role IN (…)` 与 `ORDER BY` 是标准 SQL | **已做**：三个 token 列包了 `CAST(… AS BIGINT)`，因为读取方按 `i64` 解（第 3 条） |
