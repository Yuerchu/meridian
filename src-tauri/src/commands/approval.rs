use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;

use meridian_core::agent::engine::ApprovalDecision;

/// Hand a decision to the turn waiting on it.
///
/// `approval_id` is the one the backend minted when it drew the card, not the
/// provider's tool call id — see `PendingApproval`.
///
/// Missing entry is an error, not a no-op. It means the turn is gone: cancelled,
/// already answered, or lost with the process. Reporting success there is what
/// made a dead approval card look like a live one, so the front end could keep
/// clicking a button that would never do anything.
fn decide(app: &tauri::AppHandle, approval_id: &str, decision: ApprovalDecision) -> Result<(), String> {
    let services = app.services();
    let waiters = &services.approvals;
    let entry = waiters.lock().remove(approval_id);
    match entry {
        Some(pending) => {
            // The receiver is gone when the turn stopped waiting between our
            // lookup and now. Same situation as a missing entry from the
            // caller's point of view.
            pending
                .sender
                .send(decision)
                .map_err(|_| "that turn is no longer waiting for an answer".to_string())
        }
        None => Err("that request is no longer waiting for an answer".to_string()),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCallDenyRequest {
    approval_id: String,
    reason: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskResponseRequest {
    approval_id: String,
    response: String,
}

#[tauri::command]
pub async fn approve_tool_call(app: tauri::AppHandle, approval_id: String) -> Result<(), String> {
    decide(&app, &approval_id, ApprovalDecision::Approved)
}

#[tauri::command]
pub async fn deny_tool_call(app: tauri::AppHandle, request: ToolCallDenyRequest) -> Result<(), String> {
    let ToolCallDenyRequest {
        approval_id,
        reason: RequiredNullable(reason),
    } = request;
    decide(&app, &approval_id, ApprovalDecision::Denied(reason))
}

#[tauri::command]
pub async fn respond_to_ask(app: tauri::AppHandle, request: AskResponseRequest) -> Result<(), String> {
    let AskResponseRequest { approval_id, response } = request;
    decide(&app, &approval_id, ApprovalDecision::Response(response))
}

/// Enough to redraw a card that is still waiting for an answer.
///
/// Nullable fields remain present as `null`; the card distinguishes states by
/// their values, never by accepting an incomplete response shape.
#[derive(serde::Serialize)]
pub struct PendingApprovalInfoResponse {
    pub approval_id: String,
    /// Which conversation this view belongs to. Redundant when the caller asked
    /// for one conversation by name, and the whole point when it asked for all
    /// of them: a queue drawn outside any transcript has nothing else to say
    /// where a question came from.
    pub conversation_id: String,
    /// The row the card hangs off *in the conversation that asked for this
    /// list*. For a delegated run the parent sees its own `run_agent` row and
    /// the sub-agent sees the row the call is actually on.
    pub assistant_message_id: String,
    pub provider_call_id: String,
    pub tool_name: String,
    /// What the call was made with. Sent even though an ordinary card could
    /// read it off the transcript, because a bubbled one cannot: that row is in
    /// another conversation.
    pub arguments: String,
    /// Set when this asks to run an already-asked call outside the sandbox:
    /// the same value the announcing event carried.
    pub retry: Option<meridian_core::events::ApprovalRetry>,
    /// When the question was registered, in Unix milliseconds — the same
    /// value its announcing event carried, so a queue rebuilt from this list
    /// says when each question was asked instead of saying nothing.
    pub asked_at: i64,
    /// This approval belongs to a delegated run and is being shown where it is
    /// *happening*, not where it can be answered. The card draws itself without
    /// buttons.
    pub bubbled: bool,
    /// Which `run_agent` call to hang the card under. Non-null only in the
    /// parent's view, which is the only place it means anything.
    pub parent_call_id: Option<String>,
    /// Where the delegated run can be watched.
    pub sub_conversation_id: Option<String>,
}

pub type PendingApprovalListResponse = Vec<PendingApprovalInfoResponse>;

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
pub(crate) fn pending_for(app: &tauri::AppHandle, conversation_id: &str) -> PendingApprovalListResponse {
    let services = app.services();
    let waiters = &services.approvals;
    let map = waiters.lock();
    views_for(&map, conversation_id)
}

/// The half of `pending_for` that is only about the register's contents.
///
/// Split out because the rule it encodes — one approval, two conversations,
/// different in each — is worth pinning down without a running application
/// around it.
fn views_for(
    map: &std::collections::HashMap<String, meridian_core::state::PendingApproval>,
    conversation_id: &str,
) -> Vec<PendingApprovalInfoResponse> {
    let mut out = Vec::new();
    for (id, p) in map.iter() {
        // Belt and braces. The waiter's own timer is what ends a question and
        // it removes the entry; this only closes the window between the
        // deadline and that timer's next tick, in which a list would otherwise
        // hand back a card whose buttons are about to stop meaning anything.
        if meridian_core::approval::is_expired(p) {
            continue;
        }
        // Where the call is happening. Ordinary approvals only ever match here.
        if p.conversation_id == conversation_id {
            out.push(PendingApprovalInfoResponse {
                approval_id: id.clone(),
                conversation_id: p.conversation_id.clone(),
                assistant_message_id: p.assistant_message_id.clone(),
                provider_call_id: p.provider_call_id.clone(),
                tool_name: p.tool_name.clone(),
                arguments: p.arguments.clone(),
                retry: p.retry.clone(),
                asked_at: p.asked_at,
                bubbled: p.bubble.is_some(),
                parent_call_id: None,
                sub_conversation_id: None,
            });
        }
        // Where it is asked. The card names the parent's own row and call, so
        // that the approval lands inside the `run_agent` block rather than
        // arriving as a tool call the parent never made.
        if let Some(b) = &p.bubble
            && b.conversation_id == conversation_id
        {
            out.push(answerable_view(id, p));
        }
    }
    out
}

/// The one view of an approval that can be answered.
///
/// A delegated run's question is answered on the parent's `run_agent` card, not
/// in the sub-agent's own transcript, so the answerable view is the bubble's
/// wherever there is one. `views_for` produces both views because a transcript
/// showing the sub-agent should still say what it is waiting for; a queue must
/// not, since listing both would put one question in front of the user twice
/// and the copy without buttons is the one that would look broken.
fn answerable_view(id: &str, p: &meridian_core::state::PendingApproval) -> PendingApprovalInfoResponse {
    let (conversation_id, assistant_message_id, parent_call_id, sub_conversation_id) = match &p.bubble {
        Some(b) => (
            b.conversation_id.clone(),
            b.assistant_message_id.clone(),
            Some(b.parent_call_id.clone()),
            Some(b.sub_conversation_id.clone()),
        ),
        None => (p.conversation_id.clone(), p.assistant_message_id.clone(), None, None),
    };
    PendingApprovalInfoResponse {
        approval_id: id.to_string(),
        conversation_id,
        assistant_message_id,
        provider_call_id: p.provider_call_id.clone(),
        tool_name: p.tool_name.clone(),
        arguments: p.arguments.clone(),
        retry: p.retry.clone(),
        asked_at: p.asked_at,
        // Answerable is exactly what `bubbled` denies, so this view never is.
        bubbled: false,
        parent_call_id,
        sub_conversation_id,
    }
}

/// Every question waiting on the user, across all conversations.
///
/// The stream cannot answer this. Each of these announced itself once, before
/// the window reloaded or the phone connected, and nothing replays it — so a
/// client that was not listening at that moment has no other way to learn that
/// a conversation it has never opened is holding a turn open.
///
/// One row per approval rather than per view: this is a work queue, and
/// `answerable_view` says which of a delegated run's two views belongs in one.
///
/// Synchronous for the same reason as `pending_for`. Infallible, but `Result`
/// anyway: that is the shape both `generate_handler!` and `remote::dispatch`
/// expect of a row in the command table.
#[tauri::command]
pub fn all_pending_approvals(app: tauri::AppHandle) -> Result<PendingApprovalListResponse, String> {
    let services = app.services();
    let map = services.approvals.lock();
    Ok(map
        .iter()
        // Same guard as `views_for`, and it matters more here: this is what a
        // reconnecting client rebuilds its whole queue from, so one expired
        // entry becomes a row that cannot be cleared by answering it.
        .filter(|(_, p)| !meridian_core::approval::is_expired(p))
        .map(|(id, p)| answerable_view(id, p))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::state::{Bubble, PendingApproval};
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
        map.insert(
            approval_id.to_string(),
            PendingApproval {
                conversation_id: "sub-1".into(),
                turn_id: "child-turn".into(),
                assistant_message_id: "child-row".into(),
                provider_call_id: call_id.into(),
                tool_name: "run_command".into(),
                arguments: r#"{"command":"cargo test --all"}"#.into(),
                retry: None,
                asked_at: ASKED_AT,
                bubble,
                // These views are about what a card says, not about when it
                // stops standing; the expiry filter has its own tests.
                expires_at: None,
                sender: tx,
            },
        );
    }

    const ASKED_AT: i64 = 1_700_000_000_123;

    fn bubble(parent_call_id: &str) -> Bubble {
        Bubble {
            conversation_id: "parent-1".into(),
            assistant_message_id: "parent-row".into(),
            parent_call_id: parent_call_id.into(),
            sub_conversation_id: "sub-1".into(),
        }
    }

    #[test]
    fn approval_action_requests_are_named_strict_and_complete() {
        let deny: ToolCallDenyRequest = serde_json::from_value(serde_json::json!({
            "approvalId": "appr-1",
            "reason": null,
        }))
        .expect("valid denial");
        assert_eq!(deny.approval_id, "appr-1");
        assert!(deny.reason.0.is_none());

        assert!(
            serde_json::from_value::<ToolCallDenyRequest>(serde_json::json!({
                "approvalId": "appr-1",
            }))
            .is_err(),
            "nullable reason must still be present",
        );
        assert!(
            serde_json::from_value::<ToolCallDenyRequest>(serde_json::json!({
                "approvalId": "appr-1",
                "reason": null,
                "remember": true,
            }))
            .is_err()
        );

        let response: AskResponseRequest = serde_json::from_value(serde_json::json!({
            "approvalId": "appr-2",
            "response": "continue",
        }))
        .expect("valid ask response");
        assert_eq!(response.response, "continue");
        assert!(
            serde_json::from_value::<AskResponseRequest>(serde_json::json!({
                "approvalId": "appr-2",
                "response": "continue",
                "format": "text",
            }))
            .is_err()
        );
    }

    #[test]
    fn pending_approval_response_serializes_every_nullable_key() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "call-1", None);

        let payload = serde_json::to_value(answerable_view("appr-1", &map["appr-1"])).unwrap();
        for key in ["retry", "parent_call_id", "sub_conversation_id"] {
            assert_eq!(payload[key], serde_json::Value::Null, "missing required-null key {key}");
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
        assert_eq!(
            on_parent,
            vec![
                ("appr-1".to_string(), "call-a".to_string()),
                ("appr-2".to_string(), "call-b".to_string()),
            ]
        );
    }

    /// What the cross-conversation queue is built from. Two approvals, one of
    /// them delegated, produce two rows and not three — the sub-agent's
    /// read-only view is the one left out, because a queue offering a question
    /// that cannot be answered from there is worse than not offering it.
    #[test]
    fn the_queue_lists_each_approval_once_where_it_can_be_answered() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "0", Some(bubble("call-run-agent")));
        registered(&mut map, "appr-2", "c1", None);

        let mut rows: Vec<(String, String)> = map
            .iter()
            .map(|(id, p)| {
                let v = answerable_view(id, p);
                (v.approval_id, v.conversation_id)
            })
            .collect();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                // Answered on the parent, which is also where the card is.
                ("appr-1".to_string(), "parent-1".to_string()),
                ("appr-2".to_string(), "sub-1".to_string()),
            ]
        );
        // And the row for the delegated one names the parent's own row, so the
        // queue can send the reader somewhere the card actually exists.
        let delegated = answerable_view("appr-1", &map["appr-1"]);
        assert_eq!(delegated.assistant_message_id, "parent-row");
        assert!(!delegated.bubbled);
    }

    /// A question rebuilt from the register keeps the time it was asked. Both
    /// views carry it — the transcript's and the queue's — and it is the
    /// registered value, not the moment of the listing.
    #[test]
    fn a_listed_question_says_when_it_was_asked() {
        let mut map = HashMap::new();
        registered(&mut map, "appr-1", "0", Some(bubble("call-run-agent")));
        registered(&mut map, "appr-2", "c1", None);

        let queued = answerable_view("appr-1", &map["appr-1"]);
        assert_eq!(queued.asked_at, ASKED_AT);
        assert_eq!(
            serde_json::to_value(&queued).unwrap()["asked_at"],
            serde_json::json!(ASKED_AT)
        );
        for view in views_for(&map, "sub-1") {
            assert_eq!(view.asked_at, ASKED_AT, "{}", view.approval_id);
        }
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
