# 事务调用图

由 `node scripts/check-transaction-graph.mjs --write` 生成，不要手改。
规则与用途见脚本头注释；SeaORM 迁移按这里的连通分量和事务根分期。

- 事务根（非测试）：283
- Diesel ops 调用点（db/ops 之外）：0
- Diesel API 引用：166

## R2 无法检查的 SeaORM 事务根

接收者是一次调用的结果（`get_db().write(…)`），静态上认不出闭包里哪个句柄是同一个池。

- 无

## ops 模块的事务连通分量

- 28 个：acp_context_delivery acp_session acp_session_notice assistant audit background_task cached_model composer_draft conversation emoji emoji_pack memory message message_context_item model_config model_profile plan plan_review preference project provider queue queued_prompt_context_item skill_binding todo tool_preset turn usage
- 1 个：custom_tool
- 1 个：journal
- 1 个：mcp_server
- 1 个：notification
- 1 个：redaction_rule
- 1 个：skill
- 1 个：tool_category
- 1 个：voice_corpus

## 事务根

| 位置 | 类型 | 触及的 ops 模块 |
|---|---|---|
| `src-tauri/crates/core/src/acp/import.rs` › `attach` | sea-write | acp_session, conversation |
| `src-tauri/crates/core/src/acp/import.rs` › `import` | sea-write | acp_session, acp_session_notice, assistant, audit, conversation, memory, message, model_config, model_profile, plan, project, provider, todo, turn |
| `src-tauri/crates/core/src/acp/mod.rs` › `remember_session` | sea-write | acp_session |
| `src-tauri/crates/core/src/acp/mod.rs` › `reopen_session` | sea-read | acp_session, conversation |
| `src-tauri/crates/core/src/acp/mod.rs` › `save` | sea-write | preference |
| `src-tauri/crates/core/src/acp/mod.rs` › `write_conversation_row` | sea-write | acp_session, assistant, conversation |
| `src-tauri/crates/core/src/acp/plan_review.rs` › `submit` | sea-write | plan_review |
| `src-tauri/crates/core/src/acp/plan_review.rs` › `submit` | sea-write | plan_review, turn |
| `src-tauri/crates/core/src/acp/session.rs` › `adopt_title` | sea-write | conversation |
| `src-tauri/crates/core/src/acp/session.rs` › `deliver_plan_review` | sea-write | turn |
| `src-tauri/crates/core/src/acp/session.rs` › `finish` | sea-write | turn |
| `src-tauri/crates/core/src/acp/session.rs` › `pending_shell_context` | sea-read | acp_context_delivery, conversation, message, message_context_item |
| `src-tauri/crates/core/src/acp/session.rs` › `record_diffs` | sea-write | message |
| `src-tauri/crates/core/src/acp/session.rs` › `record_notice` | sea-write | acp_session_notice |
| `src-tauri/crates/core/src/acp/session.rs` › `record_phase` | sea-write | turn |
| `src-tauri/crates/core/src/acp/session.rs` › `revise_stored` | sea-write | message |
| `src-tauri/crates/core/src/acp/session.rs` › `settle` | sea-write | acp_context_delivery |
| `src-tauri/crates/core/src/acp/session.rs` › `write_interjections` | sea-write | queue |
| `src-tauri/crates/core/src/acp/session.rs` › `write_plan` | sea-write | plan, todo |
| `src-tauri/crates/core/src/acp/session.rs` › `write_prompt_row` | sea-write | audit, conversation, memory, message, message_context_item, model_config, model_profile, provider, queue, queued_prompt_context_item, turn |
| `src-tauri/crates/core/src/acp/session.rs` › `write_row` | sea-write | message |
| `src-tauri/crates/core/src/agent/auto_review/mod.rs` › `record` | sea-nested | audit, memory, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/auto_review/mod.rs` › `record` | sea-nested | message |
| `src-tauri/crates/core/src/agent/auto_review/mod.rs` › `record` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/auto_review/mod.rs` › `scene_text` | sea-read | conversation, message |
| `src-tauri/crates/core/src/agent/auto_review/mod.rs` › `wrap` | sea-read | preference |
| `src-tauri/crates/core/src/agent/codex_install.rs` › `installation_id` | sea-write | preference |
| `src-tauri/crates/core/src/agent/compact.rs` › `do_compact` | sea-nested | audit, memory, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/compact.rs` › `do_compact` | sea-read | conversation, message, message_context_item |
| `src-tauri/crates/core/src/agent/compact.rs` › `do_compact` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/conversation_excerpt.rs` › `freeze_conversation_refs` | sea-read | conversation, message |
| `src-tauri/crates/core/src/agent/engine/transcript.rs` › `append_tool_result` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/engine/transcript.rs` › `begin_assistant` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/engine/transcript.rs` › `complete_assistant` | sea-nested | audit, memory, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/engine/transcript.rs` › `complete_assistant` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/engine/transcript.rs` › `write_steering_as` | sea-write | audit, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/agent/engine/transitions.rs` › `store_mode` | sea-write | conversation |
| `src-tauri/crates/core/src/agent/interrupted.rs` › `confirm_delivered` | sea-write | turn |
| `src-tauri/crates/core/src/agent/interrupted.rs` › `load_block` | sea-read | turn |
| `src-tauri/crates/core/src/agent/memory_context.rs` › `persist_context_row` | sea-write | message |
| `src-tauri/crates/core/src/agent/memory_context.rs` › `plan_injection_async` | sea-read | memory |
| `src-tauri/crates/core/src/agent/model_config.rs` › `load_one` | sea-read | model_config, model_profile |
| `src-tauri/crates/core/src/agent/queue.rs` › `confirm_reported` | sea-write | queue |
| `src-tauri/crates/core/src/agent/queue.rs` › `has_plan_review_barrier` | sea-read | plan_review |
| `src-tauri/crates/core/src/agent/queue.rs` › `hold` | sea-write | queue |
| `src-tauri/crates/core/src/agent/queue.rs` › `steer` | sea-write | — |
| `src-tauri/crates/core/src/agent/queue.rs` › `steer` | sea-write | — |
| `src-tauri/crates/core/src/agent/queue.rs` › `steer` | sea-write | — |
| `src-tauri/crates/core/src/agent/queue/native.rs` › `take_one` | sea-write | audit, conversation, memory, message, model_config, model_profile, provider, queue |
| `src-tauri/crates/core/src/agent/skills.rs` › `seed_builtin_bindings` | sea-write | preference, skill_binding |
| `src-tauri/crates/core/src/agent/skills.rs` › `sync_index` | sea-write | skill |
| `src-tauri/crates/core/src/agent/todo_context.rs` › `plan_todo_injection` | sea-read | todo |
| `src-tauri/crates/core/src/agent/turn_config.rs` › `resolve_on` | sea-read | emoji, emoji_pack, plan, plan_review, skill_binding, tool_preset |
| `src-tauri/crates/core/src/agent/turn_record.rs` › `begin_triggered` | sea-write | turn |
| `src-tauri/crates/core/src/agent/turn_record.rs` › `finish` | sea-write | turn |
| `src-tauri/crates/core/src/agent/turn_record.rs` › `note_phase` | sea-write | turn |
| `src-tauri/crates/core/src/background.rs` › `claim` | sea-write | background_task, conversation, message |
| `src-tauri/crates/core/src/background.rs` › `run` | sea-write | background_task |
| `src-tauri/crates/core/src/background.rs` › `start` | sea-write | background_task |
| `src-tauri/crates/core/src/bootstrap.rs` › `bootstrap_with_secrets` | sea-write | assistant |
| `src-tauri/crates/core/src/bootstrap.rs` › `bootstrap_with_secrets` | sea-write | assistant, provider |
| `src-tauri/crates/core/src/bootstrap.rs` › `resume_completed_plan_review_queues` | sea-read | plan_review |
| `src-tauri/crates/core/src/bootstrap.rs` › `resume_completed_plan_review_queues` | sea-write | plan_review |
| `src-tauri/crates/core/src/bootstrap.rs` › `seed_tool_catalog` | sea-write | tool_category |
| `src-tauri/crates/core/src/bootstrap.rs` › `seed_tool_catalog` | sea-write | tool_preset |
| `src-tauri/crates/core/src/bootstrap.rs` › `seed_tool_catalog` | sea-write | tool_preset |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | background_task |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | memory |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | memory |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | memory |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | plan_review |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | plan_review, turn |
| `src-tauri/crates/core/src/bootstrap.rs` › `startup_recovery` | sea-write | queue, turn |
| `src-tauri/crates/core/src/db/sea/ops/message.rs` › `audit_copy` | sea-nested | audit, memory, model_config, model_profile, provider |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `(顶层)` | sea-read | — |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `(顶层)` | sea-write | — |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `append_assistant_revision` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `backfill_legacy_artifacts` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `backfill_legacy_artifacts` | sea-nested | — |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `create_or_resume_document` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `decide_review` | sea-nested | conversation, plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `discard_review_draft` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `mark_delivery_acknowledged` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `mark_delivery_dispatched_for_turn` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `mark_delivery_in_doubt` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `reconcile_dispatched_deliveries` | sea-nested | plan_review, turn |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `retry_delivery_dispatched_for_turn` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `save_review_draft` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `submit_head_for_review_inner` | sea-nested | plan_review, turn |
| `src-tauri/crates/core/src/db/sea/ops/plan_review.rs` › `transition_delivery` | sea-nested | plan_review |
| `src-tauri/crates/core/src/db/sea/ops/queue.rs` › `take_next` | sea-nested | audit, memory, message, model_config, model_profile, provider, queue |
| `src-tauri/crates/core/src/db/sea/ops/usage.rs` › `(顶层)` | sea-read | — |
| `src-tauri/crates/core/src/db/sea/ops/usage.rs` › `(顶层)` | sea-read | — |
| `src-tauri/crates/core/src/hooks/mod.rs` › `save_config` | sea-write | preference |
| `src-tauri/crates/core/src/hooks/review.rs` › `load_history` | sea-read | conversation, message |
| `src-tauri/crates/core/src/hooks/review.rs` › `write_round` | sea-write | audit, conversation, memory, message, model_config, model_profile, project, provider, turn |
| `src-tauri/crates/core/src/journal/capture.rs` › `command_bracket` | sea-write | journal |
| `src-tauri/crates/core/src/journal/capture.rs` › `record` | sea-write | journal |
| `src-tauri/crates/core/src/journal/capture.rs` › `settle_command_bracket` | sea-write | journal |
| `src-tauri/crates/core/src/notify/mod.rs` › `check_usage` | sea-read | model_config, usage |
| `src-tauri/crates/core/src/notify/mod.rs` › `clear` | sea-write | notification |
| `src-tauri/crates/core/src/notify/mod.rs` › `raise_and_dispatch` | sea-write | notification |
| `src-tauri/crates/core/src/notify/mod.rs` › `raise_and_dispatch` | sea-write | notification |
| `src-tauri/crates/core/src/notify/mod.rs` › `record_attempt` | sea-write | notification |
| `src-tauri/crates/core/src/notify/mod.rs` › `save_config` | sea-write | preference |
| `src-tauri/crates/core/src/onebot/agent.rs` › `headless_chat_inner` | sea-read | assistant, conversation, message |
| `src-tauri/crates/core/src/onebot/agent.rs` › `headless_chat_inner` | sea-write | audit, emoji, memory, message, model_config, model_profile, provider |
| `src-tauri/crates/core/src/onebot/agent.rs` › `oneshot_completion` | sea-read | assistant, conversation |
| `src-tauri/crates/core/src/onebot/agent.rs` › `oneshot_completion` | sea-write | audit, conversation, memory, model_config, model_profile, provider |
| `src-tauri/crates/core/src/onebot/capture.rs` › `commit` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/onebot/extract.rs` › `approve_proposal` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/extract.rs` › `reject_proposal` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/extract.rs` › `run_extraction` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `conversation_and_assistant` | sea-read | assistant, conversation |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-read | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `dispatch_memory` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `run_agent_turn` | sea-write | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `run_extraction_pass` | sea-read | memory |
| `src-tauri/crates/core/src/onebot/handler.rs` › `status_of` | sea-read | assistant, conversation, message |
| `src-tauri/crates/core/src/onebot/media.rs` › `resolve_supports_images` | sea-read | assistant, conversation |
| `src-tauri/crates/core/src/onebot/mod.rs` › `save_config` | sea-write | preference |
| `src-tauri/crates/core/src/onebot/qq_tools.rs` › `list_stickers` | sea-read | emoji, emoji_pack |
| `src-tauri/crates/core/src/onebot/qq_tools.rs` › `send_sticker` | sea-read | emoji, emoji_pack |
| `src-tauri/crates/core/src/onebot/session.rs` › `create_project` | sea-nested | conversation, preference |
| `src-tauri/crates/core/src/onebot/session.rs` › `get_or_create` | sea-write | conversation, preference, project |
| `src-tauri/crates/core/src/onebot/session.rs` › `reset_conversation` | sea-nested | conversation |
| `src-tauri/crates/core/src/onebot/session.rs` › `reset_conversation` | sea-write | conversation, project |
| `src-tauri/crates/core/src/onebot/stickers.rs` › `capture_stickers` | sea-write | emoji |
| `src-tauri/crates/core/src/onebot/stickers.rs` › `capture_stickers` | sea-write | emoji |
| `src-tauri/crates/core/src/onebot/stickers.rs` › `ensure_pack` | sea-write | emoji_pack |
| `src-tauri/crates/core/src/onebot/stickers.rs` › `evict_candidates` | sea-write | emoji |
| `src-tauri/crates/core/src/onebot/stickers.rs` › `record_new` | sea-write | emoji |
| `src-tauri/crates/core/src/plan_files.rs` › `mark_applied` | sea-write | plan_review |
| `src-tauri/crates/core/src/plan_files.rs` › `mark_conflict` | sea-write | plan_review |
| `src-tauri/crates/core/src/plan_files.rs` › `reconcile_document_inner` | sea-write | plan_review |
| `src-tauri/crates/core/src/sandbox.rs` › `load` | sea-read | — |
| `src-tauri/crates/core/src/tools/memory.rs` › `execute` | sea-write | memory |
| `src-tauri/crates/core/src/tools/memory.rs` › `execute` | sea-write | memory |
| `src-tauri/crates/core/src/tools/read_conversation.rs` › `execute` | sea-read | conversation, message, message_context_item |
| `src-tauri/crates/core/src/tools/redaction.rs` › `execute` | sea-write | redaction_rule |
| `src-tauri/crates/core/src/tools/redaction.rs` › `execute` | sea-write | redaction_rule |
| `src-tauri/crates/core/src/tools/skill.rs` › `execute` | sea-read | skill_binding |
| `src-tauri/crates/core/src/tools/sticker.rs` › `execute` | sea-read | emoji, emoji_pack |
| `src-tauri/crates/core/src/tools/sticker.rs` › `execute` | sea-read | emoji, emoji_pack |
| `src-tauri/crates/core/src/tools/todo.rs` › `execute` | sea-write | plan, todo |
| `src-tauri/crates/core/src/tools/usage.rs` › `execute` | sea-read | model_config, usage |
| `src-tauri/crates/core/src/voice_corpus.rs` › `storage_key` | sea-write | preference |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `delete_rows_and_files` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `delete_rows_and_files` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `export` | sea-read | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `forget_sender` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `list_sessions` | sea-read | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `resolve_handle` | sea-read | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/manage.rs` › `set_optout` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/recover.rs` › `run` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/recover.rs` › `run` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/recover.rs` › `run` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/voice_corpus/recover.rs` › `run` | sea-write | voice_corpus |
| `src-tauri/crates/core/src/workspace/mod.rs` › `configured_dir` | sea-read | acp_session, conversation, project |
| `src-tauri/crates/meridiand/src/apply.rs` › `apply` | sea-write | notification |
| `src-tauri/crates/meridiand/src/apply.rs` › `apply` | sea-write | notification |
| `src-tauri/crates/meridiand/src/apply.rs` › `apply` | sea-write | provider |
| `src-tauri/crates/meridiand/src/apply.rs` › `apply` | sea-write | provider |
| `src-tauri/crates/meridiand/src/apply.rs` › `claim_data_dir` | sea-write | preference, provider |
| `src-tauri/src/commands/assistant.rs` › `create_assistant` | sea-write | assistant |
| `src-tauri/src/commands/assistant.rs` › `delete_assistant` | sea-write | assistant, conversation, plan_review |
| `src-tauri/src/commands/assistant.rs` › `update_assistant` | sea-write | assistant, conversation, plan_review |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-nested | audit, memory, model_config, model_profile, provider |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-read | assistant, conversation, message, project |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-read | cached_model, emoji, emoji_pack, model_config, plan, plan_review, provider, skill_binding, tool_preset |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-read | conversation, message |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-write | audit, conversation, memory, model_config, model_profile, provider |
| `src-tauri/src/commands/chat.rs` › `chat_inner` | sea-write | audit, emoji, memory, message, message_context_item, model_config, model_profile, provider, queue, queued_prompt_context_item |
| `src-tauri/src/commands/chat.rs` › `read_plan` | sea-read | plan_review |
| `src-tauri/src/commands/chat.rs` › `read_plan` | sea-write | plan_review |
| `src-tauri/src/commands/chat.rs` › `rebuild` | sea-read | emoji, emoji_pack, plan, plan_review, skill_binding, tool_preset |
| `src-tauri/src/commands/chat.rs` › `submit_plan` | sea-write | plan_review |
| `src-tauri/src/commands/chat.rs` › `submit_plan` | sea-write | plan_review, turn |
| `src-tauri/src/commands/chat.rs` › `update_plan` | sea-write | plan_review |
| `src-tauri/src/commands/chat.rs` › `update_plan` | sea-write | plan_review |
| `src-tauri/src/commands/chat.rs` › `verify_plan_review_workspace` | sea-read | conversation, project |
| `src-tauri/src/commands/composer_draft.rs` › `delete_draft` | sea-write | composer_draft |
| `src-tauri/src/commands/composer_draft.rs` › `read_draft` | sea-read | composer_draft, conversation, emoji |
| `src-tauri/src/commands/composer_draft.rs` › `write_draft` | sea-write | composer_draft |
| `src-tauri/src/commands/conversation.rs` › `assemble_system_prompt` | sea-read | cached_model, emoji, emoji_pack, model_config, plan, plan_review, provider, skill_binding, tool_preset |
| `src-tauri/src/commands/conversation.rs` › `compact` | sea-read | assistant, conversation |
| `src-tauri/src/commands/conversation.rs` › `create_conversation` | sea-write | assistant, conversation |
| `src-tauri/src/commands/conversation.rs` › `delete_conversation` | sea-read | conversation |
| `src-tauri/src/commands/conversation.rs` › `delete_conversation` | sea-write | conversation |
| `src-tauri/src/commands/conversation.rs` › `get_context_info` | sea-read | assistant, conversation, message, message_context_item, project |
| `src-tauri/src/commands/conversation.rs` › `search_conversations` | sea-read | conversation |
| `src-tauri/src/commands/conversation.rs` › `set_conversation_mode` | sea-write | conversation |
| `src-tauri/src/commands/conversation.rs` › `set_unless_plan_barrier` | sea-write | conversation, plan_review |
| `src-tauri/src/commands/conversation.rs` › `toggle_archive_conversation` | sea-write | conversation |
| `src-tauri/src/commands/conversation.rs` › `toggle_pin_conversation` | sea-write | conversation |
| `src-tauri/src/commands/conversation.rs` › `update_conversation_title` | sea-write | conversation |
| `src-tauri/src/commands/emoji.rs` › `assign_emoji_pack` | sea-write | emoji_pack |
| `src-tauri/src/commands/emoji.rs` › `confirm_sticker_semantics` | sea-write | emoji |
| `src-tauri/src/commands/emoji.rs` › `create_emoji_pack` | sea-write | emoji_pack |
| `src-tauri/src/commands/emoji.rs` › `delete_emoji_pack` | sea-write | emoji_pack |
| `src-tauri/src/commands/emoji.rs` › `delete_emoji` | sea-write | emoji |
| `src-tauri/src/commands/emoji.rs` › `import_emojis` | sea-write | emoji |
| `src-tauri/src/commands/emoji.rs` › `rename_emoji` | sea-write | emoji |
| `src-tauri/src/commands/emoji.rs` › `suggest_sticker_semantics` | sea-write | emoji |
| `src-tauri/src/commands/emoji.rs` › `unassign_emoji_pack` | sea-write | emoji_pack |
| `src-tauri/src/commands/logs.rs` › `set_log_level` | sea-write | preference |
| `src-tauri/src/commands/mcp.rs` › `create_mcp_server` | sea-write | mcp_server |
| `src-tauri/src/commands/mcp.rs` › `delete_mcp_server` | sea-write | mcp_server |
| `src-tauri/src/commands/mcp.rs` › `update_mcp_server` | sea-write | mcp_server |
| `src-tauri/src/commands/memory.rs` › `delete_memories` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `forget_memory_subject` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `purge_memories` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `restore_memories` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `save_memory_scoped` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `set_memory_subject_flags` | sea-write | memory |
| `src-tauri/src/commands/memory.rs` › `update_memory` | sea-write | memory |
| `src-tauri/src/commands/message.rs` › `delete_message` | sea-write | message, plan_review |
| `src-tauri/src/commands/message.rs` › `export_conversation` | sea-read | assistant, conversation, message |
| `src-tauri/src/commands/message.rs` › `rate_message` | sea-write | message |
| `src-tauri/src/commands/message.rs` › `read_message_context_item` | sea-read | conversation, message, message_context_item |
| `src-tauri/src/commands/message.rs` › `read_once` | sea-read | acp_session_notice, conversation, message, message_context_item, model_config, plan_review, turn, usage |
| `src-tauri/src/commands/message.rs` › `switch_branch` | sea-write | message, plan_review |
| `src-tauri/src/commands/model_config.rs` › `delete_model_config` | sea-write | conversation, model_config, model_profile, plan_review |
| `src-tauri/src/commands/model_config.rs` › `get_model_config` | sea-read | model_config, model_profile |
| `src-tauri/src/commands/model_config.rs` › `list_model_configs` | sea-read | model_config, model_profile |
| `src-tauri/src/commands/model_config.rs` › `list_model_profiles` | sea-read | model_profile |
| `src-tauri/src/commands/model_config.rs` › `save_model_config` | sea-write | conversation, model_config, model_profile, plan_review |
| `src-tauri/src/commands/notify.rs` › `create_notification_webhook` | sea-write | notification |
| `src-tauri/src/commands/notify.rs` › `delete_notification_webhook` | sea-write | notification |
| `src-tauri/src/commands/notify.rs` › `update_notification_webhook` | sea-write | notification |
| `src-tauri/src/commands/plan_review.rs` › `decide_plan_review` | sea-write | acp_session, audit, conversation, memory, message, model_config, model_profile, plan_review, provider, turn |
| `src-tauri/src/commands/plan_review.rs` › `discard_plan_review_draft` | sea-write | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `dispatch_acp_delivery` | sea-write | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `dispatch_native_delivery` | sea-write | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `ensure_conversation_not_waiting_review` | sea-read | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `get_plan_review_delivery` | sea-read | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `get_plan_review` | sea-read | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `resolve_plan_file_conflict` | sea-read | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `resolve_plan_file_conflict` | sea-write | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `save_plan_review_draft` | sea-write | plan_review |
| `src-tauri/src/commands/plan_review.rs` › `settle_delivery` | sea-write | plan_review · 回调来自 2 处 |
| `src-tauri/src/commands/preference.rs` › `set_preference` | sea-write | preference |
| `src-tauri/src/commands/project.rs` › `create_project` | sea-write | project |
| `src-tauri/src/commands/project.rs` › `delete_project` | sea-write | conversation, memory, plan_review, project |
| `src-tauri/src/commands/project.rs` › `update_project` | sea-write | conversation, plan_review, project |
| `src-tauri/src/commands/provider.rs` › `cached_models_for` | sea-read | cached_model |
| `src-tauri/src/commands/provider.rs` › `create_provider` | sea-write | provider |
| `src-tauri/src/commands/provider.rs` › `delete_provider` | sea-write | conversation, plan_review, provider |
| `src-tauri/src/commands/provider.rs` › `fetch_provider_models` | sea-write | cached_model |
| `src-tauri/src/commands/provider.rs` › `get_provider_capabilities` | sea-read | model_config, model_profile, provider |
| `src-tauri/src/commands/provider.rs` › `set_provider_key` | sea-write | cached_model, conversation, plan_review |
| `src-tauri/src/commands/provider.rs` › `update_provider` | sea-write | cached_model, conversation, plan_review, provider |
| `src-tauri/src/commands/queue.rs` › `queue_enqueue` | sea-write | plan_review, queue, queued_prompt_context_item |
| `src-tauri/src/commands/queue.rs` › `queue_release` | sea-write | plan_review, queue |
| `src-tauri/src/commands/queue.rs` › `queue_remove` | sea-write | queue |
| `src-tauri/src/commands/queue.rs` › `queue_reorder` | sea-write | queue |
| `src-tauri/src/commands/queue.rs` › `queue_set_delivery` | sea-write | queue, queued_prompt_context_item |
| `src-tauri/src/commands/skill.rs` › `create_skill` | sea-write | skill |
| `src-tauri/src/commands/skill.rs` › `delete_skill` | sea-write | skill |
| `src-tauri/src/commands/skill.rs` › `set_skill_binding` | sea-write | skill_binding |
| `src-tauri/src/commands/skill.rs` › `update_skill` | sea-write | skill |
| `src-tauri/src/commands/sub_agent.rs` › `open_conversation` | sea-write | audit, conversation, memory, message, model_config, model_profile, provider, turn |
| `src-tauri/src/commands/todo.rs` › `get_active_todo_list` | sea-read | todo |
| `src-tauri/src/commands/tool_system.rs` › `create_custom_tool` | sea-write | custom_tool |
| `src-tauri/src/commands/tool_system.rs` › `create_tool_preset` | sea-write | tool_preset |
| `src-tauri/src/commands/tool_system.rs` › `delete_custom_tool` | sea-write | custom_tool |
| `src-tauri/src/commands/tool_system.rs` › `delete_tool_preset` | sea-write | tool_preset |
| `src-tauri/src/commands/tool_system.rs` › `update_custom_tool` | sea-write | custom_tool |
| `src-tauri/src/commands/tool_system.rs` › `update_tool_preset` | sea-write | tool_preset |
| `src-tauri/src/commands/usage.rs` › `usage_report` | sea-read | model_config, usage |
| `src-tauri/src/commands/user_command.rs` › `get_user_command_result` | sea-read | message, message_context_item |
| `src-tauri/src/commands/user_command.rs` › `persist_result` | sea-write | message_context_item |
| `src-tauri/src/commands/user_command.rs` › `prepare` | sea-write | audit, conversation, memory, message, message_context_item, model_config, model_profile, provider |
| `src-tauri/src/platform.rs` › `save_saf_roots` | sea-write | preference |
| `src-tauri/src/remote/mod.rs` › `save_config` | sea-write | preference |
