//! How the desktop asks, and waits.
//!
//! One asker, not two. A delegated run's questions surface on the card that
//! spawned it rather than in the conversation nobody is watching, and that is
//! the *only* difference — so it is one optional field rather than a second
//! implementation. Written twice, the two would drift the way every pair in this
//! codebase has, and the half that drifted here would decide whether a command
//! runs.

use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::agent::engine::{self, ApprovalDecision};
use crate::db::models::turn::TurnPhase;
use crate::provider;
use crate::services::Services;
use crate::state::Bubble;

/// The desktop's way of asking: a card in the window, and a wait that ends when
/// the user answers or the turn is cancelled.
///
/// Holds the turn's identity rather than taking it per call, because everything
/// except which row is asking is fixed for the whole turn. `Err` here ends the
/// turn, and only this adapter can produce one: drawing the card *is* an event,
/// so a send that fails means the user is looking at a question that will never
/// appear.
pub(crate) struct DesktopApprovals {
    pub services: Services,
    pub cancel: CancellationToken,
    pub turn_id: String,
    /// Where the call happens. Still the sub-agent's own conversation for a
    /// delegated run — `bubble` is what says where it is asked.
    pub conversation_id: String,
    /// `None` for a turn the user started themselves.
    pub bubble: Option<Bubble>,
}

#[async_trait::async_trait]
impl engine::Approvals for DesktopApprovals {
    async fn ask(
        &self,
        assistant_message_id: &str,
        call: &provider::ToolCall,
        retry_reason: Option<&str>,
    ) -> Result<Option<ApprovalDecision>, String> {
        self.wait_for_approval(call, assistant_message_id, retry_reason).await
    }
}

impl DesktopApprovals {
    /// Put a tool call in front of the user and wait for their answer. Returns
    /// `None` when the chat is cancelled (stop button) before a decision
    /// arrives, so approval waits cannot outlive the conversation.
    ///
    /// Brackets the wait with the turn's phase, so a process killed while the
    /// card is on screen is diagnosed as "stopped waiting for you" rather than
    /// as something that might have run.
    ///
    /// `retry_reason` is set when a sandbox-blocked command is asking to be run
    /// again without the sandbox. It retries the same call under the same id —
    /// the approval is what is new, and that gets its own `approval_id`.
    async fn wait_for_approval(
        &self,
        tc: &provider::ToolCall,
        message_id: &str,
        retry_reason: Option<&str>,
    ) -> Result<Option<ApprovalDecision>, String> {
        let services = &self.services;
        // Ours, not the provider's. See `PendingApproval` for what reusing the
        // tool call id used to cost.
        let approval_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        // Registered before the event goes out, so a decision can never arrive
        // before there is somewhere to put it.
        {
            services.approvals.lock().insert(
                approval_id.clone(),
                crate::state::PendingApproval {
                    conversation_id: self.conversation_id.clone(),
                    turn_id: self.turn_id.clone(),
                    assistant_message_id: message_id.to_string(),
                    provider_call_id: tc.id.clone(),
                    // A retry is an attempt at the same call, under the same id.
                    origin_call_id: retry_reason.map(|_| tc.id.clone()),
                    tool_name: tc.name.clone(),
                    arguments: tc.arguments.clone(),
                    retry_reason: retry_reason.map(str::to_string),
                    bubble: self.bubble.clone(),
                    sender: tx,
                },
            );
        }
        // Routed to whoever is watching. For a delegated run that is the parent:
        // the sub-agent's conversation may not even be open, and a question
        // nobody sees is a turn that stalls until it is cancelled.
        let mut payload = serde_json::json!({
            "type": "tool_approval_req",
            "approval_id": approval_id,
            "call_id": tc.id,
            "tool_name": tc.name,
            "arguments": tc.arguments,
            "message_id": self.bubble.as_ref().map_or(message_id, |b| &b.assistant_message_id),
            "conversation_id":
                self.bubble.as_ref().map_or(&self.conversation_id, |b| &b.conversation_id),
        });
        // Which `run_agent` card to hang it under, and where the run itself can
        // be watched. Their presence is what tells the card this is a delegated
        // call rather than one of its own.
        if let Some(b) = &self.bubble {
            payload["parent_call_id"] = serde_json::json!(b.parent_call_id);
            payload["sub_conversation_id"] = serde_json::json!(b.sub_conversation_id);
        }
        // The reason's presence is the flag; a separate boolean beside it could
        // only ever disagree with it.
        if let Some(reason) = retry_reason {
            payload["retry_reason"] = serde_json::json!(reason);
            payload["origin_call_id"] = serde_json::json!(tc.id);
        }
        if let Err(e) = services.events.emit("chat-stream", payload) {
            // Nobody will ever answer a card that was never drawn; don't leave
            // the entry behind for the turn guard to find.
            services.approvals.lock().remove(&approval_id);
            return Err(e);
        }
        // After the card is on screen, so the recorded phase is never ahead of
        // what the user can actually see.
        let pool = services.db.clone();
        // The bracket restores `Streaming` however the wait ends — leaving the
        // phase behind would have a crash a minute later report a card that is
        // no longer on screen.
        let decision = engine::in_phase(
            &pool,
            &self.turn_id,
            TurnPhase::AwaitingApproval,
            Some(&tc.name),
            async {
                let decision = tokio::select! {
                    _ = self.cancel.cancelled() => None,
                    r = rx => r.ok(),
                };
                if decision.is_none() {
                    // Cancelled, or the sender was dropped. Take the entry out
                    // so a late answer cannot land on a turn that has already
                    // moved on.
                    services.approvals.lock().remove(&approval_id);
                }
                decision
            },
        )
        .await;
        Ok(decision)
    }
}
