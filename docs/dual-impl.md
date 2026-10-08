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
| assistant::create_assistant | 2 |
| assistant::get_assistant | 11 |
| assistant::update_assistant | 1 |
| audit::record | 1 |
| audit::record_side_request | 4 |
| cached_model::list_by_provider | 1 |
| conversation::all_ids | 1 |
| conversation::get_conversation | 39 |
| conversation::update_project | 1 |
| emoji::create_emoji | 1 |
| emoji::list_confirmed_for_packs | 1 |
| emoji_pack::assign_pack | 1 |
| emoji_pack::create_pack | 1 |
| emoji_pack::list_assigned_pack_ids | 1 |
| memory::list_subjects | 1 |
| message::append_message | 17 |
| message::delete_subtree | 1 |
| message::delete_summaries_anchored_in | 1 |
| message::get_message | 1 |
| message::insert_message | 1 |
| message::list_messages | 26 |
| message::record_auto_review | 1 |
| message::record_tool_diffs | 2 |
| message::record_tool_diffs_for_call | 1 |
| message::revise_tool_call | 1 |
| message::switch_branch | 1 |
| message::update_assistant_message | 2 |
| message::update_rating | 1 |
| model_config::get_with_profile | 1 |
| model_config::list_by_provider_with_profiles | 1 |
| plan::format_plan_block | 1 |
| plan::get_active | 1 |
| plan_review::has_conversation_barrier | 6 |
| plan_review::list_reviews_for_conversation | 1 |
| preference::delete_preference | 1 |
| preference::get_preference | 12 |
| preference::set_preference | 4 |
| project::create_project | 3 |
| project::get_project | 5 |
| provider::create_provider | 7 |
| provider::get_provider | 5 |
| provider::list_providers | 5 |
| provider::update_provider | 2 |
| queue::attach_message | 1 |
| queue::carries_attachments | 1 |
| queue::enqueue | 5 |
| queue::hold_all | 3 |
| queue::list | 10 |
| queue::mark_dispatched | 3 |
| queue::mark_reported | 1 |
| queue::mark_settled | 3 |
| queue::next_deliverable | 2 |
| queue::next_pending | 3 |
| queue::release_all | 1 |
| queue::remove | 1 |
| queue::reorder | 1 |
| queue::set_delivery | 1 |
| queue::take_next | 1 |
| queue::undispatch | 1 |
| queue::unreported_in_doubt | 1 |
| queued_prompt_context_item::delete_for_queue | 2 |
| queued_prompt_context_item::list_prepared | 4 |
| skill_binding::resolve_available | 1 |
| todo::format_todo_block | 2 |
| todo::get_active_view | 3 |
| todo::replace_active_list | 12 |
| tool_preset::create_preset | 1 |
| tool_preset::get_preset | 1 |
| turn::begin | 56 |
| turn::begin_triggered | 1 |
| turn::finish | 12 |
| turn::finish_waiting_review | 3 |
| turn::get | 1 |
| turn::list_for_conversation | 3 |
| turn::mark_reported | 2 |
| turn::reconcile_interrupted | 2 |
| turn::set_phase | 14 |
| turn::unreported_for_conversation | 1 |
