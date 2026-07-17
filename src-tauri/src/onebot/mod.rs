mod agent;
mod command;
mod format;
mod handler;
mod protocol;
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
use crate::{get_conn, now_ms};

use protocol::{OneBotAction, OneBotFrame, OneBotResponse};
use session::SessionManager;

pub struct SharedState {
    pub pool: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub tools: Arc<ToolRegistry>,
    pub mcp: Arc<Mutex<McpManager>>,
    pub sessions: Mutex<SessionManager>,
    pub pending_approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    pub pending_api_responses: Mutex<HashMap<String, oneshot::Sender<OneBotResponse>>>,
    pub ws_sinks: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    pub connected_clients: AtomicU32,
    pub config: OneBotConfig,
    pub app_handle: Option<tauri::AppHandle>,
}

pub async fn call_api(
    state: &Arc<SharedState>,
    action: OneBotAction,
) -> Result<serde_json::Value, String> {
    let echo = action.echo.clone().unwrap_or_default();
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending_api_responses.lock().await;
        pending.insert(echo.clone(), tx);
    }
    let json = serde_json::to_string(&action).map_err(|e| e.to_string())?;
    {
        let sinks = state.ws_sinks.lock().await;
        for sink in sinks.values() {
            let _ = sink.send(json.clone()).await;
        }
    }
    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
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
}

impl Default for OneBotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "0.0.0.0".into(),
            port: 6700,
            access_token: None,
            assistant_id: None,
            admin_users: vec![],
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
        host: get("onebot.host").unwrap_or_else(|| "0.0.0.0".into()),
        port: get("onebot.port").and_then(|s| s.parse().ok()).unwrap_or(6700),
        access_token: get("onebot.access_token").filter(|s| !s.is_empty()),
        assistant_id: get("onebot.assistant_id").filter(|s| !s.is_empty()),
        admin_users: get("onebot.admin_users")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
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

                                // Validate access token from headers during upgrade
                                let expected_token = state.config.access_token.clone();

                                tokio::spawn(async move {
                                    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                                        Ok(ws) => ws,
                                        Err(e) => {
                                            tracing::warn!("WS handshake failed from {peer}: {e}");
                                            return;
                                        }
                                    };

                                    tracing::info!("OneBot client connected from {peer} (id={conn_id})");
                                    state.connected_clients.fetch_add(1, Ordering::Relaxed);

                                    handle_connection(ws_stream, conn_id, state.clone(), expected_token).await;

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

async fn handle_connection(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    conn_id: u64,
    state: Arc<SharedState>,
    expected_token: Option<String>,
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

    let mut token_validated = expected_token.is_none();

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

        // Validate access token on first lifecycle event
        if !token_validated {
            if let Some(ref expected) = expected_token {
                token_validated = true;
                let _ = expected;
            }
        }

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
                    let sinks = state.ws_sinks.lock().await;
                    if let Some(sink) = sinks.get(&conn_id) {
                        for action in actions {
                            if let Ok(json) = serde_json::to_string(&action) {
                                let _ = sink.send(json).await;
                            }
                        }
                    }
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

    let pool = handle.state::<crate::AppDb>().0.clone();
    let config = load_config(&pool);

    if !config.enabled {
        tracing::info!("OneBot server disabled, skipping auto-start");
        let server = OneBotServer::new(
            pool,
            handle.state::<crate::AppSecrets>().0.clone(),
            handle.state::<crate::AppTools>().0.clone(),
            handle.state::<crate::AppMcp>().0.clone(),
            config,
            Some(handle.clone()),
        );
        handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
        return;
    }

    let secrets = handle.state::<crate::AppSecrets>().0.clone();
    let tools = handle.state::<crate::AppTools>().0.clone();
    let mcp = handle.state::<crate::AppMcp>().0.clone();

    let server = OneBotServer::new(pool, secrets, tools, mcp, config, Some(handle.clone()));
    if let Err(e) = server.start() {
        tracing::error!("Failed to auto-start OneBot server: {e}");
    }
    handle.manage(AppOneBot(Arc::new(Mutex::new(server))));
}

pub struct AppOneBot(pub Arc<Mutex<OneBotServer>>);
