mod base_prompt;
mod compact;
mod context;
pub(crate) mod diagnostics;
pub(crate) mod engine;
mod file_access;
mod inline_tag;
pub(crate) mod interrupted;
mod loop_guard;
pub(crate) mod manual;
pub(crate) mod memory_context;
pub(crate) mod modes;
pub(crate) mod pricing;
mod project_instructions;
mod provider_config;
pub(crate) mod skills;
mod stream;
pub(crate) mod sub_agents;
pub(crate) mod tokenizer;
mod tool_calls;
pub(crate) mod tool_defs;
mod truncate;
pub(crate) mod turn_config;
pub(crate) mod turn_record;

/// Skills the app ships and rewrites on every launch. They are uneditable and
/// undeletable through the UI, so the check has to be a set rather than a
/// comparison against one name.
pub(crate) const BUILTIN_SKILL_DIRS: &[&str] = &[manual::MANUAL_DIR, diagnostics::DIAGNOSTICS_DIR];

pub(crate) fn is_builtin_skill_dir(dir_name: &str) -> bool {
    BUILTIN_SKILL_DIRS.contains(&dir_name)
}

pub(crate) use base_prompt::base_prompt;
pub(crate) use compact::{CompactCircuitBreaker, do_compact, mid_turn_compact};
#[cfg(test)]
pub(crate) use context::build_messages;
pub(crate) use context::{
    SenderNames, build_messages_with_senders, microcompact, resolve_file_uris_in_messages,
    resolve_sticker_parts_in_messages, trim_to_context_limit,
};
pub(crate) use file_access::{build_file_access, file_access_prompt};
pub(crate) use inline_tag::{InlineHiddenTagParser, InlineTagSpec};
pub(crate) use loop_guard::{LoopVerdict, ToolLoopGuard, loop_abort_message, loop_warning_message};
pub(crate) use memory_context::{
    MemoryRequest, MemorySubjectRef, memory_budget, persist_injection, plan_injection, plan_injection_async,
    roster_block, trailing_with_memory,
};
pub(crate) use project_instructions::{instruction_budget, load_project_instructions};
pub(crate) use provider_config::{
    ResolvedProvider, TurnParams, TurnParamsInput, build_tool_secrets, get_provider_api_key, provider_secret_name,
    resolve_provider_config, resolve_turn_params, resolve_with_overrides, without_thinking,
};
pub(crate) use stream::{
    MAX_STREAM_RETRIES, STREAM_RETRY_BASE, StreamResult, is_context_window_error, is_retryable_stream_error,
    parse_retry_after,
};
pub(crate) use tokenizer::TokenBudget;
pub(crate) use tool_calls::{extract_tool_calls_from_blocks, serialize_tool_calls_openai};
pub(crate) use truncate::{TOOL_OUTPUT_TRUNCATION, formatted_truncate_text};
