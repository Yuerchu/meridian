//! Letting another device use this one.
//!
//! The desktop is the whole app — the database, the keys, the agent loop — and
//! this is how a second device reaches it rather than keeping a copy. There is
//! no synchronisation anywhere in here on purpose: a phone that connects is
//! looking at the same rows the window is, a turn it starts runs in this
//! process, and closing the phone does not stop it.
//!
//! Which is also why this lives in the shell rather than in `meridian-core`.
//! What it dispatches to are the Tauri commands, and those are the shell's.
//! A headless build would want them in the core instead; nothing here assumes
//! a window, so that day is a move rather than a rewrite.
//!
//! ## What this is not
//!
//! Not the hook endpoint. That one answers a local process, refuses anything
//! carrying an `Origin`, and fails open because a missed review costs one
//! review. This one answers a device across the room, has to satisfy a browser's
//! preflight, and fails closed: no token, no answer.

pub(crate) mod dispatch;
pub(crate) mod http;
pub(crate) mod ws;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use meridian_core::db::DbPool;
use meridian_core::events::SinkId;
use meridian_core::listen_guard::validate_listen_config;
use meridian_core::services::Services;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, watch};

/// Not 8765 (the hook endpoint) and not 6700 (OneBot). Nothing else claims it.
const DEFAULT_PORT: u16 = 8787;

/// Bound to every interface by default because the feature has no other
/// meaning: a remote access server on loopback is reachable only by the machine
/// that already has the app open. `enabled` is what keeps that from mattering
/// until the user asks for it, and `listen_guard` is what stops it happening
/// without a token.
const DEFAULT_HOST: &str = "0.0.0.0";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ListenConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    /// Minted on first enable, like the hook token. What the user types into
    /// their phone once.
    pub token: Option<String>,
}

impl Default for ListenConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: DEFAULT_HOST.into(),
            port: DEFAULT_PORT,
            token: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    /// Live websocket connections. The one number that says whether the phone
    /// on the sofa is actually attached, which "running" does not.
    pub connections: usize,
}

pub fn load_config(pool: &DbPool) -> ListenConfig {
    let Ok(mut conn) = pool.get() else {
        return ListenConfig::default();
    };
    let mut get = |key: &str| -> Option<String> {
        meridian_core::db::ops::preference::get_preference(&mut conn, key)
            .ok()
            .flatten()
    };

    ListenConfig {
        enabled: get("remote.enabled").as_deref() == Some("true"),
        host: get("remote.host").unwrap_or_else(|| DEFAULT_HOST.into()),
        port: get("remote.port").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_PORT),
        token: get("remote.token").filter(|s| !s.is_empty()),
    }
}

pub fn save_config(pool: &DbPool, config: &ListenConfig) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let now = meridian_core::util::now_ms();
    let mut set = |key: &str, value: &str| -> Result<(), String> {
        meridian_core::db::ops::preference::set_preference(&mut conn, key, value, now).map_err(|e| e.to_string())
    };

    set("remote.enabled", if config.enabled { "true" } else { "false" })?;
    set("remote.host", &config.host)?;
    set("remote.port", &config.port.to_string())?;
    set("remote.token", config.token.as_deref().unwrap_or(""))?;
    Ok(())
}

/// Everything a request needs, shared by every connection.
pub(crate) struct SharedState {
    pub config: ListenConfig,
    pub services: Services,
    /// What the dispatcher hands to a command.
    ///
    /// The commands take an `AppHandle` and this is the shell, so there is no
    /// reason to make them take anything else: a remote call ends up in exactly
    /// the same function the window calls, with the same argument. It is the
    /// one place in here that touches Tauri, and it is why moving this module
    /// into a headless build means changing this field rather than rewriting
    /// the dispatcher.
    pub app: tauri::AppHandle,
    /// Where events go once this server is listening.
    pub fanout: Arc<ws::WsFanout>,
    /// Mirrors `fanout.len()` so `status` can be answered without taking that
    /// lock from a command thread.
    pub connections: AtomicUsize,
}

pub struct RemoteServer {
    state: Arc<SharedState>,
    shutdown_tx: watch::Sender<bool>,
    running: Arc<AtomicBool>,
    /// The bus registration, so stopping takes it back out. A fan-out left
    /// registered after the server stops would keep being handed every event in
    /// the app for the rest of the process's life.
    sink: std::sync::Mutex<Option<SinkId>>,
}

impl RemoteServer {
    pub fn new(services: Services, config: ListenConfig, app: tauri::AppHandle) -> Self {
        let (shutdown_tx, _) = watch::channel(false);
        Self {
            state: Arc::new(SharedState {
                config,
                services,
                app,
                fanout: Arc::new(ws::WsFanout::default()),
                connections: AtomicUsize::new(0),
            }),
            shutdown_tx,
            running: Arc::new(AtomicBool::new(false)),
            sink: std::sync::Mutex::new(None),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> ListenStatus {
        ListenStatus {
            enabled: self.state.config.enabled,
            running: self.is_running(),
            host: self.state.config.host.clone(),
            port: self.state.config.port,
            connections: self.state.connections.load(Ordering::Relaxed),
        }
    }

    pub fn config(&self) -> &ListenConfig {
        &self.state.config
    }

    pub fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Err("remote access is already running".into());
        }
        validate_listen_config(
            &self.state.config.host,
            self.state.config.token.as_deref(),
            "the remote access token",
        )?;

        let state = self.state.clone();
        let running = self.running.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        // Set before the task starts, so a `start` immediately followed by
        // another cannot both get past the check above.
        running.store(true, Ordering::Relaxed);

        // Registered before the socket is bound, so nothing can connect and
        // then miss an event that happened while this was being set up.
        // Non-critical: a device that has gone away must not fail the turn that
        // was writing to it -- see the `Emit` doc for the other reading.
        let id = self.state.services.events.register(self.state.fanout.clone(), false);
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);

        tokio::spawn(async move {
            let addr = format!("{}:{}", state.config.host, state.config.port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    tracing::info!("remote access listening on {addr}");
                    l
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to bind remote access to {addr}");
                    running.store(false, Ordering::Relaxed);
                    return;
                }
            };

            let shutdown = async move {
                loop {
                    // `Err` means every sender was dropped, i.e. this server was
                    // replaced by a newer one. Same meaning as `true`, and not
                    // treating it that way spins on a closed channel.
                    match shutdown_rx.changed().await {
                        Err(_) => break,
                        Ok(()) => {
                            if *shutdown_rx.borrow() {
                                break;
                            }
                        }
                    }
                }
                tracing::info!("remote access shutting down");
            };

            if let Err(e) = axum::serve(listener, http::router(state.clone()))
                .with_graceful_shutdown(shutdown)
                .await
            {
                tracing::error!(error = %e, "remote access server ended with an error");
            }
            running.store(false, Ordering::Relaxed);
        });

        Ok(())
    }

    pub fn stop(&self) {
        if let Some(id) = self.sink.lock().unwrap_or_else(|e| e.into_inner()).take() {
            self.state.services.events.unregister(id);
        }
        let _ = self.shutdown_tx.send(true);
        self.running.store(false, Ordering::Relaxed);
    }
}

/// Start the server if the user has it enabled, and hand it back either way, so
/// the IPC commands always have something to talk to.
pub(crate) async fn maybe_start(services: Services, app: tauri::AppHandle) -> AppRemote {
    let config = load_config(&services.db);
    let enabled = config.enabled;

    let server = RemoteServer::new(services, config, app);
    if enabled {
        if let Err(e) = server.start() {
            tracing::error!(error = %e, "failed to auto-start remote access");
        }
    } else {
        tracing::info!("remote access disabled, skipping auto-start");
    }

    AppRemote(Arc::new(Mutex::new(server)))
}

pub struct AppRemote(pub Arc<Mutex<RemoteServer>>);
