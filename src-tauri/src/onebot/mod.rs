mod agent;
mod command;
mod format;
mod handler;
mod media;
mod protocol;
mod qq_tools;
mod session;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, watch, Mutex};

use crate::db::DbPool;
use crate::mcp::McpManager;
use crate::secrets::SecretsManager;
use crate::tools::ToolRegistry;
use crate::util::{get_conn, now_ms};

use protocol::{OneBotAction, OneBotFrame, OneBotResponse};
use session::SessionManager;

pub struct SharedState {
    pub pool: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub tools: Arc<ToolRegistry>,
    pub mcp: Arc<Mutex<McpManager>>,
    pub sessions: Mutex<SessionManager>,
    /// Session key → (initiator user_id, responder). Only the user who
    /// triggered the tool call may answer the approval prompt.
    pub pending_approvals: Mutex<HashMap<String, (i64, oneshot::Sender<bool>)>>,
    pub pending_api_responses: Mutex<HashMap<String, oneshot::Sender<OneBotResponse>>>,
    pub pending_requests: Mutex<HashMap<u32, PendingRequest>>,
    pub request_seq: AtomicU32,
    pub ws_sinks: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    pub connected_clients: AtomicU32,
    pub config: OneBotConfig,
    pub app_handle: Option<tauri::AppHandle>,
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
        mcp: Arc<Mutex<McpManager>>,
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
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() {
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
                    let actions = handler::handle_message(&event, &state).await;
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
    use super::{token_matches, validate_listen_config};

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
