# 双实现登记

Diesel 与 SeaORM 共存期间，同一个操作在 `db/ops/<module>.rs`（Diesel）和
`db/sea/ops/<module>.rs`（SeaORM）各有一份的，登记在这里。手写，不是生成的；
`node scripts/check-transaction-graph.mjs` 核对它：

- 一对 = 两边**同模块、同名的 `pub fn`**。Diesel 一侧只算 `db/ops` 之外叫得到的（`pub` 或
  `pub(crate)`）：私有或 `pub(super)` 的辅助函数跟着调用它的 Diesel op 一起删，不成对。
- 每行一对，`| module::name | 剩余 Diesel 调用点 |`。剩余调用点是 Diesel 版本在
  `db/ops/` 之外还被调用的次数（和 `docs/migration-counters.json` 里 `dieselOpsCalls`
  同一口径，含测试代码：测试还在调它，它就还删不掉）。
- 少一行、多一行、数字不对都是红。剩余调用点降到 0 的那一对也是红：那时该删掉
  Diesel 版本（和这一行），不要让两份永远并存。

这张表看不见换了名字写的 SeaORM 版本——那不是一对。兜住这种绕法的是基线里只减不增的
`dieselOpsCalls`：新的 Diesel 调用点进不来，旧的只能往 SeaORM 挪。

| 操作 | 剩余 Diesel 调用点 |
|---|---|
| acp_session::get | 7 |
| acp_session::owners | 3 |
| acp_session::upsert | 6 |
| acp_session_notice::list_for_conversation | 1 |
| acp_session_notice::upsert_if_newer | 1 |
| assistant::create_assistant | 2 |
| assistant::get_assistant | 10 |
| assistant::update_assistant | 1 |
| audit::record_side_request | 4 |
| conversation::all_ids | 1 |
| conversation::archive_conversation | 1 |
| conversation::create_conversation | 23 |
| conversation::delete_conversation | 2 |
| conversation::descendants | 1 |
| conversation::get_conversation | 28 |
| conversation::insert | 7 |
| conversation::list_conversations | 1 |
| conversation::list_conversations_by_project | 2 |
| conversation::search_transcripts | 1 |
| conversation::toggle_archive | 2 |
| conversation::toggle_pin | 2 |
| conversation::update_mode | 1 |
| conversation::update_title | 3 |
| memory::list_subjects | 1 |
| message::append_message | 7 |
| message::delete_summaries_anchored_in | 1 |
| message::insert_message | 1 |
| message::list_messages | 17 |
| message::record_auto_review | 1 |
| message::record_tool_diffs | 2 |
| message::record_tool_diffs_for_call | 1 |
| message::revise_tool_call | 1 |
| message_context_item::insert_many | 2 |
| message_context_item::list_for_message | 2 |
| message_context_item::list_for_messages | 3 |
| model_config::get_with_profile | 1 |
| model_config::seed_flat | 2 |
| plan_review::append_assistant_revision | 7 |
| plan_review::create_or_resume_document | 7 |
| plan_review::decide_review | 1 |
| plan_review::get_pending_review_for_conversation | 1 |
| plan_review::get_review_bundle | 1 |
| plan_review::mark_delivery_acknowledged | 1 |
| plan_review::mark_delivery_dispatched | 1 |
| plan_review::mark_materialization_applied | 7 |
| plan_review::submit_native_head_for_review | 7 |
| preference::delete_preference | 1 |
| preference::get_preference | 12 |
| preference::set_preference | 4 |
| project::create_project | 2 |
| project::get_project | 4 |
| provider::create_provider | 7 |
| provider::get_provider | 5 |
| provider::list_providers | 4 |
| provider::update_provider | 2 |
| queue::enqueue | 1 |
| todo::format_todo_block | 2 |
| todo::get_active_view | 3 |
| todo::replace_active_list | 8 |
| turn::begin | 36 |
| turn::finish | 7 |
| turn::finish_waiting_review | 2 |
| turn::list_for_conversation | 1 |
| turn::mark_reported | 1 |
| turn::set_phase | 10 |
