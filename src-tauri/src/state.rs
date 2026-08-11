use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use crate::agent::engine::ApprovalDecision;
use crate::agent::CompactCircuitBreaker;
use crate::db::DbPool;
use crate::edit_session;
use crate::mcp;
use crate::secrets::SecretsManager;
use crate::tools;

pub(crate) struct AppSecrets(pub(crate) Arc<SecretsManager>);
pub(crate) struct AppDb(pub(crate) DbPool);
pub(crate) struct AppTools(pub(crate) Arc<tools::ToolRegistry>);
/// No outer mutex: the registry locks internally and never across I/O. Holding
/// one here is what let a single slow MCP call stop every conversation in the
/// app from assembling its tool set.
pub(crate) struct AppMcp(pub(crate) Arc<mcp::McpRegistry>);

pub(crate) static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// A tool call sitting in front of the user, waiting to be allowed or refused.
///
/// Identified by an `approval_id` we mint, not by the provider's tool call id.
/// Those arrive off the wire unvalidated and OpenAI-compatible gateways
/// routinely reuse `"0"` from one call to the next; keyed by that, a second
/// call would overwrite the first one's sender, the first would read the
/// resulting `RecvError` as "the user said nothing", and its cleanup would then
/// delete the *second* one's entry — leaving that turn waiting on an answer
/// that could no longer reach it.
pub(crate) struct PendingApproval {
    pub(crate) conversation_id: String,
    /// Which run of the turn asked. What the turn guard sweeps by when a turn
    /// ends: an approval whose turn is gone has nobody left to answer it.
    pub(crate) turn_id: String,
    /// The assistant row this call hangs off. Needed to place the card: the
    /// provider call id alone does not name one once it repeats within a turn.
    pub(crate) assistant_message_id: String,
    /// What the model called it, and what the tool result must be sent back
    /// under. Never used to look an approval up.
    pub(crate) provider_call_id: String,
    /// The call this one is a second attempt at. Set only for sandbox
    /// escalations. It currently equals `provider_call_id` — the retry reuses
    /// the id — but the two mean different things, and recording it keeps the
    /// front end from having to know that they coincide.
    pub(crate) origin_call_id: Option<String>,
    pub(crate) tool_name: String,
    /// Why a sandbox-blocked command is asking to run again without the
    /// sandbox. Present exactly when this approval is such a retry.
    pub(crate) retry_reason: Option<String>,
    pub(crate) sender: oneshot::Sender<ApprovalDecision>,
}

/// Keyed by `approval_id`.
///
/// A `std::sync::Mutex` rather than tokio's: every critical section is one map
/// operation with nothing awaited inside, and a turn has to be able to clear
/// its own entries from `Drop`, which cannot await.
pub(crate) struct ApprovalWaiters(std::sync::Mutex<HashMap<String, PendingApproval>>);

impl ApprovalWaiters {
    pub(crate) fn new() -> Self {
        ApprovalWaiters(std::sync::Mutex::new(HashMap::new()))
    }

    /// Recovers from poisoning instead of propagating it. The critical sections
    /// only insert and remove, so a panic elsewhere cannot leave the map
    /// half-written — whereas refusing the lock would take every later approval
    /// in the app down with it.
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingApproval>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Voice input state. The engine slot has its own lock so that a slow model
/// load (~3.6s) naturally deduplicates: the prewarm task holds the lock while
/// loading and a concurrent transcribe call just waits on it, then hits the
/// cache instead of loading again.
#[cfg(not(target_os = "android"))]
pub(crate) struct VoiceState {
    pub(crate) inner: Arc<Mutex<VoiceInner>>,
    pub(crate) engine: Arc<Mutex<Option<Arc<crate::voice::engine::Engine>>>>,
}

#[cfg(not(target_os = "android"))]
#[derive(Default)]
pub(crate) struct VoiceInner {
    pub(crate) session: Option<crate::voice::capture::RecordingSession>,
    pub(crate) download: Option<CancellationToken>,
}

#[cfg(not(target_os = "android"))]
impl VoiceState {
    pub(crate) fn new() -> Self {
        VoiceState {
            inner: Arc::new(Mutex::new(VoiceInner::default())),
            engine: Arc::new(Mutex::new(None)),
        }
    }
}
/// Who currently holds each conversation. Shared with the OneBot server, which
/// is handed this same `Arc` rather than keeping a table of its own.
pub(crate) struct AppTurns(pub(crate) Arc<crate::turn::TurnCoordinator>);

pub(crate) struct EditSessions(pub(crate) Mutex<HashMap<String, Arc<tokio::sync::Mutex<edit_session::EditSession>>>>);
pub(crate) struct CompactBreakers(pub(crate) Mutex<HashMap<String, Arc<CompactCircuitBreaker>>>);

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(conversation_id: &str, call_id: &str)
        -> (PendingApproval, oneshot::Receiver<ApprovalDecision>)
    {
        let (tx, rx) = oneshot::channel();
        let entry = PendingApproval {
            conversation_id: conversation_id.into(),
            turn_id: "turn-1".into(),
            assistant_message_id: "msg-1".into(),
            provider_call_id: call_id.into(),
            origin_call_id: None,
            tool_name: "read_file".into(),
            retry_reason: None,
            sender: tx,
        };
        (entry, rx)
    }

    /// The reason approvals are not keyed by the provider's call id. Two
    /// conversations both handed `"0"` used to collide: the second insert
    /// dropped the first sender, the first turn read that as "no answer", and
    /// its cleanup then removed the second turn's entry.
    #[test]
    fn two_calls_sharing_a_provider_id_do_not_displace_each_other() {
        let waiters = ApprovalWaiters::new();
        let (a, mut rx_a) = pending("conv-1", "0");
        let (b, mut rx_b) = pending("conv-2", "0");
        waiters.lock().insert("appr-1".into(), a);
        waiters.lock().insert("appr-2".into(), b);
        assert_eq!(waiters.lock().len(), 2);

        let answered = waiters.lock().remove("appr-1").expect("first approval still registered");
        answered.sender.send(ApprovalDecision::Approved).expect("its turn is still listening");

        assert!(rx_a.try_recv().is_ok());
        assert!(rx_b.try_recv().is_err(), "the other turn must not have been answered");
        assert!(waiters.lock().contains_key("appr-2"));
    }

    #[test]
    fn an_answered_approval_cannot_be_answered_twice() {
        let waiters = ApprovalWaiters::new();
        let (p, _rx) = pending("conv-1", "c1");
        waiters.lock().insert("appr-1".into(), p);

        assert!(waiters.lock().remove("appr-1").is_some());
        // The command layer turns this `None` into an error, which is what
        // tells the front end to retire the card rather than spin on it.
        assert!(waiters.lock().remove("appr-1").is_none());
    }

    #[test]
    fn listing_is_scoped_to_one_conversation() {
        let waiters = ApprovalWaiters::new();
        let (a, _rx_a) = pending("conv-1", "c1");
        let (b, _rx_b) = pending("conv-2", "c1");
        waiters.lock().insert("appr-1".into(), a);
        waiters.lock().insert("appr-2".into(), b);

        let mine: Vec<String> = waiters.lock().iter()
            .filter(|(_, p)| p.conversation_id == "conv-1")
            .map(|(id, _)| id.clone())
            .collect();
        assert_eq!(mine, vec!["appr-1".to_string()]);
    }

    /// One turn panicking while holding the lock must not take every later
    /// approval in the app down with it.
    #[test]
    fn a_poisoned_lock_still_hands_out_the_map() {
        let waiters = Arc::new(ApprovalWaiters::new());
        let poisoner = Arc::clone(&waiters);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock();
            panic!("a turn died holding the lock");
        }).join();

        assert!(waiters.lock().is_empty());
    }
}
