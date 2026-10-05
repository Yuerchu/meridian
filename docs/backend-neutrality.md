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

## 等价验收怎么证明基线对

- 结构：`introspect::Schema` 读 `pragma_table_info` / `foreign_key_list` / `index_list` /
  `index_xinfo`，声明类型归一到亲和性后逐表比对回放库与基线库。
- 文本：`CHECK` 子句、部分索引过滤、触发器正文从 `sqlite_master.sql` 提取（去注释、
  归一空白）后比对；另统计 `CREATE TABLE` 里 `CHECK` 记号数等于提取数，防提取器两边同漏。
- 行为：一组每条约束各一行的反例在两个库上都必须被同一类约束拒绝，另有一组去掉唯一
  缺陷的对照行在两边都必须被接受。
- 生成器：`render(读回放库)` 的文本必须与入库文件逐字相同。
