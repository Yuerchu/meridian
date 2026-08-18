use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};

use super::context::{data_uri_re, remove_orphan_tool_messages};
use super::provider_config::{TurnParamsInput, resolve_provider_config, resolve_turn_params, without_thinking};
use super::stream::is_context_window_error;
use super::tokenizer::TokenBudget;
use crate::db::models::assistant::Assistant;
use crate::db::models::message::NewMessage;
use crate::db::{self, DbPool};
use crate::provider::{self, ChatMessage, ChatProvider};
use crate::secrets::SecretsManager;
use crate::util::{get_conn, now_ms};

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
/// What a summary is allowed to cost. The prompt above asks for a handful of
/// sections about one conversation; anything approaching this is already the
/// model misreading the task, and a ceiling that tracks the chat model's
/// advertised output instead would be the whole window on some of them.
///
/// A cap, not the answer: what each request actually asks for is this against
/// what its own input left. See `compact_with_retry`.
const SUMMARY_OUTPUT_CAP: usize = 16_384;
/// Under this there is no point sending the request. What comes back is a
/// heading and a truncated sentence, and it replaces the history it summarised.
const MIN_SUMMARY_TOKENS: usize = 512;
const MAX_SUMMARY_TRANSIENT_RETRIES: u32 = 2;
const SUMMARY_RETRY_BASE: std::time::Duration = std::time::Duration::from_millis(500);

/// The gap between our tokenizer and the provider's, which scales with the
/// input. Same shape as the compaction threshold's own headroom.
fn summary_headroom(context_limit: usize) -> usize {
    (context_limit / 20).min(8_000)
}
const TOOL_RESULT_TRUNCATE_CHARS: usize = 3000;
const TOOL_RESULT_HEAD_CHARS: usize = 500;
const TOOL_RESULT_TAIL_CHARS: usize = 200;

#[derive(Debug)]
pub(crate) enum CompactError {
    NotEnoughMessages,
    Provider(String),
}

impl std::fmt::Display for CompactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotEnoughMessages => write!(f, "Not enough messages to compact"),
            Self::Provider(e) => write!(f, "Provider error: {e}"),
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
pub async fn do_compact(
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
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            let history = db::ops::message::list_messages(&mut conn, &conv_id).map_err(|e| e.to_string())?;
            Ok::<_, String>(db::ops::message::active_context(
                &history,
                conv.head_message_id.as_deref(),
            ))
        })
        .await
        .map_err(|e| e.to_string())??
    };

    // Injected background is not conversation and takes no part in any of the
    // arithmetic below. Counted, it inflates `path.len()` and brings compaction
    // on early; kept in the tail, it eats into the turns `keep_recent` is meant
    // to preserve; and worst, it can *be* `anchor_id` — leaving `live()` to start
    // at a delta row whose own cursor claims a history that is no longer there.
    //
    // Dropping it from the summary input is the other half: `prepare_compact_input`
    // only labels user/assistant/tool and would skip these anyway, but that is a
    // property of a match arm rather than a decision, and `<owner_notes>` going
    // through a summariser is not something to leave resting on one.
    let active_messages: Vec<&db::models::message::Message> = ctx.path.iter().filter(|m| m.role != "context").collect();

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
            let crate::agent::ResolvedProvider {
                provider_type,
                base_url,
                api_key,
                model,
                api_format,
                ..
            } = resolve_provider_config(&secrets2, &pool2, assistant2.as_ref())?;
            let turn = resolve_turn_params(
                &pool2,
                TurnParamsInput {
                    assistant: assistant2.as_ref(),
                    provider_id: assistant2.as_ref().and_then(|a| a.provider_id.as_deref()),
                    provider_type: &provider_type,
                    api_format: &api_format,
                    model: &model,
                    thinking_level: None,
                    // Summarising is background work; it does not take the priority tier.
                    fast: false,
                },
            )?;
            Ok::<_, String>((provider_type, base_url, api_key, model, api_format, turn))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let prov = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));
    let params = without_thinking(turn.params);
    // The same window and the same tokenizer the turn would use. A summariser
    // sized against a different one is sized against nothing.
    let budget = TokenBudget::new(&provider_type, &model, turn.context_limit, turn.max_output, None);

    let summary = compact_with_retry(&*prov, &compact_system, &conversation_text, &params, &budget).await?;

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
            db::ops::message::insert_message(
                &mut conn,
                &NewMessage {
                    id: &msg_id,
                    conversation_id: &conv_id,
                    role: "user",
                    content: &final_summary,
                    provider_id: None,
                    model_id: None,
                    input_tokens: None,
                    output_tokens: None,
                    tool_calls: None,
                    tool_call_id: None,
                    sort_order: -1,
                    created_at: now,
                    reasoning_content: None,
                    rating: None,
                    schema_version: 2,
                    is_compact_summary: 1,
                    // A summary is written by the compaction pass, not by any speaker.
                    sender_id: None,
                    // A summary is not a node in the tree; it sits beside it and
                    // names the message it stands in front of.
                    parent_id: None,
                    compact_anchor_id: Some(&anchor),
                    source: None,
                    // Nor by any one turn. A summary outlives the turns whose
                    // history it replaced, and attributing it to whichever turn
                    // happened to trigger the compaction would make it disappear
                    // with that turn's record.
                    turn_id: None,
                    tool_outcome: None,
                    // The summarising request had its own usage, but it is not this
                    // row's: this row is the summary, not the reply that produced
                    // it, and charging it here would double-count against the turn
                    // that already recorded that call.
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    provider_name: None,
                },
            )
            .map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    Ok(anchor_id)
}

async fn compact_with_retry(
    provider: &dyn ChatProvider,
    system: &str,
    conversation_text: &str,
    params: &provider::ChatParams,
    budget: &TokenBudget,
) -> Result<String, String> {
    // The turn's parameters come along because they already passed this model's
    // capability filter, but its output ceiling must not. A turn's `max_tokens`
    // is whatever the model is allowed to write at most -- 128k on the
    // configuration this was found on -- while a summariser is asked for one
    // bounded artefact. Providers count the prompt and `max_tokens` against one
    // window, so carrying that ceiling over refuses the summariser in exactly
    // the situation that called for it.
    let configured = params
        .max_tokens
        .filter(|m| *m > 0)
        .map_or(SUMMARY_OUTPUT_CAP, |m| m as usize);
    let lines: Vec<&str> = conversation_text.split("### ").collect();
    let total_sections = lines.len();
    let headroom = summary_headroom(budget.context_limit);
    // Kept so the last word is what actually went wrong. Running out of
    // attempts because every one of them was too large is a different problem
    // from running out of attempts after four provider errors.
    let mut no_room: Option<String> = None;

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
            ChatMessage {
                role: "system".into(),
                content: system.into(),
                reasoning_content: None,
                tool_calls: None,
                tool_call_id: None,
                signature: None,
                origin: crate::provider::MessageOrigin::Assistant,
            },
            ChatMessage::user(&trimmed),
        ];

        // Measured per attempt, because dropping sections is the only lever
        // that moves it. A static cap cannot state the invariant this has to
        // hold: input + ceiling + headroom fits the window. On the history that
        // motivated this, 250k of input left no room for even a capped 16k
        // summary, and the request would have been refused before any of the
        // dropping below had a chance to help.
        let input = budget.counter.count_messages(&msgs);
        let room = budget.context_limit.saturating_sub(input + headroom);
        let ceiling = configured.min(SUMMARY_OUTPUT_CAP).min(room);
        if ceiling < MIN_SUMMARY_TOKENS {
            no_room = Some(format!(
                "{input} tokens of history left no room for a summary in a {limit} token window",
                limit = budget.context_limit,
            ));
            tracing::warn!(
                attempt,
                input,
                limit = budget.context_limit,
                "compaction input leaves no room for the summary; dropping the oldest sections"
            );
            continue;
        }
        let attempt_params = provider::ChatParams {
            max_tokens: Some(ceiling as i32),
            ..params.clone()
        };

        match send_summary(provider, msgs, attempt_params).await {
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
    Err(match no_room {
        Some(why) => format!("Compact summarization failed: {why}"),
        None => "Compact failed after max retries".into(),
    })
}

/// One summarisation request, with the transient failures taken out of it.
///
/// Compaction gets one shot per pass and its failures open a circuit breaker,
/// so a single 502 between the app and the gateway costs the whole pass and
/// counts against the budget for trying again. The turn loop already retries
/// its own stream this way; this path had nothing.
async fn send_summary(
    provider: &dyn ChatProvider,
    msgs: Vec<ChatMessage>,
    params: provider::ChatParams,
) -> Result<String, provider::ProviderError> {
    let mut attempt = 0u32;
    loop {
        let sent = provider.chat(msgs.clone(), params.clone()).await;
        match sent {
            Err(ref e)
                if attempt < MAX_SUMMARY_TRANSIENT_RETRIES && super::is_retryable_stream_error(&e.to_string()) =>
            {
                attempt += 1;
                let delay = crate::client::backoff(SUMMARY_RETRY_BASE, attempt as u64);
                // No error body: a gateway's 502 page has been known to echo
                // the request back, and this is a summary of a conversation.
                tracing::warn!(attempt, "summarisation request failed; retrying");
                tokio::time::sleep(delay).await;
            }
            other => return other,
        }
    }
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

    let summary = compact_with_retry(provider, COMPACT_PROMPT, &conversation_text, &compact_params, budget)
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
                if let Ok(args) = serde_json::from_str::<serde_json::Value>(&tc.arguments)
                    && let Some(path) = args.get("path").and_then(|p| p.as_str())
                    && seen.insert(path.to_string())
                {
                    files.push((path.to_string(), op));
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
        if m.role != "assistant" {
            continue;
        }
        let Some(ref tc_json) = m.tool_calls else { continue };
        let Ok(tcs) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json) else {
            continue;
        };
        for tc in &tcs {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .or_else(|| tc.get("name").and_then(|n| n.as_str()));
            let args_str = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .or_else(|| tc.get("arguments").and_then(|a| a.as_str()));
            let Some(name) = name else { continue };
            let op = match name {
                "read_file" => "read",
                "write_file" => "written",
                "edit_file" => "edited",
                "search_files" => "searched",
                _ => continue,
            };
            if let Some(args_str) = args_str
                && let Ok(args) = serde_json::from_str::<serde_json::Value>(args_str)
                && let Some(path) = args.get("path").and_then(|p| p.as_str())
                && seen.insert(path.to_string())
            {
                files.push((path.to_string(), op));
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

pub struct CompactCircuitBreaker {
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
    pub fn new() -> Self {
        Self {
            consecutive_failures: AtomicU32::new(0),
            state: AtomicU8::new(CB_CLOSED),
            last_failure_ms: std::sync::atomic::AtomicI64::new(0),
        }
    }

    pub fn can_compact(&self) -> bool {
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

    pub fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.state.store(CB_CLOSED, Ordering::Relaxed);
    }

    pub fn record_failure(&self) {
        let count = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
        self.last_failure_ms.store(now_ms(), Ordering::Relaxed);
        if count >= CB_MAX_FAILURES {
            self.state.store(CB_OPEN, Ordering::Relaxed);
        }
    }

    pub fn state_label(&self) -> &'static str {
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
    use crate::provider::{ChatStream, ProviderError, ToolDefinition};
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Records every request as the provider saw it: what it was asked to write
    /// and how much history it was given to do it from. Together those are the
    /// only thing these tests are about.
    #[derive(Default)]
    struct Summariser {
        sent: Mutex<Vec<(usize, Option<i32>)>>,
        /// Errors to answer with before finally succeeding, oldest first.
        fails: Mutex<VecDeque<ProviderError>>,
    }

    impl Summariser {
        fn failing(errs: Vec<ProviderError>) -> Self {
            Self {
                fails: Mutex::new(errs.into()),
                ..Default::default()
            }
        }
        fn ceilings(&self) -> Vec<Option<i32>> {
            self.sent.lock().unwrap().iter().map(|(_, c)| *c).collect()
        }
        fn requests(&self) -> Vec<(usize, Option<i32>)> {
            self.sent.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl ChatProvider for Summariser {
        async fn stream_chat_with_tools(
            &self,
            _messages: Vec<ChatMessage>,
            _tools: Vec<ToolDefinition>,
            _params: provider::ChatParams,
        ) -> Result<ChatStream, ProviderError> {
            unreachable!("compaction does not stream")
        }

        async fn chat(
            &self,
            messages: Vec<ChatMessage>,
            params: provider::ChatParams,
        ) -> Result<String, ProviderError> {
            let input = budget().counter.count_messages(&messages);
            self.sent.lock().unwrap().push((input, params.max_tokens));
            match self.fails.lock().unwrap().pop_front() {
                Some(e) => Err(e),
                None => Ok("a summary".into()),
            }
        }

        async fn chat_with_tools(
            &self,
            _messages: Vec<ChatMessage>,
            _tools: Vec<ToolDefinition>,
            _params: provider::ChatParams,
        ) -> Result<crate::provider::AgentResponse, ProviderError> {
            unreachable!("compaction offers no tools")
        }
    }

    fn budget() -> TokenBudget {
        TokenBudget::new("openai", "gpt-4o", 32_000, 8_000, None)
    }

    /// A history of roughly `tokens` tokens, in sections the retry ladder can
    /// drop a quarter of at a time.
    fn history(tokens: usize) -> String {
        (0..40)
            .map(|_| format!("### User\n{}\n\n", "word ".repeat(tokens / 40)))
            .collect()
    }

    /// The invariant, stated against the provider's own view of each request:
    /// whatever this asked for, it fits behind what it sent.
    fn every_request_fits(prov: &Summariser, limit: usize) {
        for (input, ceiling) in prov.requests() {
            let asked = ceiling.expect("a summariser always names its ceiling") as usize;
            assert!(
                input + asked + summary_headroom(limit) <= limit,
                "input {input} + ceiling {asked} overruns a {limit} window",
            );
        }
    }

    /// The turn this runs inside may be allowed to write 128k. Asking for that
    /// on top of a history large enough to need compacting is a request the
    /// provider has to refuse -- and refuse every retry, since dropping
    /// sections shrinks the input and not the ceiling.
    #[tokio::test]
    async fn a_summary_does_not_ask_for_the_whole_window() {
        let prov = Summariser::default();
        let params = provider::ChatParams {
            max_tokens: Some(128_000),
            ..Default::default()
        };

        let out = compact_with_retry(&prov, "system", "### User\nhello\n\n", &params, &budget())
            .await
            .unwrap();

        assert_eq!(out, "a summary");
        assert_eq!(prov.ceilings(), [Some(SUMMARY_OUTPUT_CAP as i32)]);
    }

    /// Only a ceiling, never a floor: a model configured to write less than a
    /// summary's worth is still only asked for what it can write.
    #[tokio::test]
    async fn a_smaller_configured_ceiling_is_left_alone() {
        let prov = Summariser::default();
        let params = provider::ChatParams {
            max_tokens: Some(4_096),
            ..Default::default()
        };

        compact_with_retry(&prov, "system", "### User\nhello\n\n", &params, &budget())
            .await
            .unwrap();

        assert_eq!(prov.ceilings(), [Some(4_096)]);
    }

    /// The cap alone is not enough. A history that nearly fills the window
    /// leaves less than 16k behind it, and a request for 16k anyway is refused
    /// before any of the section-dropping gets a chance to help.
    #[tokio::test]
    async fn a_summary_asks_for_what_its_own_input_left() {
        let prov = Summariser::default();
        let params = provider::ChatParams {
            max_tokens: Some(128_000),
            ..Default::default()
        };

        // Comfortably inside a 32k window, but not by 16k.
        let out = compact_with_retry(&prov, "system", &history(24_000), &params, &budget())
            .await
            .unwrap();

        assert_eq!(out, "a summary");
        every_request_fits(&prov, 32_000);
        let asked = prov.ceilings()[0].unwrap() as usize;
        assert!(asked < SUMMARY_OUTPUT_CAP, "took the cap without looking: {asked}");
        assert!(asked >= MIN_SUMMARY_TOKENS);
    }

    /// And when there is no room at all, dropping sections is what makes it --
    /// not sending the request and finding out.
    #[tokio::test]
    async fn a_history_with_no_room_behind_it_is_cut_before_it_is_sent() {
        let prov = Summariser::default();
        let params = provider::ChatParams {
            max_tokens: Some(128_000),
            ..Default::default()
        };

        let out = compact_with_retry(&prov, "system", &history(31_000), &params, &budget())
            .await
            .unwrap();

        assert_eq!(out, "a summary");
        every_request_fits(&prov, 32_000);
        // The first attempt never left the building: it was measured, found not
        // to fit, and cut instead.
        let first = prov.requests()[0].0;
        assert!(first < 31_000, "sent the whole history anyway: {first} tokens");
    }

    /// Nothing left to cut. Better to say so than to send a request that will
    /// come back as an unattributable provider error.
    #[tokio::test]
    async fn a_history_that_cannot_be_cut_small_enough_says_so() {
        let prov = Summariser::default();
        let params = provider::ChatParams {
            max_tokens: Some(128_000),
            ..Default::default()
        };

        // One indivisible section, larger than the window.
        let huge = format!("### User\n{}\n\n", "word ".repeat(40_000));
        let err = compact_with_retry(&prov, "system", &huge, &params, &budget())
            .await
            .expect_err("there was never room for a summary");

        assert!(err.contains("no room for a summary"), "unhelpful: {err}");
        assert!(prov.requests().is_empty(), "sent it anyway: {:?}", prov.requests());
    }

    /// Compaction gets one pass, and its failures open a circuit breaker. A
    /// gateway hiccup should not cost both.
    #[tokio::test]
    async fn a_transient_failure_is_retried_rather_than_counted_against_compaction() {
        let prov = Summariser::failing(vec![ProviderError::Api {
            status: 502,
            body: "bad gateway".into(),
        }]);
        let params = provider::ChatParams {
            max_tokens: Some(8_000),
            ..Default::default()
        };

        let out = compact_with_retry(&prov, "system", "### User\nhello\n\n", &params, &budget())
            .await
            .unwrap();

        assert_eq!(out, "a summary");
        assert_eq!(prov.requests().len(), 2, "gave up on the first 502");
    }

    /// But not a rejection. Retrying a bad key just delays the report of it.
    #[tokio::test]
    async fn a_rejection_is_not_retried() {
        let prov = Summariser::failing(vec![ProviderError::Api {
            status: 401,
            body: "invalid api key".into(),
        }]);
        let params = provider::ChatParams {
            max_tokens: Some(8_000),
            ..Default::default()
        };

        let err = compact_with_retry(&prov, "system", "### User\nhello\n\n", &params, &budget())
            .await
            .expect_err("401 is an answer, not a hiccup");

        assert!(err.contains("401"), "lost the reason: {err}");
        assert_eq!(prov.requests().len(), 1, "retried a rejection");
    }

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
            cache_read_tokens: None,
            cache_write_tokens: None,
            provider_name: None,
        };
        let result = prepare_compact_input(&[&msg]);
        assert!(result.contains("truncated"));
        assert!(result.len() < 5000);
    }

    /// Frozen injections must not reach the summariser.
    ///
    /// `<owner_notes>` are kept behind a tag the model is told never to quote
    /// from; a summariser reading them has no such instruction and would
    /// paraphrase them into ordinary prose, at which point the protection is
    /// gone and nothing says so. `do_compact` filters these out before it counts
    /// or slices anything — this pins the second line of defence, which is that
    /// the summariser would ignore the row even if one got through.
    #[test]
    fn a_frozen_memory_row_never_reaches_the_summariser() {
        let mut row = crate::db::models::message::Message {
            id: "1".into(),
            conversation_id: "c".into(),
            role: "context".into(),
            content: "<owner_notes>\n- [general] 他在找工作\n</owner_notes>".into(),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 0,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: Some("memory|full|100.abc|-|".into()),
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            provider_name: None,
        };
        assert_eq!(prepare_compact_input(&[&row]), "");

        // The same text as an ordinary user row *would* go in, which is what
        // makes the role the thing doing the work here.
        row.role = "user".into();
        assert!(prepare_compact_input(&[&row]).contains("找工作"));
    }

    #[test]
    fn test_extract_recent_files_from_chat() {
        let msgs = vec![
            ChatMessage::assistant_with_tools(
                "let me read",
                None,
                vec![provider::ToolCall {
                    id: "c1".into(),
                    name: "read_file".into(),
                    arguments: r#"{"path":"src/main.rs"}"#.into(),
                }],
            ),
            ChatMessage::tool_result("c1", "fn main() {}"),
        ];
        let result = extract_recent_files_from_chat(&msgs);
        assert!(result.contains("src/main.rs"));
        assert!(result.contains("read"));
    }
}
