use tauri::Manager;

use crate::state::{ApprovalDecision, ApprovalWaiters};

/// Hand a decision to the turn waiting on it.
///
/// `approval_id` is the one the backend minted when it drew the card, not the
/// provider's tool call id — see `PendingApproval`.
///
/// Missing entry is an error, not a no-op. It means the turn is gone: cancelled,
/// already answered, or lost with the process. Reporting success there is what
/// made a dead approval card look like a live one, so the front end could keep
/// clicking a button that would never do anything.
fn decide(
    app: &tauri::AppHandle,
    approval_id: &str,
    decision: ApprovalDecision,
) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let entry = waiters.lock().remove(approval_id);
    match entry {
        Some(pending) => {
            // The receiver is gone when the turn stopped waiting between our
            // lookup and now. Same situation as a missing entry from the
            // caller's point of view.
            pending.sender.send(decision)
                .map_err(|_| "that turn is no longer waiting for an answer".to_string())
        }
        None => Err("that request is no longer waiting for an answer".to_string()),
    }
}

#[tauri::command]
pub async fn approve_tool_call(app: tauri::AppHandle, approval_id: String) -> Result<(), String> {
    decide(&app, &approval_id, ApprovalDecision::Approved)
}

#[tauri::command]
pub async fn deny_tool_call(
    app: tauri::AppHandle,
    approval_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    decide(&app, &approval_id, ApprovalDecision::Denied(reason))
}

#[tauri::command]
pub async fn respond_to_ask(
    app: tauri::AppHandle,
    approval_id: String,
    response: String,
) -> Result<(), String> {
    decide(&app, &approval_id, ApprovalDecision::Response(response))
}

/// Enough to redraw a card that is still waiting for an answer.
///
/// `retry_reason` is left out rather than sent empty when this is not a
/// sandbox escalation: the card tells the two apart by whether the field is
/// there at all.
#[derive(serde::Serialize)]
pub struct PendingApprovalInfo {
    pub approval_id: String,
    pub assistant_message_id: String,
    pub provider_call_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_call_id: Option<String>,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_reason: Option<String>,
}

/// Which of this conversation's tool calls are still waiting on the user.
///
/// The transcript alone cannot answer that. A call with no matching tool row is
/// either waiting, or was abandoned when its turn died — and those look
/// identical in the database. This is the live half of the answer.
/// Synchronous on purpose. The guard is a `std::sync::MutexGuard` and must not
/// be held across an await; a function that cannot await cannot hold it across
/// one.
///
/// Not a command any more. It was one, and the caller had to pair it with two
/// separate reads of the database and hope nothing moved between the three —
/// `conversation_snapshot` asks for all of it at once and calls this last, so
/// every approval belonging to a row it read is in the answer.
pub(crate) fn pending_for(
    app: &tauri::AppHandle,
    conversation_id: &str,
) -> Vec<PendingApprovalInfo> {
    let waiters = app.state::<ApprovalWaiters>();
    let map = waiters.lock();
    map.iter()
        .filter(|(_, p)| p.conversation_id == conversation_id)
        .map(|(id, p)| PendingApprovalInfo {
            approval_id: id.clone(),
            assistant_message_id: p.assistant_message_id.clone(),
            provider_call_id: p.provider_call_id.clone(),
            origin_call_id: p.origin_call_id.clone(),
            tool_name: p.tool_name.clone(),
            retry_reason: p.retry_reason.clone(),
        })
        .collect()
}
