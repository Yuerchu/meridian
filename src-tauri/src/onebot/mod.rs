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

use crate::db::DbPool;
use crate::mcp::McpRegistry;
use crate::secrets::SecretsManager;
use crate::tools::ToolRegistry;
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
    /// Session key → (initiator user_id, responder). Only the user who
    /// triggered the tool call may answer the approval prompt.
    pub pending_approvals: Mutex<HashMap<String, (i64, oneshot::Sender<bool>)>>,
    pub pending_api_responses: Mutex<HashMap<String, oneshot::Sender<OneBotResponse>>>,
    pub pending_requests: Mutex<HashMap<u32, PendingRequest>>,
    pub request_seq: AtomicU32,
    pub ws_sinks: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    pub connected_clients: AtomicU32,
    /// Session key → turn/inbox state. All turn-active/inbox transitions happen
    /// under this single lock so a message can never race past an active turn.
    pub session_states: Mutex<HashMap<String, SessionState>>,
    pub config: OneBotConfig,
    pub app_handle: Option<tauri::AppHandle>,
    /// (session, user) → the memory ids their last listing showed, in the order
    /// it showed them. Numbers only mean something against the listing they came
    /// from; see `MemoryListing`.
    pub memory_listings: Mutex<HashMap<(String, i64), MemoryListing>>,
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
pub enum TurnEnd {
    Done,
    Continue(Vec<InboxItem>),
}

impl SessionState {
    /// Returns `true` when the turn was started; `false` when another turn is
    /// already running and `item` was queued instead.
    fn begin_or_queue(&mut self, item: InboxItem) -> bool {
        if self.turn_active {
            self.inbox.push(item);
            false
        } else {
            self.turn_active = true;
            true
        }
    }

    /// User messages left in the inbox keep the turn active and are handed
    /// back for an immediate follow-up; notice-only leftovers stay queued.
    fn finish(&mut self, now: i64) -> TurnEnd {
        expire_inbox(&mut self.inbox, now);
        if self.inbox.iter().any(|i| i.kind == InboxKind::UserMessage) {
            TurnEnd::Continue(std::mem::take(&mut self.inbox))
        } else {
            self.turn_active = false;
            TurnEnd::Done
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

/// Try to start a turn for `session`. Returns `true` when the turn was started;
/// `false` when another turn is already running and `item` was queued into the
/// inbox instead (it will be injected mid-turn or picked up at turn end).
pub async fn try_begin_turn(
    state: &Arc<SharedState>,
    session: &SessionKey,
    item: InboxItem,
) -> bool {
    let mut states = state.session_states.lock().await;
    states.entry(session.to_string()).or_default().begin_or_queue(item)
}

/// Finish a turn. If the inbox holds user messages the session stays active and
/// they are handed back for an immediate follow-up turn; notice-only leftovers
/// stay queued for the next trigger.
pub async fn end_turn(state: &Arc<SharedState>, session: &SessionKey) -> TurnEnd {
    let mut states = state.session_states.lock().await;
    states.entry(session.to_string()).or_default().finish(now_ms())
}

/// Force-release a turn without consuming the inbox. Error-path only: leftover
/// items are delivered on the session's next trigger.
pub async fn release_turn(state: &Arc<SharedState>, session: &SessionKey) {
    let mut states = state.session_states.lock().await;
    if let Some(s) = states.get_mut(&session.to_string()) {
        s.turn_active = false;
    }
}

/// Take everything queued for `session`; called by the agent loop between tool
/// rounds so events surface inside the running turn.
pub async fn drain_inbox_mid_turn(state: &Arc<SharedState>, session: &SessionKey) -> Vec<InboxItem> {
    let mut states = state.session_states.lock().await;
    let Some(s) = states.get_mut(&session.to_string()) else { return vec![] };
    expire_inbox(&mut s.inbox, now_ms());
    std::mem::take(&mut s.inbox)
}

/// Queue a notice note for `session`; oldest notes are dropped past the cap.
pub async fn push_notice_note(state: &Arc<SharedState>, session: &SessionKey, text: String) {
    let mut states = state.session_states.lock().await;
    states.entry(session.to_string()).or_default().push_note(text, now_ms());
}

/// Record an OneBot message id that entered the AI context for `session`.
pub async fn record_seen_message(state: &Arc<SharedState>, session: &SessionKey, message_id: i64) {
    let mut states = state.session_states.lock().await;
    states.entry(session.to_string()).or_default().record_seen(message_id);
}

pub async fn was_seen_message(state: &Arc<SharedState>, session: &SessionKey, message_id: i64) -> bool {
    let states = state.session_states.lock().await;
    states
        .get(&session.to_string())
        .is_some_and(|s| s.seen_message_ids.contains(&message_id))
}

/// Handle passed into the headless agent loop so it can pull queued events into
/// the running turn between tool rounds.
pub struct InboxHandle {
    state: Arc<SharedState>,
    session: SessionKey,
}

impl InboxHandle {
    pub fn new(state: Arc<SharedState>, session: SessionKey) -> Self {
        Self { state, session }
    }

    pub async fn drain(&self) -> Vec<InboxItem> {
        drain_inbox_mid_turn(&self.state, &self.session).await
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
    pub fn new(
        pool: DbPool,
        secrets: Arc<SecretsManager>,
        tools: Arc<ToolRegistry>,
        mcp: Arc<McpRegistry>,
        config: OneBotConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        let (shutdown_tx, _) = watch::channel(false);
        Self {
            state: Arc::new(SharedState {
                sessions: Mutex::new(SessionManager::new(pool.clone())),
                pending_approvals: Mutex::new(HashMap::new()),
                pending_api_responses: Mutex::new(HashMap::new()),
                pending_requests: Mutex::new(HashMap::new()),
                // Time-seeded so ids don't restart at 1 after a relaunch, which
                // would let a stale "同意 N" notification approve a new request.
                request_seq: AtomicU32::new((now_ms() / 1000 % 1_000_000) as u32),
                ws_sinks: Mutex::new(HashMap::new()),
                connected_clients: AtomicU32::new(0),
                session_states: Mutex::new(HashMap::new()),
                memory_listings: Mutex::new(HashMap::new()),
                config,
                pool,
                secrets,
                tools,
                mcp,
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
            config,
            Some(handle.clone()),
        );
        handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
        return;
    }

    let secrets = handle.state::<crate::state::AppSecrets>().0.clone();
    let tools = handle.state::<crate::state::AppTools>().0.clone();
    let mcp = handle.state::<crate::state::AppMcp>().0.clone();

    let server = OneBotServer::new(pool, secrets, tools, mcp, config, Some(handle.clone()));
    if let Err(e) = server.start() {
        tracing::error!("Failed to auto-start OneBot server: {e}");
    }
    handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
}

pub struct AppOneBot(pub Arc<Mutex<OneBotServer>>);

#[cfg(test)]
mod tests {
    use super::{
        token_matches, validate_listen_config, InboxItem, InboxKind, SessionState, TurnEnd,
        NOTICE_INBOX_CAP, SEEN_IDS_CAP,
    };

    fn item(kind: InboxKind, at: i64) -> InboxItem {
        InboxItem { text: "x".into(), kind, created_at: at, sender: None }
    }

    #[test]
    fn test_begin_or_queue_mutual_exclusion() {
        let mut s = SessionState::default();
        assert!(s.begin_or_queue(item(InboxKind::UserMessage, 1000)));
        assert!(s.turn_active);
        assert!(s.inbox.is_empty(), "starting item is not queued");
        // Second message while active gets queued instead of starting a turn.
        assert!(!s.begin_or_queue(item(InboxKind::UserMessage, 1001)));
        assert_eq!(s.inbox.len(), 1);
    }

    #[test]
    fn test_finish_continues_on_late_user_message() {
        let mut s = SessionState::default();
        assert!(s.begin_or_queue(item(InboxKind::UserMessage, 1000)));
        s.inbox.push(item(InboxKind::Notice, 1001));
        s.inbox.push(item(InboxKind::UserMessage, 1002));
        match s.finish(2000) {
            TurnEnd::Continue(items) => {
                assert_eq!(items.len(), 2, "notices ride along with the user message");
                assert!(s.turn_active, "session stays active for the follow-up turn");
                assert!(s.inbox.is_empty());
            }
            TurnEnd::Done => panic!("expected Continue"),
        }
    }

    #[test]
    fn test_finish_done_keeps_notice_queued() {
        let mut s = SessionState::default();
        assert!(s.begin_or_queue(item(InboxKind::UserMessage, 1000)));
        s.inbox.push(item(InboxKind::Notice, 1001));
        match s.finish(2000) {
            TurnEnd::Done => {
                assert!(!s.turn_active);
                assert_eq!(s.inbox.len(), 1, "notice waits for the next trigger");
            }
            TurnEnd::Continue(_) => panic!("expected Done"),
        }
    }

    #[test]
    fn test_finish_drops_expired_items() {
        let mut s = SessionState::default();
        assert!(s.begin_or_queue(item(InboxKind::UserMessage, 0)));
        s.inbox.push(item(InboxKind::UserMessage, 0));
        match s.finish(super::INBOX_EXPIRY_MS + 1) {
            TurnEnd::Done => assert!(s.inbox.is_empty()),
            TurnEnd::Continue(_) => panic!("expired item must not restart a turn"),
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
