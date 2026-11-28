//! Desktop Tauri glue for delegated sub-agent runs.
//!
//! The runner itself lives in [`meridian_core::agent::sub_agent_runner::CoreSubAgentRunner`],
//! shared by the desktop shell and headless/server deployments. This module keeps
//! only the Tauri steering command and the desktop bubble-approval factory.

use crate::ServicesExt;
use meridian_core::agent::engine;
use meridian_core::agent::sub_agent_runner::{ApprovalsFactory, SubAgentApprovalContext};
use meridian_core::services::Services;

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationSteerRequest {
    conversation_id: String,
    text: String,
}

/// Say something to a run that is already going.
///
/// Not a turn: it starts nothing, takes no lease and writes no row here. The
/// message goes into the run's inbox and the loop picks it up between rounds,
/// which is what keeps a request from being assembled out of a history
/// something else is appending to.
#[tauri::command]
pub async fn send_conversation_steer(app: tauri::AppHandle, request: ConversationSteerRequest) -> Result<(), String> {
    let ConversationSteerRequest { conversation_id, text } = request;
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

/// Desktop approval factory that bubbles sub-agent approval prompts onto the
/// parent conversation's sub-agent card.
pub(crate) struct DesktopApprovalsFactory {
    pub services: Services,
}

impl ApprovalsFactory for DesktopApprovalsFactory {
    fn build(&self, ctx: SubAgentApprovalContext<'_>) -> Box<dyn engine::Approvals> {
        Box::new(super::approval_adapter::DesktopApprovals {
            services: self.services.clone(),
            cancel: ctx.cancel,
            turn_id: ctx.turn_id.to_string(),
            conversation_id: ctx.sub_conversation_id.to_string(),
            bubble: Some(meridian_core::state::Bubble {
                conversation_id: ctx.parent_conversation_id.to_string(),
                assistant_message_id: ctx.parent_message_id.to_string(),
                parent_call_id: ctx.parent_call_id.to_string(),
                sub_conversation_id: ctx.sub_conversation_id.to_string(),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_steer_request_is_named_and_strict() {
        let request: ConversationSteerRequest = serde_json::from_value(serde_json::json!({
            "conversation_id": "conversation-1",
            "text": "check the failing test",
        }))
        .expect("valid steer request");
        assert_eq!(request.conversation_id, "conversation-1");
        assert_eq!(request.text, "check the failing test");

        assert!(
            serde_json::from_value::<ConversationSteerRequest>(serde_json::json!({
                "conversation_id": "conversation-1",
                "text": "check the failing test",
                "urgent": true,
            }))
            .is_err()
        );
    }
}
