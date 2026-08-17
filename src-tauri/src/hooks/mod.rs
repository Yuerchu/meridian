//! The local endpoint another coding agent's hooks call into.
//!
//! "Hook" here means a Claude Code hook, not a git one. Claude Code fires a
//! `PermissionRequest` when it wants to leave plan mode; the plugin behind that
//! hook posts the plan here, and what this answers decides whether the plan
//! goes back for another draft or carries on to the user.
//!
//! The listener is deliberately general — one HTTP server, routes added as more
//! hook events earn one — while [`review`] is the business of this first route.
//!
//! ## The one rule
//!
//! Claude Code treats every failure of an HTTP hook as *proceed*: a refused
//! connection, a non-2xx, a timeout, a body that will not parse. That is the
//! right default and this module is built around it rather than against it.
//! Anything uncertain here becomes a non-200 or an `Inconclusive`, and the plan
//! carries on to the user, who was always the one meant to approve it. The only
//! thing that stops a plan is a review that ran, parsed, and said so.

pub(crate) mod http;
pub(crate) mod protocol;
pub(crate) mod review;
pub(crate) mod verdict;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tokio::net::TcpListener;
use tokio::sync::{Mutex, watch};

use crate::db::DbPool;
use crate::mcp::McpRegistry;
use crate::secrets::SecretsManager;
use crate::tools::ToolRegistry;
use crate::turn::TurnCoordinator;
use crate::util::{get_conn, now_ms};

/// Which incarnation of the server wrote the handshake file.
///
/// Saving settings stops the old server and starts a new one 300ms later, but
/// the old server deletes the handshake from the tail of its own task — on the
/// runtime's schedule, not inside that window. Busy enough and it runs *after*
/// the new server has written the file, deleting a live server's only
/// advertisement: the endpoint answers fine while the plugin reports it as not
/// running, until the app is restarted.
///
/// So the file records who wrote it, and a departing server only deletes what
/// it still owns. This covers both ways the accept loop can exit — an explicit
/// `stop()` and the channel closing when the server is replaced — which a
/// synchronous delete inside `stop()` would not.
static GENERATION: AtomicU64 = AtomicU64::new(0);

const DEFAULT_PORT: u16 = 8765;
const DEFAULT_TIMEOUT_SECS: u32 = 600;
/// The longest a review is allowed to take, and not a number we are free to
/// choose: three layers have to decrease, or nobody gets to say "timed out".
///
/// ```text
/// this ceiling  1200s  ← Meridian gives up and answers 504
/// plugin budget 1260s  ← plugin gives up and reports it to the user
/// hook timeout  1320s  ← Claude Code kills the hook process; user sees nothing
/// ```
///
/// Raising this without raising `BUDGET_MS` in `plan-review-hook.mjs` and
/// `timeout` in the plugin's `hooks.json` does not buy a longer review — it
/// just moves the cutoff to the layer that cannot explain itself.
///
/// The first ceiling here was 300s, chosen on the assumption that a review is a
/// short verdict after a bit of reading. Measured against a real repository it
/// is not: the reviewer is a model of roughly the capability of the one being
/// reviewed, and it works like one — an observed run took 274s over 71 messages
/// and some sixty tool calls before it had checked what the plan claimed. That
/// is the job being done properly, not a runaway, so the budget follows the
/// work rather than the other way round.
const MAX_TIMEOUT_SECS: u32 = 1200;

fn clamp_timeout(secs: u32) -> u32 {
    secs.clamp(10, MAX_TIMEOUT_SECS)
}

/// How many times a plan may be sent back before the gate gives up and lets it
/// through. `0` means never give up on that count alone.
///
/// Not the mechanism that guarantees termination — that is the plugin's
/// stagnation check, which passes a plan the moment two rounds in a row bring
/// no material change, and which measures progress rather than counting it.
/// This covers the narrower case of an agent that keeps producing genuinely
/// different plans that keep failing review, where the question is not
/// correctness but how much the user is willing to spend. So it is theirs to
/// set, and `0` is a legitimate answer.
const DEFAULT_MAX_ROUNDS: u32 = 5;
const MAX_MAX_ROUNDS: u32 = 20;

fn clamp_rounds(rounds: u32) -> u32 {
    rounds.min(MAX_MAX_ROUNDS)
}
/// The file the plugin reads to find this server.
const HANDSHAKE: &str = "plan-gate.json";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HookConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    /// Generated on first enable. Loopback is not a boundary on a desktop —
    /// every process on the machine can reach it, and so can any page the
    /// user's browser has open.
    pub token: Option<String>,
    /// `"<provider_id>:<model_id>"`. No default: which model reviews plans is
    /// the whole point of the feature, and picking one here would quietly
    /// review with whatever happened to be first in the provider list.
    pub review_model: Option<String>,
    /// Supplies temperature, thinking and the rest. `None` uses the default
    /// assistant. The persona is always replaced by the review prompt.
    pub assistant_id: Option<String>,
    pub timeout_secs: u32,
    /// Rounds before the gate stops blocking. `0` = no limit; see
    /// [`DEFAULT_MAX_ROUNDS`].
    pub max_rounds: u32,
}

impl Default for HookConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".into(),
            port: DEFAULT_PORT,
            token: None,
            review_model: None,
            assistant_id: None,
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            max_rounds: DEFAULT_MAX_ROUNDS,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HookStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    /// Where the plugin will look for us. Shown in settings so a user who is
    /// debugging can check the file themselves.
    pub handshake_path: Option<String>,
}

pub fn load_config(pool: &DbPool) -> HookConfig {
    let Ok(mut conn) = pool.get() else {
        return HookConfig::default();
    };
    let mut get = |key: &str| -> Option<String> {
        crate::db::ops::preference::get_preference(&mut conn, key)
            .ok()
            .flatten()
    };

    HookConfig {
        enabled: get("hooks.enabled").as_deref() == Some("true"),
        host: get("hooks.host").unwrap_or_else(|| "127.0.0.1".into()),
        port: get("hooks.port").and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_PORT),
        token: get("hooks.token").filter(|s| !s.is_empty()),
        review_model: get("hooks.plan_review.model").filter(|s| !s.is_empty()),
        assistant_id: get("hooks.plan_review.assistant_id").filter(|s| !s.is_empty()),
        // Clamped on the way in as well as on the way out, so a value stored
        // before the ceiling existed corrects itself on the next load instead
        // of waiting for someone to open the settings page and press save.
        timeout_secs: clamp_timeout(
            get("hooks.plan_review.timeout_secs")
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_TIMEOUT_SECS),
        ),
        max_rounds: clamp_rounds(
            get("hooks.plan_review.max_rounds")
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_MAX_ROUNDS),
        ),
    }
}

pub fn save_config(pool: &DbPool, config: &HookConfig) -> Result<(), String> {
    let mut conn = get_conn(pool)?;
    let now = now_ms();
    let mut set = |key: &str, val: &str| -> Result<(), String> {
        crate::db::ops::preference::set_preference(&mut conn, key, val, now).map_err(|e| e.to_string())
    };

    set("hooks.enabled", if config.enabled { "true" } else { "false" })?;
    set("hooks.host", &config.host)?;
    set("hooks.port", &config.port.to_string())?;
    set("hooks.token", config.token.as_deref().unwrap_or(""))?;
    set("hooks.plan_review.model", config.review_model.as_deref().unwrap_or(""))?;
    set(
        "hooks.plan_review.assistant_id",
        config.assistant_id.as_deref().unwrap_or(""),
    )?;
    set(
        "hooks.plan_review.timeout_secs",
        &clamp_timeout(config.timeout_secs).to_string(),
    )?;
    set(
        "hooks.plan_review.max_rounds",
        &clamp_rounds(config.max_rounds).to_string(),
    )?;
    Ok(())
}

/// A 32-character hex token. Not a secret anyone types, so length beats shape.
pub fn generate_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub(crate) struct SharedState {
    pub config: HookConfig,
    pub pool: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub tools: Arc<ToolRegistry>,
    pub mcp: Arc<McpRegistry>,
    pub coordinator: Arc<TurnCoordinator>,
    /// Only to announce that a review conversation exists or has moved on.
    ///
    /// The review loop deliberately streams to nobody — there is no window
    /// waiting on it. But the conversation it writes shows up in the sidebar,
    /// and the sidebar only refetches when something says so. Without this the
    /// review is invisible for the several minutes it runs, which is the same
    /// as the gate not being installed.
    pub app_handle: Option<tauri::AppHandle>,
}

pub struct HookServer {
    state: Arc<SharedState>,
    shutdown_tx: watch::Sender<bool>,
    running: Arc<AtomicBool>,
    handshake: Option<std::path::PathBuf>,
}

impl HookServer {
    pub fn new(
        pool: DbPool,
        secrets: Arc<SecretsManager>,
        tools: Arc<ToolRegistry>,
        mcp: Arc<McpRegistry>,
        coordinator: Arc<TurnCoordinator>,
        config: HookConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        let handshake = app_handle.as_ref().and_then(handshake_path);
        let (shutdown_tx, _) = watch::channel(false);
        Self {
            state: Arc::new(SharedState {
                config,
                pool,
                secrets,
                tools,
                mcp,
                coordinator,
                app_handle,
            }),
            shutdown_tx,
            running: Arc::new(AtomicBool::new(false)),
            handshake,
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> HookStatus {
        HookStatus {
            enabled: self.state.config.enabled,
            running: self.is_running(),
            host: self.state.config.host.clone(),
            port: self.state.config.port,
            handshake_path: self.handshake.as_ref().map(|p| p.display().to_string()),
        }
    }

    pub fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Err("hook server is already running".into());
        }
        validate_listen_config(&self.state.config.host, self.state.config.token.as_deref())?;

        let state = self.state.clone();
        let running = self.running.clone();
        let handshake = self.handshake.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;

        running.store(true, Ordering::Relaxed);

        tokio::spawn(async move {
            let addr = format!("{}:{}", state.config.host, state.config.port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    tracing::info!("hook server listening on {addr}");
                    l
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to bind hook server to {addr}");
                    running.store(false, Ordering::Relaxed);
                    return;
                }
            };

            // Written only after the bind succeeds: the file means "there is
            // something listening on this port", and writing it earlier would
            // point the plugin at a port that lost the race for it.
            if let Some(path) = &handshake {
                write_handshake(path, &state.config, generation);
            }

            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        // Err = every sender dropped, i.e. this server was
                        // replaced. Same meaning as `true`, and not treating it
                        // that way spins on a closed channel.
                        if changed.is_err() || *shutdown_rx.borrow() {
                            tracing::info!("hook server shutting down");
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, peer)) => http::serve(stream, peer, state.clone()),
                            Err(e) => tracing::warn!(error = %e, "hook server accept failed"),
                        }
                    }
                }
            }

            if let Some(path) = &handshake {
                remove_handshake_if_ours(path, generation);
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

fn handshake_path(handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    handle.path().app_data_dir().ok().map(|d| d.join(HANDSHAKE))
}

fn write_handshake(path: &std::path::Path, config: &HookConfig, generation: u64) {
    let body = serde_json::json!({
        "version": 1,
        "host": config.host,
        "port": config.port,
        "token": config.token.as_deref().unwrap_or(""),
        "pid": std::process::id(),
        "timeoutMs": config.timeout_secs as u64 * 1000,
        // The plugin counts the rounds, so it needs the ceiling. Carried here
        // rather than configured on that side because this is where the user
        // already sets the model and the timeout.
        "maxRounds": config.max_rounds,
        "generation": generation,
    });
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Written to a sibling and renamed over the target, for the same reason the
    // plugin writes its own state that way: two generations overlapping would
    // otherwise leave a half-written file, and a reader that cannot parse it
    // concludes the service is not running.
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let staged = std::fs::write(&tmp, body.to_string()).and_then(|()| std::fs::rename(&tmp, path));
    match staged {
        // The token is in this file, so say where it is and nothing else.
        Ok(()) => tracing::info!(path = %path.display(), generation, "hook handshake written"),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            tracing::error!(error = %e, path = %path.display(), "failed to write hook handshake");
        }
    }
}

/// Delete the handshake only if this generation is still the one it names.
///
/// Anything else — a newer generation, an unreadable file, one with no
/// generation at all — is left alone. A stale file costs one failed connection
/// that the plugin reports accurately; deleting a live server's file costs a
/// silently disabled gate until the next restart.
fn remove_handshake_if_ours(path: &std::path::Path, generation: u64) {
    let owner = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("generation").and_then(serde_json::Value::as_u64));

    match owner {
        Some(found) if found == generation => {
            let _ = std::fs::remove_file(path);
            tracing::debug!(path = %path.display(), generation, "hook handshake removed");
        }
        other => tracing::debug!(
            path = %path.display(),
            generation,
            found = ?other,
            "hook handshake left in place; it belongs to someone else"
        ),
    }
}

/// Off loopback, anyone who can reach the socket can put text in front of a
/// model that reads this machine's files and can spend money doing it. A token
/// is the minimum, and a short one is not a token.
fn validate_listen_config(host: &str, token: Option<&str>) -> Result<(), String> {
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
    if is_loopback {
        return Ok(());
    }
    match token {
        Some(t) if t.len() >= 16 => Ok(()),
        Some(_) => Err(
            "the hook token is too short for a non-loopback address (need at least 16 characters); use a longer token or bind to 127.0.0.1"
                .into(),
        ),
        None => Err(
            "the hook server refuses to listen on a non-loopback address without a token; set one or bind to 127.0.0.1"
                .into(),
        ),
    }
}

/// Called from Tauri setup. Manages the state even when disabled, so the IPC
/// commands always have something to talk to.
pub async fn maybe_start(handle: tauri::AppHandle) {
    use tauri::Manager;

    let pool = handle.state::<crate::state::AppDb>().0.clone();
    let config = load_config(&pool);
    let enabled = config.enabled;

    let server = HookServer::new(
        pool,
        handle.state::<crate::state::AppSecrets>().0.clone(),
        handle.state::<crate::state::AppTools>().0.clone(),
        handle.state::<crate::state::AppMcp>().0.clone(),
        handle.state::<crate::state::AppTurns>().0.clone(),
        config,
        Some(handle.clone()),
    );

    if enabled {
        if let Err(e) = server.start() {
            tracing::error!(error = %e, "failed to auto-start hook server");
        }
    } else {
        tracing::info!("hook server disabled, skipping auto-start");
    }

    handle.manage(AppHooks(Arc::new(Mutex::new(server))));
}

pub struct AppHooks(pub Arc<Mutex<HookServer>>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_needs_no_token() {
        assert!(validate_listen_config("127.0.0.1", None).is_ok());
        assert!(validate_listen_config("localhost", None).is_ok());
        assert!(validate_listen_config("::1", None).is_ok());
    }

    #[test]
    fn off_loopback_needs_a_long_token() {
        assert!(validate_listen_config("0.0.0.0", None).is_err());
        assert!(validate_listen_config("0.0.0.0", Some("123456789012345")).is_err());
        assert!(validate_listen_config("0.0.0.0", Some("1234567890123456")).is_ok());
    }

    fn handshake_with(dir: &std::path::Path, generation: u64) -> std::path::PathBuf {
        let path = dir.join(HANDSHAKE);
        write_handshake(&path, &HookConfig::default(), generation);
        path
    }

    #[test]
    fn a_departing_server_deletes_only_its_own_handshake() {
        let dir = tempfile::tempdir().unwrap();
        let path = handshake_with(dir.path(), 1);

        // The generation that has been replaced tries to clean up last.
        remove_handshake_if_ours(&path, 1);
        assert!(!path.exists(), "its own file should go");

        // Now the case that used to disable the gate: generation 2 is live and
        // generation 1 wakes up late.
        let path = handshake_with(dir.path(), 2);
        remove_handshake_if_ours(&path, 1);
        assert!(path.exists(), "a live server's file must survive a stale cleanup");
    }

    #[test]
    fn a_handshake_that_names_nobody_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HANDSHAKE);

        for body in ["not json at all", r#"{"port":8765}"#] {
            std::fs::write(&path, body).unwrap();
            remove_handshake_if_ours(&path, 1);
            assert!(path.exists(), "should not delete on `{body}`");
        }
    }

    /// Zero survives, because "never give up on a count" is a real answer here
    /// and not the same as "unset".
    #[test]
    fn the_round_limit_allows_no_limit_at_all() {
        assert_eq!(clamp_rounds(0), 0);
        assert_eq!(clamp_rounds(5), 5);
        assert_eq!(clamp_rounds(999), MAX_MAX_ROUNDS);
    }

    /// A value stored before the ceiling existed (the author's own config held
    /// 1200) has to come back clamped, not honoured.
    #[test]
    fn the_review_timeout_cannot_outlive_the_layers_above_it() {
        assert_eq!(clamp_timeout(3600), MAX_TIMEOUT_SECS);
        assert_eq!(clamp_timeout(1200), 1200);
        assert_eq!(clamp_timeout(300), 300);
        assert_eq!(clamp_timeout(0), 10);
    }

    #[test]
    fn generated_tokens_are_long_enough_to_bind_off_loopback() {
        let token = generate_token();
        assert_eq!(token.len(), 32);
        assert!(validate_listen_config("0.0.0.0", Some(&token)).is_ok());
    }
}
