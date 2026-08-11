mod agent;
mod command;
mod extract;
mod format;
mod handler;
mod media;
mod notice;
mod protocol;
mod qq_tools;
mod session;

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::mcp::McpRegistry;
use crate::secrets::SecretsManager;
use crate::tools::ToolRegistry;
use crate::turn::{Busy, TurnCoordinator, TurnLease, TurnOrigin};
use crate::util::{get_conn, now_ms};

use protocol::{OneBotAction, OneBotFrame, OneBotResponse};
pub use qq_tools::catalog as qq_tool_catalog;
use session::{SessionKey, SessionManager};

pub struct SharedState {
    pub pool: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub tools: Arc<ToolRegistry>,
    pub mcp: Arc<McpRegistry>,
    pub sessions: Mutex<SessionManager>,
    /// Tool calls waiting on a QQ reply. Behind its own `Arc` for the same
    /// reason as `session_states`: a turn that dies has to be able to retire
    /// its waiters from `Drop`, which cannot await.
    pub pending_approvals: Arc<PendingApprovals>,
    pub pending_api_responses: Mutex<HashMap<String, oneshot::Sender<OneBotResponse>>>,
    pub pending_requests: Mutex<HashMap<u32, PendingRequest>>,
    pub request_seq: AtomicU32,
    pub ws_sinks: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    pub connected_clients: AtomicU32,
    /// Session key → turn/inbox state. Behind its own `Arc` rather than inline:
    /// a running turn's guard has to hand the session back from `Drop`, and if
    /// that meant holding the whole server state, the turn machinery could not
    /// be exercised — or tested — without a websocket server and a provider
    /// standing behind it.
    pub session_states: Arc<SessionStates>,
    /// Shared with the desktop, not owned here. A QQ session's conversation is
    /// an ordinary conversation row that the desktop can open and write to, so
    /// "is anyone answering this" has to be one question with one answer.
    ///
    /// Passed in rather than read off `app_handle`, which is optional and — more
    /// to the point — `start_onebot` rebuilds this whole struct, so anything
    /// stored here resets when QQ restarts.
    pub coordinator: Arc<TurnCoordinator>,
    pub config: OneBotConfig,
    pub app_handle: Option<tauri::AppHandle>,
    /// (session, user) → the memory ids their last listing showed, in the order
    /// it showed them. Numbers only mean something against the listing they came
    /// from; see `MemoryListing`.
    pub memory_listings: Mutex<HashMap<(String, i64), MemoryListing>>,
}

/// Every session's turn and inbox state, under one lock.
///
/// All turn-active/inbox transitions happen under it, which is what stops a
/// message racing past an active turn. A `std::sync::Mutex`, not tokio's: every
/// critical section is one map operation with nothing awaited inside, and
/// `SessionTurn::drop` has to be able to take it, which cannot await.
#[derive(Default)]
pub struct SessionStates(std::sync::Mutex<HashMap<String, SessionState>>);

impl SessionStates {
    /// Recovers from poisoning instead of propagating it. The critical sections
    /// are single map operations, so a panic elsewhere cannot leave the map
    /// half-written — whereas refusing the lock would take every later QQ
    /// message in the process down with it.
    pub fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionState>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A tool call sitting in front of a QQ user, waiting to be allowed or refused.
pub struct PendingApproval {
    /// Only the person who triggered the call may answer it — otherwise anyone
    /// in the group could approve someone else's command.
    pub initiator: i64,
    /// Which run of the turn asked. What lets a turn that died sweep its own
    /// waiters out in one pass, rather than leaving a sender in the map until
    /// somebody happens to reply to it or the next call overwrites it.
    pub turn_id: String,
    /// The prompt this is an answer to, so an answer can be recognised as one.
    ///
    /// Without it, any message from the initiator counts — and in a group the
    /// initiator is mostly talking to other people. A "y" meant for someone
    /// else approved whatever happened to be waiting.
    ///
    /// `None` when the send did not come back with an id: an adapter that
    /// answers nothing, or a call that timed out after the message went out.
    /// The rule then falls back to "anything from the initiator", because the
    /// alternative is an approval nobody can ever answer.
    pub prompt_message_id: Option<i64>,
    /// What kind of question is parked, so the acknowledgement can be worded
    /// without re-deriving it from a tool name this side no longer holds.
    pub kind: crate::onebot::agent::AskKind,
    /// What they typed, verbatim. Never logged, and read only by the adapter
    /// that knows which tool asked and therefore what the words mean.
    pub responder: oneshot::Sender<String>,
}

impl PendingApproval {
    /// Whether a message from the initiator is answering this, given what it
    /// quoted.
    pub fn answered_by(&self, reply_to: Option<i64>) -> bool {
        match self.prompt_message_id {
            Some(id) => reply_to == Some(id),
            None => true,
        }
    }
}

/// Session key → the call that session is waiting on an answer for.
///
/// A `std::sync::Mutex` for the same reason as `SessionStates`: the critical
/// sections are single map operations, and a dead turn has to be able to clear
/// its own entries from `Drop`.
#[derive(Default)]
pub struct PendingApprovals(std::sync::Mutex<HashMap<String, PendingApproval>>);

impl PendingApprovals {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingApproval>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Drop every waiter belonging to `turn_id`. Dropping the sender is what
    /// tells the waiting side that no answer is coming — though by the time
    /// this runs, on the path that matters, there is no waiting side left.
    pub fn retire_turn(&self, turn_id: &str) {
        self.lock().retain(|_, pending| pending.turn_id != turn_id);
    }
}

/// Which listing a set of numbers belongs to. Deleting resolves against the
/// matching kind only: the numbers a person saw for their own memories mean
/// something different from the ones they saw for the room's, and one slot
/// shared between them lets `/memory group` followed by `/memory forget 1`
/// delete a row the command never claimed to touch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryListingKind {
    /// The caller's own memories (`/memory me`).
    Own,
    /// This room's memories (`/memory group`).
    Group,
    /// An operator view (`/memory user`, `/memory global`) — never a delete
    /// target for the numbered self-service commands.
    Operator,
}

/// A numbered listing shown to one person, so `/memory forget 2` can resolve
/// "2" to the row they actually saw.
///
/// Expires rather than falling back to the current order: between listing and
/// deleting, a memory can be added or removed, and silently renumbering would
/// delete something the person never chose.
pub struct MemoryListing {
    pub kind: MemoryListingKind,
    pub ids: Vec<String>,
    pub created_at: i64,
}

/// How long a numbered listing stays valid.
pub const MEMORY_LISTING_TTL_MS: i64 = 300 * 1000;

/// Cap on queued notice notes per session (user messages are not capped).
const NOTICE_INBOX_CAP: usize = 5;
/// Inbox items older than this are dropped instead of delivered.
const INBOX_EXPIRY_MS: i64 = 2 * 3600 * 1000;
/// How many OneBot message ids that entered the AI context to remember per
/// session (used to decide whether a recall is worth reporting).
const SEEN_IDS_CAP: usize = 200;

#[derive(Default)]
pub struct SessionState {
    pub turn_active: bool,
    pub inbox: Vec<InboxItem>,
    pub seen_message_ids: VecDeque<i64>,
    pub last_poke_reply_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboxKind {
    Notice,
    UserMessage,
}

/// Who sent a message, carried from the platform event through the queue, the
/// database and into the provider payload. Distinct from `is_admin` alone: that
/// gates tools, this attributes memories.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SenderContext {
    pub user_id: i64,
    pub nickname: Option<String>,
    /// QQ group role (`owner` / `admin` / `member`), when the event carried one.
    pub role: Option<String>,
    pub is_admin: bool,
    pub is_group: bool,
}

impl SenderContext {
    pub fn scope_id(&self) -> String {
        crate::db::models::memory::onebot_user_scope_id(self.user_id)
    }

    /// Where anything learned from this person right now was learned. An admin
    /// speaking is still speaking on a surface — operator authorship is a
    /// property of explicit commands, not of who happens to be talking.
    pub fn origin(&self) -> crate::db::models::memory::Origin {
        if self.is_group {
            crate::db::models::memory::Origin::Group
        } else {
            crate::db::models::memory::Origin::Private
        }
    }
}

impl From<&SenderContext> for crate::provider::SenderRef {
    fn from(s: &SenderContext) -> Self {
        crate::provider::SenderRef {
            user_id: s.user_id,
            nickname: s.nickname.clone(),
            role: s.role.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct InboxItem {
    pub text: String,
    pub kind: InboxKind,
    pub created_at: i64,
    /// `None` for notices, which nobody said. Queued user messages keep their
    /// own sender: merging them into one blob first would make the speakers
    /// unrecoverable.
    pub sender: Option<SenderContext>,
}

/// One inbound message for a turn. A turn can start with several (queued
/// messages from different people), and each keeps its own attribution rather
/// than being flattened into one string.
#[derive(Debug, Clone)]
pub struct IncomingMessage {
    pub text: String,
    pub sender: Option<SenderContext>,
}

impl IncomingMessage {
    pub fn new(text: impl Into<String>, sender: Option<SenderContext>) -> Self {
        Self { text: text.into(), sender }
    }
}

impl From<&InboxItem> for IncomingMessage {
    fn from(i: &InboxItem) -> Self {
        Self { text: i.text.clone(), sender: i.sender.clone() }
    }
}

fn expire_inbox(inbox: &mut Vec<InboxItem>, now: i64) {
    inbox.retain(|i| now - i.created_at < INBOX_EXPIRY_MS);
}

/// Outcome of finishing a turn: either the session is idle again, or user
/// messages arrived too late for mid-turn injection and the caller must run
/// another turn with them.
///
/// The lease rides along on `Continue` rather than being released and retaken.
/// A follow-up round is the same turn continuing, and letting go of the
/// conversation in between would open exactly the gap this coordinator exists
/// to close — the desktop would be free to start a turn between two rounds of
/// one QQ answer.
pub enum TurnEnd {
    Done,
    Continue(SessionTurn, Vec<InboxItem>),
}

/// The session-local half of the above, before the lease is decided.
enum Finish {
    Done,
    Continue(Vec<InboxItem>),
}

impl SessionState {
    /// Queue `item` behind the running turn, or report that the session is free.
    ///
    /// Split from `activate` because taking the session is no longer the whole
    /// story: between the two the caller has to take the *conversation* from
    /// the coordinator, and that can be refused by a desktop turn — in which
    /// case nothing may be queued, since only the OneBot runner drains this
    /// inbox.
    fn queue_unless_free(&mut self, item: InboxItem) -> bool {
        if self.turn_active {
            self.inbox.push(item);
            false
        } else {
            true
        }
    }

    fn activate(&mut self) {
        self.turn_active = true;
    }

    /// User messages left in the inbox keep the turn active and are handed
    /// back for an immediate follow-up; notice-only leftovers stay queued.
    fn finish(&mut self, now: i64) -> Finish {
        expire_inbox(&mut self.inbox, now);
        if self.inbox.iter().any(|i| i.kind == InboxKind::UserMessage) {
            Finish::Continue(std::mem::take(&mut self.inbox))
        } else {
            self.turn_active = false;
            Finish::Done
        }
    }

    fn push_note(&mut self, text: String, now: i64) {
        expire_inbox(&mut self.inbox, now);
        let notice_count = self.inbox.iter().filter(|i| i.kind == InboxKind::Notice).count();
        if notice_count >= NOTICE_INBOX_CAP {
            if let Some(pos) = self.inbox.iter().position(|i| i.kind == InboxKind::Notice) {
                self.inbox.remove(pos);
            }
        }
        // Notices are ours, not anyone's utterance.
        self.inbox.push(InboxItem { text, kind: InboxKind::Notice, created_at: now, sender: None });
    }

    fn record_seen(&mut self, message_id: i64) {
        if self.seen_message_ids.len() >= SEEN_IDS_CAP {
            self.seen_message_ids.pop_front();
        }
        self.seen_message_ids.push_back(message_id);
    }
}

/// A turn's claim on both things it had to take.
///
/// They live in different places — the conversation in the shared coordinator,
/// this session's `turn_active` flag in `session_states` — and giving back only
/// one of them is worse than giving back neither. Release just the conversation
/// and the session stays active forever: every later QQ message is queued into
/// an inbox with no runner left to drain it, and the session goes silent for
/// good. Release just the session and two runners write the same conversation.
///
/// So both are held by one value, and `Drop` covers every way a turn can leave
/// that is not the normal one — a cancelled task, a panic, an early return.
pub struct SessionTurn {
    states: Arc<SessionStates>,
    session: String,
    /// Copied out of the lease so they stay readable after it has been given
    /// back, and so neither accessor has to invent a value for a state that
    /// should not be observable.
    turn_id: String,
    cancel: CancellationToken,
    /// `None` once the turn has ended normally, which is what stops `Drop` from
    /// clearing a flag that `finish` already cleared — and, more to the point,
    /// one that a *later* turn may since have set.
    holding: Option<TurnLease>,
}

impl SessionTurn {
    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }

    pub fn cancel_token(&self) -> &CancellationToken {
        &self.cancel
    }

    /// Hand both claims back inside one critical section.
    ///
    /// Not two. Anyone who can see this session as free had to take its lock to
    /// do it, so by the time they can, the conversation has to be free too.
    /// Leaving the lease to drop after the lock — which is what a plain field
    /// does, since fields are destroyed once `Drop::drop` has returned — opens
    /// a window where a QQ message finds an idle session and is then turned
    /// away by the coordinator, and the user is told the desktop is busy by a
    /// turn that had already ended.
    ///
    /// `watch` runs at the end of that section, which is the only place the
    /// difference between the two orders is visible.
    fn release(&mut self, watch: impl FnOnce()) {
        let Some(lease) = self.holding.take() else { return };
        let mut map = self.states.lock();
        if let Some(s) = map.get_mut(&self.session) {
            s.turn_active = false;
        }
        drop(lease);
        watch();
    }
}

impl Drop for SessionTurn {
    fn drop(&mut self) {
        self.release(|| ());
    }
}

/// Where a turn's terminal event goes. Injected rather than reached for through
/// an `AppHandle` so the ordering below can be watched from a test.
///
/// `Sync` as well as `Send` so that a `&RunningTurn` can be held across an
/// await. Without it the guard could only ever be used by value, which rules
/// out doing anything asynchronous through it — including opening the turn's
/// record, which has to happen *after* the guard exists.
pub type StopSink = Box<dyn Fn(serde_json::Value) + Send + Sync>;

/// A turn while it is running, and the announcement it owes when it stops.
///
/// `SessionTurn` gives the session and the conversation back however the turn
/// dies. This is the other half: telling whoever is watching. Both have to
/// happen, in that order, on every exit — and "every exit" includes the ones
/// no code path passes through. An OneBot turn runs in a detached task; drop
/// that task mid-`await` (runtime shutdown) or let a tool panic, and the code
/// after the await never runs. Announcing from there covered the ordinary
/// endings and nothing else, and a desktop with that QQ conversation open would
/// stream for good.
///
/// So the duty lives in a value that is dropped either way.
pub struct RunningTurn {
    states: Arc<SessionStates>,
    session: SessionKey,
    /// Taken by `end_round` when the turn is over, and by `Drop` when nothing
    /// else got there first. `None` means the end has already been announced.
    turn: Option<SessionTurn>,
    /// Cleared of this turn's waiters on every exit. `make_approval_fn` parks
    /// on a 60-second timeout, and a task dropped mid-`await` never reaches the
    /// timeout branch — the sender would sit in the map until somebody replied
    /// to a question nobody is listening for, or the next call overwrote it.
    approvals: Arc<PendingApprovals>,
    sink: Option<StopSink>,
    conversation_id: String,
    turn_id: String,
    /// The last assistant row written, across rounds. A round that fails before
    /// writing one leaves the previous round's, which is closer to the truth
    /// than nothing.
    message_id: Option<String>,
    input_tokens: i32,
    output_tokens: i32,
}

impl RunningTurn {
    pub fn new(
        states: Arc<SessionStates>,
        approvals: Arc<PendingApprovals>,
        session: SessionKey,
        turn: SessionTurn,
        conversation_id: String,
        sink: Option<StopSink>,
    ) -> Self {
        let turn_id = turn.turn_id().to_string();
        Self {
            states,
            session,
            turn: Some(turn),
            approvals,
            sink,
            conversation_id,
            turn_id,
            message_id: None,
            input_tokens: 0,
            output_tokens: 0,
        }
    }

    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }

    pub fn cancel_token(&self) -> CancellationToken {
        self.turn
            .as_ref()
            .map(|t| t.cancel_token().clone())
            .unwrap_or_default()
    }

    /// Open this turn's durable record.
    ///
    /// A method on the guard rather than a free call, so it cannot be made
    /// before the guard exists. Recording first would leave a window — one
    /// `await` on a pooled connection — in which a dropped task handed both
    /// claims back and announced nothing, which is the state this value was
    /// written to make unreachable.
    pub async fn open_record(&self, pool: &crate::db::DbPool) -> Result<(), String> {
        crate::agent::turn_record::begin(
            pool, &self.turn_id, &self.conversation_id, TurnOrigin::OneBot,
        )
        .await
    }

    /// Fold a finished round's numbers in. Follow-up rounds are the same turn,
    /// so they add up rather than each reporting their own.
    pub fn record(&mut self, progress: agent::TurnProgress) {
        self.input_tokens += progress.input_tokens;
        self.output_tokens += progress.output_tokens;
        if progress.message_id.is_some() {
            self.message_id = progress.message_id;
        }
    }

    fn announce(&self, reason: &str) {
        let Some(sink) = self.sink.as_ref() else { return };
        sink(agent::turn_stop_payload(
            &self.conversation_id,
            &self.turn_id,
            self.message_id.as_deref(),
            reason,
            self.input_tokens,
            self.output_tokens,
        ));
    }

    /// End a round. `None` means the turn is over and has been announced;
    /// `Some(items)` means it continues with those messages, and nothing has
    /// been announced because nothing has ended.
    pub fn end_round(&mut self, reason: &str) -> Option<Vec<InboxItem>> {
        let turn = self.turn.take().expect("a turn can only be ended once");
        // Ahead of the release, as on the desktop side: an answer arriving
        // after this has nobody to reach, and leaving the entry behind would
        // let the next call for this session inherit a stale one.
        self.approvals.retire_turn(&self.turn_id);
        match end_turn(&self.states, &self.session, turn, || self.announce(reason)) {
            TurnEnd::Done => None,
            TurnEnd::Continue(held, items) => {
                self.turn = Some(held);
                Some(items)
            }
        }
    }
}

impl Drop for RunningTurn {
    fn drop(&mut self) {
        // Ended normally: `end_round` took the turn and announced it.
        let Some(turn) = self.turn.take() else { return };
        // Anything still here means the runner died on its feet. It may have
        // died parked on an approval — `make_approval_fn` waits 60 seconds, and
        // a dropped task never reaches that timeout, so nothing else would ever
        // take the entry out.
        self.approvals.retire_turn(&self.turn_id);
        // Both claims back before the announcement: a stop is read as
        // permission to send, and the conversation has to actually be free by
        // the time it goes out.
        drop(turn);
        self.announce("error");
    }
}

/// What came of a session's attempt to start a turn.
pub enum TurnStart {
    /// This task owns the turn. Hold it for as long as the turn runs, follow-up
    /// rounds included.
    Started(SessionTurn),
    /// Another OneBot turn is running for this session and `item` went into its
    /// inbox — that turn will pick it up between tool rounds, or at its end.
    Queued,
    /// Something outside OneBot holds the conversation. Nothing was queued: the
    /// inbox is drained only by the OneBot runner, so a message parked there
    /// while the desktop is answering would sit until the next QQ message
    /// happened along.
    Elsewhere(Busy),
}

/// Try to start a turn for `session`, on the conversation it maps to.
///
/// Two things have to be taken, and they are not the same thing: the *session*,
/// which is what OneBot deduplicates and queues against, and the
/// *conversation*, which is the row set anyone might be writing. A QQ session's
/// conversation is an ordinary conversation the desktop can open and send to.
///
/// Lock order is `session_states` then the coordinator, here and everywhere.
/// The coordinator's critical sections never await and never reach back for
/// this lock, so the pair cannot invert.
pub fn try_begin_turn(
    states: &Arc<SessionStates>,
    coordinator: &Arc<TurnCoordinator>,
    session: &SessionKey,
    conversation_id: &str,
    item: InboxItem,
) -> TurnStart {
    let mut map = states.lock();
    let entry = map.entry(session.to_string()).or_default();
    if !entry.queue_unless_free(item) {
        return TurnStart::Queued;
    }
    match coordinator.try_acquire_turn(conversation_id, TurnOrigin::OneBot) {
        Ok(lease) => {
            entry.activate();
            TurnStart::Started(SessionTurn {
                states: Arc::clone(states),
                session: session.to_string(),
                turn_id: lease.turn_id().to_string(),
                cancel: lease.cancel_token().clone(),
                holding: Some(lease),
            })
        }
        // The session stays idle on purpose: it never became active, so the
        // next message can try again rather than queueing behind a turn that
        // does not exist.
        Err(busy) => TurnStart::Elsewhere(busy),
    }
}

/// Finish a turn. If the inbox holds user messages the session stays active,
/// the lease stays held, and they are handed back for an immediate follow-up
/// turn; notice-only leftovers stay queued for the next trigger.
///
/// `announce` is how the turn's end is told to anyone watching — the terminal
/// `chat-stream` event a desktop reads as permission to send again. It is taken
/// as a callback rather than left to the caller to run afterwards precisely so
/// the ordering is a property of *this* function: it runs only after both
/// claims have been handed back, and only on the path where the turn is
/// actually over. A `Continue` round is the same turn going round again, and
/// announcing an end there would invite a message the coordinator would refuse.
pub fn end_turn(
    states: &Arc<SessionStates>,
    session: &SessionKey,
    mut turn: SessionTurn,
    announce: impl FnOnce(),
) -> TurnEnd {
    let mut map = states.lock();
    match map.entry(session.to_string()).or_default().finish(now_ms()) {
        Finish::Done => {
            // `finish` has already cleared the flag, so the guard must not
            // clear it again — by the time this value is dropped another turn
            // may have set it. Taking the lease out here also releases the
            // conversation inside the same critical section: leaving it to the
            // drop after this returns would open an instant where the session
            // reads as free while the conversation was still taken, and a QQ
            // message landing there would be told "busy" by a turn that had
            // already finished.
            turn.holding = None;
            drop(map);
            announce();
            TurnEnd::Done
        }
        Finish::Continue(items) => TurnEnd::Continue(turn, items),
    }
}

/// Take everything queued for `session`; called by the agent loop between tool
/// rounds so events surface inside the running turn.
pub fn drain_inbox_mid_turn(states: &SessionStates, session: &SessionKey) -> Vec<InboxItem> {
    let mut map = states.lock();
    let Some(s) = map.get_mut(&session.to_string()) else { return vec![] };
    expire_inbox(&mut s.inbox, now_ms());
    std::mem::take(&mut s.inbox)
}

/// Queue a notice note for `session`; oldest notes are dropped past the cap.
pub fn push_notice_note(states: &SessionStates, session: &SessionKey, text: String) {
    states.lock().entry(session.to_string()).or_default().push_note(text, now_ms());
}

/// Record an OneBot message id that entered the AI context for `session`.
pub fn record_seen_message(states: &SessionStates, session: &SessionKey, message_id: i64) {
    states.lock().entry(session.to_string()).or_default().record_seen(message_id);
}

pub fn was_seen_message(states: &SessionStates, session: &SessionKey, message_id: i64) -> bool {
    states
        .lock()
        .get(&session.to_string())
        .is_some_and(|s| s.seen_message_ids.contains(&message_id))
}

/// Handle passed into the headless agent loop so it can pull queued events into
/// the running turn between tool rounds.
pub struct InboxHandle {
    states: Arc<SessionStates>,
    session: SessionKey,
}

impl InboxHandle {
    pub fn new(states: Arc<SessionStates>, session: SessionKey) -> Self {
        Self { states, session }
    }

    pub fn drain(&self) -> Vec<InboxItem> {
        drain_inbox_mid_turn(&self.states, &self.session)
    }
}

/// A friend request or group invite waiting for admin approval.
#[derive(Debug, Clone)]
pub struct PendingRequest {
    pub kind: RequestKind,
    pub flag: String,
    pub user_id: i64,
    pub group_id: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
    Friend,
    GroupAdd,
    GroupInvite,
}

/// Broadcast a pre-serialized frame to all connected clients. Senders are
/// cloned out of the ws_sinks lock so a slow client only blocks this task
/// (never other lock users), and a momentarily full queue backpressures rather
/// than silently dropping the message.
async fn broadcast(state: &Arc<SharedState>, json: String) {
    let sinks: Vec<mpsc::Sender<String>> =
        state.ws_sinks.lock().await.values().cloned().collect();
    for sink in sinks {
        let _ = sink.send(json.clone()).await;
    }
}

/// Broadcast an action to all connected clients without waiting for a response.
pub async fn send_action_nowait(state: &Arc<SharedState>, action: &OneBotAction) {
    let Ok(json) = serde_json::to_string(action) else { return };
    broadcast(state, json).await;
}

pub async fn call_api(
    state: &Arc<SharedState>,
    action: OneBotAction,
) -> Result<serde_json::Value, String> {
    call_api_with_timeout(state, action, std::time::Duration::from_secs(10)).await
}

pub async fn call_api_with_timeout(
    state: &Arc<SharedState>,
    action: OneBotAction,
    timeout: std::time::Duration,
) -> Result<serde_json::Value, String> {
    let echo = action.echo.clone().unwrap_or_default();
    // Serialize before inserting into pending so a serialization failure can't
    // leave an orphaned pending entry behind.
    let json = serde_json::to_string(&action).map_err(|e| e.to_string())?;
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending_api_responses.lock().await;
        pending.insert(echo.clone(), tx);
    }
    broadcast(state, json).await;
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(resp)) => {
            if resp.retcode == Some(0) {
                Ok(resp.data.unwrap_or(serde_json::Value::Null))
            } else {
                Err(format!("API error: {:?}", resp.status))
            }
        }
        _ => {
            let mut pending = state.pending_api_responses.lock().await;
            pending.remove(&echo);
            Err("API call timed out".into())
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OneBotConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub access_token: Option<String>,
    pub assistant_id: Option<String>,
    pub admin_users: Vec<i64>,
    /// QQ emoji id used to acknowledge group messages; empty or "0" disables.
    #[serde(default = "default_ack_emoji")]
    pub ack_emoji_id: String,
}

fn default_ack_emoji() -> String {
    "76".into()
}

impl Default for OneBotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".into(),
            port: 6700,
            access_token: None,
            assistant_id: None,
            admin_users: vec![],
            ack_emoji_id: default_ack_emoji(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OneBotStatus {
    pub enabled: bool,
    pub running: bool,
    pub connected_clients: u32,
    pub host: String,
    pub port: u16,
}

pub fn load_config(pool: &DbPool) -> OneBotConfig {
    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return OneBotConfig::default(),
    };

    let mut get = |key: &str| -> Option<String> {
        crate::db::ops::preference::get_preference(&mut conn, key).ok().flatten()
    };

    OneBotConfig {
        enabled: get("onebot.enabled").as_deref() == Some("true"),
        host: get("onebot.host").unwrap_or_else(|| "127.0.0.1".into()),
        port: get("onebot.port").and_then(|s| s.parse().ok()).unwrap_or(6700),
        access_token: get("onebot.access_token").filter(|s| !s.is_empty()),
        assistant_id: get("onebot.assistant_id").filter(|s| !s.is_empty()),
        admin_users: get("onebot.admin_users")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        ack_emoji_id: get("onebot.ack_emoji_id").unwrap_or_else(default_ack_emoji),
    }
}

pub fn save_config(pool: &DbPool, config: &OneBotConfig) -> Result<(), String> {
    let mut conn = get_conn(pool)?;
    let now = now_ms();

    let mut set = |key: &str, val: &str| -> Result<(), String> {
        crate::db::ops::preference::set_preference(&mut conn, key, val, now)
            .map_err(|e| e.to_string())
    };

    set("onebot.enabled", if config.enabled { "true" } else { "false" })?;
    set("onebot.host", &config.host)?;
    set("onebot.port", &config.port.to_string())?;
    set("onebot.access_token", config.access_token.as_deref().unwrap_or(""))?;
    set("onebot.assistant_id", config.assistant_id.as_deref().unwrap_or(""))?;
    set("onebot.admin_users", &serde_json::to_string(&config.admin_users).unwrap_or_default())?;
    set("onebot.ack_emoji_id", &config.ack_emoji_id)?;

    Ok(())
}

/// Manages the OneBot WS server lifecycle.
pub struct OneBotServer {
    state: Arc<SharedState>,
    shutdown_tx: watch::Sender<bool>,
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl OneBotServer {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pool: DbPool,
        secrets: Arc<SecretsManager>,
        tools: Arc<ToolRegistry>,
        mcp: Arc<McpRegistry>,
        coordinator: Arc<TurnCoordinator>,
        config: OneBotConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        let (shutdown_tx, _) = watch::channel(false);
        Self {
            state: Arc::new(SharedState {
                sessions: Mutex::new(SessionManager::new(pool.clone())),
                pending_approvals: Arc::new(PendingApprovals::default()),
                pending_api_responses: Mutex::new(HashMap::new()),
                pending_requests: Mutex::new(HashMap::new()),
                // Time-seeded so ids don't restart at 1 after a relaunch, which
                // would let a stale "同意 N" notification approve a new request.
                request_seq: AtomicU32::new((now_ms() / 1000 % 1_000_000) as u32),
                ws_sinks: Mutex::new(HashMap::new()),
                connected_clients: AtomicU32::new(0),
                session_states: Arc::new(SessionStates::default()),
                memory_listings: Mutex::new(HashMap::new()),
                config,
                pool,
                secrets,
                tools,
                mcp,
                coordinator,
                app_handle,
            }),
            shutdown_tx,
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> OneBotStatus {
        OneBotStatus {
            enabled: self.state.config.enabled,
            running: self.is_running(),
            connected_clients: self.state.connected_clients.load(Ordering::Relaxed),
            host: self.state.config.host.clone(),
            port: self.state.config.port,
        }
    }

    pub fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Err("OneBot server is already running".into());
        }
        validate_listen_config(
            &self.state.config.host,
            self.state.config.access_token.as_deref(),
        )?;

        let state = self.state.clone();
        let running = self.running.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        running.store(true, Ordering::Relaxed);

        tokio::spawn(async move {
            let addr = format!("{}:{}", state.config.host, state.config.port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    tracing::info!("OneBot WS server listening on {addr}");
                    l
                }
                Err(e) => {
                    tracing::error!("Failed to bind OneBot WS server to {addr}: {e}");
                    running.store(false, Ordering::Relaxed);
                    return;
                }
            };

            let mut conn_id_counter: u64 = 0;

            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        // Err = all senders dropped (this server was replaced);
                        // either case means stop, so don't hot-spin on a closed channel.
                        if changed.is_err() || *shutdown_rx.borrow() {
                            tracing::info!("OneBot WS server shutting down");
                            break;
                        }
                    }
                    result = listener.accept() => {
                        match result {
                            Ok((stream, peer)) => {
                                conn_id_counter += 1;
                                let conn_id = conn_id_counter;
                                let state = state.clone();

                                tokio::spawn(async move {
                                    use tokio_tungstenite::tungstenite::handshake::server::{
                                        ErrorResponse, Request, Response,
                                    };
                                    use tokio_tungstenite::tungstenite::http::StatusCode;

                                    let expected_token = state.config.access_token.clone();
                                    let callback = move |req: &Request, resp: Response|
                                        -> Result<Response, ErrorResponse> {
                                        let Some(ref expected) = expected_token else {
                                            return Ok(resp);
                                        };
                                        let auth = req.headers().get("authorization")
                                            .and_then(|v| v.to_str().ok());
                                        if token_matches(expected, auth, req.uri().query()) {
                                            Ok(resp)
                                        } else {
                                            let mut r = ErrorResponse::new(Some("Unauthorized".into()));
                                            *r.status_mut() = StatusCode::UNAUTHORIZED;
                                            Err(r)
                                        }
                                    };

                                    let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
                                        Ok(ws) => ws,
                                        Err(e) => {
                                            tracing::warn!("WS handshake failed from {peer}: {e}");
                                            return;
                                        }
                                    };

                                    tracing::info!("OneBot client connected from {peer} (id={conn_id})");
                                    state.connected_clients.fetch_add(1, Ordering::Relaxed);

                                    handle_connection(ws_stream, conn_id, state.clone()).await;

                                    state.connected_clients.fetch_sub(1, Ordering::Relaxed);
                                    tracing::info!("OneBot client disconnected (id={conn_id})");
                                });
                            }
                            Err(e) => {
                                tracing::error!("Failed to accept connection: {e}");
                            }
                        }
                    }
                }
            }

            running.store(false, Ordering::Relaxed);
        });

        Ok(())
    }

    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
        self.running.store(false, Ordering::Relaxed);
    }
}

/// Anyone who can reach the socket can submit events with an arbitrary
/// `user_id`, i.e. impersonate an admin — so listening outside loopback
/// without a real access token is refused outright.
fn validate_listen_config(host: &str, access_token: Option<&str>) -> Result<(), String> {
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if is_loopback {
        return Ok(());
    }
    match access_token {
        Some(t) if t.len() >= 16 => Ok(()),
        Some(_) => Err(
            "OneBot access token is too short for a non-loopback address (need at least 16 characters); use a longer token or bind to 127.0.0.1".into(),
        ),
        None => Err(
            "OneBot refuses to listen on a non-loopback address without an access token; set a token or bind to 127.0.0.1".into(),
        ),
    }
}

/// Check an access token against the Authorization header (`Bearer <t>`,
/// `Token <t>`, or bare) or the `access_token` query parameter.
fn token_matches(expected: &str, auth_header: Option<&str>, query: Option<&str>) -> bool {
    if let Some(auth) = auth_header {
        let token = auth
            .strip_prefix("Bearer ")
            .or_else(|| auth.strip_prefix("Token "))
            .unwrap_or(auth)
            .trim();
        if token == expected {
            return true;
        }
    }
    if let Some(q) = query {
        for kv in q.split('&') {
            if let Some(v) = kv.strip_prefix("access_token=") {
                let decoded = percent_encoding::percent_decode_str(v).decode_utf8_lossy();
                if decoded == expected {
                    return true;
                }
            }
        }
    }
    false
}

/// Send actions to one connection. The sender is cloned out of the lock so a
/// slow client only blocks the calling task, never other ws_sinks users.
async fn send_to_conn(state: &Arc<SharedState>, conn_id: u64, actions: Vec<OneBotAction>) {
    let sink = state.ws_sinks.lock().await.get(&conn_id).cloned();
    let Some(sink) = sink else { return };
    for action in actions {
        if let Ok(json) = serde_json::to_string(&action) {
            let _ = sink.send(json).await;
        }
    }
}

async fn handle_connection(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    conn_id: u64,
    state: Arc<SharedState>,
) {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let (mut write, mut read) = ws.split();

    // Set up a channel for outbound messages (used by approval requests etc.)
    let (sink_tx, mut sink_rx) = mpsc::channel::<String>(64);
    {
        let mut sinks = state.ws_sinks.lock().await;
        sinks.insert(conn_id, sink_tx);
    }

    // Spawn outbound writer
    let write_handle = tokio::spawn(async move {
        while let Some(msg) = sink_rx.recv().await {
            if write.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = read.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t.to_string(),
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
            Ok(Message::Close(_)) | Err(_) => break,
            _ => continue,
        };

        let frame = match protocol::parse_frame(&text) {
            Some(f) => f,
            None => {
                tracing::debug!("Failed to parse OneBot frame");
                continue;
            }
        };

        let event = match frame {
            OneBotFrame::Response(resp) => {
                if let Some(echo) = resp.echo.as_deref() {
                    let mut pending = state.pending_api_responses.lock().await;
                    if let Some(tx) = pending.remove(echo) {
                        let _ = tx.send(resp);
                    }
                }
                continue;
            }
            OneBotFrame::Event(e) => e,
        };

        match event.post_type.as_str() {
            "meta_event" => {
                // Heartbeat / lifecycle — just log
                if event.meta_event_type.as_deref() == Some("lifecycle") {
                    tracing::debug!("OneBot lifecycle event from conn {conn_id}");
                }
            }
            "message" => {
                let state = state.clone();
                tokio::spawn(async move {
                    let actions = handler::handle_message(&event, &state, conn_id).await;
                    send_to_conn(&state, conn_id, actions).await;
                });
            }
            "request" => {
                let state = state.clone();
                tokio::spawn(async move {
                    let actions = handler::handle_request(&event, &state).await;
                    send_to_conn(&state, conn_id, actions).await;
                });
            }
            "notice" => {
                let state = state.clone();
                tokio::spawn(async move {
                    let actions = notice::handle_notice(&event, &state, conn_id).await;
                    send_to_conn(&state, conn_id, actions).await;
                });
            }
            _ => {
                tracing::debug!("Unhandled OneBot event type: {}", event.post_type);
            }
        }
    }

    // Cleanup
    {
        let mut sinks = state.ws_sinks.lock().await;
        sinks.remove(&conn_id);
    }
    write_handle.abort();
}

/// Called from Tauri setup to auto-start if enabled.
pub async fn maybe_start(handle: tauri::AppHandle) {
    use tauri::Manager;

    let pool = handle.state::<crate::state::AppDb>().0.clone();
    let config = load_config(&pool);

    if !config.enabled {
        tracing::info!("OneBot server disabled, skipping auto-start");
        let server = OneBotServer::new(
            pool,
            handle.state::<crate::state::AppSecrets>().0.clone(),
            handle.state::<crate::state::AppTools>().0.clone(),
            handle.state::<crate::state::AppMcp>().0.clone(),
            handle.state::<crate::state::AppTurns>().0.clone(),
            config,
            Some(handle.clone()),
        );
        handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
        return;
    }

    let secrets = handle.state::<crate::state::AppSecrets>().0.clone();
    let tools = handle.state::<crate::state::AppTools>().0.clone();
    let mcp = handle.state::<crate::state::AppMcp>().0.clone();
    let coordinator = handle.state::<crate::state::AppTurns>().0.clone();

    let server = OneBotServer::new(
        pool, secrets, tools, mcp, coordinator, config, Some(handle.clone()),
    );
    if let Err(e) = server.start() {
        tracing::error!("Failed to auto-start OneBot server: {e}");
    }
    handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
}

pub struct AppOneBot(pub Arc<Mutex<OneBotServer>>);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turn::{Busy, TurnOrigin};

    fn item(kind: InboxKind, at: i64) -> InboxItem {
        InboxItem { text: "x".into(), kind, created_at: at, sender: None }
    }

    /// Everything the turn/inbox transitions actually touch. Nothing here needs
    /// the websocket server, the database or a provider — which is the point of
    /// `SessionStates` being its own value rather than a field the guard has to
    /// reach through `SharedState` for.
    struct Fixture {
        states: Arc<SessionStates>,
        approvals: Arc<PendingApprovals>,
        coordinator: Arc<TurnCoordinator>,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                states: Arc::new(SessionStates::default()),
                approvals: Arc::new(PendingApprovals::default()),
                coordinator: Arc::new(TurnCoordinator::new()),
            }
        }

        /// A tool call parked in front of the user, as `make_approval_fn`
        /// leaves it.
        fn park_approval(&self, key: &SessionKey, turn_id: &str) -> oneshot::Receiver<String> {
            let (tx, rx) = oneshot::channel();
            self.approvals.lock().insert(
                key.to_string(),
                PendingApproval {
                    initiator: 7,
                    turn_id: turn_id.into(),
                    prompt_message_id: Some(9001),
                    kind: crate::onebot::agent::AskKind::Permission,
                    responder: tx,
                },
            );
            rx
        }

        fn begin(&self, key: &SessionKey, conv: &str, at: i64) -> TurnStart {
            try_begin_turn(
                &self.states, &self.coordinator, key, conv,
                item(InboxKind::UserMessage, at),
            )
        }

        fn started(&self, key: &SessionKey, conv: &str, at: i64) -> SessionTurn {
            match self.begin(key, conv, at) {
                TurnStart::Started(turn) => turn,
                TurnStart::Queued => panic!("the session was supposed to be free"),
                TurnStart::Elsewhere(b) => panic!("the conversation was supposed to be free: {b}"),
            }
        }

        fn active(&self, key: &SessionKey) -> bool {
            self.states.lock()[&key.to_string()].turn_active
        }

        fn conversation_free(&self, conv: &str) -> bool {
            self.coordinator.try_acquire_turn(conv, TurnOrigin::Desktop).is_ok()
        }
    }

    /// The whole reason `SessionTurn` exists. A runner that is cancelled or
    /// panics never reaches `end_turn`, and the session's `turn_active` flag
    /// used to stay set for good — every later message then queued into an
    /// inbox with no runner left to drain it, and the session went silent.
    #[test]
    fn a_turn_that_dies_without_finishing_hands_the_session_back() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        assert!(f.active(&key));

        // However the runner died: a cancelled task, a panic, an early return.
        drop(turn);

        assert!(!f.active(&key), "the session must be free again");
        drop(f.started(&key, "conv-1", 1001));
    }

    /// And gives them back together, not one and then the other.
    ///
    /// The probe runs at the end of the session's critical section — the only
    /// point where the two orders differ. Anyone who could see this session as
    /// free has to take that lock first, so if the conversation is still held
    /// here, there is a moment when a QQ message finds an idle session and is
    /// then refused by the coordinator: the user is told the desktop is busy by
    /// a turn that no longer exists.
    #[test]
    fn a_dying_turn_gives_both_back_before_anyone_can_look() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let mut turn = f.started(&key, "conv-1", 1000);

        let mut conversation_free = None;
        turn.release(|| {
            conversation_free = Some(f.conversation_free("conv-1"));
        });

        assert_eq!(
            conversation_free,
            Some(true),
            "the conversation was still held when the session was already free",
        );
    }

    /// Both claims are given back, not just one. Releasing only the
    /// conversation would leave the session queueing into a dead inbox;
    /// releasing only the session would let two runners write one conversation.
    #[test]
    fn a_dead_turn_hands_the_conversation_back_too() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        assert!(!f.conversation_free("conv-1"));

        drop(turn);

        assert!(f.conversation_free("conv-1"));
    }

    /// A panic is the case `Drop` exists for, so exercise it as a panic.
    #[test]
    fn a_panicking_runner_hands_both_back() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let _ = std::thread::spawn(move || {
            let _turn = turn;
            panic!("the runner died");
        })
        .join();

        assert!(!f.active(&key));
        assert!(f.conversation_free("conv-1"));
    }

    /// A follow-up round is the same turn continuing. Letting go of either
    /// claim in between is exactly the gap that lets the desktop start a turn
    /// between two rounds of one QQ answer.
    #[test]
    fn a_continuing_turn_keeps_both_claims() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        // Arrived too late to be injected mid-turn. Stamped now, because
        // `end_turn` expires the inbox against the real clock.
        f.states.lock()
            .get_mut(&key.to_string())
            .unwrap()
            .inbox
            .push(item(InboxKind::UserMessage, now_ms()));

        let TurnEnd::Continue(held, items) = end_turn(&f.states, &key, turn, || ()) else {
            panic!("a queued user message must continue the turn")
        };

        assert_eq!(items.len(), 1);
        assert!(f.active(&key));
        assert_eq!(
            f.coordinator.try_acquire_turn("conv-1", TurnOrigin::Desktop).err(),
            Some(Busy::Turn(TurnOrigin::OneBot)),
        );
        drop(held);
    }

    /// The normal exit gives both back too — and the guard must not then clear
    /// a flag `finish` already cleared, which by the time it drops could belong
    /// to a later turn.
    #[test]
    fn a_finished_turn_gives_both_back() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);

        assert!(matches!(end_turn(&f.states, &key, turn, || ()), TurnEnd::Done));

        assert!(!f.active(&key));
        assert!(f.conversation_free("conv-1"));
    }

    /// The ordering, watched from inside the announcement itself.
    ///
    /// The front end reads the terminal event as permission to send again, so
    /// by the time it goes out the conversation has to be free. Asserting on
    /// the state *after* `end_turn` returns cannot tell the two orders apart —
    /// this looks from where the difference is visible.
    #[test]
    fn the_end_is_announced_only_after_both_claims_are_back() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);

        let mut seen: Option<(bool, bool)> = None;
        let announce = || {
            seen = Some((
                !f.states.lock()[&key.to_string()].turn_active,
                f.coordinator.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_ok(),
            ));
        };
        assert!(matches!(end_turn(&f.states, &key, turn, announce), TurnEnd::Done));

        let (session_free, conversation_free) = seen.expect("the end must be announced");
        assert!(session_free, "the session was still active when the turn was announced over");
        assert!(conversation_free, "the conversation was still held when the turn was announced over");
    }

    /// A follow-up round is not an ending, so nothing may be announced. One
    /// used to go out between rounds, and a desktop watching the conversation
    /// took it as its cue to send — into a turn that still held it.
    #[test]
    fn a_continuing_turn_announces_nothing() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        f.states.lock()
            .get_mut(&key.to_string())
            .unwrap()
            .inbox
            .push(item(InboxKind::UserMessage, now_ms()));

        let mut announced = false;
        let TurnEnd::Continue(held, _) = end_turn(&f.states, &key, turn, || announced = true) else {
            panic!("a queued user message must continue the turn")
        };

        assert!(!announced, "a round that is not the end must not announce one");
        drop(held);
    }

    /// And exactly once — the announcement is not repeated by whatever drops
    /// the guard afterwards.
    #[test]
    fn the_end_is_announced_once() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);

        let mut count = 0;
        end_turn(&f.states, &key, turn, || count += 1);
        assert_eq!(count, 1);
    }

    /// The desktop is answering this conversation. Nothing may be queued: this
    /// inbox is drained only by the OneBot runner, so an item left here would
    /// wait for the next QQ message rather than for the desktop turn to end.
    #[test]
    fn a_conversation_held_by_the_desktop_queues_nothing() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let _desktop = f.coordinator
            .try_acquire_turn("conv-1", TurnOrigin::Desktop)
            .expect("free");

        let start = f.begin(&key, "conv-1", 1000);
        assert!(matches!(start, TurnStart::Elsewhere(Busy::Turn(TurnOrigin::Desktop))));

        let states = f.states.lock();
        let s = &states[&key.to_string()];
        assert!(!s.turn_active, "a session we never took must not read as active");
        assert!(s.inbox.is_empty(), "nothing may queue behind a turn we do not own");
    }

    /// A second message for a session this runner *does* own still queues, as
    /// it always did.
    #[test]
    fn a_second_message_for_our_own_turn_still_queues() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let _turn = f.started(&key, "conv-1", 1000);

        assert!(matches!(f.begin(&key, "conv-1", 1001), TurnStart::Queued));
        assert_eq!(f.states.lock()[&key.to_string()].inbox.len(), 1);
    }

    /// A `RunningTurn` whose announcements land somewhere a test can read, and
    /// which reports what the world looked like at the moment each went out.
    struct Watcher {
        stops: Arc<std::sync::Mutex<Vec<(serde_json::Value, bool, bool)>>>,
    }

    impl Watcher {
        fn attach(f: &Fixture, key: &SessionKey, turn: SessionTurn, conv: &str) -> (Self, RunningTurn) {
            let stops = Arc::new(std::sync::Mutex::new(Vec::new()));
            let recorded = Arc::clone(&stops);
            let states = Arc::clone(&f.states);
            let coordinator = Arc::clone(&f.coordinator);
            let session = key.to_string();
            let conversation = conv.to_string();
            let sink: StopSink = Box::new(move |payload| {
                // Read from inside the announcement: after it returns, the two
                // orderings are indistinguishable.
                let session_free = !states.lock()
                    .get(&session)
                    .is_some_and(|s| s.turn_active);
                let conversation_free = coordinator
                    .try_acquire_turn(&conversation, TurnOrigin::Desktop)
                    .is_ok();
                recorded.lock().unwrap().push((payload, session_free, conversation_free));
            });
            let running = RunningTurn::new(
                Arc::clone(&f.states), Arc::clone(&f.approvals),
                key.clone(), turn, conv.to_string(), Some(sink),
            );
            (Self { stops }, running)
        }

        fn stops(&self) -> Vec<(serde_json::Value, bool, bool)> {
            self.stops.lock().unwrap().clone()
        }
    }

    /// The hole the old `ErrorStopGuard` covered and moving the emit to the
    /// caller did not: this task is detached, so dropping it mid-`await` — a
    /// runtime shutting down, a connection task torn down — runs none of the
    /// code after the await. Without this, a desktop with the QQ conversation
    /// open streams for good.
    #[test]
    fn a_runner_dropped_mid_turn_still_announces_the_end() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let (watch, running) = Watcher::attach(&f, &key, turn, "conv-1");

        // Whatever killed it, this is all that is left to run.
        drop(running);

        let stops = watch.stops();
        assert_eq!(stops.len(), 1, "a turn that died still owes a terminal event");
        assert_eq!(stops[0].0["reason"], "error");
        assert_eq!(stops[0].0["type"], "stop");
        assert!(stops[0].1, "the session was still active when the end was announced");
        assert!(stops[0].2, "the conversation was still held when the end was announced");
    }

    /// Same duty, reached by unwinding rather than by a drop.
    #[test]
    fn a_panicking_runner_announces_the_end() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let (watch, running) = Watcher::attach(&f, &key, turn, "conv-1");

        let _ = std::thread::spawn(move || {
            let _running = running;
            panic!("a tool blew up");
        })
        .join();

        let stops = watch.stops();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].0["reason"], "error");
        assert!(stops[0].2, "the conversation was still held when the end was announced");
    }

    /// And the normal path says it once, not twice — the guard must not add a
    /// second one on its way out.
    #[test]
    fn a_turn_that_ended_normally_announces_once() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let (watch, mut running) = Watcher::attach(&f, &key, turn, "conv-1");

        assert!(running.end_round("end_turn").is_none(), "nothing was queued");
        assert_eq!(watch.stops().len(), 1);

        drop(running);
        assert_eq!(watch.stops().len(), 1, "the guard must not announce a second ending");
        assert_eq!(watch.stops()[0].0["reason"], "end_turn");
    }

    /// A round that continues has not ended, so it announces nothing — but the
    /// duty is still owed, and dying during the follow-up must still discharge
    /// it.
    #[test]
    fn a_continuing_round_announces_nothing_but_still_owes_one() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let (watch, mut running) = Watcher::attach(&f, &key, turn, "conv-1");
        f.states.lock()
            .get_mut(&key.to_string())
            .unwrap()
            .inbox
            .push(item(InboxKind::UserMessage, now_ms()));

        assert!(running.end_round("end_turn").is_some(), "a queued message continues the turn");
        assert!(watch.stops().is_empty(), "a round that is not the end announces nothing");

        // The follow-up round dies.
        drop(running);
        assert_eq!(watch.stops().len(), 1);
        assert_eq!(watch.stops()[0].0["reason"], "error");
    }

    /// What separates an answer from the rest of a group conversation. Without
    /// it the initiator's every message counted, and in a group most of them
    /// are addressed to other people: a "y" typed at a friend approved whatever
    /// happened to be waiting.
    #[test]
    fn only_a_reply_to_the_prompt_answers_it() {
        let asked = PendingApproval {
            initiator: 7,
            turn_id: "t1".into(),
            prompt_message_id: Some(42),
            kind: crate::onebot::agent::AskKind::Permission,
            responder: oneshot::channel().0,
        };
        assert!(asked.answered_by(Some(42)));
        assert!(!asked.answered_by(Some(41)), "answered a different message");
        assert!(!asked.answered_by(None), "answered nothing in particular");
    }

    /// And when the prompt never learnt its own id — a send that failed, or an
    /// adapter that returns nothing — the old rule stands. Worse, but an
    /// approval nobody can answer is worse still.
    #[test]
    fn a_prompt_that_does_not_know_its_own_id_takes_any_answer() {
        let asked = PendingApproval {
            initiator: 7,
            turn_id: "t1".into(),
            prompt_message_id: None,
            kind: crate::onebot::agent::AskKind::Permission,
            responder: oneshot::channel().0,
        };
        assert!(asked.answered_by(None));
        assert!(asked.answered_by(Some(42)));
    }

    /// The third thing a turn owes back. `make_approval_fn` parks on a
    /// 60-second timeout; a task dropped mid-`await` never reaches the timeout
    /// branch, so the sender used to sit in the map until somebody replied to a
    /// question nobody was listening for — or until the next call for the same
    /// session overwrote it.
    #[test]
    fn a_runner_dropped_while_waiting_on_an_approval_retires_it() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let turn_id = turn.turn_id().to_string();
        let (_watch, running) = Watcher::attach(&f, &key, turn, "conv-1");
        let mut waiting = f.park_approval(&key, &turn_id);

        drop(running);

        assert!(f.approvals.lock().is_empty(), "a dead turn leaves no waiters behind");
        // And the waiting side, if there still were one, is told rather than
        // left hanging.
        assert!(waiting.try_recv().is_err());
    }

    #[test]
    fn a_turn_that_ended_normally_retires_its_approvals_too() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let turn_id = turn.turn_id().to_string();
        let (_watch, mut running) = Watcher::attach(&f, &key, turn, "conv-1");
        f.park_approval(&key, &turn_id);

        assert!(running.end_round("end_turn").is_none());

        assert!(f.approvals.lock().is_empty());
    }

    /// By turn, not by session. A QQ session's key is stable across turns, so
    /// sweeping the session would take an approval the *next* turn had already
    /// registered — and that turn would then wait out its full minute for an
    /// answer that could no longer reach it.
    #[test]
    fn retiring_a_turn_leaves_another_turns_approval_alone() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let other = SessionKey::group(2);
        let turn = f.started(&key, "conv-1", 1000);
        let turn_id = turn.turn_id().to_string();
        let (_watch, running) = Watcher::attach(&f, &key, turn, "conv-1");
        f.park_approval(&other, "some-other-turn");

        drop(running);

        assert_eq!(f.approvals.lock().len(), 1);
        assert_eq!(f.approvals.lock()[&other.to_string()].turn_id, "some-other-turn");
        let _ = turn_id;
    }

    /// Rounds add up: they are one turn, and the desktop gets one figure.
    #[test]
    fn a_turns_rounds_are_reported_together() {
        let f = Fixture::new();
        let key = SessionKey::group(1);
        let turn = f.started(&key, "conv-1", 1000);
        let (watch, mut running) = Watcher::attach(&f, &key, turn, "conv-1");
        f.states.lock()
            .get_mut(&key.to_string())
            .unwrap()
            .inbox
            .push(item(InboxKind::UserMessage, now_ms()));

        running.record(agent::TurnProgress {
            message_id: Some("msg-1".into()),
            input_tokens: 10,
            output_tokens: 1,
            aborted: false,
        });
        assert!(running.end_round("end_turn").is_some());
        // The follow-up round never wrote a row, so the first round's stands.
        running.record(agent::TurnProgress {
            input_tokens: 5,
            output_tokens: 2,
            ..Default::default()
        });
        assert!(running.end_round("end_turn").is_none());

        let stops = watch.stops();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].0["input_tokens"], 15);
        assert_eq!(stops[0].0["output_tokens"], 3);
        assert_eq!(stops[0].0["message_id"], "msg-1");
    }

    /// Two sessions on two conversations do not contend at all.
    #[test]
    fn a_second_session_is_unaffected() {
        let f = Fixture::new();
        let _first = f.started(&SessionKey::group(1), "conv-1", 1000);
        drop(f.started(&SessionKey::private(2), "conv-2", 1000));
    }

    /// What `try_begin_turn` does when the coordinator hands the conversation
    /// over; the refusal path is covered by the coordinator's own tests.
    fn begin(s: &mut SessionState, item: InboxItem) -> bool {
        let free = s.queue_unless_free(item);
        if free {
            s.activate();
        }
        free
    }

    #[test]
    fn test_a_second_message_queues_behind_the_running_turn() {
        let mut s = SessionState::default();
        assert!(begin(&mut s, item(InboxKind::UserMessage, 1000)));
        assert!(s.turn_active);
        assert!(s.inbox.is_empty(), "starting item is not queued");
        // Second message while active gets queued instead of starting a turn.
        assert!(!begin(&mut s, item(InboxKind::UserMessage, 1001)));
        assert_eq!(s.inbox.len(), 1);
    }

    /// The session must not be marked active until the conversation is actually
    /// taken: a desktop turn can refuse in between, and an active session with
    /// no turn behind it would queue every later message forever.
    #[test]
    fn test_a_refused_conversation_leaves_the_session_idle() {
        let mut s = SessionState::default();
        assert!(s.queue_unless_free(item(InboxKind::UserMessage, 1000)));
        // The coordinator says no, so `activate` is never called.
        assert!(!s.turn_active);
        assert!(s.inbox.is_empty(), "nothing may be queued behind a turn we do not own");
        // The next message can still try.
        assert!(begin(&mut s, item(InboxKind::UserMessage, 1001)));
    }

    #[test]
    fn test_finish_continues_on_late_user_message() {
        let mut s = SessionState::default();
        assert!(begin(&mut s, item(InboxKind::UserMessage, 1000)));
        s.inbox.push(item(InboxKind::Notice, 1001));
        s.inbox.push(item(InboxKind::UserMessage, 1002));
        match s.finish(2000) {
            Finish::Continue(items) => {
                assert_eq!(items.len(), 2, "notices ride along with the user message");
                assert!(s.turn_active, "session stays active for the follow-up turn");
                assert!(s.inbox.is_empty());
            }
            Finish::Done => panic!("expected Continue"),
        }
    }

    #[test]
    fn test_finish_done_keeps_notice_queued() {
        let mut s = SessionState::default();
        assert!(begin(&mut s, item(InboxKind::UserMessage, 1000)));
        s.inbox.push(item(InboxKind::Notice, 1001));
        match s.finish(2000) {
            Finish::Done => {
                assert!(!s.turn_active);
                assert_eq!(s.inbox.len(), 1, "notice waits for the next trigger");
            }
            Finish::Continue(_) => panic!("expected Done"),
        }
    }

    #[test]
    fn test_finish_drops_expired_items() {
        let mut s = SessionState::default();
        assert!(begin(&mut s, item(InboxKind::UserMessage, 0)));
        s.inbox.push(item(InboxKind::UserMessage, 0));
        match s.finish(super::INBOX_EXPIRY_MS + 1) {
            Finish::Done => assert!(s.inbox.is_empty()),
            Finish::Continue(_) => panic!("expired item must not restart a turn"),
        }
    }

    #[test]
    fn test_push_note_cap_drops_oldest_notice() {
        let mut s = SessionState::default();
        for i in 0..(NOTICE_INBOX_CAP + 2) {
            s.push_note(format!("n{i}"), 1000 + i as i64);
        }
        let notices: Vec<&str> = s.inbox.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(notices.len(), NOTICE_INBOX_CAP);
        assert_eq!(notices.first(), Some(&"n2"), "oldest notes dropped first");
    }

    #[test]
    fn test_record_seen_ring() {
        let mut s = SessionState::default();
        for i in 0..(SEEN_IDS_CAP as i64 + 10) {
            s.record_seen(i);
        }
        assert_eq!(s.seen_message_ids.len(), SEEN_IDS_CAP);
        assert!(!s.seen_message_ids.contains(&5), "oldest ids evicted");
        assert!(s.seen_message_ids.contains(&(SEEN_IDS_CAP as i64 + 9)));
    }

    #[test]
    fn test_validate_listen_loopback_needs_no_token() {
        assert!(validate_listen_config("127.0.0.1", None).is_ok());
        assert!(validate_listen_config("::1", None).is_ok());
        assert!(validate_listen_config("localhost", None).is_ok());
    }

    #[test]
    fn test_validate_listen_non_loopback_requires_long_token() {
        assert!(validate_listen_config("0.0.0.0", None).is_err());
        assert!(validate_listen_config("0.0.0.0", Some("short")).is_err());
        assert!(validate_listen_config("192.168.1.10", None).is_err());
        assert!(validate_listen_config("0.0.0.0", Some("0123456789abcdef")).is_ok());
    }

    #[test]
    fn test_token_matches_bearer_header() {
        assert!(token_matches("secret", Some("Bearer secret"), None));
        assert!(token_matches("secret", Some("Token secret"), None));
        assert!(token_matches("secret", Some("secret"), None));
        assert!(!token_matches("secret", Some("Bearer wrong"), None));
    }

    #[test]
    fn test_token_matches_query() {
        assert!(token_matches("secret", None, Some("access_token=secret")));
        assert!(token_matches("secret", None, Some("foo=1&access_token=secret")));
        assert!(!token_matches("secret", None, Some("access_token=wrong")));
    }

    #[test]
    fn test_token_matches_query_percent_encoded() {
        assert!(token_matches("s3cr:t/x", None, Some("access_token=s3cr%3At%2Fx")));
        assert!(!token_matches("s3cr:t/x", None, Some("access_token=s3cr%3At%2Fy")));
    }

    #[test]
    fn test_token_matches_none() {
        assert!(!token_matches("secret", None, None));
    }
}
