# 双实现登记

Diesel 与 SeaORM 共存期间，同一个操作在 `db/ops/<module>.rs`（Diesel）和
`db/sea/ops/<module>.rs`（SeaORM）各有一份的，登记在这里。手写，不是生成的；
`node scripts/check-transaction-graph.mjs` 核对它：

- 一对 = 两边**同模块、同名的 `pub fn`**。
- 每行一对，`| module::name | 剩余 Diesel 调用点 |`。剩余调用点是 Diesel 版本在
  `db/ops/` 之外还被调用的次数（和 `docs/migration-counters.json` 里 `dieselOpsCalls`
  同一口径，含测试代码：测试还在调它，它就还删不掉）。
- 少一行、多一行、数字不对都是红。剩余调用点降到 0 的那一对也是红：那时该删掉
  Diesel 版本（和这一行），不要让两份永远并存。

这张表看不见换了名字写的 SeaORM 版本——那不是一对。兜住这种绕法的是基线里只减不增的
`dieselOpsCalls`：新的 Diesel 调用点进不来，旧的只能往 SeaORM 挪。

| 操作 | 剩余 Diesel 调用点 |
|---|---|
| preference::delete_preference | 1 |
| preference::get_preference | 14 |
| preference::set_preference | 5 |
