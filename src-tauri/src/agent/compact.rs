use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;

use crate::db::{self, DbPool};
use crate::db::models::assistant::Assistant;
use crate::db::models::message::NewMessage;
use crate::provider::{self, ChatMessage, ChatProvider};
use crate::secrets::SecretsManager;
use crate::util::{get_conn, now_ms};
use super::context::{remove_orphan_tool_messages, data_uri_re};
use super::provider_config::{resolve_provider_config, resolve_turn_params, without_thinking, TurnParamsInput};
use super::stream::is_context_window_error;
use super::tokenizer::TokenBudget;

pub(crate) const COMPACT_PROMPT: &str = "\
You are a summarization assistant for an AI coding agent conversation. \
Produce a structured summary that preserves ALL essential context for continuing the task. \
Include these sections:

1. **Original Request**: What the user asked for (preserve their exact words)
2. **Key Decisions & Constraints**: Technical decisions made, constraints identified, user preferences stated
3. **Current Approach**: The approach being taken, technologies/patterns chosen
4. **Files Modified/Created**: Complete list of file paths that were read, modified, or created, with brief description of changes
5. **Code Context**: Critical code snippets, function signatures, type definitions that are actively being worked on (include actual code)
6. **Progress**: What has been completed so far (be specific about tool call outcomes)
7. **Current State**: Where the conversation left off; what was the last action taken
8. **Pending Tasks**: Outstanding items, next steps, known issues
9. **User Messages**: Preserve the exact text of ALL user messages (they contain intent and corrections that must not be lost)

CRITICAL RULES:
- File paths must be EXACT (no abbreviation)
- Preserve all user messages verbatim — summarize assistant responses, not user input
- Include error messages and their resolutions
- Do NOT use tool calls. Respond with ONLY the summary text.
- Write in the same language the user used in the conversation.";

const MAX_COMPACT_RETRIES: usize = 3;
const TOOL_RESULT_TRUNCATE_CHARS: usize = 3000;
const TOOL_RESULT_HEAD_CHARS: usize = 500;
const TOOL_RESULT_TAIL_CHARS: usize = 200;

#[derive(Debug)]
pub(crate) enum CompactError {
    NotEnoughMessages,
    Provider(String),
    ExhaustedRetries,
}

impl std::fmt::Display for CompactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotEnoughMessages => write!(f, "Not enough messages to compact"),
            Self::Provider(e) => write!(f, "Provider error: {e}"),
            Self::ExhaustedRetries => write!(f, "Compaction failed after max retries"),
        }
    }
}

fn prepare_compact_input(messages: &[&crate::db::models::message::Message]) -> String {
    let re = data_uri_re();
    let mut text = String::new();
    for m in messages {
        let role_label = match m.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool Result",
            _ => continue,
        };

        let content = if m.role == "tool" && m.content.len() > TOOL_RESULT_TRUNCATE_CHARS {
            let chars: Vec<char> = m.content.chars().collect();
            let head: String = chars[..TOOL_RESULT_HEAD_CHARS.min(chars.len())].iter().collect();
            let tail_start = chars.len().saturating_sub(TOOL_RESULT_TAIL_CHARS);
            let tail: String = chars[tail_start..].iter().collect();
            format!("{head}\n[... {len} chars truncated ...]\n{tail}", len = chars.len())
        } else {
            m.content.clone()
        };

        let content = re.replace_all(&content, "[image attachment]");

        text.push_str(&format!("### {role_label}\n{content}\n\n"));
    }
    text
}

// Takes the `Arc` rather than a plain reference so the provider resolution below
// can be handed to `spawn_blocking`, which needs an owned handle.
pub(crate) async fn do_compact(
    pool: &DbPool,
    secrets: &Arc<SecretsManager>,
    conversation_id: &str,
    assistant: Option<&Assistant>,
    keep_recent: usize,
    custom_instructions: Option<&str>,
) -> Result<String, String> {
    // Only the active path is summarised. Folding in a branch the user has
    // switched away from would put events in the summary that never happened on
    // the conversation being continued.
    let ctx = {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(db::ops::message::active_context(&history, conv.head_message_id.as_deref()))
        }).await.map_err(|e| e.to_string())??
    };

    let active_messages: Vec<&db::models::message::Message> = ctx.path.iter().collect();

    let min_messages = keep_recent * 2 + 2;
    if active_messages.len() < min_messages {
        return Err("Not enough messages to compact".into());
    }

    let boundary_idx = active_messages.len() - keep_recent * 2;
    let anchor_id = active_messages[boundary_idx].id.clone();

    let to_compact = &active_messages[..boundary_idx];
    let conversation_text = prepare_compact_input(to_compact);

    let mut compact_system = COMPACT_PROMPT.to_string();
    if let Some(instructions) = custom_instructions {
        compact_system.push_str(&format!("\n\nAdditional instructions: {instructions}"));
    }

    // Both resolutions take a pooled connection, and the first also reads the OS
    // credential store, so they run off the async thread.
    //
    // The turn parameters use the same resolution as a normal turn: a
    // summarisation request that invents its own temperature or output ceiling
    // is rejected by models the chat path already knows how to talk to.
    let (provider_type, base_url, api_key, model, api_format, turn) = {
        let pool2 = pool.clone();
        let secrets2 = secrets.clone();
        let assistant2 = assistant.cloned();
        tokio::task::spawn_blocking(move || {
            let (provider_type, base_url, api_key, model, api_format) =
                resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())?;
            let turn = resolve_turn_params(&pool2, TurnParamsInput {
                assistant: assistant2.as_ref(),
                provider_id: assistant2.as_ref().and_then(|a| a.provider_id.as_deref()),
                provider_type: &provider_type,
                api_format: &api_format,
                model: &model,
                thinking_level: None,
                // Summarising is background work; it does not take the priority tier.
                fast: false,
            })?;
            Ok::<_, String>((provider_type, base_url, api_key, model, api_format, turn))
        }).await.map_err(|e| e.to_string())??
    };
    let prov = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));
    let params = without_thinking(turn.params);

    let summary = compact_with_retry(&*prov, &compact_system, &conversation_text, &params).await?;

    let project_context = extract_recent_files_from_db_messages(&active_messages[boundary_idx..]);

    let final_summary = if project_context.is_empty() {
        summary
    } else {
        format!("{summary}\n\n---\n{project_context}")
    };

    {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let anchor = anchor_id.clone();
        let path_ids: Vec<String> = ctx.path.iter().map(|m| m.id.clone()).collect();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            // Scoped to this path: another branch's summary is still valid for
            // that branch.
            db::ops::message::delete_summaries_anchored_in(&mut conn, &conv_id, &path_ids)
                .map_err(|e| e.to_string())?;
            let msg_id = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user",
                content: &final_summary,
                provider_id: None, model_id: None,
                input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None,
                sort_order: -1, created_at: now,
                reasoning_content: None, rating: None,
                schema_version: 2, is_compact_summary: 1,
                // A summary is written by the compaction pass, not by any speaker.
                sender_id: None,
                // A summary is not a node in the tree; it sits beside it and
                // names the message it stands in front of.
                parent_id: None, compact_anchor_id: Some(&anchor), source: None,
                // Nor by any one turn. A summary outlives the turns whose
                // history it replaced, and attributing it to whichever turn
                // happened to trigger the compaction would make it disappear
                // with that turn's record.
                turn_id: None, tool_outcome: None,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    Ok(anchor_id)
}

async fn compact_with_retry(
    provider: &dyn ChatProvider,
    system: &str,
    conversation_text: &str,
    params: &provider::ChatParams,
) -> Result<String, String> {
    let lines: Vec<&str> = conversation_text.split("### ").collect();
    let total_sections = lines.len();

    for attempt in 0..=MAX_COMPACT_RETRIES {
        let drop_fraction = match attempt {
            0 => 0,
            1 => total_sections / 4,
            2 => total_sections / 2,
            _ => total_sections * 3 / 4,
        };

        let trimmed: String = if drop_fraction == 0 {
            conversation_text.to_string()
        } else {
            let kept = &lines[drop_fraction..];
            kept.join("### ")
        };

        let msgs = vec![
            ChatMessage { role: "system".into(), content: system.into(), reasoning_content: None, tool_calls: None, tool_call_id: None, signature: None, origin: crate::provider::MessageOrigin::Assistant },
            ChatMessage::user(&trimmed),
        ];

        match provider.chat(msgs, params.clone()).await {
            Ok(summary) => return Ok(summary),
            Err(e) => {
                let err_str = e.to_string();
                if is_context_window_error(&err_str) && attempt < MAX_COMPACT_RETRIES {
                    tracing::warn!(
                        model = %params.model,
                        attempt,
                        dropped_sections = drop_fraction,
                        "compaction input too large; dropping the oldest sections and retrying"
                    );
                    continue;
                }
                // `model` is the field that mattered when this last went wrong:
                // the summariser was being refused by one specific model while
                // ordinary chat on the same provider worked fine.
                tracing::error!(
                    model = %params.model,
                    attempt,
                    error = %err_str,
                    "compaction summarisation failed"
                );
                return Err(format!("Compact summarization failed: {err_str}"));
            }
        }
    }
    Err("Compact failed after max retries".into())
}

pub(crate) async fn mid_turn_compact(
    messages: &mut Vec<ChatMessage>,
    budget: &TokenBudget,
    provider: &dyn ChatProvider,
    params: &provider::ChatParams,
    keep_recent: usize,
) -> Result<usize, CompactError> {
    let before = budget.counter.count_messages(messages);

    // Injected background (the memory block) is held aside for the whole pass.
    // Summarising it would both lose the memories and paraphrase <owner_notes>
    // out of the wrapper that forbids quoting them.
    let injected = super::context::take_injected_context(messages);

    let has_system = messages.first().is_some_and(|m| m.role == "system");
    let system_offset = if has_system { 1 } else { 0 };
    let keep_msgs = (keep_recent * 2).min(messages.len().saturating_sub(system_offset));
    let boundary = messages.len() - keep_msgs;

    if boundary <= system_offset + 1 {
        // Bail out without swallowing what was lifted aside.
        messages.extend(injected);
        return Err(CompactError::NotEnoughMessages);
    }

    let to_compact = &messages[system_offset..boundary];
    let re = data_uri_re();
    let mut conversation_text = String::new();
    for m in to_compact {
        let role_label = match m.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool Result",
            _ => continue,
        };
        let content = if m.role == "tool" && m.content.len() > TOOL_RESULT_TRUNCATE_CHARS {
            let chars: Vec<char> = m.content.chars().collect();
            let head: String = chars[..TOOL_RESULT_HEAD_CHARS.min(chars.len())].iter().collect();
            let tail_start = chars.len().saturating_sub(TOOL_RESULT_TAIL_CHARS);
            let tail: String = chars[tail_start..].iter().collect();
            format!("{head}\n[... {len} chars truncated ...]\n{tail}", len = chars.len())
        } else {
            m.content.clone()
        };
        let content = re.replace_all(&content, "[image attachment]");
        conversation_text.push_str(&format!("### {role_label}\n{content}\n\n"));
    }

    // Inherits the turn's own parameters — they already passed the capability
    // filter for this model.
    let compact_params = without_thinking(params.clone());

    let summary = compact_with_retry(provider, COMPACT_PROMPT, &conversation_text, &compact_params)
        .await
        .map_err(CompactError::Provider)?;

    let file_context = extract_recent_files_from_chat(messages);
    let summary_with_context = if file_context.is_empty() {
        summary
    } else {
        format!("{summary}\n\n---\n{file_context}")
    };

    let mut new_messages = Vec::new();
    if has_system {
        new_messages.push(messages[0].clone());
    }
    new_messages.push(ChatMessage::user(&summary_with_context));
    // Back in verbatim, ahead of the kept tail so later trims keep it too.
    new_messages.extend(injected);
    new_messages.extend_from_slice(&messages[boundary..]);
    remove_orphan_tool_messages(&mut new_messages);

    *messages = new_messages;

    let after = budget.counter.count_messages(messages);
    Ok(before.saturating_sub(after))
}

fn extract_recent_files_from_chat(messages: &[ChatMessage]) -> String {
    let mut files: Vec<(String, &str)> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for m in messages.iter().rev() {
        if let Some(ref tcs) = m.tool_calls {
            for tc in tcs {
                let op = match tc.name.as_str() {
                    "read_file" => "read",
                    "write_file" => "written",
                    "edit_file" => "edited",
                    "search_files" => "searched",
                    _ => continue,
                };
                if let Ok(args) = serde_json::from_str::<serde_json::Value>(&tc.arguments) {
                    if let Some(path) = args.get("path").and_then(|p| p.as_str()) {
                        if seen.insert(path.to_string()) {
                            files.push((path.to_string(), op));
                        }
                    }
                }
            }
        }
        if files.len() >= 10 {
            break;
        }
    }

    if files.is_empty() {
        return String::new();
    }

    files.reverse();
    let mut out = String::from("[Recently accessed files]\n");
    for (path, op) in &files {
        out.push_str(&format!("- {path} ({op})\n"));
    }
    out
}

fn extract_recent_files_from_db_messages(messages: &[&crate::db::models::message::Message]) -> String {
    let mut files: Vec<(String, &str)> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for m in messages.iter().rev() {
        if m.role != "assistant" { continue; }
        let Some(ref tc_json) = m.tool_calls else { continue };
        let Ok(tcs) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json) else { continue };
        for tc in &tcs {
            let name = tc.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str())
                .or_else(|| tc.get("name").and_then(|n| n.as_str()));
            let args_str = tc.get("function").and_then(|f| f.get("arguments")).and_then(|a| a.as_str())
                .or_else(|| tc.get("arguments").and_then(|a| a.as_str()));
            let Some(name) = name else { continue };
            let op = match name {
                "read_file" => "read",
                "write_file" => "written",
                "edit_file" => "edited",
                "search_files" => "searched",
                _ => continue,
            };
            if let Some(args_str) = args_str {
                if let Ok(args) = serde_json::from_str::<serde_json::Value>(args_str) {
                    if let Some(path) = args.get("path").and_then(|p| p.as_str()) {
                        if seen.insert(path.to_string()) {
                            files.push((path.to_string(), op));
                        }
                    }
                }
            }
        }
        if files.len() >= 10 { break; }
    }

    if files.is_empty() {
        return String::new();
    }

    files.reverse();
    let mut out = String::from("[Recently accessed files]\n");
    for (path, op) in &files {
        out.push_str(&format!("- {path} ({op})\n"));
    }
    out
}

pub(crate) struct CompactCircuitBreaker {
    consecutive_failures: AtomicU32,
    state: AtomicU8,
    last_failure_ms: std::sync::atomic::AtomicI64,
}

const CB_CLOSED: u8 = 0;
const CB_OPEN: u8 = 1;
const CB_HALF_OPEN: u8 = 2;
const CB_MAX_FAILURES: u32 = 3;
const CB_COOLDOWN_MS: i64 = 60_000;

impl CompactCircuitBreaker {
    pub(crate) fn new() -> Self {
        Self {
            consecutive_failures: AtomicU32::new(0),
            state: AtomicU8::new(CB_CLOSED),
            last_failure_ms: std::sync::atomic::AtomicI64::new(0),
        }
    }

    pub(crate) fn can_compact(&self) -> bool {
        match self.state.load(Ordering::Relaxed) {
            CB_CLOSED => true,
            CB_HALF_OPEN => true,
            CB_OPEN => {
                let elapsed = now_ms() - self.last_failure_ms.load(Ordering::Relaxed);
                if elapsed >= CB_COOLDOWN_MS {
                    self.state.store(CB_HALF_OPEN, Ordering::Relaxed);
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    pub(crate) fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.state.store(CB_CLOSED, Ordering::Relaxed);
    }

    pub(crate) fn record_failure(&self) {
        let count = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
        self.last_failure_ms.store(now_ms(), Ordering::Relaxed);
        if count >= CB_MAX_FAILURES {
            self.state.store(CB_OPEN, Ordering::Relaxed);
        }
    }

    pub(crate) fn state_label(&self) -> &'static str {
        match self.state.load(Ordering::Relaxed) {
            CB_CLOSED => "closed",
            CB_OPEN => "open",
            CB_HALF_OPEN => "half-open",
            _ => "unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_closes_on_success() {
        let cb = CompactCircuitBreaker::new();
        assert!(cb.can_compact());
        cb.record_failure();
        cb.record_failure();
        cb.record_success();
        assert!(cb.can_compact());
        assert_eq!(cb.state_label(), "closed");
    }

    #[test]
    fn test_circuit_breaker_opens_after_max_failures() {
        let cb = CompactCircuitBreaker::new();
        for _ in 0..CB_MAX_FAILURES {
            cb.record_failure();
        }
        assert!(!cb.can_compact());
        assert_eq!(cb.state_label(), "open");
    }

    #[test]
    fn test_prepare_compact_input_truncates_large_tool() {
        let msg = crate::db::models::message::Message {
            id: "1".into(),
            conversation_id: "c".into(),
            role: "tool".into(),
            content: "x".repeat(5000),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: Some("call_1".into()),
            sort_order: 0,
            created_at: 0,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
        };
        let result = prepare_compact_input(&[&msg]);
        assert!(result.contains("truncated"));
        assert!(result.len() < 5000);
    }

    #[test]
    fn test_extract_recent_files_from_chat() {
        let msgs = vec![
            ChatMessage::assistant_with_tools("let me read", None, vec![
                provider::ToolCall { id: "c1".into(), name: "read_file".into(), arguments: r#"{"path":"src/main.rs"}"#.into() },
            ]),
            ChatMessage::tool_result("c1", "fn main() {}"),
        ];
        let result = extract_recent_files_from_chat(&msgs);
        assert!(result.contains("src/main.rs"));
        assert!(result.contains("read"));
    }
}
