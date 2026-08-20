//! One hosted session: a conversation here, a session id there, and the turn
//! that connects them.
//!
//! The transcript is written with the same three functions a native turn uses
//! (`begin_assistant`, `complete_assistant`, `append_tool_result`), so an ACP
//! conversation is an ordinary row set that search, branching, compaction and
//! the transcript view all already understand. Nothing about it is a special
//! case below `chat-view`.
//!
//! **A turn here is flattened.** The adapter may go round the model several
//! times in one `session/prompt`, and all of it lands on one assistant row with
//! every tool call attached to it, rather than the row-per-round a native turn
//! writes. The shape is legal — an assistant row carries a list of calls, and
//! each result is its own row — and it reads correctly; what it loses is which
//! text came before which call. Recovering that means splitting the row at the
//! first result, which is worth doing when something needs the distinction and
//! not before.

use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use crate::agent::engine::transcript::{append_tool_result, begin_assistant, complete_assistant};
use crate::agent::tool_calls::serialize_tool_calls_openai;
use crate::db::models::message::MessageUsage;
use crate::db::models::turn::TurnStatus;
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
/// Recorded on every assistant row so a transcript says what wrote it. Not a
/// model id — which model the adapter chose is its business and it does not
/// report one.
const MODEL_LABEL: &str = "claude-code";

/// The turn in flight, if there is one.
struct TurnState {
    turn_id: String,
    assistant_message_id: String,
    cancel: CancellationToken,
    text: String,
    reasoning: String,
    tool_calls: Vec<provider::ToolCall>,
    /// `(call_id, output, outcome)`, in the order the calls finished.
    results: Vec<(String, String, &'static str)>,
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

    async fn absorb(&self, notification: SessionNotification) {
        let effect = mapping::effect_of(notification.update);
        // Every branch below takes the lock, drops it, and only then emits.
        // Emitting under the lock would put a sink's latency inside a critical
        // section the reader is feeding.
        match effect {
            Effect::Text(chunk) => {
                let Some(message_id) = self.with_turn(|t| {
                    t.text.push_str(&chunk);
                    t.assistant_message_id.clone()
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
                let Some(message_id) = self.with_turn(|t| {
                    t.reasoning.push_str(&chunk);
                    t.assistant_message_id.clone()
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
                let Some(message_id) = self.with_turn(|t| {
                    t.tool_calls.push(provider::ToolCall {
                        id: call_id.clone(),
                        name: tool_name.clone(),
                        arguments: arguments.clone(),
                    });
                    t.assistant_message_id.clone()
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
            }
            Effect::ToolResult {
                call_id,
                result,
                outcome,
            } => {
                let Some(message_id) = self.with_turn(|t| {
                    t.results.push((call_id.clone(), result.clone(), outcome));
                    t.assistant_message_id.clone()
                }) else {
                    return;
                };
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
            Effect::Ignored => {}
        }
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
                        assistant_message_id: t.assistant_message_id.clone(),
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

pub struct AcpSession {
    peer: Arc<Peer>,
    shared: Arc<Shared>,
    pub conversation_id: String,
    pub acp_session_id: String,
    pub cwd: String,
}

impl AcpSession {
    /// Start an adapter and open a session in `cwd`.
    ///
    /// The conversation must already exist: creating it is the caller's job
    /// because only the caller knows whether this is a new conversation or one
    /// being reopened, and a half-created conversation whose adapter failed to
    /// start is worse than none.
    pub async fn open(
        services: Services,
        config: &AcpConfig,
        conversation_id: String,
        cwd: String,
    ) -> Result<Arc<Self>, String> {
        let process = AdapterProcess::spawn(&config.command, &config.args).await?;

        let shared = Arc::new(Shared {
            services,
            conversation_id: conversation_id.clone(),
            turn: Mutex::new(None),
        });
        let peer = Peer::start(process, shared.clone() as Arc<dyn Handler>);

        // From here on the adapter is running, so every failure has to take it
        // down again. `?` alone would return leaving the peer's tasks holding a
        // live child nobody has a handle to any more — an orphaned node process
        // per failed attempt, and the usual reason to fail (not signed in) is
        // one the user retries.
        match Self::handshake(&peer, &cwd).await {
            Ok(acp_session_id) => {
                tracing::info!(
                    conversation_id = %conversation_id,
                    acp_session_id = %acp_session_id,
                    "ACP session opened"
                );
                Ok(Arc::new(Self {
                    peer,
                    shared,
                    conversation_id,
                    acp_session_id,
                    cwd,
                }))
            }
            Err(e) => {
                peer.stop().await;
                Err(e)
            }
        }
    }

    /// Greet the adapter and open a session in `cwd`.
    ///
    /// Split out so [`open`](Self::open) has exactly one failure path to clean
    /// up after, rather than four `?`s that each need remembering.
    async fn handshake(peer: &Arc<Peer>, cwd: &str) -> Result<String, String> {
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
        tracing::info!(
            protocol_version = init.protocol_version,
            load_session = init.agent_capabilities.load_session,
            auth_method_count = init.auth_methods.len(),
            "ACP adapter initialised"
        );

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
        Ok(session.session_id)
    }

    pub fn is_alive(&self) -> bool {
        self.peer.is_alive()
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

        let user_message_id = self.write_prompt_row(services, &turn_id, text).await?;

        let assistant_message_id = begin_assistant(
            &services.db,
            &self.conversation_id,
            &turn_id,
            (None, Some("Claude Code")),
            MODEL_LABEL,
            Some(&user_message_id),
        )
        .await?;

        if let Ok(mut slot) = self.shared.turn.lock() {
            *slot = Some(TurnState {
                turn_id: turn_id.clone(),
                assistant_message_id: assistant_message_id.clone(),
                cancel: cancel.clone(),
                text: String::new(),
                reasoning: String::new(),
                tool_calls: Vec::new(),
                results: Vec::new(),
            });
        }

        self.shared.emit(serde_json::json!({
            "type": "message_start",
            "message_id": assistant_message_id,
            "conversation_id": self.conversation_id,
        }));

        let params = serde_json::to_value(protocol::PromptParams {
            session_id: self.acp_session_id.clone(),
            prompt: vec![protocol::ContentBlock::text(text)],
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

        self.finish(services, &turn_id, outcome, lease, dropped_before).await
    }

    /// Write the user's row and the turn record, in one transaction.
    ///
    /// Both or neither: a turn row without its message is a run that reports
    /// progress on nothing, and a message without its turn row is invisible to
    /// startup reconciliation.
    async fn write_prompt_row(&self, services: &Services, turn_id: &str, text: &str) -> Result<String, String> {
        use crate::db::models::message::NewMessage;
        use diesel::Connection;

        let pool = services.db.clone();
        let conversation_id = self.conversation_id.clone();
        let turn_id = turn_id.to_string();
        let message_id = uuid::Uuid::new_v4().to_string();
        let returned = message_id.clone();
        let content = text.to_string();

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
                        provider_name: None,
                    },
                    head.as_deref(),
                )?;

                crate::db::ops::turn::begin(conn, &turn_id, &conversation_id, TurnOrigin::ClaudeCode, None, now)?;
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
    ) -> Result<(), String> {
        let state = self.shared.turn.lock().ok().and_then(|mut slot| slot.take());
        let Some(state) = state else {
            drop(lease);
            return Err("the ACP turn lost its state".into());
        };

        let tool_calls_json = (!state.tool_calls.is_empty()).then(|| serialize_tool_calls_openai(&state.tool_calls));
        complete_assistant(
            &services.db,
            &state.assistant_message_id,
            &state.text,
            (!state.reasoning.is_empty()).then_some(state.reasoning.as_str()),
            tool_calls_json.as_deref(),
            None,
            MessageUsage {
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                cache_write_tokens: None,
            },
        )
        .await?;

        // Each result hangs off the one before it, so the path through the tree
        // is the order the calls finished in.
        let mut parent = state.assistant_message_id.clone();
        for (call_id, output, outcome) in &state.results {
            if let Some(id) = append_tool_result(
                &services.db,
                &self.conversation_id,
                turn_id,
                call_id,
                output,
                outcome,
                Some(&parent),
            )
            .await
            {
                parent = id;
            }
        }

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
            "message_id": state.assistant_message_id,
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
