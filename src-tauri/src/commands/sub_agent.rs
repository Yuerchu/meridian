//! Running a delegated turn on the desktop.
//!
//! A cut-down `chat_inner`: the same shape, minus everything a sub-agent does
//! not have. No branch to resolve, no title to generate, no mode to switch, no
//! history — the briefing the parent wrote is the whole conversation.
//!
//! What it does have is a conversation of its own. That is what makes a
//! delegated run diagnosable after a crash, keeps its fifteen rounds out of the
//! parent's context, and means the lease it takes contends with nobody.

use std::sync::Arc;

use diesel::Connection;
use tokio_util::sync::CancellationToken;

use crate::ServicesExt;
use meridian_core::agent::engine::{self, Stranded, SubAgentReport, SubAgentSpec, SubAgentStatus};
use meridian_core::agent::sub_agents::SubAgentKind;
use meridian_core::agent::turn_record;
use meridian_core::db;
use meridian_core::db::DbPool;
use meridian_core::db::models::assistant::Assistant;
use meridian_core::db::models::conversation::NewConversation;
use meridian_core::db::models::message::NewMessage;
use meridian_core::db::models::turn::{ERROR_LOOP_DETECTED, TurnStatus};
use meridian_core::secrets::SecretsManager;
use meridian_core::services::Services;
use meridian_core::state::SubAgentInbox;
use meridian_core::tools::{self, ToolRegistry};
use meridian_core::turn::{TurnLease, TurnOrigin};
use meridian_core::util::{get_conn, now_ms};

/// What an `Explore` agent may do.
///
/// A whitelist rather than a permission rule, because the two answer different
/// questions: a permission decides whether to ask, and asking is exactly what an
/// errand nobody is watching cannot usefully do. The boundary is that none of
/// these can change anything, so there is nothing to ask about.
const EXPLORE_TOOLS: &[&str] = &[
    "read_file",
    "search_files",
    "glob",
    "list_directory",
    "web_search",
    "recall_memory",
    "list_memories",
    "read_app_logs",
];

/// Which model each kind runs on when the caller does not say.
fn default_model_preference(kind: SubAgentKind) -> String {
    format!("sub_agent.{}.model", kind.as_str())
}

/// Say something to a run that is already going.
///
/// Not a turn: it starts nothing, takes no lease and writes no row here. The
/// message goes into the run's inbox and the loop picks it up between rounds,
/// which is what keeps a request from being assembled out of a history
/// something else is appending to.
///
/// `Err` means nobody is reading — the run ended, or there never was one on this
/// conversation. The text is not written anywhere in that case, deliberately:
/// this command holds no lease and no cursor, and a message that was refused
/// should not turn up in the transcript as though it had been received. The
/// caller has it and can say so.
#[tauri::command]
pub async fn steer_conversation(app: tauri::AppHandle, conversation_id: String, text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("There is nothing to send.".to_string());
    }
    match app.services().sub_agent_inboxes.append(&conversation_id, text) {
        meridian_core::state::Accept::Queued => Ok(()),
        meridian_core::state::Accept::Closed(_) => {
            Err("This run has already finished, so it did not see that.".to_string())
        }
    }
}

/// Everything a delegated run needs that the loop does not carry.
///
/// Assembled once per parent turn and borrowed by the port, the same way
/// `PlanTransitions` is: by the time a `run_agent` call arrives, the assistant
/// row, the project and the tool context are hundreds of lines behind.
pub(crate) struct DesktopSubAgents {
    pub services: Services,
    pub pool: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub registry: Arc<ToolRegistry>,
    pub coordinator: Arc<meridian_core::turn::TurnCoordinator>,
    pub mcp: Arc<meridian_core::mcp::McpRegistry>,
    /// Where the card lives.
    pub parent_conversation_id: String,
    /// The turn that delegated. Its cancellation has to reach the child, so the
    /// child is entered under a token derived from this one.
    pub parent_cancel: CancellationToken,
    pub assistant: Option<Assistant>,
    pub project_id: Option<String>,
    /// The parent's, cloned per run with the conversation and the cancellation
    /// swapped. Same derivation as `without_sandbox`, and for the same reason:
    /// everything else about where tools may reach is identical.
    pub tool_context: tools::ToolContext,
    pub files_root: Option<std::path::PathBuf>,
    /// The user's standing yes, on this conversation. Inherited by `Agent` and
    /// never by `Explore` — a read-only errand has nothing to accept edits for,
    /// and inheriting it would be the one way it could grow teeth.
    pub accept_edits: bool,
    pub keep_recent: usize,
}

#[async_trait::async_trait]
impl engine::SubAgents for DesktopSubAgents {
    async fn run(&self, spec: SubAgentSpec) -> Result<SubAgentReport, String> {
        self.delegate(spec).await
    }
}

impl DesktopSubAgents {
    async fn delegate(&self, spec: SubAgentSpec) -> Result<SubAgentReport, String> {
        // Nothing is written until this resolves. A model that does not exist is
        // an ordinary mistake, and the answer to it is a tool result the parent
        // can act on — not a half-built conversation nobody will ever open.
        let (assistant, turn_params) = self.resolve_model(&spec).await?;

        let sub_conversation_id = uuid::Uuid::new_v4().to_string();
        let turn_id = uuid::Uuid::new_v4().to_string();

        // The lease first, and under a token derived from the parent's. Taken
        // after the row existed there would be a window where the database says
        // `running` and the register holds nobody, which every reader — the
        // snapshot, the card, the interruption report — reads as a crash.
        let cancel = self.parent_cancel.child_token();
        let lease = self
            .coordinator
            .try_acquire_turn_with(
                &sub_conversation_id,
                TurnOrigin::SubAgent,
                turn_id.clone(),
                cancel.clone(),
            )
            .map_err(|busy| busy.to_string())?;

        let user_message_id = self
            .open_conversation(&sub_conversation_id, &turn_id, &spec, &assistant)
            .await?;

        let inbox_handle = self.services.sub_agent_inboxes.open(&sub_conversation_id);
        let mut guard = ChildTurnGuard {
            services: self.services.clone(),
            conversation_id: sub_conversation_id.clone(),
            turn_id: turn_id.clone(),
            message_id: None,
            armed: true,
            lease: Some(lease),
            inbox: Some(Arc::clone(&inbox_handle)),
        };

        // Straight away, not when the run ends: without it the card has no
        // conversation to link to and no turn to count steps against for however
        // long the sub-agent takes, which is the whole time the user is looking
        // at it.
        let _ = self.services.events.emit(
            "chat-stream",
            serde_json::json!({
                "type": "sub_agent_started",
                "conversation_id": &self.parent_conversation_id,
                "message_id": &spec.parent_message_id,
                "call_id": &spec.parent_call_id,
                "sub_conversation_id": &sub_conversation_id,
                "spawned_turn_id": &turn_id,
                "kind": spec.kind.as_str(),
                "description": &spec.description,
            }),
        );

        let outcome = self
            .run_loop(
                &spec,
                &assistant,
                &turn_params,
                &sub_conversation_id,
                &turn_id,
                &user_message_id,
                &cancel,
                &inbox_handle,
            )
            .await;

        // One exit. Everything after the transaction committed runs through
        // here, because a `?` that skipped it would leave the row at `running` —
        // which reads as "nobody knows whether it ran" when in fact we do know
        // it failed.
        guard.message_id = outcome.progress.message_id.clone();
        let status = classify(&outcome, &cancel);
        let (stored, error) = match status {
            SubAgentStatus::Done => (TurnStatus::Done, None),
            SubAgentStatus::Cancelled => (TurnStatus::Cancelled, None),
            SubAgentStatus::Aborted => (TurnStatus::Failed, Some(ERROR_LOOP_DETECTED.to_string())),
            SubAgentStatus::Failed => (TurnStatus::Failed, outcome.reply.as_ref().err().cloned()),
        };
        turn_record::finish(&self.pool, &turn_id, stored, error.as_deref()).await;

        // Whatever was typed at the run and never reached it. Closing the inbox
        // is what makes this the last word: nothing can be added after it, so
        // nothing can go missing between here and the report.
        let stranded = self
            .persist_stranded(&sub_conversation_id, &turn_id, outcome.progress.final_cursor.as_deref())
            .await;

        // Sent even when no assistant row was ever written. Anyone with the
        // child's conversation open is sitting on the streaming flag the
        // snapshot's `adoptLiveTurn` set for them, and with no stop it stays set.
        let _ = self.services.events.emit(
            "chat-stream",
            serde_json::json!({
                "type": "stop", "reason": outcome.stop_reason(), "done": true,
                "message_id": outcome.progress.message_id,
                "turn_id": &turn_id,
                "conversation_id": &sub_conversation_id,
                "input_tokens": outcome.progress.input_tokens,
                "output_tokens": outcome.progress.output_tokens,
            }),
        );
        guard.disarm();
        guard.release();

        Ok(SubAgentReport {
            status,
            reply: outcome.reply.unwrap_or_else(|e| e),
            steps: outcome.progress.steps,
            stranded,
        })
    }

    /// Write down what the user typed at a run that had already stopped reading.
    ///
    /// These were accepted: the command said `Ok` and the sender watched their
    /// message go. So they belong in the transcript whatever else happened, and
    /// the parent is told how many there were — a message that was taken and
    /// then silently dropped is the one outcome nobody can act on.
    ///
    /// Hung off `final_cursor` rather than the last assistant row. A turn that
    /// ended on a tool call has that result as its last reachable row, and
    /// attaching here to the assistant row above it would open a branch that
    /// pushes the result off the active path.
    async fn persist_stranded(&self, sub_conversation_id: &str, turn_id: &str, final_cursor: Option<&str>) -> Stranded {
        let leftover = self.services.sub_agent_inboxes.close(sub_conversation_id);
        let mut stranded = Stranded {
            accepted: leftover.len(),
            unrecorded: 0,
        };
        let mut cursor = final_cursor.map(str::to_string);
        for item in leftover {
            match engine::write_steering(
                &self.pool,
                sub_conversation_id,
                turn_id,
                &item.text,
                None,
                cursor.as_deref(),
            )
            .await
            {
                Ok(id) => cursor = Some(id),
                Err(e) => {
                    stranded.unrecorded += 1;
                    tracing::warn!(
                        conversation_id = %sub_conversation_id,
                        error = %e,
                        "a message accepted for a sub-agent could not be written down",
                    );
                }
            }
        }
        stranded
    }

    /// Which provider and model this run uses, and everything derived from it.
    ///
    /// Three answers in order: what the caller named, what the user configured
    /// for this kind, and failing both, whatever the parent is using.
    async fn resolve_model(
        &self,
        spec: &SubAgentSpec,
    ) -> Result<(Assistant, meridian_core::agent::TurnParams), String> {
        let base = self
            .assistant
            .clone()
            .ok_or("This conversation has no assistant, so there is nothing to run a sub-agent on.")?;

        let pool = self.pool.clone();
        let key = default_model_preference(spec.kind);
        let configured = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool).ok()?;
            db::ops::preference::get_preference(&mut conn, &key).ok().flatten()
        })
        .await
        .map_err(|e| e.to_string())?;

        let chosen = spec.model.clone().or(configured).filter(|s| !s.trim().is_empty());
        let (provider_id, model_id) = match chosen.as_deref() {
            Some(q) => {
                let (p, m) = q
                    .split_once(':')
                    .ok_or_else(|| format!("`{q}` is not a model name. Use one of the values listed on `model`."))?;
                (Some(p.to_string()), Some(m.to_string()))
            }
            None => (base.provider_id.clone(), base.model_id.clone()),
        };

        let assistant = effective_assistant(base, spec.kind, provider_id, model_id);
        let params = self.resolve_params(&assistant).await?;
        Ok((assistant, params))
    }

    async fn resolve_params(&self, assistant: &Assistant) -> Result<meridian_core::agent::TurnParams, String> {
        let pool = self.pool.clone();
        let secrets = self.secrets.clone();
        let configured_max = self.assistant.as_ref().and_then(|a| a.max_tokens);
        let assistant = assistant.clone();
        let resolved = {
            let a = assistant.clone();
            let pool2 = pool.clone();
            tokio::task::spawn_blocking(move || {
                meridian_core::agent::resolve_with_overrides(&secrets, &pool2, Some(&a), None, None)
            })
            .await
            .map_err(|e| e.to_string())??
        };
        let provider_id = assistant.provider_id.clone();
        let mut params = tokio::task::spawn_blocking(move || {
            meridian_core::agent::resolve_turn_params(
                &pool,
                meridian_core::agent::TurnParamsInput {
                    assistant: Some(&assistant),
                    provider_id: provider_id.as_deref(),
                    provider_type: &resolved.provider_type,
                    api_format: &resolved.api_format,
                    model: &resolved.model,
                    thinking_level: None,
                    fast: false,
                },
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        // The smaller of what the user asked for and what this model can write.
        // Absent stays absent: leaving the field off is what lets a provider fit
        // the answer to the room it has.
        params.params.max_tokens = clamp_max_tokens(configured_max, params.max_output);
        Ok(params)
    }

    /// The conversation, the briefing and the turn record, in one transaction.
    ///
    /// All three or none. A conversation without its turn row would be a run
    /// that startup reconciliation cannot see; a turn row without its
    /// conversation would be a report about somewhere the user cannot go.
    async fn open_conversation(
        &self,
        sub_conversation_id: &str,
        turn_id: &str,
        spec: &SubAgentSpec,
        assistant: &Assistant,
    ) -> Result<String, String> {
        let pool = self.pool.clone();
        let (conv_id, turn_id) = (sub_conversation_id.to_string(), turn_id.to_string());
        let parent = self.parent_conversation_id.clone();
        let project_id = self.project_id.clone();
        let (message_id, prompt) = (uuid::Uuid::new_v4().to_string(), spec.prompt.clone());
        let (title, kind) = (spec.description.clone(), spec.kind.as_str());
        let (parent_message_id, parent_call_id) = (spec.parent_message_id.clone(), spec.parent_call_id.clone());
        let (assistant_id, provider_id, model_id) = (
            assistant.id.clone(),
            assistant.provider_id.clone(),
            assistant.model_id.clone(),
        );
        let returned = message_id.clone();

        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                db::ops::conversation::insert(
                    conn,
                    NewConversation {
                        id: &conv_id,
                        title: Some(&title),
                        assistant_id: Some(&assistant_id),
                        is_pinned: 0,
                        is_archived: 0,
                        created_at: now,
                        updated_at: now,
                        project_id: project_id.as_deref(),
                        parent_conversation_id: Some(&parent),
                        spawned_by_message_id: Some(&parent_message_id),
                        spawned_by_call_id: Some(&parent_call_id),
                        spawned_turn_id: Some(&turn_id),
                        agent_kind: Some(kind),
                        agent_provider_id: provider_id.as_deref(),
                        agent_model_id: model_id.as_deref(),
                    },
                )?;
                db::ops::message::append_message(
                    conn,
                    &NewMessage {
                        id: &message_id,
                        conversation_id: &conv_id,
                        role: "user",
                        content: &prompt,
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
                        parent_id: None,
                        compact_anchor_id: None,
                        source: None,
                        turn_id: Some(&turn_id),
                        tool_outcome: None,
                        // The delegating prompt, not a reply: no upstream was
                        // asked anything to produce it.
                        cache_read_tokens: None,
                        cache_write_tokens: None,
                        server_tool_calls: None,
                        provider_name: None,
                    },
                    None,
                )?;
                // The synchronous op, not `turn_record::begin`: that one opens
                // its own blocking task and so its own connection, which would
                // put this row outside the transaction the other two are in.
                db::ops::turn::begin(conn, &turn_id, &conv_id, TurnOrigin::SubAgent, None, now)?;
                Ok(())
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        Ok(returned)
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_loop(
        &self,
        spec: &SubAgentSpec,
        assistant: &Assistant,
        turn_params: &meridian_core::agent::TurnParams,
        sub_conversation_id: &str,
        turn_id: &str,
        user_message_id: &str,
        cancel: &CancellationToken,
        inbox: &SubAgentInbox,
    ) -> engine::TurnOutcome {
        let config = match self.build_config(assistant, sub_conversation_id, turn_params).await {
            Ok(c) => c,
            Err(e) => return engine::TurnOutcome::failed(e),
        };

        let provider = match self.build_provider(assistant).await {
            Ok(p) => p,
            Err(e) => return engine::TurnOutcome::failed(e),
        };

        let chat_messages = meridian_core::agent::build_messages_with_senders(
            config.system_prompt.trim(),
            &db::ops::message::ActiveContext {
                path: Vec::new(),
                summary: None,
                anchor_index: None,
                head_id: None,
            },
            meridian_core::agent::trailing_with_memory(None, None, &spec.prompt, None),
            &Default::default(),
        );

        let mut budget = meridian_core::agent::TokenBudget::new(
            &provider.1.provider_type,
            &turn_params.params.model,
            turn_params.context_limit,
            turn_params.max_output,
            turn_params.compact_threshold,
        );
        budget.update_estimate(&chat_messages);

        // Asked on the parent's card. Nobody is necessarily looking at this
        // conversation — it does not even appear in the sidebar — so a question
        // left here would stall the run until someone cancelled it.
        let approvals = super::approval_adapter::DesktopApprovals {
            services: self.services.clone(),
            cancel: cancel.clone(),
            turn_id: turn_id.to_string(),
            conversation_id: sub_conversation_id.to_string(),
            bubble: Some(meridian_core::state::Bubble {
                conversation_id: self.parent_conversation_id.clone(),
                assistant_message_id: spec.parent_message_id.clone(),
                parent_call_id: spec.parent_call_id.clone(),
                sub_conversation_id: sub_conversation_id.to_string(),
            }),
        };
        let emitter = SubAgentEmit(self.services.events.clone());
        let tool_context = tools::ToolContext {
            conversation_id: Some(sub_conversation_id.to_string()),
            turn_id: Some(turn_id.to_string()),
            cancel: cancel.clone(),
            ..self.tool_context.clone()
        };

        engine::run_turn(
            &engine::TurnServices {
                pool: &self.pool,
                tools: &self.registry,
                mcp: &self.mcp,
            },
            engine::TurnSetup {
                provider: &*provider.0,
                params: turn_params.params.clone(),
                chat_messages,
                tool_defs: config.tool_defs,
                offered: config.offered,
                mode: meridian_core::agent::modes::Modes::Fixed.spec(),
                tool_context,
                budget,
                turn_id: turn_id.to_string(),
                conversation_id: sub_conversation_id.to_string(),
                // The child's own, not the parent's: a delegated run can be
                // pointed at a different endpoint entirely, and the same value is
                // already stored on the sub-conversation as `agent_provider_id`.
                provider_id: Some(provider.1.provider_id.clone()),
                provider_name: Some(provider.1.provider_name.clone()),
                parent_cursor: Some(user_message_id.to_string()),
                cancel: cancel.clone(),
                keep_recent: self.keep_recent,
                context_limit: turn_params.context_limit,
                // Both kinds go through reach. `Explore` differs by never
                // inheriting the standing yes — not by refusing everything,
                // which would stop it reading a file: `read_file` declares
                // `Ask`, and only reach knows that reading inside the project
                // is not worth interrupting anyone for.
                approval_rule: engine::ApprovalRule::ByReach {
                    accept_edits: self.accept_edits && spec.kind == SubAgentKind::Agent,
                },
                withheld: engine::WithheldWording::Explained,
                files_root: self.files_root.clone(),
                // A sub-agent's conversation is one turn old. There is nothing
                // behind it that could have been cut off.
                interrupted: None,
                compaction: engine::CompactionPolicy::Desktop {
                    enabled: true,
                    breaker: Arc::new(meridian_core::agent::CompactCircuitBreaker::new()),
                },
                // A delegated run reports its tokens to the card that launched
                // it; its spend reaches the bill through the audit log.
                pricing: None,
            },
            engine::TurnPorts {
                emit: Some(&emitter),
                approvals: &approvals,
                interim: None,
                surface_tools: None,
                // The sub-agent's conversation is open and writable while it
                // runs, and what gets typed there is meant for the run rather
                // than for a turn after it.
                steering: Some(inbox),
                transitions: None,
                // The one that matters: a delegated run is handed no way to
                // delegate, so nesting is not something anyone has to remember
                // to check for.
                sub_agents: None,
            },
        )
        .await
    }

    async fn build_config(
        &self,
        assistant: &Assistant,
        sub_conversation_id: &str,
        turn_params: &meridian_core::agent::TurnParams,
    ) -> Result<meridian_core::agent::turn_config::TurnConfig, String> {
        let mcp_defs = if assistant.tool_preset_id.is_none() && assistant.enabled_tools.is_some() {
            // `Explore` — an explicit whitelist and nothing outside it. MCP
            // tools ask unconditionally, and an errand nobody is watching has
            // nowhere useful to put the question.
            Vec::new()
        } else {
            self.mcp.tool_definitions().as_ref().clone()
        };
        let input = meridian_core::agent::turn_config::TurnConfigInput {
            assistant: Some(assistant.clone()),
            server_tools: turn_params.params.server_tools.clone(),
            conversation_id: sub_conversation_id.to_string(),
            project_id: self.project_id.clone(),
            mode: meridian_core::agent::modes::Modes::Fixed,
            // No port, so no `run_agent`. This is the nesting guard again, on
            // the other side: the tool is not offered, so the name is not even
            // recognised.
            sub_agents: None,
            mcp_defs,
            // The child model's answer, not the parent's. They can differ, and
            // handing a model tools it cannot call earns a 400.
            exposure: meridian_core::agent::turn_config::ToolExposure::when(turn_params.caps.supports_tools),
            persona: assistant.system_prompt.clone(),
            context_blocks: Vec::new(),
        };
        let pool = self.pool.clone();
        let registry = self.registry.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            Ok::<_, String>(meridian_core::agent::turn_config::resolve(&mut conn, &registry, input))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// The provider instance, and the provider type the token counter needs.
    async fn build_provider(
        &self,
        assistant: &Assistant,
    ) -> Result<
        (
            Box<dyn meridian_core::provider::ChatProvider>,
            meridian_core::agent::ResolvedProvider,
        ),
        String,
    > {
        let pool = self.pool.clone();
        let secrets = self.secrets.clone();
        let a = assistant.clone();
        let resolved = tokio::task::spawn_blocking(move || {
            meridian_core::agent::resolve_with_overrides(&secrets, &pool, Some(&a), None, None)
        })
        .await
        .map_err(|e| e.to_string())??;
        let provider = meridian_core::provider::registry::create_provider(
            &resolved.provider_type,
            &resolved.base_url,
            &resolved.api_key,
            Some(&resolved.api_format),
        );
        // The whole resolution travels back, not just the type: the rows this run
        // writes record which upstream answered, and a sub-agent can be pointed
        // at a different one than its parent.
        Ok((provider, resolved))
    }
}

/// The parent's assistant, adjusted for what this run is allowed to be.
///
/// Three of the changes exist to stop a value meant for the parent's model being
/// applied to a different one:
///
/// * `context_limit` is cleared so the window comes from the model rather than
///   from a number the user set beside a 200K model. Left in, a sub-agent on a
///   64K model would fill its window before anything noticed.
/// * `max_tokens` is cleared here and re-applied against the child model's own
///   ceiling once that is known. Nothing else clamps it — `filter_params` does
///   not look at it and `reply_ceiling` only measures the prompt — so a 64K
///   output allowance would otherwise reach an 8K model intact.
/// * `tool_preset_id` is cleared for `Explore`, because a preset wins over an
///   explicit list (`turn_config::enabled_tools`). Left set, a parent whose
///   assistant uses a preset containing write tools would hand them to an agent
///   whose whole definition is that it cannot change anything.
fn effective_assistant(
    base: Assistant,
    kind: SubAgentKind,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Assistant {
    let mut a = Assistant {
        provider_id,
        model_id,
        context_limit: 0,
        max_tokens: None,
        ..base
    };
    if kind == SubAgentKind::Explore {
        a.tool_preset_id = None;
        a.enabled_tools = serde_json::to_string(EXPLORE_TOOLS).ok();
    }
    a
}

/// The smaller of what the user asked for and what this model can write.
///
/// Absent stays absent: leaving the field off is what lets a provider fit the
/// answer to the room it has, and a number invented here would be a ceiling
/// nobody asked for.
fn clamp_max_tokens(configured: Option<i32>, model_ceiling: usize) -> Option<i32> {
    configured.map(|m| m.min(model_ceiling as i32))
}

/// How a delegated run ended, decided once.
///
/// The same judgement feeds the stored status and the verdict the parent's model
/// is given, so the row and the answer cannot disagree about what happened.
fn classify(outcome: &engine::TurnOutcome, cancel: &CancellationToken) -> SubAgentStatus {
    if outcome.reply.is_err() {
        SubAgentStatus::Failed
    } else if outcome.progress.aborted {
        SubAgentStatus::Aborted
    } else if cancel.is_cancelled() {
        SubAgentStatus::Cancelled
    } else {
        SubAgentStatus::Done
    }
}

/// A sub-agent's events go to a window that may not be looking.
///
/// Nobody has to have the child's conversation open — usually nobody does — so a
/// send that fails is not the run failing. The parent's card is fed by the
/// snapshot and by the tool result, neither of which is an event. That is why
/// this swallows what `BusEmit` would report: the bus speaks for the window,
/// which is critical for a turn the user is watching and irrelevant to this one.
struct SubAgentEmit(meridian_core::events::EventBus);

impl engine::Emit for SubAgentEmit {
    fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
        let _ = self.0.emit(channel, payload);
        Ok(())
    }
}

/// Everything a delegated run owes back, whichever way it leaves.
///
/// `TurnGuard`'s counterpart, and for the same reason: once the conversation
/// exists, every exit — an early `?`, a panic, a cancellation — has to stop the
/// child's conversation looking like it is still streaming, or the user opens it
/// and finds a spinner nothing will ever clear.
///
/// It deliberately writes nothing to `turns`. A destructor does not run for a
/// kill, so leaving the row at `running` *is* the record; the epilogue writes
/// the ending for every path that has one.
struct ChildTurnGuard {
    services: Services,
    conversation_id: String,
    turn_id: String,
    message_id: Option<String>,
    armed: bool,
    lease: Option<TurnLease>,
    inbox: Option<Arc<SubAgentInbox>>,
}

impl ChildTurnGuard {
    fn release(&mut self) {
        self.lease.take();
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ChildTurnGuard {
    fn drop(&mut self) {
        // The parent's guard sweeps by the parent's turn id and so cannot see
        // these. Left behind, they are cards whose buttons reach a receiver that
        // has gone.
        self.services
            .approvals
            .lock()
            .retain(|_, pending| pending.turn_id != self.turn_id);
        if self.inbox.take().is_some() {
            let stranded = self.services.sub_agent_inboxes.close(&self.conversation_id);
            if !stranded.is_empty() {
                // Nothing can be written from here — a destructor may run while
                // the runtime is going down. The count is the diagnosis; the
                // epilogue is where accepted messages get accounted for.
                tracing::warn!(
                    conversation_id = %self.conversation_id,
                    count = stranded.len(),
                    "a sub-agent ended with messages still in its inbox",
                );
            }
        }
        // Before the event, not after: the same ordering the desktop guard keeps,
        // so a stop never reaches a window while the conversation still reads as
        // occupied.
        self.lease.take();
        if self.armed {
            let _ = self.services.events.emit(
                "chat-stream",
                serde_json::json!({
                    "type": "stop", "reason": "error", "done": true,
                    "message_id": self.message_id,
                    "turn_id": self.turn_id,
                    "conversation_id": self.conversation_id,
                }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::agent::modes::Modes;
    use meridian_core::agent::turn_config::{TurnConfigInput, resolve};
    use meridian_core::db::test_db;

    fn parent(preset: Option<&str>, enabled: Option<&str>) -> Assistant {
        Assistant {
            id: "a1".into(),
            name: "A".into(),
            description: None,
            avatar: None,
            system_prompt: "You are helpful.".into(),
            provider_id: Some("p1".into()),
            model_id: Some("big-model".into()),
            temperature: Some(0.7),
            top_p: None,
            max_tokens: Some(64_000),
            is_default: 0,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            context_limit: 200_000,
            compact_keep_recent: 10,
            enabled_tools: enabled.map(str::to_string),
            thinking_enabled: 0,
            thinking_budget: None,
            tool_preset_id: preset.map(str::to_string),
            auto_compact_enabled: 0,
        }
    }

    fn registry() -> ToolRegistry {
        ToolRegistry::new(
            std::path::PathBuf::from("/nonexistent"),
            std::path::PathBuf::from("/nonexistent"),
        )
    }

    fn config_for(child: Assistant) -> meridian_core::agent::turn_config::TurnConfig {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        meridian_core::db::ops::conversation::create_conversation(&mut conn, "sub-1", None, None, None, 1).unwrap();
        resolve(
            &mut conn,
            &registry(),
            TurnConfigInput {
                assistant: Some(child),
                server_tools: Vec::new(),
                conversation_id: "sub-1".into(),
                project_id: None,
                mode: Modes::Fixed,
                sub_agents: None,
                mcp_defs: Vec::new(),
                exposure: meridian_core::agent::turn_config::ToolExposure::All,
                persona: String::new(),
                context_blocks: Vec::new(),
            },
        )
    }

    /// The parent's numbers describe the parent's model. Carried over, a
    /// sub-agent on a smaller one fills its window before anything notices, and
    /// asks for an output allowance the model has to refuse.
    #[test]
    fn the_parents_window_and_allowance_do_not_follow_the_child() {
        let child = effective_assistant(
            parent(None, None),
            SubAgentKind::Agent,
            Some("p2".into()),
            Some("small-model".into()),
        );

        assert_eq!(child.context_limit, 0, "so the window comes from the model");
        assert_eq!(child.max_tokens, None, "re-applied against the child's own ceiling");
        assert_eq!(child.model_id.as_deref(), Some("small-model"));
        assert_eq!(child.provider_id.as_deref(), Some("p2"));
        // What describes the assistant rather than the model stays put.
        assert_eq!(child.temperature, Some(0.7));
        assert_eq!(child.compact_keep_recent, 10);
    }

    #[test]
    fn an_output_allowance_is_the_smaller_of_the_two_and_absence_stays_absent() {
        assert_eq!(clamp_max_tokens(Some(64_000), 8_192), Some(8_192));
        assert_eq!(clamp_max_tokens(Some(4_096), 8_192), Some(4_096));
        assert_eq!(clamp_max_tokens(None, 8_192), None, "nothing is invented here");
    }

    /// Why `tool_preset_id` is cleared rather than `enabled_tools` merely being
    /// overwritten. A preset wins over an explicit list, so a parent configured
    /// with one would hand its contents — writes included — to an agent whose
    /// whole definition is that it cannot change anything.
    #[test]
    fn a_read_only_agent_keeps_its_whitelist_even_when_the_parent_uses_a_preset() {
        let child = effective_assistant(
            parent(Some("a-preset-with-writes"), None),
            SubAgentKind::Explore,
            None,
            None,
        );
        assert_eq!(child.tool_preset_id, None);

        let offered = config_for(child).offered;
        assert!(offered.contains("read_file"), "an explorer that cannot read is useless");
        for writer in ["write_file", "edit_file", "apply_patch", "delete_file", "run_command"] {
            assert!(!offered.contains(writer), "{writer} reached a read-only agent");
        }
        // The nesting guard, from the other side: not offered, so not recognised.
        assert!(!offered.contains(meridian_core::agent::sub_agents::RUN_AGENT_TOOL));
        assert!(!offered.contains("enter_plan"), "a fixed mode has nowhere to go");
    }

    /// A working agent is the assistant's own tool set, minus the two a
    /// sub-agent has no use for.
    #[test]
    fn a_working_agent_inherits_the_assistants_tools() {
        let child = effective_assistant(parent(None, None), SubAgentKind::Agent, None, None);
        assert!(
            child.enabled_tools.is_none(),
            "an unrestricted parent stays unrestricted"
        );

        let offered = config_for(child).offered;
        assert!(offered.contains("write_file"), "it is the one that may change things");
        assert!(!offered.contains(meridian_core::agent::sub_agents::RUN_AGENT_TOOL));
        assert!(!offered.contains("enter_plan"));
    }

    /// One judgement, used twice. The stored status and the verdict the parent's
    /// model reads come from the same call, so a row saying `done` above a reply
    /// the model was told is partial cannot happen.
    #[test]
    fn how_a_run_ended_is_decided_once() {
        let ended = |reply: Result<String, String>, aborted: bool, stopped: bool| {
            let cancel = CancellationToken::new();
            if stopped {
                cancel.cancel();
            }
            classify(
                &engine::TurnOutcome {
                    reply,
                    progress: engine::TurnProgress {
                        aborted,
                        ..Default::default()
                    },
                },
                &cancel,
            )
        };

        assert_eq!(ended(Ok("done".into()), false, false), SubAgentStatus::Done);
        assert_eq!(ended(Ok("half".into()), false, true), SubAgentStatus::Cancelled);
        assert_eq!(
            ended(Ok("round and round".into()), true, false),
            SubAgentStatus::Aborted
        );
        assert_eq!(ended(Err("no key".into()), false, false), SubAgentStatus::Failed);
        // A failure while cancelled is still a failure: the error is the more
        // specific thing to report.
        assert_eq!(ended(Err("no key".into()), false, true), SubAgentStatus::Failed);

        // And only one of them is a successful tool call.
        assert_eq!(SubAgentStatus::Done.outcome(), "success");
        for bad in [
            SubAgentStatus::Cancelled,
            SubAgentStatus::Aborted,
            SubAgentStatus::Failed,
        ] {
            assert_eq!(bad.outcome(), "error", "{bad:?}");
        }
    }

    #[test]
    fn each_kind_reads_its_own_configured_default() {
        assert_eq!(
            default_model_preference(SubAgentKind::Explore),
            "sub_agent.explore.model"
        );
        assert_eq!(default_model_preference(SubAgentKind::Agent), "sub_agent.agent.model");
    }
}
