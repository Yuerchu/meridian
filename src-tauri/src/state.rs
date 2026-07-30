use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use crate::agent::CompactCircuitBreaker;
use crate::db::DbPool;
use crate::edit_session;
use crate::mcp;
use crate::secrets::SecretsManager;
use crate::tools;

pub(crate) struct AppSecrets(pub(crate) Arc<SecretsManager>);
pub(crate) struct AppDb(pub(crate) DbPool);
pub(crate) struct AppTools(pub(crate) Arc<tools::ToolRegistry>);
pub(crate) struct AppMcp(pub(crate) Arc<Mutex<mcp::McpManager>>);

pub(crate) static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ApprovalDecision {
    Approved,
    Denied(Option<String>),
    Response(String),
}

pub(crate) struct ApprovalWaiters(pub(crate) Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>);

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
pub(crate) struct ActiveChats(pub(crate) Mutex<HashMap<String, CancellationToken>>);
pub(crate) struct EditSessions(pub(crate) Mutex<HashMap<String, Arc<tokio::sync::Mutex<edit_session::EditSession>>>>);
pub(crate) struct CompactBreakers(pub(crate) Mutex<HashMap<String, Arc<CompactCircuitBreaker>>>);
