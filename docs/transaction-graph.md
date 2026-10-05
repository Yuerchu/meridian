# 事务调用图

由 `node scripts/check-transaction-graph.mjs --write` 生成，不要手改。
规则与用途见脚本头注释；SeaORM 迁移按这里的连通分量和事务根分期。

- 事务根（非测试）：70
- Diesel ops 调用点（db/ops 之外）：1024
- Diesel API 引用：1566

## R2 无法检查的 SeaORM 事务根

接收者是一次调用的结果（`get_db().write(…)`），静态上认不出闭包里哪个句柄是同一个池。

- 无

## ops 模块的事务连通分量

- 21 个：acp_session acp_session_notice assistant audit cached_model conversation emoji memory message message_context_item model_config model_profile plan plan_review project provider queue queued_prompt_context_item todo turn usage
- 1 个：journal
- 1 个：notification
- 1 个：preference
- 1 个：voice_corpus

## 事务根

| 位置 | 类型 | 触及的 ops 模块 |
|---|---|---|
| `src-tauri/crates/core/src/acp/import.rs` › `attach` | diesel-deferred | acp_session, conversation |
| `src-tauri/crates/core/src/acp/import.rs` › `import` | diesel-deferred | acp_session, acp_session_notice, assistant, audit, conversation, message, model_config, plan, project, todo, turn |
| `src-tauri/crates/core/src/acp/mod.rs` › `write_conversation_row` | diesel-deferred | acp_session, assistant, conversation |
| `src-tauri/crates/core/src/acp/session.rs` › `write_prompt_row` | diesel-deferred | audit, conversation, message, message_context_item, model_config, queue, queued_prompt_context_item, turn |
| `src-tauri/crates/core/src/agent/queue.rs` › `steer` | diesel-immediate | queue |
| `src-tauri/crates/core/src/agent/queue/native.rs` › `take_one` | diesel-immediate | audit, conversation, message, model_config, queue |
| `src-tauri/crates/core/src/db/ops/acp_session_notice.rs` › `upsert_if_newer` | diesel-immediate | acp_session_notice |
| `src-tauri/crates/core/src/db/ops/cached_model.rs` › `list_cached_for_provider` | diesel-deferred | cached_model |
| `src-tauri/crates/core/src/db/ops/cached_model.rs` › `replace_models` | diesel-deferred | — |
| `src-tauri/crates/core/src/db/ops/composer_draft.rs` › `save` | diesel-immediate | — |
| `src-tauri/crates/core/src/db/ops/conversation.rs` › `delete_conversation` | diesel-deferred | conversation |
| `src-tauri/crates/core/src/db/ops/conversation.rs` › `toggle_archive` | diesel-immediate | — |
| `src-tauri/crates/core/src/db/ops/conversation.rs` › `toggle_pin` | diesel-immediate | — |
| `src-tauri/crates/core/src/db/ops/journal.rs` › `append_command_observed` | diesel-immediate | journal |
| `src-tauri/crates/core/src/db/ops/journal.rs` › `append_version` | diesel-immediate | journal |
| `src-tauri/crates/core/src/db/ops/journal.rs` › `reconcile_external` | diesel-immediate | journal |
| `src-tauri/crates/core/src/db/ops/message.rs` › `append_message` | diesel-deferred | message |
| `src-tauri/crates/core/src/db/ops/message.rs` › `delete_subtree` | diesel-deferred | message |
| `src-tauri/crates/core/src/db/ops/message.rs` › `switch_branch` | diesel-deferred | message |
| `src-tauri/crates/core/src/db/ops/notification.rs` › `record_delivery_attempt` | diesel-immediate | notification |
| `src-tauri/crates/core/src/db/ops/notification.rs` › `record_raised` | diesel-immediate | notification |
| `src-tauri/crates/core/src/db/ops/plan.rs` › `approve` | diesel-deferred | plan |
| `src-tauri/crates/core/src/db/ops/plan.rs` › `complete_active` | diesel-deferred | plan |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `append_assistant_revision` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `backfill_legacy_artifacts` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `backfill_legacy_artifacts` | diesel-deferred | — |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `create_or_resume_document` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `decide_review` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `discard_review_draft` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `mark_delivery_acknowledged` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `mark_delivery_dispatched_for_turn` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `mark_delivery_in_doubt` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `reconcile_dispatched_deliveries` | diesel-deferred | plan_review, turn |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `retry_delivery_dispatched_for_turn` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `save_review_draft` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `submit_head_for_review_inner` | diesel-deferred | plan_review, turn |
| `src-tauri/crates/core/src/db/ops/plan_review.rs` › `transition_delivery` | diesel-deferred | plan_review |
| `src-tauri/crates/core/src/db/ops/project.rs` › `delete_project` | diesel-deferred | memory |
| `src-tauri/crates/core/src/db/ops/queue.rs` › `enqueue_with_context` | diesel-immediate | queue, queued_prompt_context_item |
| `src-tauri/crates/core/src/db/ops/queue.rs` › `reorder` | diesel-deferred | queue |
| `src-tauri/crates/core/src/db/ops/queue.rs` › `set_delivery` | diesel-immediate | queue, queued_prompt_context_item |
| `src-tauri/crates/core/src/db/ops/queue.rs` › `take_next` | diesel-deferred | audit, message, model_config, queue |
| `src-tauri/crates/core/src/db/ops/todo.rs` › `replace_active_list_with_plan_completion` | diesel-deferred | plan, todo |
| `src-tauri/crates/core/src/db/ops/turn.rs` › `reconcile_interrupted` | diesel-deferred | queue |
| `src-tauri/crates/core/src/db/ops/voice_corpus.rs` › `tombstone_unreferenced` | diesel-immediate | — |
| `src-tauri/crates/core/src/hooks/review.rs` › `write_round` | diesel-deferred | audit, conversation, message, model_config, project, turn |
| `src-tauri/crates/core/src/onebot/capture.rs` › `commit` | diesel-immediate | voice_corpus |
| `src-tauri/crates/core/src/onebot/extract.rs` › `approve_proposal` | diesel-deferred | memory |
| `src-tauri/crates/core/src/onebot/mod.rs` › `save_config` | diesel-deferred | preference |
| `src-tauri/crates/core/src/voice_corpus.rs` › `storage_key` | diesel-immediate | preference |
| `src-tauri/src/commands/assistant.rs` › `delete_assistant_unless_plan_barrier` | diesel-immediate | assistant, conversation, plan_review |
| `src-tauri/src/commands/assistant.rs` › `update_assistant_unless_plan_barrier` | diesel-immediate | assistant, conversation, plan_review |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | diesel-deferred | audit, emoji, message, message_context_item, model_config, queue, queued_prompt_context_item |
| `src-tauri/src/commands/conversation.rs` › `mutate_conversation_unless_plan_barrier` | diesel-immediate | conversation, plan_review · 回调来自 3 处 |
| `src-tauri/src/commands/conversation.rs` › `update_conversation_project_unless_plan_barrier` | diesel-immediate | conversation, plan_review |
| `src-tauri/src/commands/message.rs` › `delete_message_unless_plan_barrier` | diesel-immediate | message, plan_review |
| `src-tauri/src/commands/message.rs` › `read_message_context_item` | diesel-deferred | conversation, message, message_context_item |
| `src-tauri/src/commands/message.rs` › `read_snapshot` | diesel-deferred | acp_session_notice, conversation, message, message_context_item, plan_review, turn, usage |
| `src-tauri/src/commands/message.rs` › `switch_branch_unless_plan_barrier` | diesel-immediate | message, plan_review |
| `src-tauri/src/commands/model_config.rs` › `delete_model_config_unless_plan_barrier` | diesel-immediate | conversation, model_config, model_profile, plan_review |
| `src-tauri/src/commands/model_config.rs` › `upsert_model_config_unless_plan_barrier` | diesel-immediate | conversation, model_config, model_profile, plan_review |
| `src-tauri/src/commands/plan_review.rs` › `decide_plan_review` | diesel-deferred | acp_session, audit, conversation, message, model_config, plan_review, turn |
| `src-tauri/src/commands/project.rs` › `delete_project_unless_plan_barrier` | diesel-immediate | conversation, memory, plan_review, project |
| `src-tauri/src/commands/project.rs` › `update_project_unless_plan_barrier` | diesel-immediate | conversation, plan_review, project |
| `src-tauri/src/commands/provider.rs` › `delete_provider_unless_plan_barrier` | diesel-immediate | conversation, plan_review, provider |
| `src-tauri/src/commands/provider.rs` › `set_provider_key` | diesel-immediate | cached_model, conversation, plan_review |
| `src-tauri/src/commands/provider.rs` › `update_provider_unless_plan_barrier` | diesel-immediate | cached_model, conversation, plan_review, provider |
| `src-tauri/src/commands/queue.rs` › `enqueue_unless_plan_barrier` | diesel-immediate | plan_review, queue, queued_prompt_context_item |
| `src-tauri/src/commands/queue.rs` › `release_unless_plan_barrier` | diesel-immediate | plan_review, queue |
| `src-tauri/src/commands/sub_agent.rs` › `open_conversation` | diesel-deferred | audit, conversation, message, model_config, turn |
