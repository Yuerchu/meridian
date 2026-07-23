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
pub(crate) struct ActiveChats(pub(crate) Mutex<HashMap<String, CancellationToken>>);
pub(crate) struct EditSessions(pub(crate) Mutex<HashMap<String, Arc<tokio::sync::Mutex<edit_session::EditSession>>>>);
pub(crate) struct CompactBreakers(pub(crate) Mutex<HashMap<String, Arc<CompactCircuitBreaker>>>);
