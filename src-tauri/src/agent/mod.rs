mod base_prompt;
mod compact;
mod context;
pub(crate) mod diagnostics;
pub(crate) mod engine;
mod file_access;
pub(crate) mod interrupted;
mod inline_tag;
mod loop_guard;
pub(crate) mod manual;
pub(crate) mod pricing;
mod project_instructions;
mod provider_config;
pub(crate) mod skills;
pub(crate) mod memory_context;
pub(crate) mod modes;
pub(crate) mod tool_defs;
pub(crate) mod turn_config;
pub(crate) mod turn_record;
mod stream;
mod tool_calls;
pub(crate) mod tokenizer;
mod truncate;

/// Skills the app ships and rewrites on every launch. They are uneditable and
/// undeletable through the UI, so the check has to be a set rather than a
/// comparison against one name.
pub(crate) const BUILTIN_SKILL_DIRS: &[&str] =
    &[manual::MANUAL_DIR, diagnostics::DIAGNOSTICS_DIR];

pub(crate) fn is_builtin_skill_dir(dir_name: &str) -> bool {
    BUILTIN_SKILL_DIRS.contains(&dir_name)
}

pub(crate) use base_prompt::base_prompt;
pub(crate) use compact::{do_compact, mid_turn_compact, CompactCircuitBreaker, CompactError, COMPACT_PROMPT};
pub(crate) use context::{build_messages, build_messages_with_senders, estimate_tokens, microcompact, resolve_file_uris_in_messages, trim_to_context_limit, SenderNames};
pub(crate) use memory_context::{load_memory_block, load_memory_block_sync, memory_budget, trailing_with_memory, MemoryRequest, MemorySubjectRef};
pub(crate) use file_access::{build_file_access, file_access_prompt};
pub(crate) use inline_tag::{InlineHiddenTagParser, InlineTagSpec};
pub(crate) use loop_guard::{loop_abort_message, loop_warning_message, LoopVerdict, ToolLoopGuard};
pub(crate) use project_instructions::{instruction_budget, load_project_instructions};
pub(crate) use provider_config::{build_tool_secrets, get_provider_api_key, provider_secret_name, resolve_provider_config, resolve_turn_params, without_thinking, TurnParamsInput};
pub(crate) use stream::{is_context_window_error, is_retryable_stream_error, parse_retry_after, StreamResult, MAX_STREAM_RETRIES, STREAM_RETRY_BASE};
pub(crate) use tool_calls::{extract_tool_calls_from_blocks, parse_openai_tool_calls, serialize_tool_calls_openai};
pub(crate) use tokenizer::TokenBudget;
pub(crate) use truncate::{formatted_truncate_text, TOOL_OUTPUT_TRUNCATION};
