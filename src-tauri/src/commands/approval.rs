use tauri::Manager;

use crate::agent::engine::ApprovalDecision;
use crate::state::ApprovalWaiters;

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
    /// The row the card hangs off *in the conversation that asked for this
    /// list*. For a delegated run the parent sees its own `run_agent` row and
    /// the sub-agent sees the row the call is actually on.
    pub assistant_message_id: String,
    pub provider_call_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_call_id: Option<String>,
    pub tool_name: String,
    /// What the call was made with. Sent even though an ordinary card could
    /// read it off the transcript, because a bubbled one cannot: that row is in
    /// another conversation.
    pub arguments: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_reason: Option<String>,
    /// This approval belongs to a delegated run and is being shown where it is
    /// *happening*, not where it can be answered. The card draws itself without
    /// buttons.
    pub bubbled: bool,
    /// Which `run_agent` call to hang the card under. Present only in the
    /// parent's view, which is the only place it means anything.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_call_id: Option<String>,
    /// Where the delegated run can be watched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_conversation_id: Option<String>,
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
///
/// A delegated run's approval appears in *two* conversations, and differently in
/// each: answerable on the parent's `run_agent` card, and read-only in the
/// sub-agent's own transcript, where the call really is. Both are the same
/// `approval_id`, so there is exactly one place it can be answered from and no
/// race between two cards.
pub(crate) fn pending_for(
    app: &tauri::AppHandle,
    conversation_id: &str,
) -> Vec<PendingApprovalInfo> {
    let waiters = app.state::<ApprovalWaiters>();
    let map = waiters.lock();
    views_for(&map, conversation_id)
}

/// The half of `pending_for` that is only about the register's contents.
///
/// Split out because the rule it encodes — one approval, two conversations,
/// different in each — is worth pinning down without a running application
/// around it.
fn views_for(
    map: &std::collections::HashMap<String, crate::state::PendingApproval>,
    conversation_id: &str,
) -> Vec<PendingApprovalInfo> {
    let mut out = Vec::new();
    for (id, p) in map.iter() {
        // Where the call is happening. Ordinary approvals only ever match here.
        if p.conversation_id == conversation_id {
            out.push(PendingApprovalInfo {
                approval_id: id.clone(),
                assistant_message_id: p.assistant_message_id.clone(),
                provider_call_id: p.provider_call_id.clone(),
                origin_call_id: p.origin_call_id.clone(),
                tool_name: p.tool_name.clone(),
                arguments: p.arguments.clone(),
                retry_reason: p.retry_reason.clone(),
                bubbled: p.bubble.is_some(),
                parent_call_id: None,
                sub_conversation_id: None,
            });
        }
        // Where it is asked. The card names the parent's own row and call, so
        // that the approval lands inside the `run_agent` block rather than
        // arriving as a tool call the parent never made.
        if let Some(b) = &p.bubble {
            if b.conversation_id == conversation_id {
                out.push(PendingApprovalInfo {
                    approval_id: id.clone(),
                    assistant_message_id: b.assistant_message_id.clone(),
                    provider_call_id: p.provider_call_id.clone(),
                    origin_call_id: p.origin_call_id.clone(),
                    tool_name: p.tool_name.clone(),
                    arguments: p.arguments.clone(),
                    retry_reason: p.retry_reason.clone(),
                    bubbled: false,
                    parent_call_id: Some(b.parent_call_id.clone()),
                    sub_conversation_id: Some(b.sub_conversation_id.clone()),
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Bubble, PendingApproval};
    use std::collections::HashMap;

    /// One approval in the register, as a delegated run would leave it.
    fn registered(
        map: &mut HashMap<String, PendingApproval>,
        approval_id: &str,
        call_id: &str,
        bubble: Option<Bubble>,
    ) {
        // The receiver goes away immediately; nothing here answers anything, and
        // building the views never touches the channel.
        let (tx, _rx) = tokio::sync::oneshot::channel();
        map.insert(approval_id.to_string(), PendingApproval {
            conversation_id: "sub-1".into(),
            turn_id: "child-turn".into(),
            assistant_message_id: "child-row".into(),
            provider_call_id: call_id.into(),
            origin_call_id: None,
            tool_name: "run_command".into(),
            arguments: r#"{"command":"cargo test --all"}"#.into(),
            retry_reason: None,
            bubble,
            sender: tx,
        });
    }

    fn bubble(parent_call_id: &str) -> Bubble {
        Bubble {
            conversation_id: "parent-1".into(),
            assistant_message_id: "parent-row".into(),
            parent_call_id: parent_call_id.into(),
            sub_conversation_id: "sub-1".into(),
        }
    }

    /// The same question, in the two places it is visible: answerable where the
    /// person is looking, and stated where it is actually happening.
    #[test]
    fn a_delegated_approval_is_answerable_on_the_parent_and_read_only_on_the_child() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "0", Some(bubble("call-run-agent")));

        let on_parent = views_for(&map, "parent-1");
        assert_eq!(on_parent.len(), 1);
        assert!(!on_parent[0].bubbled, "the parent is where it gets answered");
        assert_eq!(on_parent[0].parent_call_id.as_deref(), Some("call-run-agent"));
        assert_eq!(on_parent[0].sub_conversation_id.as_deref(), Some("sub-1"));
        // The parent's own row, not the sub-agent's: that is the card it hangs
        // under, and the parent's transcript has never heard of the other one.
        assert_eq!(on_parent[0].assistant_message_id, "parent-row");

        let on_child = views_for(&map, "sub-1");
        assert_eq!(on_child.len(), 1);
        assert!(on_child[0].bubbled, "the child may show it but not answer it");
        assert_eq!(on_child[0].assistant_message_id, "child-row");
        assert!(on_child[0].parent_call_id.is_none());

        // One id, so there is exactly one place an answer can come from.
        assert_eq!(on_parent[0].approval_id, on_child[0].approval_id);
    }

    /// Why `arguments` is stored rather than read back off the transcript. The
    /// call is written on a row in the sub-agent's conversation; the parent,
    /// which is where the card is, cannot reach it. Without this a reload turns
    /// "run `cargo test --all`?" into an unlabelled yes/no.
    #[test]
    fn the_parent_can_still_say_what_it_is_approving_after_a_reload() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "0", Some(bubble("call-run-agent")));

        let on_parent = views_for(&map, "parent-1");
        assert_eq!(on_parent[0].arguments, r#"{"command":"cargo test --all"}"#);
        assert_eq!(on_parent[0].tool_name, "run_command");
    }

    /// Two delegated runs under one parent, both handed `"0"` by the gateway.
    /// The pair that names a card is the row *and* the call, so they land on
    /// their own `run_agent` blocks instead of both on the first one.
    #[test]
    fn two_runs_sharing_a_provider_call_id_land_on_their_own_cards() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "0", Some(bubble("call-a")));
        registered(&mut map, "appr-2", "0", Some(bubble("call-b")));

        let mut on_parent: Vec<(String, String)> = views_for(&map, "parent-1")
            .into_iter()
            .map(|v| (v.approval_id, v.parent_call_id.unwrap_or_default()))
            .collect();
        on_parent.sort();
        assert_eq!(on_parent, vec![
            ("appr-1".to_string(), "call-a".to_string()),
            ("appr-2".to_string(), "call-b".to_string()),
        ]);
    }

    /// The ordinary case is untouched: one view, in its own conversation, with
    /// nothing about delegation attached.
    #[test]
    fn an_ordinary_approval_belongs_to_one_conversation_only() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "c1", None);

        let here = views_for(&map, "sub-1");
        assert_eq!(here.len(), 1);
        assert!(!here[0].bubbled);
        assert!(here[0].parent_call_id.is_none());
        assert!(here[0].sub_conversation_id.is_none());

        assert!(views_for(&map, "parent-1").is_empty());
    }
}
