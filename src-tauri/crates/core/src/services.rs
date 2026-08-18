//! Everything long-lived, in one value.
//!
//! These used to be a dozen newtypes registered with Tauri one at a time and
//! fetched back with `app.state::<AppDb>()`, which made `AppHandle` the way to
//! reach the database — and so made the database unreachable without a window.
//! The handle is a service locator here and nothing more, so replacing it with
//! the services themselves costs nothing and is what lets a turn run under a
//! socket, a chat bot, or a test.
//!
//! Cloning is cheap and expected: the struct is one `Arc`, so a spawned task
//! takes a clone rather than borrowing, and nothing needs a lifetime.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::agent::CompactCircuitBreaker;
use crate::db::DbPool;
use crate::events::EventBus;
use crate::mcp;
use crate::secrets::SecretsManager;
use crate::sleep_inhibitor::AppSleepInhibitor;
use crate::state::{AppSubAgentInboxes, ApprovalWaiters, VoiceState};
use crate::tools;
use crate::turn::TurnCoordinator;

/// The directories the app owns, resolved once.
///
/// Only the shell can answer where these are — on Android it is a path no
/// constant could name — so they are resolved at startup and carried, rather
/// than each caller asking the framework again.
pub struct Paths {
    pub data_dir: PathBuf,
    /// App-private, unlike project instructions, so it stays usable on Android
    /// without a SAF grant.
    pub skills_root: PathBuf,
}

#[derive(Clone)]
pub struct Services(Arc<ServicesInner>);

pub struct ServicesInner {
    pub db: DbPool,
    pub secrets: Arc<SecretsManager>,
    pub tools: Arc<tools::ToolRegistry>,
    /// No outer mutex: the registry locks internally and never across I/O.
    /// Holding one here is what let a single slow MCP call stop every
    /// conversation in the app from assembling its tool set.
    pub mcp: Arc<mcp::McpRegistry>,
    /// Who currently holds each conversation. One table for every writer,
    /// desktop and OneBot alike: `start_onebot` rebuilds the OneBot server's
    /// whole shared state, and an occupancy table that reset when QQ restarted
    /// would hand out a conversation a desktop turn was still writing.
    pub turns: Arc<TurnCoordinator>,
    pub approvals: ApprovalWaiters,
    pub sub_agent_inboxes: AppSubAgentInboxes,
    pub compact_breakers: Mutex<HashMap<String, Arc<CompactCircuitBreaker>>>,
    pub voice: VoiceState,
    pub sleep: AppSleepInhibitor,
    pub events: EventBus,
    pub paths: Paths,
}

impl Services {
    pub fn new(inner: ServicesInner) -> Self {
        Services(Arc::new(inner))
    }
}

/// So a caller writes `services.db` rather than `services.inner().db`. The
/// fields are the interface; the `Arc` is an implementation detail of how they
/// are shared.
impl std::ops::Deref for Services {
    type Target = ServicesInner;

    fn deref(&self) -> &ServicesInner {
        &self.0
    }
}
