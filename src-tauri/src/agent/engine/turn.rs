//! One turn: ask the model, run what it asked for, ask again.
//!
//! This is the loop both runners had a copy of. Everything the two genuinely
//! disagreed about is a port or a policy now; everything else was the same code
//! typed twice, which is how the approval rule ended up fixed on one side only.
//!
//! What it is not responsible for, and must not become responsible for:
//!
//! - **The lease.** Acquiring and returning the conversation is the caller's,
//!   and both callers cover about thirty exits with a guard whose drop order was
//!   argued line by line. A loop that took the lease would have to reproduce that
//!   argument, badly.
//! - **The turn record.** `begin` and `finish` bracket the guard, not the loop.
//!   Opening the record before the guard exists leaves a window where a dropped
//!   task releases the conversation silently, and only the caller knows whether
//!   the end was `Done`, `Cancelled` or a loop it had to stop.
//! - **The terminal event.** A `TurnEnd::Continue` round is the same turn going
//!   round again; announcing a stop between rounds would invite a desktop
//!   message the coordinator then refuses.
//! - **The first user row.** Written before any of this, and the two runners
//!   write different numbers of them. It is setup, not loop.
//!
//! So the loop reports and the caller decides: [`TurnOutcome`] carries the reply
//! *and* what got done, including when the reply is an error, because a turn
//! that died halfway still owes the front end an event naming the row it was
//! writing.

use std::collections::HashSet;

use tokio_util::sync::CancellationToken;

use crate::agent::modes::ModeSpec;
use crate::agent::{
    is_context_window_error, is_retryable_stream_error, MAX_STREAM_RETRIES, STREAM_RETRY_BASE,
};
use crate::agent::{serialize_tool_calls_openai, TokenBudget};
use crate::db::models::turn::TurnPhase;
use crate::db::DbPool;
use crate::mcp::McpRegistry;
use crate::provider::{ChatMessage, ChatParams, ChatProvider, ToolDefinition};
use crate::tools::{self, ToolContext, ToolRegistry};

use super::compaction::{Compacting, CompactionPolicy};
use super::ports::TurnPorts;
use super::{
    append_steering, append_tool_result, begin_assistant, complete_assistant, consume_stream,
    in_phase, transitions, ApprovalDecision,
};

/// The long-lived things a turn borrows. No `AppHandle`, and no state locator:
/// each of these is already an explicit parameter on the OneBot side, and making
/// them explicit on the desktop side is most of what stops the loop from needing
/// a window.
pub(crate) struct TurnServices<'a> {
    pub pool: &'a DbPool,
    pub tools: &'a ToolRegistry,
    pub mcp: &'a McpRegistry,
}

/// How a registry tool's declared permission becomes a question.
///
/// Two rules because the two runners have two. `ByReach` also consults where the
/// call would land — `read_file` inside the project and `read_file` pointed at
/// `~/.ssh` are the same tool — and lets a standing yes answer ordinary project
/// edits. `ByPermission` does neither, so it asks more often and cannot be told
/// to stop. Converging them is on the drift list; it is a change to when a
/// person is interrupted, which is not something to do in passing.
pub(crate) enum ApprovalRule {
    ByReach { accept_edits: bool },
    ByPermission,
}

/// What the model is told when it names a tool this turn did not offer.
///
/// `Explained` says the tool is unavailable *and* not to route around it,
/// because a model told a writing tool does not exist will reach for one that
/// does — `run_command` writes files perfectly well — and defeat the very
/// pruning the mode exists to do. `Terse` is the other runner's wording, kept
/// only because this refactor does not change what a model reads.
pub(crate) enum WithheldWording {
    Explained,
    Terse,
}

impl WithheldWording {
    fn say(&self, tool: &str) -> String {
        match self {
            WithheldWording::Explained => format!(
                "The tool '{tool}' is not available in this conversation right now. Do not try \
                 to achieve the same effect through another tool."
            ),
            WithheldWording::Terse => format!("Unknown tool: {tool}"),
        }
    }
}

/// Everything decided before the first request goes out.
pub(crate) struct TurnSetup<'a> {
    pub provider: &'a dyn ChatProvider,
    pub params: ChatParams,
    pub chat_messages: Vec<ChatMessage>,
    pub tool_defs: Vec<ToolDefinition>,
    /// The only thing that authorises a call. Checked instead of the assistant's
    /// configuration, because a tool a mode removed is still in the registry.
    pub offered: HashSet<String>,
    pub mode: &'static ModeSpec,
    pub tool_context: ToolContext,
    pub budget: TokenBudget,
    pub turn_id: String,
    pub conversation_id: String,
    /// Where the next row hangs. A cursor rather than one precomputed parent:
    /// the turn writes as it goes, and steering can add rows mid-flight.
    pub parent_cursor: Option<String>,
    pub cancel: CancellationToken,
    pub keep_recent: usize,
    pub context_limit: usize,
    pub approval_rule: ApprovalRule,
    pub withheld: WithheldWording,
    /// Where a steered message's `file://` parts resolve against.
    pub files_root: Option<std::path::PathBuf>,
    /// How earlier turns ended, for any that did not end cleanly. Retired by the
    /// first reply read all the way to the end — not by getting a request away,
    /// and not by reading the record.
    pub interrupted: Option<crate::agent::interrupted::Report>,
    pub compaction: CompactionPolicy,
}

/// What a turn left behind, whatever became of it.
#[derive(Default)]
pub struct TurnProgress {
    /// The assistant row being written, once there was one. `None` means it
    /// failed before creating one — the stop still has to go out, it just has no
    /// message to hang off.
    pub message_id: Option<String>,
    pub input_tokens: i32,
    pub output_tokens: i32,
    /// The loop guard cut it short.
    pub aborted: bool,
}

/// A turn's reply, plus what the caller needs to close it out.
pub struct TurnOutcome {
    pub reply: Result<String, String>,
    pub progress: TurnProgress,
}

impl TurnOutcome {
    /// What to tell the front end this turn ended as.
    pub fn stop_reason(&self) -> &'static str {
        if self.reply.is_err() {
            "error"
        } else if self.progress.aborted {
            "loop_detected"
        } else {
            "end_turn"
        }
    }
}

/// Run one turn to its end.
///
/// Never propagates with `?`. The body does, and this wraps it, because the
/// progress a failed turn made is exactly what the caller needs to report it —
/// and a caller that had to write `let outcome = run_turn(..).await?` would
/// throw that away at the only moment it matters.
pub(crate) async fn run_turn(
    services: &TurnServices<'_>,
    setup: TurnSetup<'_>,
    ports: TurnPorts<'_>,
) -> TurnOutcome {
    let mut progress = TurnProgress::default();
    let reply = run(services, setup, ports, &mut progress).await;
    TurnOutcome { reply, progress }
}

async fn run(
    services: &TurnServices<'_>,
    setup: TurnSetup<'_>,
    ports: TurnPorts<'_>,
    progress: &mut TurnProgress,
) -> Result<String, String> {
    let TurnSetup {
        provider,
        params,
        mut chat_messages,
        mut tool_defs,
        mut offered,
        mut mode,
        tool_context,
        mut budget,
        turn_id,
        conversation_id,
        mut parent_cursor,
        cancel,
        keep_recent,
        context_limit,
        approval_rule,
        withheld,
        files_root,
        mut interrupted,
        compaction,
    } = setup;
    let pool = services.pool;
    let emit = ports.emit;

    // Two ways to send, and the difference is the whole reason `Emit` returns a
    // `Result`. A window that missed a chunk is showing a transcript that never
    // catches up, so the desktop's adapter reports the failure and the turn ends
    // on it; OneBot's answer travels by another road entirely and its adapter
    // never fails. `reset` is best-effort on both sides and always was.
    let announce = |payload: serde_json::Value| -> Result<(), String> {
        match emit {
            Some(e) => e.emit("chat-stream", payload),
            None => Ok(()),
        }
    };
    let whisper = |channel: &str, payload: serde_json::Value| {
        if let Some(e) = emit {
            let _ = e.emit(channel, payload);
        }
    };

    let mut last_assistant_text = String::new();
    let mut loop_guard = crate::agent::ToolLoopGuard::default();
    let mut turn_aborted = false;

    loop {
        if cancel.is_cancelled() {
            break;
        }

        let assistant_msg_id =
            begin_assistant(pool, &conversation_id, &turn_id, &params.model, parent_cursor.as_deref())
                .await?;
        parent_cursor = Some(assistant_msg_id.clone());
        // Recorded before the event, and whether or not anyone is watching: the
        // caller closes the turn out with it even when nothing was attached.
        progress.message_id = Some(assistant_msg_id.clone());
        announce(serde_json::json!({
            "type": "message_start", "message_id": &assistant_msg_id,
            "turn_id": &turn_id, "conversation_id": &conversation_id,
        }))?;

        let result = {
            let mut attempt = 0u32;
            let mut retry_delay: Option<std::time::Duration> = None;
            loop {
                if attempt > 0 {
                    let delay = retry_delay
                        .take()
                        .unwrap_or_else(|| crate::client::backoff(STREAM_RETRY_BASE, attempt as u64));
                    // Before the wait, not after. The backoff is the part anyone
                    // watching actually sits through, and a turn that says
                    // nothing for it is indistinguishable from one that has hung.
                    //
                    // How many and how long, but not what went wrong: a
                    // provider's error body can echo the request back, and this
                    // goes to a window.
                    whisper(
                        "chat-stream",
                        serde_json::json!({
                            "type": "retry",
                            "attempt": attempt,
                            "max_attempts": MAX_STREAM_RETRIES,
                            "delay_ms": delay.as_millis() as u64,
                            "message_id": &assistant_msg_id,
                            "conversation_id": &conversation_id,
                        }),
                    );
                    tokio::time::sleep(delay).await;
                    // A retry replays the whole stream under the same message
                    // id; tell any window to drop what it already appended.
                    whisper(
                        "chat-stream",
                        serde_json::json!({
                            "type": "reset", "message_id": &assistant_msg_id,
                            "conversation_id": &conversation_id,
                        }),
                    );
                }
                let opened = provider
                    .stream_chat_with_tools(chat_messages.clone(), tool_defs.clone(), params.clone())
                    .await;
                let read = match opened {
                    Ok(stream) => {
                        consume_stream(stream, &cancel, emit, &assistant_msg_id, &conversation_id).await
                    }
                    Err(e) => Err(e.to_string()),
                };
                match read {
                    Ok(r) => {
                        // A reply the model finished producing is the only proof
                        // it received what the request carried, and `Ok` alone
                        // does not say that: a provider will answer 200 and then
                        // refuse over SSE, and `Ok` also covers a stream the user
                        // cancelled two hundred milliseconds in. Either would
                        // retire the warning that a tool may be half-run in
                        // favour of a request nothing read. Repeating it costs a
                        // paragraph; losing it costs the safety of whatever the
                        // model does next.
                        //
                        // Taken rather than read, so it is settled once — the
                        // block itself is already baked into `chat_messages` and
                        // rides along with every later iteration.
                        if r.ran_to_completion {
                            if let Some(report) = interrupted.take() {
                                crate::agent::interrupted::confirm_delivered(pool, report).await;
                            }
                        }
                        break r;
                    }
                    Err(e) if is_context_window_error(&e) => {
                        compaction
                            .on_overflow(Compacting {
                                messages: &mut chat_messages,
                                budget: &mut budget,
                                provider,
                                params: &params,
                                keep_recent,
                                context_limit,
                                emit,
                                conversation_id: &conversation_id,
                            })
                            .await;
                        whisper(
                            "chat-stream",
                            serde_json::json!({
                                "type": "reset", "message_id": &assistant_msg_id,
                                "conversation_id": &conversation_id,
                            }),
                        );
                        let stream = provider
                            .stream_chat_with_tools(
                                chat_messages.clone(),
                                tool_defs.clone(),
                                params.clone(),
                            )
                            .await
                            .map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        let recovered =
                            consume_stream(stream, &cancel, emit, &assistant_msg_id, &conversation_id)
                                .await
                                .map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        // The same rule, and reachable without the request above
                        // ever having succeeded: a provider that refuses an
                        // oversized request outright makes this the first stream
                        // anyone reads to the end.
                        if recovered.ran_to_completion {
                            if let Some(report) = interrupted.take() {
                                crate::agent::interrupted::confirm_delivered(pool, report).await;
                            }
                        }
                        break recovered;
                    }
                    Err(e) if is_retryable_stream_error(&e) && attempt < MAX_STREAM_RETRIES => {
                        tracing::warn!(error = %e, attempt, "request failed, retrying");
                        retry_delay = crate::agent::parse_retry_after(&e);
                        attempt += 1;
                        continue;
                    }
                    // Logged once by the caller, together with every other way a
                    // turn can end early.
                    Err(e) => return Err(e),
                }
            }
        };

        if let Some(ref u) = result.usage {
            progress.input_tokens += u.prompt_tokens.unwrap_or(0);
            progress.output_tokens += u.completion_tokens.unwrap_or(0);
            budget.calibrate_from_usage(u);
        }

        // A reply cut off at the length limit may hold half a call. Treating it
        // as a request would send arguments the model never finished writing.
        let has_tool_calls = !result.tool_calls.is_empty()
            && !matches!(result.finish_reason.as_deref(), Some("length") | Some("max_tokens"));

        let tool_calls_json =
            has_tool_calls.then(|| serialize_tool_calls_openai(&result.tool_calls));
        complete_assistant(
            pool,
            &assistant_msg_id,
            &result.text,
            (!result.reasoning.is_empty()).then_some(result.reasoning.as_str()),
            tool_calls_json.as_deref(),
            result.usage.as_ref().and_then(|u| u.prompt_tokens),
            result.usage.as_ref().and_then(|u| u.completion_tokens),
        )
        .await?;

        last_assistant_text = result.text.clone();

        if !has_tool_calls {
            break;
        }

        // Only the final iteration's text is returned to the caller, so on a
        // runner that does not stream, everything said on the way to a tool call
        // would otherwise exist solely in the database.
        if !result.text.is_empty() {
            if let Some(interim) = ports.interim {
                interim.say(result.text.clone()).await;
            }
        }

        let mut assistant_msg = ChatMessage::assistant_with_tools(
            &result.text,
            (!result.reasoning.is_empty()).then(|| result.reasoning.clone()),
            result.tool_calls.clone(),
        );
        if !result.signature.is_empty() {
            assistant_msg.signature = Some(result.signature.clone());
        }
        chat_messages.push(assistant_msg);

        for tc in &result.tool_calls {
            if cancel.is_cancelled() {
                break;
            }

            announce(serde_json::json!({
                "type": "tool_call",
                "call_id": tc.id,
                "tool_name": tc.name,
                "arguments": tc.arguments,
                "message_id": &assistant_msg_id,
                "conversation_id": &conversation_id,
            }))?;

            let allowed = offered.contains(&tc.name);
            let is_mcp = tc.name.starts_with("mcp__");
            let surface = ports.surface_tools.filter(|s| s.owns(&tc.name));
            let tool = if allowed && !is_mcp && surface.is_none() {
                services.tools.get(&tc.name)
            } else {
                None
            };
            // Ahead of any approval, so a stuck model cannot spend a person's
            // attention on the same dialog forty times.
            let verdict = loop_guard.observe(&tc.name, &tc.arguments);

            let (output, outcome): (String, &'static str) =
                if let crate::agent::LoopVerdict::Warn(n) = verdict {
                    (crate::agent::loop_warning_message(&tc.name, n), "error")
                } else if let crate::agent::LoopVerdict::Abort(n) = verdict {
                    turn_aborted = true;
                    (crate::agent::loop_abort_message(&tc.name, n), "error")
                } else if !allowed {
                    (withheld.say(&tc.name), "error")
                } else if let Some(surface) = surface {
                    // Read-only query tools are scope-locked and go straight
                    // through; the ones that change a group ask first.
                    let approved = !surface.requires_approval(&tc.name)
                        || matches!(
                            ports.approvals.ask(&assistant_msg_id, tc, None).await?,
                            Some(ApprovalDecision::Approved)
                        );
                    if approved {
                        let ran = in_phase(
                            pool,
                            &turn_id,
                            TurnPhase::RunningTool,
                            Some(&tc.name),
                            surface.execute(&tc.name, &tc.arguments),
                        )
                        .await;
                        match ran {
                            Ok(o) => (o, "success"),
                            Err(e) => (format!("Error: {e}"), "error"),
                        }
                    } else {
                        ("Tool call denied by user.".to_string(), "denied")
                    }
                } else if tc.name == "ask_user" {
                    match ports.approvals.ask(&assistant_msg_id, tc, None).await? {
                        Some(ApprovalDecision::Response(text)) => (text, "success"),
                        _ => ("User did not respond.".to_string(), "denied"),
                    }
                } else if let Some(target) = ports
                    .transitions
                    .and_then(|_| crate::agent::modes::by_enter_tool(&tc.name))
                {
                    // Reachable only where there is somewhere to go. A runner
                    // with no transitions falls past this to the registry, which
                    // is where its `enter_plan` ends up today — on the drift
                    // list, not fixed here.
                    let decision = ports.approvals.ask(&assistant_msg_id, tc, None).await?;
                    transitions::enter(
                        pool,
                        ports.transitions.expect("guarded above"),
                        emit,
                        &conversation_id,
                        target,
                        decision,
                    )
                    .await?
                    .apply(&mut mode, &mut chat_messages, &mut tool_defs, &mut offered)
                } else if ports.transitions.is_some() && mode.exit_tool == Some(tc.name.as_str()) {
                    let asked = ports.approvals.ask(&assistant_msg_id, tc, None);
                    transitions::exit(
                        pool,
                        ports.transitions.expect("guarded above"),
                        emit,
                        &conversation_id,
                        mode,
                        &tc.arguments,
                        asked,
                    )
                    .await?
                    .apply(&mut mode, &mut chat_messages, &mut tool_defs, &mut offered)
                } else if is_mcp {
                    // External tools ask, always. They are the one class the
                    // authorizer knows nothing about.
                    match ports.approvals.ask(&assistant_msg_id, tc, None).await? {
                        Some(ApprovalDecision::Approved) => {
                            let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                                .unwrap_or_else(|_| serde_json::json!({}));
                            // Awaited with nothing locked: the registry hands
                            // back a handle and the call runs outside it.
                            let called = in_phase(
                                pool,
                                &turn_id,
                                TurnPhase::RunningTool,
                                Some(&tc.name),
                                services.mcp.call_tool(&tc.name, args),
                            )
                            .await;
                            match called {
                                Ok(o) => (o, "success"),
                                Err(e) => (format!("MCP error: {e}"), "error"),
                            }
                        }
                        Some(ApprovalDecision::Denied(Some(reason))) => {
                            (format!("Tool call denied by user. Reason: {reason}"), "denied")
                        }
                        _ => ("Tool call denied by user.".to_string(), "denied"),
                    }
                } else if let Some(tool) = tool {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    let permission = tool.default_permission();
                    let must_ask = match &approval_rule {
                        // `reach` is advisory: it decides whether to prompt, not
                        // what the tool may touch. `tools::verified` enforces
                        // that against the handle when the I/O happens.
                        ApprovalRule::ByReach { accept_edits } => tools::reach::needs_approval(
                            permission,
                            tool.reach(&args, &tool_context),
                            *accept_edits,
                        ),
                        ApprovalRule::ByPermission => permission == tools::Permission::Ask,
                    };
                    let (approved, deny_reason): (bool, Option<String>) =
                        if permission == tools::Permission::Never {
                            (false, None)
                        } else if !must_ask {
                            (true, None)
                        } else {
                            match ports.approvals.ask(&assistant_msg_id, tc, None).await? {
                                Some(ApprovalDecision::Approved) => (true, None),
                                Some(ApprovalDecision::Denied(reason)) => (false, reason),
                                // Typed words are an answer to a question, and
                                // only `ask_user` asked one. Reaching here with
                                // some means the card was answered by something
                                // that had no permission to grant, so it is not
                                // one. Nothing said at all reads the same way.
                                Some(ApprovalDecision::Response(_)) | None => (false, None),
                            }
                        };
                    if !approved {
                        match deny_reason {
                            Some(reason) => {
                                (format!("Tool call denied by user. Reason: {reason}"), "denied")
                            }
                            None => ("Tool call denied by user.".to_string(), "denied"),
                        }
                    } else {
                        // The one phase that describes something outside the
                        // database. A turn found dead here may already have
                        // written the file or run the command.
                        let executed = in_phase(
                            pool,
                            &turn_id,
                            TurnPhase::RunningTool,
                            Some(&tc.name),
                            tool.execute(args.clone(), &tool_context),
                        )
                        .await;
                        match executed {
                            Ok(o) => (o, "success"),
                            Err(e) => match tools::decode_sandbox_denied(&e) {
                                None => (format!("Error: {e}"), "error"),
                                Some(blocked) => {
                                    // The same call under the same id: it is the
                                    // approval that is new, and that has an
                                    // identity of its own.
                                    let retry = ports
                                        .approvals
                                        .ask(&assistant_msg_id, tc, Some(blocked))
                                        .await?;
                                    if matches!(retry, Some(ApprovalDecision::Approved)) {
                                        let escalated = tool_context.without_sandbox();
                                        let retried = in_phase(
                                            pool,
                                            &turn_id,
                                            TurnPhase::RunningTool,
                                            Some(&tc.name),
                                            tool.execute(args, &escalated),
                                        )
                                        .await;
                                        match retried {
                                            Ok(o) => (o, "success"),
                                            Err(e2) => (format!("Error: {e2}"), "error"),
                                        }
                                    } else {
                                        (
                                            format!("{blocked}\n[blocked by sandbox; user declined to retry without sandbox]"),
                                            "denied",
                                        )
                                    }
                                }
                            },
                        }
                    }
                } else {
                    (format!("Unknown tool: {}", tc.name), "error")
                };

            let output = crate::agent::formatted_truncate_text(
                &output,
                crate::agent::TOOL_OUTPUT_TRUNCATION,
            );

            announce(serde_json::json!({
                "type": "tool_result",
                "call_id": tc.id,
                "result": &output,
                "outcome": outcome,
                "message_id": &assistant_msg_id,
                "conversation_id": &conversation_id,
            }))?;

            // `None` leaves the cursor where it is: the tool already ran, so the
            // row is worth less than the turn, and the next write hangs off the
            // last one that did land.
            if let Some(id) = append_tool_result(
                pool,
                &conversation_id,
                &turn_id,
                &tc.id,
                &output,
                outcome,
                parent_cursor.as_deref(),
            )
            .await
            {
                parent_cursor = Some(id);
            }

            chat_messages.push(ChatMessage::tool_result(&tc.id, &output));

            if turn_aborted {
                break;
            }
        }

        if cancel.is_cancelled() || turn_aborted {
            break;
        }

        // Between rounds, never inside one: a request must not be assembled from
        // a history something else is appending to. Injecting only appends, so
        // the prompt prefix the cache is keyed on stays exactly where it was.
        if let Some(steering) = ports.steering {
            let items = steering.drain();
            let injected_any = !items.is_empty();
            for item in items {
                if let Some(id) = append_steering(
                    pool,
                    &conversation_id,
                    &turn_id,
                    &item.text,
                    item.speaker.as_ref().map(|s| s.user_id),
                    parent_cursor.as_deref(),
                )
                .await
                {
                    parent_cursor = Some(id);
                }
                // The turn's first resolve pass ran before this existed, so any
                // image parts inside it need their own.
                let mut injected = vec![match item.speaker {
                    Some(s) => ChatMessage::user_from(&item.text, s),
                    None => ChatMessage::system_context(&item.text),
                }];
                crate::agent::resolve_file_uris_in_messages(&mut injected, files_root.as_deref());
                chat_messages.extend(injected);
            }
            if injected_any {
                whisper(
                    "conversation-updated",
                    serde_json::json!({ "id": &conversation_id }),
                );
            }
        }

        compaction
            .between_rounds(Compacting {
                messages: &mut chat_messages,
                budget: &mut budget,
                provider,
                params: &params,
                keep_recent,
                context_limit,
                emit,
                conversation_id: &conversation_id,
            })
            .await;
    }

    progress.aborted = turn_aborted;
    Ok(last_assistant_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::ports::{Approvals, Steered, Steering, SurfaceTools};
    use super::super::Emit;
    use crate::agent::turn_config::TurnConfig;
    use crate::db::test_db;
    use crate::provider::{ProviderError, SenderRef, StreamEvent, TokenUsage, ToolCall};
    use crate::turn::TurnOrigin;
    use diesel::connection::SimpleConnection;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    // --- the model -------------------------------------------------------

    /// One request's worth of stream.
    fn says(text: &str) -> Vec<StreamEvent> {
        vec![
            StreamEvent::Text { content: text.to_string() },
            StreamEvent::Stop { reason: "stop".into(), usage: None },
        ]
    }

    fn calls(id: &str, name: &str, arguments: &str) -> Vec<StreamEvent> {
        vec![
            StreamEvent::ToolCallStart { index: 0, id: id.into(), name: name.into() },
            StreamEvent::ToolCallDone { index: 0, arguments: arguments.into() },
            StreamEvent::Stop { reason: "tool_calls".into(), usage: None },
        ]
    }

    /// Answers from a script, one entry per request, and keeps every request it
    /// was given. What the loop *sent* is half of what these tests are about:
    /// "the new tools take effect immediately" and "steering does not disturb
    /// the prefix" are both claims about request N+1.
    #[derive(Default)]
    struct Scripted {
        script: Mutex<VecDeque<Vec<StreamEvent>>>,
        sent: Mutex<Vec<(Vec<ChatMessage>, Vec<String>)>>,
        /// Never let a round run out, so cancelling it means something.
        ///
        /// `consume_stream` reads its cancellation token and its stream in one
        /// `select!`, which picks at random among *ready* branches. A finite
        /// stream is always ready, so a cancelled read can still poll its way to
        /// the end — and the end is what sets `ran_to_completion`. A test that
        /// cancels against one is testing a coin toss.
        stalls: bool,
    }

    impl Scripted {
        fn of(rounds: Vec<Vec<StreamEvent>>) -> Self {
            Self { script: Mutex::new(rounds.into()), sent: Mutex::new(Vec::new()), stalls: false }
        }
        /// Says its piece and then nothing, the way a provider that has stopped
        /// sending does. The only way to leave cancellation as the sole branch
        /// that can fire.
        fn stalling(rounds: Vec<Vec<StreamEvent>>) -> Self {
            Self { stalls: true, ..Self::of(rounds) }
        }
        fn requests(&self) -> Vec<(Vec<ChatMessage>, Vec<String>)> {
            self.sent.lock().unwrap().clone()
        }
        fn rounds(&self) -> usize {
            self.sent.lock().unwrap().len()
        }
    }

    #[async_trait::async_trait]
    impl ChatProvider for Scripted {
        async fn stream_chat_with_tools(
            &self,
            messages: Vec<ChatMessage>,
            tools: Vec<ToolDefinition>,
            _params: ChatParams,
        ) -> Result<crate::provider::ChatStream, ProviderError> {
            self.sent
                .lock()
                .unwrap()
                .push((messages, tools.into_iter().map(|t| t.name).collect()));
            match self.script.lock().unwrap().pop_front() {
                Some(events) => {
                    let said = futures::stream::iter(events.into_iter().map(Ok));
                    Ok(if self.stalls {
                        Box::pin(futures::StreamExt::chain(said, futures::stream::pending()))
                    } else {
                        Box::pin(said)
                    })
                }
                // A loop that asked one more time than the test scripted has
                // gone somewhere the test does not describe. Say so rather than
                // hanging or quietly answering nothing.
                None => Err(ProviderError::Parse("the script ran out".into())),
            }
        }

        async fn chat(
            &self,
            _messages: Vec<ChatMessage>,
            _params: ChatParams,
        ) -> Result<String, ProviderError> {
            Err(ProviderError::NotImplemented("not used by the loop".into()))
        }

        async fn chat_with_tools(
            &self,
            _messages: Vec<ChatMessage>,
            _tools: Vec<ToolDefinition>,
            _params: ChatParams,
        ) -> Result<crate::provider::AgentResponse, ProviderError> {
            Err(ProviderError::NotImplemented("not used by the loop".into()))
        }
    }

    // --- the ports -------------------------------------------------------

    #[derive(Default)]
    struct Recorder(Mutex<Vec<(String, serde_json::Value)>>);

    impl Recorder {
        fn kinds(&self) -> Vec<String> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .map(|(channel, p)| match p.get("type").and_then(|t| t.as_str()) {
                    Some(t) => t.to_string(),
                    None => channel.clone(),
                })
                .collect()
        }
    }

    impl Emit for Recorder {
        fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
            self.0.lock().unwrap().push((channel.to_string(), payload));
            Ok(())
        }
    }

    /// The desktop's reading: a send that fails takes the turn with it. Narrowed
    /// to one event type so a test can say *which* send it means.
    struct Broken(&'static str);
    impl Emit for Broken {
        fn emit(&self, _channel: &str, payload: serde_json::Value) -> Result<(), String> {
            if payload["type"] == self.0 {
                return Err("the window is gone".into());
            }
            Ok(())
        }
    }

    /// OneBot's reading: the events are a courtesy, and losing one is nothing.
    struct Deaf;
    impl Emit for Deaf {
        fn emit(&self, _channel: &str, _payload: serde_json::Value) -> Result<(), String> {
            Ok(())
        }
    }

    struct Answers {
        answer: Option<ApprovalDecision>,
        asked: Mutex<Vec<(String, Option<String>)>>,
    }

    impl Answers {
        fn saying(answer: Option<ApprovalDecision>) -> Self {
            Self { answer, asked: Mutex::new(Vec::new()) }
        }
        fn nobody() -> Self {
            Self::saying(None)
        }
    }

    #[async_trait::async_trait]
    impl Approvals for Answers {
        async fn ask(
            &self,
            _assistant_message_id: &str,
            call: &ToolCall,
            retry_reason: Option<&str>,
        ) -> Result<Option<ApprovalDecision>, String> {
            self.asked
                .lock()
                .unwrap()
                .push((call.name.clone(), retry_reason.map(str::to_string)));
            Ok(self.answer.clone())
        }
    }

    /// A tool the test owns outright: no registry, no filesystem, and a hook to
    /// make something happen at exactly the moment it runs.
    struct Fixture {
        output: String,
        needs_approval: bool,
        on_call: Option<Box<dyn Fn() + Send + Sync>>,
        ran: Mutex<Vec<String>>,
    }

    impl Fixture {
        fn returning(output: &str) -> Self {
            Self {
                output: output.to_string(),
                needs_approval: false,
                on_call: None,
                ran: Mutex::new(Vec::new()),
            }
        }
        fn asking_first(mut self) -> Self {
            self.needs_approval = true;
            self
        }
        fn doing(mut self, f: impl Fn() + Send + Sync + 'static) -> Self {
            self.on_call = Some(Box::new(f));
            self
        }
    }

    #[async_trait::async_trait]
    impl SurfaceTools for Fixture {
        fn owns(&self, name: &str) -> bool {
            name == "fixture"
        }
        fn requires_approval(&self, _name: &str) -> bool {
            self.needs_approval
        }
        async fn execute(&self, _name: &str, arguments: &str) -> Result<String, String> {
            self.ran.lock().unwrap().push(arguments.to_string());
            if let Some(f) = &self.on_call {
                f();
            }
            Ok(self.output.clone())
        }
    }

    /// Hands over its queue once and is empty afterwards, the way a real inbox
    /// behaves across rounds.
    struct Inbox(Mutex<Vec<Steered>>);

    impl Steering for Inbox {
        fn drain(&self) -> Vec<Steered> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    struct Rebuilt(TurnConfig);

    #[async_trait::async_trait]
    impl transitions::Transitions for Rebuilt {
        async fn rebuild(
            &self,
            _mode: &'static ModeSpec,
        ) -> Result<Result<TurnConfig, String>, String> {
            Ok(Ok(TurnConfig {
                tool_defs: self.0.tool_defs.clone(),
                system_prompt: self.0.system_prompt.clone(),
                offered: self.0.offered.clone(),
            }))
        }
    }

    // --- the fixtures ----------------------------------------------------

    fn conversation(pool: &DbPool) {
        let mut conn = pool.get().unwrap();
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1)
            .unwrap();
        crate::db::ops::turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
    }

    fn rows(pool: &DbPool) -> Vec<crate::db::models::message::Message> {
        let mut conn = pool.get().unwrap();
        crate::db::ops::message::list_messages(&mut conn, "c1").unwrap()
    }

    fn def(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: String::new(),
            parameters: serde_json::json!({}),
        }
    }

    fn system(content: &str) -> ChatMessage {
        let mut m = ChatMessage::user(content);
        m.role = "system".into();
        m
    }

    fn registry() -> ToolRegistry {
        ToolRegistry::new(
            std::path::PathBuf::from("/nonexistent"),
            std::path::PathBuf::from("/nonexistent"),
        )
    }

    fn context(pool: &DbPool, cancel: &CancellationToken) -> ToolContext {
        ToolContext {
            working_directory: None,
            shell: tools::ShellType::default_for_platform(),
            file_access: tools::FileAccess::default(),
            project_id: None,
            conversation_id: Some("c1".into()),
            assistant_id: None,
            db_pool: Some(pool.clone()),
            edit_session: None,
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: Default::default(),
            cancel: cancel.clone(),
        }
    }

    fn setup<'a>(
        provider: &'a Scripted,
        pool: &DbPool,
        cancel: &CancellationToken,
        offered: &[&str],
    ) -> TurnSetup<'a> {
        TurnSetup {
            provider,
            params: ChatParams { model: "m".into(), ..Default::default() },
            chat_messages: vec![system("you are helpful"), ChatMessage::user("do the thing")],
            tool_defs: offered.iter().map(|n| def(n)).collect(),
            offered: offered.iter().map(|n| n.to_string()).collect(),
            mode: crate::agent::modes::resolve(None),
            tool_context: context(pool, cancel),
            budget: TokenBudget::new("openai", "m", 128_000, 4096, None),
            turn_id: "t1".into(),
            conversation_id: "c1".into(),
            parent_cursor: None,
            cancel: cancel.clone(),
            keep_recent: 10,
            context_limit: 128_000,
            approval_rule: ApprovalRule::ByReach { accept_edits: false },
            withheld: WithheldWording::Explained,
            files_root: None,
            interrupted: None,
            compaction: CompactionPolicy::OneBot,
        }
    }

    fn ports<'a>(approvals: &'a Answers, emit: Option<&'a dyn Emit>) -> TurnPorts<'a> {
        TurnPorts {
            emit,
            approvals,
            interim: None,
            surface_tools: None,
            steering: None,
            transitions: None,
        }
    }

    fn services<'a>(
        pool: &'a DbPool,
        tools: &'a ToolRegistry,
        mcp: &'a McpRegistry,
    ) -> TurnServices<'a> {
        TurnServices { pool, tools, mcp }
    }

    // --- the contract ----------------------------------------------------

    #[tokio::test]
    async fn a_turn_with_nothing_to_run_asks_once_and_answers() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![says("here you go")]);
        let approvals = Answers::nobody();
        let emit = Recorder::default();

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &[]),
            ports(&approvals, Some(&emit)),
        )
        .await;

        assert_eq!(outcome.reply.as_deref(), Ok("here you go"));
        assert_eq!(outcome.stop_reason(), "end_turn");
        assert!(!outcome.progress.aborted);
        assert_eq!(provider.rounds(), 1);
        assert_eq!(emit.kinds(), ["message_start", "text"]);

        let rows = rows(&pool);
        assert_eq!(rows.len(), 1, "one assistant row and nothing else");
        assert_eq!(rows[0].content, "here you go");
        assert_eq!(outcome.progress.message_id.as_deref(), Some(rows[0].id.as_str()));
    }

    /// The tool result has to reach the *next* request, or the model answers
    /// without ever seeing what it asked for.
    #[tokio::test]
    async fn a_tool_call_runs_and_its_answer_goes_into_the_next_request() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", r#"{"x":1}"#),
            says("that worked"),
        ]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("42");
        let emit = Recorder::default();

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, Some(&emit)) },
        )
        .await;

        assert_eq!(outcome.reply.as_deref(), Ok("that worked"));
        assert_eq!(*fixture.ran.lock().unwrap(), [r#"{"x":1}"#]);
        assert!(approvals.asked.lock().unwrap().is_empty(), "a read-only tool does not ask");
        assert_eq!(provider.rounds(), 2);

        let second = &provider.requests()[1].0;
        assert_eq!(second.last().unwrap().content, "42");
        assert_eq!(second.last().unwrap().role, "tool");

        let rows = rows(&pool);
        assert_eq!(
            rows.iter().map(|r| r.role.as_str()).collect::<Vec<_>>(),
            ["assistant", "tool", "assistant"],
        );
        assert_eq!(rows[1].parent_id.as_deref(), Some(rows[0].id.as_str()));
        assert_eq!(rows[2].parent_id.as_deref(), Some(rows[1].id.as_str()));
        assert_eq!(emit.kinds(), [
            "message_start", "tool_call", "tool_result", "message_start", "text",
        ]);
    }

    /// Cancelling is a decision, not a failure: whatever the model managed to
    /// say is still the reply, and the caller reports it as a stop rather than
    /// as an error.
    #[tokio::test]
    async fn cancelling_ends_the_turn_without_making_it_an_error() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", "{}"),
            says("never asked for"),
        ]);
        let approvals = Answers::nobody();
        let stop = cancel.clone();
        let fixture = Fixture::returning("done").doing(move || stop.cancel());

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert!(outcome.reply.is_ok(), "cancelling is not an error");
        assert_eq!(outcome.stop_reason(), "end_turn");
        assert!(!outcome.progress.aborted, "and it is not the loop guard either");
        assert_eq!(provider.rounds(), 1, "the second request is never made");
        // The tool did run and its row is written: the world had already
        // changed by the time the token was cancelled.
        assert_eq!(rows(&pool).iter().filter(|r| r.role == "tool").count(), 1);
    }

    /// The guard exists so a stuck model cannot spend a person's attention, or
    /// the machine's, on the same call forever. It ends the turn as a success
    /// carrying whatever was said — an error would lose that.
    #[tokio::test]
    async fn a_model_repeating_itself_is_stopped_and_the_caller_is_told_why() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let rounds: Vec<_> = (0..crate::agent::loop_guard::LOOP_ABORT_AFTER + 2)
            .map(|_| calls("call-1", "fixture", r#"{"same":true}"#))
            .collect();
        let provider = Scripted::of(rounds);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("again");

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert!(outcome.reply.is_ok());
        assert!(outcome.progress.aborted);
        assert_eq!(outcome.stop_reason(), "loop_detected");
        assert_eq!(
            provider.rounds(),
            crate::agent::loop_guard::LOOP_ABORT_AFTER as usize,
            "it stops on the call that trips the guard, not a round later",
        );
        assert!(fixture.ran.lock().unwrap().len() < crate::agent::loop_guard::LOOP_ABORT_AFTER as usize,
            "and the call it aborted on is not executed");
    }

    /// The one write the loop is allowed to lose. By the time it runs the tool
    /// has already touched the world, so the row is worth less than the turn.
    #[tokio::test]
    async fn a_tool_row_the_database_refuses_does_not_stop_the_turn_or_move_the_cursor() {
        let pool = test_db();
        conversation(&pool);
        {
            let mut conn = pool.get().unwrap();
            conn.batch_execute(
                "CREATE TRIGGER no_tool_rows BEFORE INSERT ON messages \
                 WHEN NEW.role = 'tool' \
                 BEGIN SELECT RAISE(ABORT, 'refused'); END",
            )
            .unwrap();
        }
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", "{}"),
            says("carried on"),
        ]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("the tool still ran");

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert_eq!(outcome.reply.as_deref(), Ok("carried on"));
        assert_eq!(provider.rounds(), 2);
        // The model still sees the result — only the transcript lost it.
        assert_eq!(provider.requests()[1].0.last().unwrap().content, "the tool still ran");

        let rows = rows(&pool);
        assert_eq!(rows.iter().map(|r| r.role.as_str()).collect::<Vec<_>>(), ["assistant", "assistant"]);
        assert_eq!(
            rows[1].parent_id.as_deref(),
            Some(rows[0].id.as_str()),
            "the cursor stayed on the last row that landed, so the chain is intact",
        );
    }

    /// The two runners disagree about this on purpose, and the disagreement is
    /// the reason `Emit` returns a `Result` at all.
    ///
    /// The send under test is one the loop makes itself, not one the stream
    /// reader makes: a failing `Emit` also takes the stream down, and a test that
    /// let it would be re-checking `engine::stream` and calling it this. So it
    /// fails only on `tool_call`, which nothing but the loop sends — and the
    /// assertion that the tool never ran is what makes the failure's *position*
    /// part of the contract rather than just its existence.
    #[tokio::test]
    async fn a_send_the_loop_makes_ends_one_runners_turn_and_not_the_others() {
        for (label, emit, ends) in [
            ("desktop", &Broken("tool_call") as &dyn Emit, true),
            ("onebot", &Deaf as &dyn Emit, false),
        ] {
            let pool = test_db();
            conversation(&pool);
            let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
            let provider =
                Scripted::of(vec![calls("call-1", "fixture", "{}"), says("carried on")]);
            let approvals = Answers::nobody();
            let fixture = Fixture::returning("ok");

            let outcome = run_turn(
                &services(&pool, &tools, &mcp),
                setup(&provider, &pool, &cancel, &["fixture"]),
                TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, Some(emit)) },
            )
            .await;

            assert_eq!(outcome.reply.is_err(), ends, "{label}");
            assert_eq!(
                fixture.ran.lock().unwrap().is_empty(),
                ends,
                "{label}: the card was never drawn, so the call must not have happened",
            );
            // Either way the row was opened, so the caller can name it.
            assert!(outcome.progress.message_id.is_some(), "{label}");
        }
    }

    /// A turn that failed still has to say what it was writing: the front end
    /// hangs its terminal event off that id, and without one it sits on the
    /// `streaming` flag its optimistic send set.
    #[tokio::test]
    async fn a_failed_turn_still_reports_what_it_had_got_done() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![]);
        let approvals = Answers::nobody();

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &[]),
            ports(&approvals, None),
        )
        .await;

        assert!(outcome.reply.is_err());
        assert_eq!(outcome.stop_reason(), "error");
        assert_eq!(
            outcome.progress.message_id.as_deref(),
            Some(rows(&pool)[0].id.as_str()),
            "the row it had opened",
        );
    }

    /// Approving a mode switch has to change the next request, not the one
    /// after it. A tool set that lags by a round is a turn told it may edit
    /// while it still cannot.
    #[tokio::test]
    async fn a_mode_switch_reaches_the_very_next_request() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", crate::agent::modes::ENTER_PLAN_TOOL, "{}"),
            says("planning now"),
        ]);
        let approvals = Answers::saying(Some(ApprovalDecision::Approved));
        let rebuilt = Rebuilt(TurnConfig {
            tool_defs: vec![def("read_file")],
            system_prompt: "# Plan mode\n\nyou are planning".into(),
            offered: ["read_file".to_string()].into_iter().collect(),
        });

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &[crate::agent::modes::ENTER_PLAN_TOOL, "write_file"]),
            TurnPorts { transitions: Some(&rebuilt), ..ports(&approvals, None) },
        )
        .await;

        assert_eq!(outcome.reply.as_deref(), Ok("planning now"));
        let requests = provider.requests();
        assert_eq!(requests[1].1, ["read_file"], "the new tool set, one request later");
        assert_eq!(requests[1].0[0].content, "# Plan mode\n\nyou are planning");
        assert_eq!(requests[0].0[0].content, "you are helpful", "and the old one before it");
    }

    /// Steering appends and only appends. Everything ahead of the first user
    /// message is the prefix the prompt cache is keyed on; moving it costs the
    /// cache on every following request of the turn.
    #[tokio::test]
    async fn steering_lands_at_the_end_and_leaves_the_prefix_alone() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", "{}"),
            says("noted"),
        ]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("ok");
        let inbox = Inbox(Mutex::new(vec![
            Steered {
                text: "one more thing".into(),
                speaker: Some(SenderRef { user_id: 7, nickname: None, role: None }),
            },
            Steered { text: "they left the group".into(), speaker: None },
        ]));

        run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts {
                surface_tools: Some(&fixture),
                steering: Some(&inbox),
                ..ports(&approvals, None)
            },
        )
        .await;

        let requests = provider.requests();
        assert_eq!(requests[1].0[0].role, requests[0].0[0].role, "the same prefix");
        assert_eq!(requests[1].0[0].content, requests[0].0[0].content, "byte for byte");
        assert_eq!(requests[1].0[1].content, requests[0].0[1].content);
        let tail: Vec<&str> = requests[1].0.iter().rev().take(2).map(|m| m.content.as_str()).collect();
        assert_eq!(tail, ["they left the group", "one more thing"]);
        // The one with a speaker is a person talking; the other is a notice we
        // generated, and it travels as context rather than as a user message.
        assert!(matches!(
            requests[1].0[requests[1].0.len() - 2].origin,
            crate::provider::MessageOrigin::User(_)
        ));
        assert_eq!(rows(&pool).iter().filter(|r| r.sender_id == Some(7)).count(), 1);
    }

    fn owed(pool: &DbPool, asking: &str) -> Option<crate::agent::interrupted::Report> {
        let mut conn = pool.get().unwrap();
        let idle = crate::turn::TurnCoordinator::default();
        crate::agent::interrupted::block(&mut conn, &idle, "c1", Some(asking))
    }

    fn ended(pool: &DbPool, turn: &str, status: crate::db::models::turn::TurnStatus, at: i64) {
        let mut conn = pool.get().unwrap();
        crate::db::ops::turn::finish(&mut conn, turn, status, None, at).unwrap();
    }

    /// The notice that an earlier turn may have left a tool half-run is retired
    /// by a reply that was read all the way to the end, and by nothing else.
    ///
    /// The case that matters is not a request that failed to go out — that one
    /// is obvious. It is a stream that opened, said something, and was then
    /// stopped: `consume_stream` hands that back as `Ok`, and reading `Ok` as
    /// "the model received the warning" would retire it in favour of a request
    /// nobody finished reading. What the model does next is the thing the
    /// warning was protecting.
    #[tokio::test]
    async fn a_stopped_reply_does_not_retire_the_interruption_notice() {
        let pool = test_db();
        conversation(&pool);
        {
            let mut conn = pool.get().unwrap();
            crate::db::ops::turn::begin(&mut conn, "t0", "c1", TurnOrigin::Desktop, 500).unwrap();
        }
        let report = owed(&pool, "t1")
            .expect("t0 is running and held by nobody, so it counts as cut off");
        let (tools, mcp) = (registry(), McpRegistry::new());
        let approvals = Answers::nobody();

        // Round one is stopped the moment the first chunk lands.
        let cancel = CancellationToken::new();
        let stopper = StopOnText(cancel.clone());
        let interrupted_run = Scripted::stalling(vec![vec![
            StreamEvent::Text { content: "I was about to".into() },
            StreamEvent::Text { content: "never sent".into() },
        ]]);
        let mut first = setup(&interrupted_run, &pool, &cancel, &[]);
        first.interrupted = Some(report);
        let outcome =
            run_turn(&services(&pool, &tools, &mcp), first, ports(&approvals, Some(&stopper))).await;
        assert!(outcome.reply.is_ok(), "being stopped is not a failure");

        ended(&pool, "t1", crate::db::models::turn::TurnStatus::Cancelled, 1500);
        let still_owed = owed(&pool, "t2");
        assert!(
            still_owed.is_some(),
            "the reply was never read to the end, so it consumed nothing",
        );

        // Round two reads one all the way through.
        let cancel = CancellationToken::new();
        let answering = Scripted::of(vec![says("understood")]);
        let mut second = setup(&answering, &pool, &cancel, &[]);
        second.interrupted = still_owed;
        second.turn_id = "t2".into();
        {
            let mut conn = pool.get().unwrap();
            crate::db::ops::turn::begin(&mut conn, "t2", "c1", TurnOrigin::Desktop, 2000).unwrap();
        }
        assert!(run_turn(&services(&pool, &tools, &mcp), second, ports(&approvals, None))
            .await
            .reply
            .is_ok());

        ended(&pool, "t2", crate::db::models::turn::TurnStatus::Done, 2500);
        assert!(owed(&pool, "t3").is_none(), "and that one does retire it");
    }

    /// Stops the turn from inside the stream, which is the only way to reach
    /// "read part of a reply and then stopped" without a race.
    struct StopOnText(CancellationToken);

    impl Emit for StopOnText {
        fn emit(&self, _channel: &str, payload: serde_json::Value) -> Result<(), String> {
            if payload["type"] == "text" {
                self.0.cancel();
            }
            Ok(())
        }
    }

    /// Usage is accumulated across every round, not taken from the last one.
    #[tokio::test]
    async fn the_tokens_of_every_round_are_added_up() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let used = |p: i32, c: i32| StreamEvent::Stop {
            reason: "stop".into(),
            usage: Some(TokenUsage {
                prompt_tokens: Some(p),
                completion_tokens: Some(c),
                ..Default::default()
            }),
        };
        let provider = Scripted::of(vec![
            vec![
                StreamEvent::ToolCallStart { index: 0, id: "c".into(), name: "fixture".into() },
                StreamEvent::ToolCallDone { index: 0, arguments: "{}".into() },
                used(100, 10),
            ],
            vec![StreamEvent::Text { content: "done".into() }, used(200, 20)],
        ]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("ok");

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert_eq!(outcome.progress.input_tokens, 300);
        assert_eq!(outcome.progress.output_tokens, 30);
    }

    /// A tool the turn did not offer is refused by the loop, not by the
    /// registry. The registry still has it; the mode's pruning would be
    /// decorative if naming it anyway worked.
    #[tokio::test]
    async fn a_tool_that_was_not_offered_is_refused_before_anything_runs() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", "{}"),
            says("fine then"),
        ]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("should not happen");

        let outcome = run_turn(
            &services(&pool, &tools, &mcp),
            // Deliberately not offered.
            setup(&provider, &pool, &cancel, &[]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert!(outcome.reply.is_ok());
        assert!(fixture.ran.lock().unwrap().is_empty());
        let requests = provider.requests();
        let told = &requests[1].0.last().unwrap().content;
        assert!(told.contains("not available"), "{told}");
        assert!(told.contains("another tool"), "and it is told not to route around it: {told}");
    }

    #[tokio::test]
    async fn the_other_runner_says_less_about_a_withheld_tool() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![calls("call-1", "fixture", "{}"), says("fine")]);
        let approvals = Answers::nobody();
        let mut s = setup(&provider, &pool, &cancel, &[]);
        s.withheld = WithheldWording::Terse;

        run_turn(&services(&pool, &tools, &mcp), s, ports(&approvals, None)).await;

        assert_eq!(
            provider.requests()[1].0.last().unwrap().content,
            "Unknown tool: fixture",
        );
    }

    /// Answering a question is not granting permission.
    ///
    /// `Response` and `Approved` both mean somebody did something rather than
    /// nothing, which is what makes them easy to conflate — and conflating them
    /// turns a typed sentence into permission to run a command. Only `ask_user`
    /// asked a question, so only `ask_user` may read one as an answer.
    ///
    /// Sandbox escalation obeys the same rule and is not covered here: reaching
    /// it needs a registry tool that fails with a sandbox denial, and every
    /// fixture in this module is a surface tool. It is written the same way, and
    /// the port's own documentation is what holds it.
    #[tokio::test]
    async fn typed_words_answer_a_question_and_authorise_nothing_else() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![
            calls("call-1", "fixture", "{}"),
            calls("call-2", "mcp__server__do", "{}"),
            calls("call-3", "ask_user", "{}"),
            says("fine"),
        ]);
        let approvals = Answers::saying(Some(ApprovalDecision::Response("go on then".into())));
        let fixture = Fixture::returning("ran anyway").asking_first();

        run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture", "mcp__server__do", "ask_user"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        let said = |round: usize| provider.requests()[round].0.last().unwrap().content.clone();

        assert!(fixture.ran.lock().unwrap().is_empty(), "a surface tool is not authorised");
        assert_eq!(said(1), "Tool call denied by user.");
        // Never reached the registry, so the refusal is the approval's and not
        // an "unknown MCP server" from further down.
        assert_eq!(said(2), "Tool call denied by user.", "an MCP tool is not authorised either");
        assert_eq!(said(3), "go on then", "but the question that was asked gets its answer");
    }

    /// An unanswered card is not a yes. The distinction matters most on the
    /// path where saying yes runs a command.
    #[tokio::test]
    async fn a_tool_nobody_approved_is_not_run() {
        let pool = test_db();
        conversation(&pool);
        let (tools, mcp, cancel) = (registry(), McpRegistry::new(), CancellationToken::new());
        let provider = Scripted::of(vec![calls("call-1", "fixture", "{}"), says("fine")]);
        let approvals = Answers::nobody();
        let fixture = Fixture::returning("ran anyway").asking_first();

        run_turn(
            &services(&pool, &tools, &mcp),
            setup(&provider, &pool, &cancel, &["fixture"]),
            TurnPorts { surface_tools: Some(&fixture), ..ports(&approvals, None) },
        )
        .await;

        assert_eq!(*approvals.asked.lock().unwrap(), [("fixture".to_string(), None)]);
        assert!(fixture.ran.lock().unwrap().is_empty());
        assert_eq!(
            provider.requests()[1].0.last().unwrap().content,
            "Tool call denied by user.",
        );
    }
}
