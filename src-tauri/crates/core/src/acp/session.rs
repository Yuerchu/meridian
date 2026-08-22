//! One hosted session: a conversation here, a session id there, and the turn
//! that connects them.
//!
//! The transcript is written with the same three functions a native turn uses
//! (`begin_assistant`, `complete_assistant`, `append_tool_result`), so an ACP
//! conversation is an ordinary row set that search, branching, compaction and
//! the transcript view all already understand. Nothing about it is a special
//! case below `chat-view`.
//!
//! **A turn is written round by round**, the way a native one is: the prose
//! that introduced a call stays on the row carrying that call, its result is
//! its own row, and whatever the agent says afterwards opens the next row.
//!
//! This used to be flattened onto a single assistant row, on the reasoning that
//! the shape was legal and only lost which text came before which call. It lost
//! more than that. `lib/turns.ts` takes the steps *after* the last tool call as
//! the turn's conclusion, so a flattened turn has none — its closing sentence
//! sits before the calls — and a turn with tools and no conclusion is drawn as
//! `interrupted`, with the whole answer folded away as process. Every finished
//! hosted turn that called a tool was reported as stopped.

use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use crate::agent::engine::transcript::{append_tool_result, begin_assistant, complete_assistant, write_steering};
use crate::agent::tool_calls::serialize_tool_calls_openai;
use crate::db::models::message::MessageUsage;
use crate::db::models::queue::QueuedPrompt;
use crate::db::models::turn::{TurnPhase, TurnStatus};
use crate::provider;
use crate::services::Services;
use crate::turn::TurnOrigin;
use crate::util::{get_conn, now_ms};

use super::mapping::{self, Effect};
use super::peer::{Handler, Peer, PeerError};
use super::process::AdapterProcess;
use super::protocol::{self, SessionNotification};
use super::{AcpConfig, approvals};

/// What this app calls itself when it introduces itself to the adapter.
const CLIENT_NAME: &str = "meridian";
/// Stands in until the agent says which model it is using, and means exactly
/// "it has not said". Not a model id, and nothing should treat it as one.
///
/// It usually does say: ACP carries the model as a session configuration option
/// (`category: "model"`), present in the `session/new` response and re-sent
/// whenever it changes, so a row normally records the real id. This is what a
/// row gets when the adapter is old enough, or quiet enough, not to report one.
const MODEL_LABEL: &str = "claude-code";
/// Copied onto every row beside the model label, the way a provider's name is.
const PROVIDER_LABEL: &str = "Claude Code";

/// One assistant row, while it is still being written.
///
/// A row holds the prose that came *before* its tool calls, plus those calls.
/// Everything after their results belongs to the next row — which is how a
/// native turn writes a multi-round answer, and it is not cosmetic. The
/// transcript reader takes the steps after the last tool call as the turn's
/// conclusion (`lib/turns.ts`, `splitAtConclusion`); with every round crammed
/// into one row the final sentence sits *before* the calls instead of after
/// them, so there is no conclusion, and a finished turn is drawn as
/// `interrupted` with its whole answer folded away as process.
struct OpenRow {
    message_id: String,
    text: String,
    reasoning: String,
    tool_calls: Vec<provider::ToolCall>,
    /// `(call_id, output, outcome)`, in the order the calls finished.
    results: Vec<(String, String, &'static str)>,
    /// A result has landed on this row, so the next prose opens a new one.
    settled: bool,
    /// This row is already in the database and must not be written again.
    /// Only set when opening the next round failed part way — see
    /// [`Shared::open_round_if_settled`].
    written: bool,
}

impl OpenRow {
    fn new(message_id: String) -> Self {
        Self {
            message_id,
            text: String::new(),
            reasoning: String::new(),
            tool_calls: Vec::new(),
            results: Vec::new(),
            settled: false,
            written: false,
        }
    }

    /// Nothing worth a row of its own. Checked before opening a new round so a
    /// turn cannot end on an empty bubble.
    fn is_empty(&self) -> bool {
        self.text.trim().is_empty() && self.reasoning.is_empty() && self.tool_calls.is_empty()
    }
}

/// A message the user put into a turn that was already running, which the
/// agent has taken and the transcript still owes a row.
struct Interjection {
    /// The queue item it came from, so the row can be named on it once written.
    queue_id: String,
    text: String,
}

/// The turn in flight, if there is one.
struct TurnState {
    turn_id: String,
    cancel: CancellationToken,
    /// The round being written.
    row: OpenRow,
    /// The last row landed in the database, which the next one hangs off.
    parent: String,
    /// Steered messages waiting for a round boundary to be written at.
    ///
    /// Not written when they are sent, which is the tempting thing to do and
    /// forks the transcript: the open row's children are its own tool results,
    /// and a user row landing beside them makes two branches out of one round.
    /// Written at the boundary instead, they sit exactly where they belong —
    /// after the round that was running when they were sent, before the round
    /// that answers them.
    interjected: Vec<Interjection>,
}

/// The half of a session the protocol handler needs.
///
/// Separate from [`AcpSession`] because the handler has to exist before the
/// peer does, and the session cannot exist before the peer. This is what both
/// of them hold.
struct Shared {
    services: Services,
    conversation_id: String,
    turn: Mutex<Option<TurnState>>,
    /// The agent's id for the model that is answering, once it has said.
    ///
    /// Kept on the session rather than the turn: it is a property of the
    /// session, arrives before the first turn, and can change under one.
    model: Mutex<Option<String>>,
    /// Every knob the agent exposes, as it last described them.
    ///
    /// Held whole rather than as the one value this app reads, because the
    /// composer offers them: what a `select` may be set to is the agent's to
    /// decide and changes under us — picking a model re-derives which modes
    /// exist. See [`Shared::merge_config`] for why this is merged rather than
    /// replaced.
    config: Mutex<Vec<protocol::SessionConfigOption>>,
    /// A `session/load` is in progress and the updates arriving are the agent
    /// reciting a conversation we already have rows for.
    ///
    /// It happens to be harmless without this — every branch of [`absorb`]
    /// asks `with_turn` first and no turn is running during a load, so the
    /// replay falls on the floor. But that is an accident of two unrelated
    /// rules lining up, and two of the branches (`Plan`, `ConfigOptions`) do
    /// not ask. Saying it out loud costs one atomic and makes the *other*
    /// answer expressible: adopting a session this app did not start needs the
    /// replay written down, because there it is the only transcript there is.
    ///
    /// [`absorb`]: Shared::absorb
    replaying: std::sync::atomic::AtomicBool,
    /// The agent is answering into a conversation it cannot see, and has not
    /// been told yet.
    ///
    /// Set when a session was opened for a conversation that already had a
    /// transcript and the agent's own memory of it could not be resumed. Read
    /// when a turn assembles its prompt and cleared only once that prompt has
    /// been delivered — the same rule the interrupted-turn report follows, for
    /// the same reason.
    memory_lost: Mutex<bool>,
}

impl Shared {
    fn emit(&self, payload: serde_json::Value) {
        // Failure here is a window that has gone away. A native turn treats
        // that as fatal because its events *are* its answer; this one has
        // already written the row, and the adapter is mid-turn on the other
        // side of a pipe that cannot be rewound.
        if let Err(e) = self.services.events.emit("chat-stream", payload) {
            tracing::debug!(error = %e, "an ACP update reached no window");
        }
    }

    /// Run `f` against the turn in flight. `None` when nothing is running,
    /// which is how every update that arrives between turns is dropped.
    fn with_turn<T>(&self, f: impl FnOnce(&mut TurnState) -> T) -> Option<T> {
        let mut guard = self.turn.lock().ok()?;
        guard.as_mut().map(f)
    }

    /// What to record as the model on a row written now.
    fn model(&self) -> String {
        self.model
            .lock()
            .ok()
            .and_then(|m| m.clone())
            .unwrap_or_else(|| MODEL_LABEL.to_string())
    }

    fn set_model(&self, model: String) {
        let Ok(mut slot) = self.model.lock() else { return };
        if slot.as_deref() == Some(model.as_str()) {
            return;
        }
        tracing::info!(model = %model, conversation_id = %self.conversation_id, "ACP session model");
        *slot = Some(model);
    }

    /// Take in a set of options the agent just described.
    ///
    /// **Merged, never replaced.** A `config_option_update` is allowed to carry
    /// only what changed, and an option in one is allowed to omit its `options`
    /// list — it is reporting a new `currentValue`, not redefining the knob. A
    /// wholesale replace would empty the picker the moment the user used it,
    /// which is the one moment they are looking at it.
    ///
    /// Also keeps the model in step: it is one of these options, and reading it
    /// from anywhere else would be a second source that could disagree.
    fn merge_config(&self, incoming: Vec<protocol::SessionConfigOption>) {
        if let Some(model) = incoming.iter().find_map(|o| o.as_model()) {
            self.set_model(model.to_string());
        }
        let Ok(mut held) = self.config.lock() else { return };
        merge_options(&mut held, incoming);
    }

    fn config_options(&self) -> Vec<protocol::SessionConfigOption> {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    async fn absorb(&self, notification: SessionNotification) {
        // The agent reciting what it already has. Every one of these is a row
        // this database wrote the first time round, so writing them again would
        // double the transcript — see [`Shared::replaying`].
        if self.replaying.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let effect = mapping::effect_of(notification.update);
        // Every branch below takes the lock, drops it, and only then emits.
        // Emitting under the lock would put a sink's latency inside a critical
        // section the reader is feeding.
        match effect {
            Effect::Text(chunk) => {
                // Prose arriving after a result is the next round talking, so it
                // gets a row of its own — see [`OpenRow`] for what depends on it.
                self.open_round_if_settled().await;
                let Some(message_id) = self.with_turn(|t| {
                    t.row.text.push_str(&chunk);
                    t.row.message_id.clone()
                }) else {
                    return;
                };
                self.emit(serde_json::json!({
                    "type": "text",
                    "content": chunk,
                    "message_id": message_id,
                    "conversation_id": self.conversation_id,
                }));
            }
            Effect::Reasoning(chunk) => {
                self.open_round_if_settled().await;
                let Some(message_id) = self.with_turn(|t| {
                    t.row.reasoning.push_str(&chunk);
                    t.row.message_id.clone()
                }) else {
                    return;
                };
                self.emit(serde_json::json!({
                    "type": "reasoning",
                    "content": chunk,
                    "message_id": message_id,
                    "conversation_id": self.conversation_id,
                }));
            }
            Effect::ToolCall {
                call_id,
                tool_name,
                arguments,
            } => {
                // A `toolCallId` is unique within an ACP session, so the same id
                // twice is one call being announced twice — which the adapter
                // does, from two sources that can arrive in either order, and
                // older ones did without deduplicating at all.
                //
                // The front end deliberately does *not* dedupe by call id
                // (`handleToolCall` pushes regardless: OpenAI-compatible
                // gateways reuse "0" within a turn and two cards there are two
                // calls). That makes this the only place that can tell the
                // difference, and getting it wrong drew every shell command
                // twice — once as the placeholder, once as itself.
                let known = self.with_turn(|t| t.row.tool_calls.iter().any(|c| c.id == call_id));
                match known {
                    Some(true) => {
                        self.revise(&call_id, &tool_name, &arguments);
                        return;
                    }
                    Some(false) => {}
                    None => return,
                }

                let Some(message_id) = self.with_turn(|t| {
                    t.row.tool_calls.push(provider::ToolCall {
                        id: call_id.clone(),
                        name: tool_name.clone(),
                        arguments: arguments.clone(),
                    });
                    t.row.message_id.clone()
                }) else {
                    return;
                };
                self.emit(serde_json::json!({
                    "type": "tool_call",
                    "call_id": call_id,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "message_id": message_id,
                    "conversation_id": self.conversation_id,
                }));
                self.record_phase(TurnPhase::RunningTool, Some(&tool_name)).await;
            }
            Effect::ToolCallRevised {
                call_id,
                tool_name,
                arguments,
            } => self.revise(&call_id, &tool_name, &arguments),
            Effect::ToolResult {
                call_id,
                result,
                outcome,
            } => {
                let Some((message_id, quiet)) = self.with_turn(|t| {
                    t.row.results.push((call_id.clone(), result.clone(), outcome));
                    // This round is over. Whatever the agent says next is the
                    // next one talking, and gets a row of its own.
                    t.row.settled = true;
                    // Claude Code runs calls in parallel, and the phase is one
                    // value. Only the last result outstanding puts the turn back
                    // to streaming — otherwise the first one to land would say
                    // no tool is running while three still are, which is exactly
                    // the claim the warning must not make wrongly.
                    (t.row.message_id.clone(), t.row.results.len() >= t.row.tool_calls.len())
                }) else {
                    return;
                };
                if quiet {
                    self.record_phase(TurnPhase::Streaming, None).await;
                }
                self.emit(serde_json::json!({
                    "type": "tool_result",
                    "call_id": call_id,
                    "result": result,
                    "outcome": outcome,
                    "message_id": message_id,
                    "conversation_id": self.conversation_id,
                }));
            }
            Effect::Plan(items) => self.write_plan(items).await,
            // Reported but not stored. `used`/`size` is how full the context is,
            // which is not what `input_tokens`/`output_tokens` mean, and writing
            // it into those columns would feed a wrong number to everything that
            // reads them — the usage report most of all.
            Effect::Usage { used, size } => {
                tracing::debug!(used, size, conversation_id = %self.conversation_id, "acp context usage")
            }
            Effect::ConfigOptions(options) => {
                self.merge_config(options);
                // The composer is showing the old value until it hears.
                self.emit(serde_json::json!({
                    "type": "acp_config",
                    "conversation_id": self.conversation_id,
                    "config_options": self.config_options(),
                }));
            }
            Effect::Ignored => {}
        }
    }

    /// Land a finished round: the assistant row, then its tool results.
    ///
    /// Returns the id of the last row written, which is what the next one hangs
    /// off. A failed tool-result write leaves the chain on the last row that did
    /// land, for the same reason a native turn does — the tool already ran, so
    /// the row is worth less than the turn.
    async fn write_row(&self, turn_id: &str, parent: &str, row: &OpenRow) -> String {
        let tool_calls_json = (!row.tool_calls.is_empty()).then(|| serialize_tool_calls_openai(&row.tool_calls));
        if let Err(e) = complete_assistant(
            &self.services.db,
            &row.message_id,
            &row.text,
            (!row.reasoning.is_empty()).then_some(row.reasoning.as_str()),
            tool_calls_json.as_deref(),
            None,
            MessageUsage {
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                cache_write_tokens: None,
                server_tool_calls: None,
            },
        )
        .await
        {
            tracing::error!(error = %e, "could not store an ACP assistant row");
            return parent.to_string();
        }

        let mut last = row.message_id.clone();
        for (call_id, output, outcome) in &row.results {
            if let Some(id) = append_tool_result(
                &self.services.db,
                &self.conversation_id,
                turn_id,
                call_id,
                output,
                outcome,
                Some(&last),
            )
            .await
            {
                last = id;
            }
        }
        last
    }

    /// Write the rows owed to messages steered into this turn, and say what the
    /// next round hangs off.
    ///
    /// Called immediately after a round is written out, which is the only place
    /// in a turn where the chain has exactly one loose end. Each row also names
    /// itself on the queue item it came from — the item was settled when the
    /// agent said `injected`, minutes of tool call ago, and this is the second
    /// half of that record rather than the thing that settles it.
    async fn write_interjections(&self, turn_id: &str, parent: &str, interjected: &[Interjection]) -> String {
        let mut last = parent.to_string();
        for item in interjected {
            // The same write a native turn's steering uses, and for the same
            // reason: a user row, filed under the turn it was said *to* rather
            // than the one it causes, because that is where the agent read it.
            match write_steering(
                &self.services.db,
                &self.conversation_id,
                turn_id,
                &item.text,
                None,
                Some(&last),
            )
            .await
            {
                Ok(id) => {
                    let pool = self.services.db.clone();
                    let queue_id = item.queue_id.clone();
                    let message_id = id.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        let mut conn = get_conn(&pool)?;
                        crate::db::ops::queue::attach_message(&mut conn, &queue_id, &message_id)
                            .map_err(|e| e.to_string())
                    })
                    .await;
                    self.emit(serde_json::json!({
                        "type": "user_message",
                        "message_id": id,
                        "content": item.text,
                        "conversation_id": self.conversation_id,
                    }));
                    last = id;
                }
                // The agent has it either way — this is the transcript's copy.
                // Losing it leaves an answer that changes direction for no
                // visible reason, which is worth a loud log and not worth
                // ending a turn over.
                Err(e) => tracing::error!(error = %e, "an interjection reached the agent but not the transcript"),
            }
        }
        last
    }

    /// Close the current round and open the next one, if the current one is
    /// finished.
    ///
    /// Called before prose is recorded, and does nothing until a result has
    /// landed — so a turn that never calls a tool stays one row, and one that
    /// does gets the row-per-round shape a native turn writes.
    async fn open_round_if_settled(&self) {
        // Decided and taken in one critical section: nothing may land on a row
        // that is already being written out.
        let taken = self
            .with_turn(|t| {
                if !t.row.settled || t.row.is_empty() {
                    return None;
                }
                let carried = OpenRow::new(t.row.message_id.clone());
                Some((
                    t.turn_id.clone(),
                    t.parent.clone(),
                    std::mem::replace(&mut t.row, carried),
                    std::mem::take(&mut t.interjected),
                ))
            })
            .flatten();
        let Some((turn_id, parent, finished, interjected)) = taken else {
            return;
        };

        let last = self.write_row(&turn_id, &parent, &finished).await;
        // A round boundary is the one place in a turn where the chain has a
        // single loose end, which is what a steered message needs to hang off.
        let last = self.write_interjections(&turn_id, &last, &interjected).await;

        match begin_assistant(
            &self.services.db,
            &self.conversation_id,
            &turn_id,
            (None, Some(PROVIDER_LABEL)),
            &self.model(),
            Some(&last),
        )
        .await
        {
            Ok(id) => {
                self.with_turn(|t| {
                    t.row = OpenRow::new(id.clone());
                    t.parent = last;
                });
                // Same event a native turn sends at the top of every round; it
                // is what makes the front end start a new bubble rather than
                // append to the one that just closed.
                self.emit(serde_json::json!({
                    "type": "message_start",
                    "message_id": id,
                    "conversation_id": self.conversation_id,
                }));
            }
            // The database is not answering, which the rest of this turn is
            // going to keep discovering. Stop here rather than carry on writing
            // into a row that has already been completed — that would replace
            // what was just stored with what comes next. The turn is cancelled
            // so it ends down the ordinary path and reports the failure.
            Err(e) => {
                tracing::error!(error = %e, "could not open the next ACP round");
                self.with_turn(|t| {
                    t.parent = last;
                    t.row.written = true;
                    t.cancel.cancel();
                });
            }
        }
    }

    /// Record where in a turn this session is, for whoever finds the row after
    /// a crash.
    ///
    /// Written *before* the thing it describes, which is the whole point: what
    /// is stored when the process dies is where it died. `RunningTool` is the
    /// one that earns this — the agent had started a call and no result was
    /// recorded, so whatever it does may already be done. Without it a hosted
    /// turn killed mid-`Bash` reports as "stopped part way through writing a
    /// reply", the mildest of the four, when it is the most dangerous.
    ///
    /// The tool ran in the adapter rather than here, but the fact being
    /// recorded is the same one: a call was announced and never came back.
    async fn record_phase(&self, phase: TurnPhase, tool: Option<&str>) {
        let Some(turn_id) = self.with_turn(|t| t.turn_id.clone()) else {
            return;
        };
        let pool = self.services.db.clone();
        let tool = tool.map(str::to_string);
        let written = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            crate::db::ops::turn::set_phase(&mut conn, &turn_id, phase, tool.as_deref(), now_ms())
                .map_err(|e| e.to_string())
        })
        .await;
        // Logged, never fatal. A phase that did not land costs a vaguer warning
        // after a crash that may not happen; a turn ended over it costs the
        // answer somebody is reading.
        match written {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::debug!(error = %e, "could not record an ACP turn phase"),
            Err(e) => tracing::debug!(error = %e, "recording an ACP turn phase panicked"),
        }
    }

    /// Fill in a call that was announced before it knew what it was.
    ///
    /// Both the stored row and the card on screen: the row because that is what
    /// a reload rebuilds from, the card because otherwise it keeps saying
    /// "Terminal" with no arguments for the life of the conversation.
    ///
    /// Only ever *adds* information. A revision that arrived without arguments
    /// would otherwise blank the ones already shown — the adapter sends plain
    /// progress beats on the same shape.
    fn revise(&self, call_id: &str, tool_name: &str, arguments: &str) {
        let empty_args = arguments.trim().is_empty() || arguments == "{}";

        let updated = self.with_turn(|t| {
            let call = t.row.tool_calls.iter_mut().find(|c| c.id == call_id)?;
            if !tool_name.is_empty() {
                call.name = tool_name.to_string();
            }
            if !empty_args {
                call.arguments = arguments.to_string();
            }
            Some((call.name.clone(), call.arguments.clone(), t.row.message_id.clone()))
        });

        let Some(Some((tool_name, arguments, message_id))) = updated else {
            return;
        };
        self.emit(serde_json::json!({
            "type": "tool_call_revised",
            "call_id": call_id,
            "tool_name": tool_name,
            "arguments": arguments,
            "message_id": message_id,
            "conversation_id": self.conversation_id,
        }));
    }

    /// Mirror the agent's plan into the todo list.
    ///
    /// Goes straight to `replace_active_list` rather than through the
    /// `update_todos` tool: that one also retires an approved plan once every
    /// step is done, and an ACP session has no plan of this app's to retire.
    async fn write_plan(&self, items: Vec<mapping::PlanItem>) {
        use crate::db::models::todo::ItemStatus;
        use crate::db::ops::todo::TodoItemInput;

        let pool = self.services.db.clone();
        let conversation_id = self.conversation_id.clone();
        let items: Vec<TodoItemInput> = items
            .into_iter()
            .map(|item| TodoItemInput {
                // ACP has no present-continuous form, and the todo bar shows
                // that one while a step runs. Repeating the content reads
                // slightly wrong; leaving it blank leaves the bar empty.
                active_form: item.content.clone(),
                content: item.content,
                status: ItemStatus::parse(&item.status).unwrap_or(ItemStatus::Pending),
            })
            .collect();
        if items.is_empty() {
            return;
        }

        let written = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            crate::db::ops::todo::replace_active_list(&mut conn, &conversation_id, "Claude Code", &items, now_ms())
                .map_err(|e| e.to_string())
        })
        .await;
        match written {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::warn!(error = %e, "could not store the agent's plan"),
            Err(e) => tracing::warn!(error = %e, "could not store the agent's plan (the write panicked)"),
        }
    }
}

#[async_trait::async_trait]
impl Handler for Shared {
    async fn notification(&self, method: String, params: serde_json::Value) {
        if method != "session/update" {
            tracing::debug!(method, "an ACP notification this client does not handle");
            return;
        }
        match serde_json::from_value::<SessionNotification>(params) {
            Ok(notification) => self.absorb(notification).await,
            Err(e) => tracing::debug!(error = %e, "could not read a session/update"),
        }
    }

    async fn request(&self, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
        match method.as_str() {
            "session/request_permission" => {
                let params = serde_json::from_value(params).map_err(|e| e.to_string())?;
                let context = self.turn.lock().ok().and_then(|t| {
                    t.as_ref().map(|t| approvals::TurnContext {
                        turn_id: t.turn_id.clone(),
                        assistant_message_id: t.row.message_id.clone(),
                        cancel: t.cancel.clone(),
                    })
                });
                match context {
                    Some(context) => Ok(approvals::ask(&self.services, &self.conversation_id, &context, params).await),
                    // A question with no turn behind it has nowhere to draw a
                    // card and nobody to answer it. Refusing beats hanging the
                    // adapter on a prompt that will never appear.
                    None => {
                        tracing::warn!("an ACP permission request arrived with no turn running");
                        Ok(protocol::permission_cancelled())
                    }
                }
            }
            // `fs/*` and `terminal/*` land here while those capabilities are
            // declared unsupported. An agent should not send them; one that
            // does gets a refusal rather than silence.
            other => Err(format!("`{other}` is not supported by this client")),
        }
    }
}

/// What a turn is carrying that has to be settled once the agent has read it.
///
/// Held together because they settle together and on the same evidence — a
/// `session/prompt` that came back at all, whatever its stop reason. Anything
/// weaker settles nothing: a turn can assemble this and then die on a pipe that
/// closed, having told nobody. Anything stronger settles too little: a turn the
/// user stopped after two seconds still delivered the prompt that carried this.
#[derive(Default)]
struct Owed {
    turns: Option<crate::agent::interrupted::Report>,
    queued: Option<crate::agent::queue::Doubtful>,
    /// The agent cannot see the conversation it is answering into.
    ///
    /// Not a ledger like the other two — there is nothing to write down, only
    /// something to say once. It settles with them because it settles on the
    /// same evidence and forgetting to clear it would repeat the notice on
    /// every turn for the life of the session.
    memory_lost: bool,
}

/// What the agent is told when it has been given a conversation it has no
/// record of.
///
/// Worth saying plainly because the situation is worse than forgetting: a
/// hosted prompt carries only the new message, so this app's transcript never
/// enters the agent's context at all. It is not hazy about what came before —
/// it cannot see any of it, while the person it is talking to can see all of
/// it. Left unsaid, both sides spend a few turns confused about which of them
/// is being obtuse.
const NO_MEMORY: &str = "<no_session_memory>\n\
This conversation has a transcript above that you cannot see. The agent session \
it belonged to could not be resumed, so you are starting with no record of any \
of it — and a prompt carries only the newest message, so none of it will reach \
you later either. The user can see all of it.\n\
Do not answer as though you remember. Say plainly that this session lost its \
memory of the conversation, and ask them to restate whatever matters.\n\
</no_session_memory>";

impl Owed {
    /// The message with whatever has to be explained in front of it.
    ///
    /// A hosted prompt is one lump of text, so there is nowhere else to put
    /// this. Ahead of the message rather than behind it, because it is context
    /// for reading the message rather than a footnote to it.
    fn in_front_of(&self, text: &str) -> String {
        let mut parts: Vec<&str> = Vec::new();
        // First of the three. The other two describe things that happened
        // *within* a conversation the agent is assumed to be following, and
        // this one says it is not following any of it.
        if self.memory_lost {
            parts.push(NO_MEMORY);
        }
        if let Some(report) = &self.turns {
            parts.push(report.text());
        }
        if let Some(report) = &self.queued {
            parts.push(report.text());
        }
        if parts.is_empty() {
            return text.to_string();
        }
        parts.push(text);
        parts.join("\n\n")
    }

    fn is_empty(&self) -> bool {
        self.turns.is_none() && self.queued.is_none() && !self.memory_lost
    }

    /// Write the ledgers down, now that the agent has had them.
    async fn settle(self, services: &Services, shared: &Shared) {
        if let Some(report) = self.turns {
            crate::agent::interrupted::confirm_delivered(&services.db, report).await;
        }
        if let Some(report) = self.queued {
            crate::agent::queue::confirm_reported(services, report).await;
        }
        if self.memory_lost
            && let Ok(mut slot) = shared.memory_lost.lock()
        {
            *slot = false;
        }
    }
}

pub struct AcpSession {
    peer: Arc<Peer>,
    shared: Arc<Shared>,
    pub conversation_id: String,
    pub acp_session_id: String,
    pub cwd: String,
    /// Whether this adapter advertised `_session/steering`.
    ///
    /// Read once, at the handshake, because that is the only time it is said.
    /// An adapter without it cannot be steered at all — an interjection has to
    /// wait for the turn to end and go as an ordinary prompt, which is what
    /// Claude Code did before the extension existed.
    steering: bool,
    /// Whether the agent picked up the session it had rather than starting one.
    ///
    /// The caller writes the id back either way — a resume answers with
    /// whichever session the SDK actually recovered, which need not be the one
    /// asked for.
    pub resumed: bool,
}

/// What the handshake settled.
struct Handshook {
    acp_session_id: String,
    steering: bool,
    resumed: bool,
}

/// How a session is being opened.
struct Opening<'a> {
    cwd: &'a str,
    /// The session to pick up, when there is one on record. Absent for a
    /// conversation being created, and for one from before there was anywhere
    /// to write the id down.
    resume: Option<&'a str>,
    /// Whether failing to resume is worth telling the agent about. False for a
    /// new conversation: there is no transcript above for it to be blind to.
    transcript_above: bool,
}

impl AcpSession {
    /// Start an adapter and open a session in `cwd`, resuming if asked to.
    ///
    /// The conversation must already exist: creating it is the caller's job
    /// because only the caller knows whether this is a new conversation or one
    /// being reopened, and a half-created conversation whose adapter failed to
    /// start is worse than none.
    async fn open_with(
        services: Services,
        config: &AcpConfig,
        conversation_id: String,
        opening: Opening<'_>,
    ) -> Result<Arc<Self>, String> {
        let process = AdapterProcess::spawn(&config.command, &config.args).await?;

        let shared = Arc::new(Shared {
            services,
            conversation_id: conversation_id.clone(),
            turn: Mutex::new(None),
            model: Mutex::new(None),
            config: Mutex::new(Vec::new()),
            replaying: std::sync::atomic::AtomicBool::new(false),
            memory_lost: Mutex::new(false),
        });
        let peer = Peer::start(process, shared.clone() as Arc<dyn Handler>);

        // From here on the adapter is running, so every failure has to take it
        // down again. `?` alone would return leaving the peer's tasks holding a
        // live child nobody has a handle to any more — an orphaned node process
        // per failed attempt, and the usual reason to fail (not signed in) is
        // one the user retries.
        match Self::handshake(&peer, &shared, &opening).await {
            Ok(Handshook {
                acp_session_id,
                steering,
                resumed,
            }) => {
                // Only now, because only now is it true. A conversation with a
                // transcript whose agent did not resume is answering blind.
                if opening.transcript_above
                    && !resumed
                    && let Ok(mut slot) = shared.memory_lost.lock()
                {
                    *slot = true;
                }
                tracing::info!(
                    conversation_id = %conversation_id,
                    acp_session_id = %acp_session_id,
                    steering,
                    resumed,
                    "ACP session opened"
                );
                Ok(Arc::new(Self {
                    peer,
                    shared,
                    conversation_id,
                    acp_session_id,
                    cwd: opening.cwd.to_string(),
                    steering,
                    resumed,
                }))
            }
            Err(e) => {
                peer.stop().await;
                Err(e)
            }
        }
    }

    /// A session for a conversation being created. Nothing to resume, and
    /// nothing above for the agent to be blind to.
    pub async fn open(
        services: Services,
        config: &AcpConfig,
        conversation_id: String,
        cwd: String,
    ) -> Result<Arc<Self>, String> {
        Self::open_with(
            services,
            config,
            conversation_id,
            Opening {
                cwd: &cwd,
                resume: None,
                transcript_above: false,
            },
        )
        .await
    }

    /// A session for a conversation that already exists, picking up `resume` if
    /// the agent still has it.
    pub async fn reopen(
        services: Services,
        config: &AcpConfig,
        conversation_id: String,
        cwd: String,
        resume: Option<String>,
        transcript_above: bool,
    ) -> Result<Arc<Self>, String> {
        Self::open_with(
            services,
            config,
            conversation_id,
            Opening {
                cwd: &cwd,
                resume: resume.as_deref(),
                transcript_above,
            },
        )
        .await
    }

    /// Greet the adapter and open a session in `cwd`.
    ///
    /// Split out so [`open_with`](Self::open_with) has exactly one failure path
    /// to clean up after, rather than four `?`s that each need remembering.
    async fn handshake(peer: &Arc<Peer>, shared: &Shared, opening: &Opening<'_>) -> Result<Handshook, String> {
        let cwd = opening.cwd;
        let init = peer
            .request(
                "initialize",
                serde_json::to_value(protocol::InitializeParams {
                    protocol_version: protocol::PROTOCOL_VERSION,
                    // Everything false. Turning `fs` on means answering
                    // `fs/read_text_file` and `fs/write_text_file`, which is
                    // the step that would put every file the agent touches
                    // through this app.
                    client_capabilities: protocol::ClientCapabilities::default(),
                    client_info: protocol::Implementation {
                        name: CLIENT_NAME.into(),
                        title: Some("Meridian".into()),
                        version: env!("CARGO_PKG_VERSION").into(),
                    },
                })
                .map_err(|e| e.to_string())?,
            )
            .await
            .map_err(|e| describe(peer, e))?;

        let init: protocol::InitializeResult = serde_json::from_value(init).map_err(|e| e.to_string())?;
        let steering = init.steering_supported();
        tracing::info!(
            protocol_version = init.protocol_version,
            load_session = init.agent_capabilities.load_session,
            auth_method_count = init.auth_methods.len(),
            steering,
            "ACP adapter initialised"
        );

        // Picking the session back up, when there is one and the agent can.
        // Tried first and allowed to fail: a session id outlives the session it
        // names — the user can delete it, `claude` can prune it — and the right
        // answer to "that one is gone" is a fresh session, not a dead
        // conversation.
        if let Some(resume) = opening.resume.filter(|_| init.agent_capabilities.load_session) {
            match Self::load(peer, shared, cwd, resume).await {
                Ok(session) => {
                    return Ok(Handshook {
                        acp_session_id: session,
                        steering,
                        resumed: true,
                    });
                }
                Err(e) => tracing::warn!(
                    error = %e,
                    resume,
                    conversation_id = %shared.conversation_id,
                    "could not resume the agent session; starting a new one"
                ),
            }
        }

        // No `authenticate` call. `authMethods` lists what the adapter *can*
        // do, not what it still needs — `claude-code-acp` reports several while
        // already signed in as whatever `claude` is signed in as, so treating a
        // non-empty list as "not authenticated" would refuse every working
        // setup. If it really is unauthenticated, `session/new` says so and
        // that message reaches the user unchanged.
        let session = peer
            .request(
                "session/new",
                serde_json::to_value(protocol::NewSessionParams {
                    cwd: cwd.to_string(),
                    mcp_servers: Vec::new(),
                })
                .map_err(|e| e.to_string())?,
            )
            .await
            .map_err(|e| describe(peer, e))?;
        let session: protocol::NewSessionResult = serde_json::from_value(session).map_err(|e| e.to_string())?;
        // Known from the moment the session exists, so the first row of the
        // first turn records the real model rather than the placeholder, and
        // the composer has something to offer before anyone has typed. Re-sent
        // on every change after this, as a `config_option_update`.
        shared.merge_config(session.config_options);
        Ok(Handshook {
            acp_session_id: session.session_id,
            steering,
            resumed: false,
        })
    }

    /// Ask the agent to pick a session back up, and swallow the recital.
    ///
    /// A load replays the whole conversation as `session/update` notifications
    /// — every one of them a row this database already has. So the gate goes up
    /// before the request and comes down only after the reply *and* a drain:
    /// the reply travels a different route from the notifications and routinely
    /// overtakes them, which is the same reason `prompt` drains before it
    /// finishes a turn.
    async fn load(peer: &Arc<Peer>, shared: &Shared, cwd: &str, resume: &str) -> Result<String, String> {
        let params = serde_json::to_value(protocol::LoadSessionParams {
            session_id: resume.to_string(),
            cwd: cwd.to_string(),
            mcp_servers: Vec::new(),
        })
        .map_err(|e| e.to_string())?;

        shared.replaying.store(true, std::sync::atomic::Ordering::Relaxed);
        let answered = peer.request("session/load", params).await;
        peer.drain_notifications().await;
        shared.replaying.store(false, std::sync::atomic::Ordering::Relaxed);

        let session: protocol::NewSessionResult =
            serde_json::from_value(answered.map_err(|e| describe(peer, e))?).map_err(|e| e.to_string())?;
        shared.merge_config(session.config_options);
        // The reply, not the request. Resuming goes through the SDK and it
        // answers with whichever session it actually recovered; storing what we
        // asked for would have the next resume chase an id that never existed.
        Ok(session.session_id)
    }

    pub fn is_alive(&self) -> bool {
        self.peer.is_alive()
    }

    /// Whether this adapter takes `_session/steering`, as it said at the
    /// handshake. An interjection to a session that answers `false` has to wait
    /// for the turn to end and go as an ordinary prompt.
    pub fn supports_steering(&self) -> bool {
        self.steering
    }

    /// The turn running right now, if there is one.
    ///
    /// What the queue runner asks to decide which of the two modes it may
    /// deliver, and what it records a steer against. Racy by nature — the turn
    /// can end in the gap — which is why nothing downstream trusts it: a steer
    /// that arrives too late is answered `promptRequired` and comes back for
    /// the other path.
    pub fn current_turn_id(&self) -> Option<String> {
        let guard = self.shared.turn.lock().ok()?;
        guard.as_ref().map(|t| t.turn_id.clone())
    }

    /// Put a message into the turn that is already running.
    ///
    /// Returns what the agent did with it, and the caller has to look: only
    /// [`SteerOutcome::PromptRequired`] means the message was not taken, and it
    /// is the one answer that is safe to retry.
    ///
    /// The transcript row is *not* written here. It is owed to the turn's next
    /// round boundary — see [`TurnState::interjected`] — because the chain has
    /// two loose ends anywhere else and a row landing between them forks it.
    pub async fn steer(&self, queue_id: &str, text: &str) -> Result<protocol::SteerOutcome, String> {
        if !self.steering {
            return Err("this adapter does not support steering".into());
        }
        let params = serde_json::to_value(protocol::SteerParams::text(self.acp_session_id.clone(), text))
            .map_err(|e| e.to_string())?;

        // **Before the send, and taken back after.** The other order loses the
        // row outright in a window that is not hypothetical: the agent decides
        // whether to inject the moment the request arrives, and the turn can
        // reach its ending before the reply gets back here — at which point
        // `finish` has taken the turn state and a message the agent has already
        // absorbed has nowhere left to be written.
        self.remember_interjection(queue_id, text);

        let answered = match self.peer.request(protocol::STEER_METHOD, params).await {
            Ok(value) => value,
            // The agent refusing, or the pipe failing. Neither says the message
            // landed, and the item stays in doubt — where the ledger, not the
            // transcript, is what carries the text forward. A row here would
            // contradict the very report that is about to be made about it.
            Err(e) => {
                self.forget_interjection(queue_id);
                return Err(describe(&self.peer, e));
            }
        };

        // An unreadable reply is not a failure to deliver: the agent answered,
        // and every outcome it can name except one means the message landed.
        // Reading it as an error would put the item in doubt over a field this
        // build does not recognise.
        let outcome = match serde_json::from_value::<protocol::SteerResult>(answered) {
            Ok(result) => result.outcome(),
            Err(e) => {
                tracing::debug!(error = %e, "could not read the reply to a steer");
                protocol::SteerOutcome::Unknown("unreadable".into())
            }
        };

        if outcome == protocol::SteerOutcome::PromptRequired {
            self.forget_interjection(queue_id);
        }
        Ok(outcome)
    }

    fn remember_interjection(&self, queue_id: &str, text: &str) {
        if let Ok(mut slot) = self.shared.turn.lock()
            && let Some(state) = slot.as_mut()
        {
            state.interjected.push(Interjection {
                queue_id: queue_id.to_string(),
                text: text.to_string(),
            });
        }
    }

    fn forget_interjection(&self, queue_id: &str) {
        if let Ok(mut slot) = self.shared.turn.lock()
            && let Some(state) = slot.as_mut()
        {
            state.interjected.retain(|i| i.queue_id != queue_id);
        }
    }

    /// Every knob the agent exposes, as it last described them.
    pub fn config_options(&self) -> Vec<protocol::SessionConfigOption> {
        self.shared.config_options()
    }

    /// Set one of them.
    ///
    /// The reply carries the whole set back rather than the one option, because
    /// changing one reshapes others — picking a model re-derives which modes
    /// are available — so it is merged in exactly like a notification.
    pub async fn set_config_option(
        &self,
        config_id: &str,
        value: serde_json::Value,
    ) -> Result<Vec<protocol::SessionConfigOption>, String> {
        let params = serde_json::to_value(protocol::SetConfigOptionParams {
            session_id: self.acp_session_id.clone(),
            config_id: config_id.to_string(),
            value,
        })
        .map_err(|e| e.to_string())?;

        let answered = self
            .peer
            .request("session/set_config_option", params)
            .await
            .map_err(|e| describe(&self.peer, e))?;

        // A reply this app cannot read is not a failure to set: the agent said
        // yes. The notification that follows carries the same set, so the
        // option list catches up either way.
        match serde_json::from_value::<protocol::SetConfigOptionResult>(answered) {
            Ok(result) if !result.config_options.is_empty() => {
                self.shared.merge_config(result.config_options);
            }
            Ok(_) => {}
            Err(e) => tracing::debug!(error = %e, "could not read the reply to session/set_config_option"),
        }
        Ok(self.shared.config_options())
    }

    /// Send one prompt and run it to completion.
    ///
    /// Holds a turn lease for the whole of it, so the conversation shows as
    /// busy, the stop button reaches this turn, and nothing else can write to
    /// the conversation underneath it.
    ///
    /// `turn_id` comes from the caller for the same reason `chat` takes one: the
    /// composer locks on the id the moment the user presses send, and the stop
    /// event it is waiting for has to carry that same id. An id minted here
    /// would not exist until the adapter had been reached, and everything
    /// arriving in the gap would be measured against nothing.
    pub async fn prompt(&self, services: &Services, text: &str, turn_id: Option<String>) -> Result<(), String> {
        self.prompt_with(services, text, turn_id, None).await
    }

    /// Deliver a queued item as a turn of its own.
    ///
    /// The item is settled in the same transaction that writes its message row
    /// and its turn row, and there is no in-doubt window here for the same
    /// reason a native turn has none: what happens after that transaction is a
    /// *recorded turn*, which either answers or is written down as having
    /// failed. Marking it in doubt instead would warn the next agent about a
    /// message sitting in plain sight a few rows above.
    pub async fn deliver_queued(&self, services: &Services, item: &QueuedPrompt) -> Result<(), String> {
        self.prompt_with(services, &item.content, None, Some(&item.id)).await
    }

    async fn prompt_with(
        &self,
        services: &Services,
        text: &str,
        turn_id: Option<String>,
        queued: Option<&str>,
    ) -> Result<(), String> {
        let turn_id = match turn_id {
            Some(raw) => uuid::Uuid::parse_str(&raw)
                .map_err(|_| "turn id must be a uuid".to_string())?
                .to_string(),
            None => uuid::Uuid::new_v4().to_string(),
        };
        // The peer's drop counter never resets, so what this turn lost is the
        // difference across it rather than the total.
        let dropped_before = self.peer.dropped_notifications();
        let cancel = CancellationToken::new();
        let lease = Arc::clone(&services.turns)
            .try_acquire_turn_with(
                &self.conversation_id,
                TurnOrigin::ClaudeCode,
                turn_id.clone(),
                cancel.clone(),
            )
            .map_err(|busy| busy.to_string())?;

        let user_message_id = self.write_prompt_row(services, &turn_id, text, queued).await?;

        let assistant_message_id = begin_assistant(
            &services.db,
            &self.conversation_id,
            &turn_id,
            (None, Some(PROVIDER_LABEL)),
            &self.shared.model(),
            Some(&user_message_id),
        )
        .await?;

        if let Ok(mut slot) = self.shared.turn.lock() {
            *slot = Some(TurnState {
                turn_id: turn_id.clone(),
                cancel: cancel.clone(),
                row: OpenRow::new(assistant_message_id.clone()),
                // The question. Every row this turn writes chains from it.
                parent: user_message_id.clone(),
                interjected: Vec::new(),
            });
        }

        self.shared.emit(serde_json::json!({
            "type": "message_start",
            "message_id": assistant_message_id,
            "conversation_id": self.conversation_id,
        }));

        // Read after the turn record exists, so `asking` can exclude it, and
        // sent in front of the message rather than stored: this is background
        // the agent needs for *this* answer, not something anybody said.
        let owed = self.owed_explanations(services, &turn_id).await;
        let params = serde_json::to_value(protocol::PromptParams {
            session_id: self.acp_session_id.clone(),
            prompt: vec![protocol::ContentBlock::text(owed.in_front_of(text))],
        })
        .map_err(|e| e.to_string())?;

        // No timeout: a turn legitimately runs for as long as the work takes,
        // and the stop button is the bound.
        //
        // Stopping does **not** abandon this request. `session/cancel` is a
        // notification, and the spec has the agent answer the prompt it
        // interrupts with `stopReason: cancelled` — so the reply still comes,
        // and waiting for it is what lets the turn end down the ordinary path
        // with whatever text had already been written. Dropping the future here
        // instead would leave the adapter mid-turn with nobody reading, and the
        // next prompt would collide with it.
        let prompt = self.peer.request("session/prompt", params);
        tokio::pin!(prompt);
        let mut cancel_sent = false;
        let outcome = loop {
            tokio::select! {
                result = &mut prompt => break result,
                // The guard is what keeps this from spinning: a cancelled token
                // stays cancelled, so without it this arm would be ready for
                // ever and starve the one that matters.
                _ = cancel.cancelled(), if !cancel_sent => {
                    cancel_sent = true;
                    let _ = self.peer.notify(
                        "session/cancel",
                        serde_json::json!({ "sessionId": self.acp_session_id }),
                    ).await;
                }
            }
        };

        // Before `finish`, which takes the state the updates are recorded into.
        // The reply and the updates travel by different routes and the reply is
        // the faster one, so the last few `session/update`s of a turn are
        // routinely still queued at this point — the tool result and the
        // closing sentence among them. See `Peer::drain_notifications`.
        self.peer.drain_notifications().await;

        self.finish(services, &turn_id, outcome, lease, dropped_before, owed)
            .await
    }

    /// What this session still owes the agent an explanation for.
    ///
    /// Two ledgers, one message. A hosted session has never carried either:
    /// `load_block` was called from the desktop path alone, so a Claude Code
    /// conversation whose app was killed mid-tool started its next turn as if
    /// nothing had happened — which is the case the warning exists for, since
    /// the adapter's own memory of that turn died with the process while
    /// whatever the tool did to the disk did not.
    async fn owed_explanations(&self, services: &Services, turn_id: &str) -> Owed {
        Owed {
            turns: crate::agent::interrupted::load_block(&services.db, &services.turns, &self.conversation_id, turn_id)
                .await,
            queued: crate::agent::queue::owed(services, &self.conversation_id).await,
            // Read, not taken. A turn can assemble this and then die before a
            // byte leaves; clearing it here would spend the one chance to say
            // it on a prompt nobody received.
            memory_lost: self.shared.memory_lost.lock().is_ok_and(|slot| *slot),
        }
    }

    /// Write the user's row and the turn record — and, when this prompt came
    /// off the queue, settle the item too — in one transaction.
    ///
    /// All or none: a turn row without its message is a run that reports
    /// progress on nothing, a message without its turn row is invisible to
    /// startup reconciliation, and a queue item settled without either is one
    /// that has been consumed and produced nothing.
    async fn write_prompt_row(
        &self,
        services: &Services,
        turn_id: &str,
        text: &str,
        queued: Option<&str>,
    ) -> Result<String, String> {
        use crate::db::models::message::NewMessage;
        use diesel::Connection;

        let pool = services.db.clone();
        let conversation_id = self.conversation_id.clone();
        let turn_id = turn_id.to_string();
        let message_id = uuid::Uuid::new_v4().to_string();
        let returned = message_id.clone();
        let content = text.to_string();
        let queued = queued.map(str::to_string);

        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                let head = crate::db::ops::conversation::get_conversation(conn, &conversation_id)
                    .ok()
                    .and_then(|c| c.head_message_id);

                crate::db::ops::message::append_message(
                    conn,
                    &NewMessage {
                        id: &message_id,
                        conversation_id: &conversation_id,
                        role: "user",
                        content: &content,
                        provider_id: None,
                        model_id: None,
                        input_tokens: None,
                        output_tokens: None,
                        tool_calls: None,
                        tool_call_id: None,
                        sort_order: 0,
                        created_at: now,
                        reasoning_content: None,
                        rating: None,
                        schema_version: 2,
                        is_compact_summary: 0,
                        sender_id: None,
                        parent_id: head.as_deref(),
                        compact_anchor_id: None,
                        source: None,
                        turn_id: Some(&turn_id),
                        tool_outcome: None,
                        cache_read_tokens: None,
                        cache_write_tokens: None,
                        server_tool_calls: None,
                        provider_name: None,
                    },
                    head.as_deref(),
                )?;

                crate::db::ops::turn::begin(conn, &turn_id, &conversation_id, TurnOrigin::ClaudeCode, None, now)?;
                if let Some(queued) = &queued {
                    // Refuses an item somebody has already taken, and rolls the
                    // whole thing back rather than writing a second row for it.
                    // The turn lease makes that all but impossible — two pumps
                    // cannot both hold the conversation — and "all but" is the
                    // wrong guarantee for a message that says "delete the old
                    // migration".
                    if crate::db::ops::queue::mark_dispatched(conn, queued, &turn_id, now)? == 0 {
                        return Err(diesel::result::Error::RollbackTransaction);
                    }
                    crate::db::ops::queue::mark_settled(conn, queued, Some(&message_id), now)?;
                }
                Ok(())
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        Ok(returned)
    }

    /// Land the transcript and report how the turn ended.
    ///
    /// Runs on every path out of `prompt`, success or not: a turn that failed
    /// half way still wrote text worth keeping, and the row it wrote is already
    /// on screen.
    async fn finish(
        &self,
        services: &Services,
        turn_id: &str,
        outcome: Result<serde_json::Value, PeerError>,
        lease: crate::turn::TurnLease,
        dropped_before: u64,
        owed: Owed,
    ) -> Result<(), String> {
        // Before anything else can return early. The evidence is the reply
        // itself: `session/prompt` answering at all means the adapter took the
        // prompt, and the prompt is where this was written. A `cancelled` stop
        // reason still means it was read — the user stopped the work, not the
        // reading — while an `Err` is a pipe that may have closed before the
        // request went out, and leaves both ledgers owing.
        if outcome.is_ok() && !owed.is_empty() {
            owed.settle(services, &self.shared).await;
        }

        let state = self.shared.turn.lock().ok().and_then(|mut slot| slot.take());
        let Some(state) = state else {
            drop(lease);
            self.retire_approvals(services, turn_id);
            return Err("the ACP turn lost its state".into());
        };

        // Before anything else, and on every path out of a turn. A question can
        // still be on screen when the turn ends — the adapter died with one
        // outstanding, or the reply came back an error — and nothing else will
        // ever answer it: the task waiting on it is parked, the entry stays in
        // the register, `all_pending_approvals` keeps handing it out, and a
        // reload draws a card for a turn that stopped minutes ago.
        //
        // Cancelling first is what releases that task, which then removes its
        // own entry; the sweep below is for whatever it did not reach. The
        // desktop does the same two things in `TurnGuard::drop`, for the same
        // reason, and this path had neither.
        state.cancel.cancel();
        self.retire_approvals(services, turn_id);

        // The last round. Earlier ones were written as they closed, each by the
        // prose that opened the next — so this is only ever the tail.
        //
        // Skipped when the row has nothing on it, which happens on exactly one
        // path: the next round was opened and then failed to, leaving a carried
        // id that already holds the previous round's answer. Completing it again
        // would replace that answer with nothing.
        let last_row = state.row;
        let last = if last_row.written {
            state.parent.clone()
        } else {
            self.shared.write_row(turn_id, &state.parent, &last_row).await
        };
        // Whatever was steered into the final round, which has no boundary of
        // its own to land at. Owed even on a failed turn: the agent took the
        // message, so the transcript has to show it was said.
        self.shared
            .write_interjections(turn_id, &last, &state.interjected)
            .await;

        let (status, reason, error) = match &outcome {
            Ok(value) => {
                let stop = value
                    .get("stopReason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("end_turn")
                    .to_string();
                match stop.as_str() {
                    "cancelled" => (TurnStatus::Cancelled, stop, None),
                    _ => (TurnStatus::Done, stop, None),
                }
            }
            Err(e) => (TurnStatus::Failed, "error".to_string(), Some(e.to_string())),
        };

        // An update the reader could not queue is a piece of this answer that
        // was never written down, and the rows above have already been saved
        // without it. Nothing downstream can tell: the transcript is
        // well-formed, just missing a paragraph or a tool's result.
        //
        // So a turn that lost one does not get to say it finished. Reporting
        // `Done` here is the failure mode with no symptom at all — the user
        // reads a truncated answer as the whole answer. Overriding a real
        // failure would be worse, so this only demotes success.
        let lost = self.peer.dropped_notifications().saturating_sub(dropped_before);
        let (status, reason, error) = if lost > 0 && status == TurnStatus::Done {
            tracing::error!(
                lost,
                conversation_id = %self.conversation_id,
                "an ACP turn lost updates; its transcript is incomplete"
            );
            (
                TurnStatus::Failed,
                "error".to_string(),
                Some(format!(
                    "{lost} update(s) from Claude Code were dropped, so this answer is incomplete."
                )),
            )
        } else {
            (status, reason, error)
        };

        crate::agent::turn_record::finish(&services.db, turn_id, status, error.as_deref()).await;

        self.shared.emit(serde_json::json!({
            "type": "stop",
            "reason": reason,
            "done": true,
            "message_id": last_row.message_id,
            "turn_id": turn_id,
            "conversation_id": self.conversation_id,
            "input_tokens": 0,
            "output_tokens": 0,
        }));
        // The sidebar refetches on this; without it the conversation's preview
        // and timestamp stay at whatever they were before the turn.
        let _ = services.events.emit(
            "conversation-updated",
            serde_json::json!({ "conversation_id": self.conversation_id }),
        );

        drop(lease);

        // Now, and not before: the queue's next item wants a turn of its own,
        // and the lease it needs is the one that has just been dropped.
        //
        // A turn that did not reach an ending stops the queue instead. The
        // instructions behind a failure rest on the step that failed — "now
        // rename that function" means nothing if the function was never
        // created — so what happens next is a person's decision, not ours.
        match status {
            TurnStatus::Done => crate::agent::queue::pump_later(services, &self.conversation_id),
            _ => crate::agent::queue::hold(services, &self.conversation_id).await,
        }

        match outcome {
            // The caller hears about lost updates too. `acp_send` is awaited by
            // the composer, and a rejection is what unlocks it with an error
            // rather than with a tick.
            Ok(_) => match error {
                Some(e) => Err(e),
                None => Ok(()),
            },
            Err(e) => Err(e.to_string()),
        }
    }

    /// Drop every question this turn left unanswered.
    ///
    /// Keyed by turn rather than by conversation: a later turn in the same
    /// conversation may already have questions of its own outstanding, and
    /// clearing those would strand *it* instead.
    fn retire_approvals(&self, services: &Services, turn_id: &str) {
        let mut register = services.approvals.lock();
        let before = register.len();
        register.retain(|_, pending| pending.turn_id != turn_id);
        let retired = before - register.len();
        if retired > 0 {
            tracing::debug!(
                retired,
                turn_id,
                conversation_id = %self.conversation_id,
                "dropped approvals nobody was left to answer"
            );
        }
    }

    /// Stop whatever this session is doing, without closing it.
    pub async fn cancel(&self) {
        if let Ok(slot) = self.shared.turn.lock()
            && let Some(state) = slot.as_ref()
        {
            state.cancel.cancel();
        }
        let _ = self
            .peer
            .notify(
                "session/cancel",
                serde_json::json!({ "sessionId": self.acp_session_id }),
            )
            .await;
    }

    /// End the session and the process behind it.
    pub async fn close(&self) {
        self.cancel().await;
        self.peer.stop().await;
    }
}

/// Turn a peer failure into something worth showing a user.
///
/// A dead peer's message already carries the adapter's own stderr; an RPC
/// refusal does not, and the adapter's last words are usually the whole
/// explanation ("not logged in", "no such directory").
fn describe(peer: &Peer, error: PeerError) -> String {
    match error {
        PeerError::Dead(m) => m,
        PeerError::Rpc(m) if peer.is_alive() => m,
        PeerError::Rpc(m) => format!("{m} (the adapter has since stopped)"),
    }
}

/// Fold a freshly described set of config options into the one being held.
///
/// Free of the session so the rule can be stated on its own, because it is not
/// the obvious one: an option in an update may carry only a new `currentValue`
/// and omit the values it accepts. It is reporting a change, not redefining the
/// knob. Replacing wholesale — or even replacing one option wholesale — empties
/// the picker at the exact moment somebody is using it.
fn merge_options(held: &mut Vec<protocol::SessionConfigOption>, incoming: Vec<protocol::SessionConfigOption>) {
    for option in incoming {
        match held.iter_mut().find(|o| o.id == option.id) {
            Some(existing) => {
                // Keep what the update did not restate.
                let previous = std::mem::take(&mut existing.options);
                let keep_previous = option.options.is_empty();
                *existing = option;
                if keep_previous {
                    existing.options = previous;
                }
            }
            // A knob that did not exist a moment ago. Agents add them when a
            // model changes, so this is ordinary rather than exceptional.
            None => held.push(option),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::protocol::{ConfigOptionValue, SessionConfigOption};

    fn select(id: &str, current: &str, values: &[&str]) -> SessionConfigOption {
        SessionConfigOption {
            id: id.into(),
            name: id.into(),
            description: None,
            category: Some(id.into()),
            kind: Some("select".into()),
            current_value: Some(serde_json::Value::String(current.into())),
            options: values
                .iter()
                .map(|v| ConfigOptionValue {
                    value: (*v).into(),
                    name: (*v).into(),
                    description: None,
                })
                .collect(),
        }
    }

    /// The whole reason this is a merge.
    ///
    /// An update that reports a new `currentValue` need not restate what the
    /// knob accepts. Taking it at face value would leave the picker with one
    /// entry and no way back — and it would happen on the very update that
    /// follows the user changing the model.
    #[test]
    fn an_update_that_omits_its_values_keeps_the_ones_already_known() {
        let mut held = vec![select("model", "sonnet", &["sonnet", "opus"])];

        let mut narrowed = select("model", "opus", &[]);
        narrowed.options.clear();
        merge_options(&mut held, vec![narrowed]);

        assert_eq!(held.len(), 1);
        assert_eq!(held[0].current_str(), Some("opus"), "the change is taken");
        assert_eq!(
            held[0].options.len(),
            2,
            "and what it may be set to survives: {:?}",
            held[0].options
        );
    }

    /// When an update *does* restate them, it wins — an agent that re-derives
    /// which modes exist for a newly chosen model is telling us the old list is
    /// wrong, and keeping it would offer a mode that no longer applies.
    #[test]
    fn an_update_that_restates_its_values_replaces_them() {
        let mut held = vec![select("mode", "code", &["code", "plan", "bypass"])];
        merge_options(&mut held, vec![select("mode", "code", &["code"])]);

        assert_eq!(held[0].options.len(), 1);
        assert_eq!(held[0].options[0].value, "code");
    }

    /// A hosted prompt is one lump of text, so anything that has to be
    /// explained goes in front of the message rather than beside it — and when
    /// there is nothing to explain, the message is passed through untouched
    /// rather than wrapped in an empty frame.
    #[test]
    fn what_is_owed_goes_in_front_of_the_message_and_nothing_else_does() {
        let plain = Owed::default();
        assert!(plain.is_empty());
        assert_eq!(plain.in_front_of("do the thing"), "do the thing");

        let mut conn = crate::db::test_db().get().unwrap();
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 0).unwrap();
        crate::db::ops::turn::begin(&mut conn, "dead", "c1", crate::turn::TurnOrigin::ClaudeCode, None, 1000).unwrap();
        crate::db::ops::turn::set_phase(&mut conn, "dead", TurnPhase::RunningTool, Some("Bash"), 1001).unwrap();

        let owed = Owed {
            turns: crate::agent::interrupted::block(
                &mut conn,
                &crate::turn::TurnCoordinator::new(),
                "c1",
                Some("asking"),
            ),
            queued: None,
            memory_lost: false,
        };
        assert!(!owed.is_empty(), "a turn killed inside a tool is owed an explanation");

        let sent = owed.in_front_of("carry on");
        assert!(sent.starts_with("<interrupted_turn>"), "{sent}");
        assert!(sent.ends_with("carry on"), "{sent}");
        assert!(
            sent.contains("Bash") && sent.contains("may have taken effect"),
            "a hosted turn caught inside a tool says the dangerous thing, not the mild one: {sent}"
        );

        // And the blindness goes first. The other two describe things that
        // happened inside a conversation the agent is assumed to be following;
        // this one says it is following none of it, which changes how the rest
        // should be read.
        let blind = Owed {
            turns: crate::agent::interrupted::block(
                &mut conn,
                &crate::turn::TurnCoordinator::new(),
                "c1",
                Some("asking"),
            ),
            queued: None,
            memory_lost: true,
        };
        let sent = blind.in_front_of("carry on");
        assert!(sent.starts_with("<no_session_memory>"), "{sent}");
        assert!(
            sent.find("<no_session_memory>") < sent.find("<interrupted_turn>"),
            "{sent}"
        );
        assert!(sent.ends_with("carry on"));

        // On its own it is still worth saying, and still nothing more than a
        // prefix — the message itself is untouched.
        let alone = Owed {
            memory_lost: true,
            ..Owed::default()
        };
        assert!(!alone.is_empty());
        assert!(alone.in_front_of("hello").ends_with("\n\nhello"));
    }

    /// Only what the update mentions is touched, and a knob it has never
    /// mentioned before is added rather than ignored.
    #[test]
    fn options_the_update_does_not_mention_are_left_alone() {
        let mut held = vec![
            select("model", "sonnet", &["sonnet"]),
            select("mode", "code", &["code"]),
        ];
        merge_options(&mut held, vec![select("effort", "high", &["low", "high"])]);

        assert_eq!(held.len(), 3);
        assert_eq!(held[0].current_str(), Some("sonnet"));
        assert_eq!(held[1].current_str(), Some("code"));
        assert_eq!(held[2].id, "effort");
    }
}
