//! Driving a hosted Claude Code session from the window.
//!
//! Thin on purpose: everything these do lives in `meridian_core::acp`, because
//! a session has to be startable from something without a window before this is
//! more than one frontend's feature.

use crate::ServicesExt;
use meridian_core::acp::{self, AcpConfig};

/// Start an adapter in `cwd` and give it a conversation. Returns the
/// conversation id, which is what everything else here is keyed by.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_open_session(app: tauri::AppHandle, cwd: String) -> Result<String, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("choose a folder for the session to work in".into());
    }
    // Checked here rather than left to the adapter: `session/new` with a
    // directory that does not exist fails with the adapter's own wording, in
    // the middle of a JSON-RPC error, which reads as a protocol fault.
    if !std::path::Path::new(cwd).is_dir() {
        return Err(format!("`{cwd}` is not a folder"));
    }
    acp::open_session(&app.services(), cwd).await
}

/// Send one prompt and run the turn to completion.
///
/// Awaited rather than spawned, exactly like `chat`: the answer arrives on
/// `chat-stream` while this call is still outstanding, and its return is how the
/// caller learns the turn is over and whether it failed.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_send(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
    turn_id: Option<String>,
) -> Result<(), String> {
    let services = app.services();
    // Reopens a conversation whose adapter died with the last run of the app.
    // The transcript is still here; the agent's memory of it is not.
    let session = acp::reopen_session(&services, &conversation_id).await?;
    session.prompt(&services, &message, turn_id).await
}

/// Stop the turn in flight, leaving the session open.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_cancel(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    if let Some(session) = app.services().acp.get(&conversation_id) {
        session.cancel().await;
    }
    // Absent is success: the turn this was meant to stop has already ended.
    Ok(())
}

/// End the session and the process behind it. The conversation stays.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_close(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    app.services().acp.close(&conversation_id).await;
    Ok(())
}

/// Which conversations have a live adapter behind them right now.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_live_sessions(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(app.services().acp.conversations())
}

/// The knobs the agent exposes for this session: model, mode, effort, and
/// whatever else it invents.
///
/// Empty for a conversation with no live session — including one whose adapter
/// died with the last run of the app. The composer reads that as "nothing to
/// offer" and falls back to showing the model recorded on the transcript, which
/// is the honest answer: there is no session to change anything on.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_session_config(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Vec<meridian_core::acp::protocol::SessionConfigOption>, String> {
    Ok(app
        .services()
        .acp
        .get(&conversation_id)
        .map(|session| session.config_options())
        .unwrap_or_default())
}

/// Change one of them, and hand back the whole set as it now stands.
///
/// The whole set, because changing one reshapes others: picking a model
/// re-derives which modes are available, and a caller that updated only the
/// option it set would offer a mode that no longer exists.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_set_session_config(
    app: tauri::AppHandle,
    conversation_id: String,
    config_id: String,
    value: serde_json::Value,
) -> Result<Vec<meridian_core::acp::protocol::SessionConfigOption>, String> {
    let session = app
        .services()
        .acp
        .get(&conversation_id)
        .ok_or("this conversation has no running Claude Code session")?;
    session.set_config_option(&config_id, value).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_get_config(app: tauri::AppHandle) -> Result<AcpConfig, String> {
    Ok(AcpConfig::load(&app.services().db))
}

/// `local`, and this is the one row here where that is load-bearing:
/// `acp.command` names a binary this app will execute. A remote caller able to
/// write it has arbitrary code execution on the machine running Meridian, which
/// is a different order of thing from the self-lockout the other `local` rows
/// guard. `SERVER_OWNED_PREFIXES` closes the same hole from the `set_preference`
/// side.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_save_config(app: tauri::AppHandle, config: AcpConfig) -> Result<AcpConfig, String> {
    let services = app.services();
    config.save(&services.db)?;
    Ok(AcpConfig::load(&services.db))
}

/// What a working adapter says about itself.
#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize)]
pub struct AcpCheck {
    pub ok: bool,
    /// The adapter's name and version, when it got far enough to say.
    pub agent: Option<String>,
    pub protocol_version: Option<u32>,
    pub load_session: bool,
    /// Present exactly when `ok` is false. Carries the adapter's own stderr,
    /// which is where "command not found" and a node stack trace both end up.
    pub error: Option<String>,
}

/// Start an adapter, greet it, and shut it down.
///
/// The settings page's "is this configured correctly" button. `local` because
/// it launches a process on this machine, and because the answer is about this
/// machine.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_check_adapter(app: tauri::AppHandle) -> Result<AcpCheck, String> {
    let config = AcpConfig::load(&app.services().db);
    match acp::check_adapter(&config).await {
        Ok(report) => Ok(AcpCheck {
            ok: true,
            agent: report.agent,
            protocol_version: Some(report.protocol_version),
            load_session: report.load_session,
            error: None,
        }),
        // A failed check is a successful command: the page wants to draw the
        // reason, not catch an exception.
        Err(e) => Ok(AcpCheck {
            ok: false,
            agent: None,
            protocol_version: None,
            load_session: false,
            error: Some(e),
        }),
    }
}
