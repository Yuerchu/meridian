//! Turning what the agent narrates into what this app draws.
//!
//! Kept pure and separate from [`super::session`] so the translation can be
//! tested without a child process, a database or a window — which matters
//! because it is the layer most likely to drift when the adapter adds an update
//! kind.
//!
//! The target shapes are not ours to choose: `chat-stream` already has a
//! vocabulary that `chat-view` understands (`turn.rs` emits `message_start`,
//! `text`, `tool_call`, `tool_result`; `stream.rs` emits `reasoning`). Inventing
//! a parallel one for ACP would mean a second renderer.

use super::protocol::{PlanEntry, SessionUpdate, ToolCall, Usage};

/// What one `session/update` means here.
///
/// One update maps to at most one effect; the variants this step does not draw
/// collapse to [`Effect::Ignored`] rather than being an error, for the same
/// reason the parse is lax.
#[derive(Debug, PartialEq)]
pub enum Effect {
    /// Visible prose from the agent.
    Text(String),
    /// Its thinking, drawn separately.
    Reasoning(String),
    /// A call has started. `arguments` is JSON, because that is what the tool
    /// card renders and what `PendingApproval` stores.
    ToolCall {
        call_id: String,
        tool_name: String,
        arguments: String,
    },
    /// A call has finished, one way or the other.
    ToolResult {
        call_id: String,
        result: String,
        /// `success` or `error`, matching `messages.tool_outcome`.
        outcome: &'static str,
    },
    /// The agent's own todo list.
    Plan(Vec<PlanItem>),
    /// Context usage. Reported, never priced — see [`Usage::cost`].
    Usage { used: u64, size: u64 },
    /// A call that has been announced but has not finished, and everything this
    /// step does not draw.
    Ignored,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct PlanItem {
    pub content: String,
    pub status: String,
}

pub fn effect_of(update: SessionUpdate) -> Effect {
    match update {
        SessionUpdate::AgentMessageChunk { content } => match content.as_text() {
            Some(text) if !text.is_empty() => Effect::Text(text.to_string()),
            _ => Effect::Ignored,
        },
        SessionUpdate::AgentThoughtChunk { content } => match content.as_text() {
            Some(text) if !text.is_empty() => Effect::Reasoning(text.to_string()),
            _ => Effect::Ignored,
        },
        // The agent echoing what it was sent. This app wrote that row before it
        // ever reached the adapter, so drawing it again would double it.
        SessionUpdate::UserMessageChunk { .. } => Effect::Ignored,
        SessionUpdate::ToolCall(call) => Effect::ToolCall {
            call_id: call.tool_call_id.clone(),
            tool_name: tool_name_of(&call),
            arguments: arguments_of(&call),
        },
        SessionUpdate::ToolCallUpdate(call) => match call.status.as_deref() {
            Some("completed") => Effect::ToolResult {
                call_id: call.tool_call_id.clone(),
                result: output_of(&call),
                outcome: "success",
            },
            Some("failed") => Effect::ToolResult {
                call_id: call.tool_call_id.clone(),
                result: output_of(&call),
                outcome: "error",
            },
            // `pending` and `in_progress` say a call is still running, which the
            // card already shows from having been announced.
            _ => Effect::Ignored,
        },
        SessionUpdate::Plan { entries } => Effect::Plan(entries.iter().map(plan_item).collect()),
        SessionUpdate::UsageUpdate(Usage { used, size, .. }) => Effect::Usage { used, size },
        SessionUpdate::Unhandled => Effect::Ignored,
    }
}

/// What to label the tool card with.
///
/// ACP has no field for "the tool's name": `title` is prose written for a
/// person ("Run npm test") and `kind` is one of a handful of categories. The
/// title is the better label of the two and the only one that distinguishes two
/// calls of the same tool, so it wins where it exists.
///
/// Public because an approval card labels the same call, and the two must not
/// disagree — a question naming the tool differently from the block it belongs
/// to reads as being about something else.
pub fn tool_name_of(call: &ToolCall) -> String {
    call.title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .or(call.kind.as_deref())
        .unwrap_or("tool")
        .to_string()
}

/// The call's input, as the JSON string the card expects.
///
/// `rawInput` is optional in the protocol and absent in practice for some
/// adapters, so an empty object stands in — a card with no arguments is worth
/// drawing, and `arguments` is also what an approval quotes back to the user.
pub fn arguments_of(call: &ToolCall) -> String {
    call.raw_input
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string())
}

/// Everything textual the call produced, in order.
///
/// Non-text blocks (diffs, terminal handles, images) are skipped rather than
/// described. They are drawn from the tool card's own data in a later step; a
/// placeholder like `[diff]` in the result text would be indistinguishable from
/// output a command actually printed.
fn output_of(call: &ToolCall) -> String {
    let mut out = String::new();
    for block in &call.content {
        if let Some(text) = block.content.as_ref().and_then(|c| c.as_text()) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(text);
        }
    }
    out
}

fn plan_item(entry: &PlanEntry) -> PlanItem {
    PlanItem {
        content: entry.content.clone(),
        // The protocol's own default. An entry with no status is one that has
        // not been started, not one in an unknown state.
        status: entry.status.clone().unwrap_or_else(|| "pending".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::protocol::SessionNotification;

    fn update(raw: &str) -> SessionUpdate {
        let wrapped = format!(r#"{{"sessionId":"s1","update":{raw}}}"#);
        serde_json::from_str::<SessionNotification>(&wrapped).unwrap().update
    }

    #[test]
    fn prose_and_thinking_land_on_different_channels() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}"#
            )),
            Effect::Text("hello".into())
        );
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hmm"}}"#
            )),
            Effect::Reasoning("hmm".into())
        );
    }

    /// The adapter echoes the prompt back as a `user_message_chunk`. This app
    /// wrote that row itself before sending it, so drawing the echo would show
    /// the question twice.
    #[test]
    fn the_echo_of_our_own_prompt_is_dropped() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"do it"}}"#
            )),
            Effect::Ignored
        );
    }

    /// An empty chunk is a keepalive, not a paragraph break. Emitted, it would
    /// be an empty bubble.
    #[test]
    fn an_empty_chunk_produces_nothing() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":""}}"#
            )),
            Effect::Ignored
        );
    }

    #[test]
    fn a_tool_call_is_labelled_with_its_title() {
        let effect = effect_of(update(
            r#"{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Run npm test",
                "kind":"execute","status":"pending","rawInput":{"command":"npm test"}}"#,
        ));
        assert_eq!(
            effect,
            Effect::ToolCall {
                call_id: "t1".into(),
                tool_name: "Run npm test".into(),
                arguments: r#"{"command":"npm test"}"#.into(),
            }
        );
    }

    /// Without a title there is still a card to draw, and without rawInput the
    /// card still needs valid JSON — an approval quotes this back to the user.
    #[test]
    fn a_tool_call_missing_its_optional_fields_still_produces_a_card() {
        let effect = effect_of(update(
            r#"{"sessionUpdate":"tool_call","toolCallId":"t1","kind":"read","status":"pending"}"#,
        ));
        assert_eq!(
            effect,
            Effect::ToolCall {
                call_id: "t1".into(),
                tool_name: "read".into(),
                arguments: "{}".into(),
            }
        );

        let effect = effect_of(update(
            r#"{"sessionUpdate":"tool_call","toolCallId":"t2","status":"pending"}"#,
        ));
        match effect {
            Effect::ToolCall { tool_name, .. } => assert_eq!(tool_name, "tool"),
            other => panic!("expected a tool call, got {other:?}"),
        }
    }

    /// Only a finished call produces a result. `in_progress` arrives for the
    /// same id first, and turning that into a result would close the card while
    /// the command is still running.
    #[test]
    fn only_a_finished_call_produces_a_result() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"in_progress"}"#
            )),
            Effect::Ignored
        );

        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed",
                    "content":[{"type":"content","content":{"type":"text","text":"3 passed"}}]}"#
            )),
            Effect::ToolResult {
                call_id: "t1".into(),
                result: "3 passed".into(),
                outcome: "success",
            }
        );

        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"failed",
                    "content":[{"type":"content","content":{"type":"text","text":"exit 1"}}]}"#
            )),
            Effect::ToolResult {
                call_id: "t1".into(),
                result: "exit 1".into(),
                outcome: "error",
            }
        );
    }

    /// Several content blocks are one result, joined in order. A diff block in
    /// the middle is skipped rather than described — a `[diff]` marker would be
    /// indistinguishable from something a command printed.
    #[test]
    fn a_result_joins_its_text_blocks_and_skips_the_rest() {
        let effect = effect_of(update(
            r#"{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","content":[
                {"type":"content","content":{"type":"text","text":"first"}},
                {"type":"diff","path":"a.rs","oldText":"x","newText":"y"},
                {"type":"content","content":{"type":"text","text":"second"}}]}"#,
        ));
        assert_eq!(
            effect,
            Effect::ToolResult {
                call_id: "t1".into(),
                result: "first\nsecond".into(),
                outcome: "success",
            }
        );
    }

    #[test]
    fn a_plan_entry_with_no_status_is_pending() {
        let effect = effect_of(update(
            r#"{"sessionUpdate":"plan","entries":[
                {"content":"read the code","priority":"high","status":"completed"},
                {"content":"write the fix"}]}"#,
        ));
        assert_eq!(
            effect,
            Effect::Plan(vec![
                PlanItem {
                    content: "read the code".into(),
                    status: "completed".into()
                },
                PlanItem {
                    content: "write the fix".into(),
                    status: "pending".into()
                },
            ])
        );
    }

    #[test]
    fn usage_is_carried_without_its_cost() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"usage_update","used":1200,"size":200000,
                    "cost":{"amount":0.03,"currency":"USD"}}"#
            )),
            Effect::Usage {
                used: 1200,
                size: 200000
            }
        );
    }

    /// The reason the parse is lax, stated as behaviour: a variant this build
    /// has never heard of costs nothing.
    #[test]
    fn an_unknown_variant_is_ignored_rather_than_fatal() {
        assert_eq!(
            effect_of(update(
                r#"{"sessionUpdate":"current_mode_update","currentModeId":"plan"}"#
            )),
            Effect::Ignored
        );
    }
}
