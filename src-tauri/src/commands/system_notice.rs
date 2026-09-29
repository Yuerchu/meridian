//! What this machine is doing on its own, for the inbox's "system" tab.
//!
//! Not questions: nothing here waits on anybody, so none of it goes to the
//! floating stack, which carries questions and nothing else. It lives in the
//! inbox so that something the app did unasked — rebuilding the input
//! method's dictionaries after an update — has somewhere to say so, and to say
//! when it failed.
//!
//! Device-local by construction: the register is this process's, the event is
//! emitted straight to this window rather than through the bus (a remote
//! client would be shown this machine's keyboard, and would drop the
//! connection over a channel it does not know), and both commands are `local`.

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::system_notice::SystemNotices;

/// The channel the register publishes on.
pub const SYSTEM_NOTICE_CHANNEL: &str = "system-notice";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SystemNoticeInfoResponse {
    pub id: String,
    /// Milliseconds since the epoch.
    pub started_at: i64,
    /// Null while it is still going.
    pub finished_at: Option<i64>,
    pub detail: SystemNoticeDetail,
}

pub type SystemNoticeListResponse = Vec<SystemNoticeInfoResponse>;

/// What happened. One kind today; each kind names its own facts so the page
/// can word them, rather than the backend handing over a sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemNoticeDetail {
    /// Dictionaries written by an older build being rebuilt in this one's
    /// format (`meridian_ime_dict::upgrade_in_place`).
    ImeDictionaryUpgrade {
        state: ImeDictionaryUpgradeState,
        /// Names of the dictionaries being upgraded, in catalog order.
        dictionaries: Vec<String>,
        upgraded: u32,
        failures: Vec<ImeDictionaryUpgradeFailureInfoResponse>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImeDictionaryUpgradeState {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImeDictionaryUpgradeFailureInfoResponse {
    pub name: String,
    pub error: String,
}

/// What the channel carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SystemNoticeEvent {
    /// A notice appeared or changed; replaces any with the same id.
    Upsert {
        notice: SystemNoticeInfoResponse,
    },
    Dismiss {
        id: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SystemNoticeDismissRequest {
    pub id: String,
}

/// Every notice this process is holding, oldest first. What the inbox
/// rebuilds from after a reload; the event is never replayed.
#[tauri::command]
pub fn list_system_notices(app: tauri::AppHandle) -> SystemNoticeListResponse {
    app.state::<SystemNotices>().list()
}

/// Takes a finished notice out of the inbox. One still running cannot be:
/// it would come straight back with its next change.
#[tauri::command]
pub fn dismiss_system_notice(app: tauri::AppHandle, request: SystemNoticeDismissRequest) -> Result<(), String> {
    app.state::<SystemNotices>().dismiss(&request.id)
}
