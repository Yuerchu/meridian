use tauri::Manager;

use crate::db;
use crate::AppDb;

/// The audit log, newest first.
#[tauri::command]
pub async fn list_audit_messages(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<db::models::audit::AuditMessage>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::audit::list_recent(&mut conn, limit.unwrap_or(200)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drop everything said before `before_ms`, and report how many rows went.
///
/// The only way records leave the audit log, and the reason it is acceptable to
/// keep one at all: retention has to be something the operator states and can
/// act on, or the people in the log can never be forgotten. Deliberately by time
/// rather than by person — a trail with one participant quietly removed reads as
/// though they were never there, which is worse than not keeping one.
#[tauri::command]
pub async fn purge_audit_before(app: tauri::AppHandle, before_ms: i64) -> Result<usize, String> {
    let pool = app.state::<AppDb>().0.clone();
    let removed = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::audit::purge_before(&mut conn, before_ms).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    // Worth a line in the log of its own: this is the one operation that removes
    // records nothing else holds a copy of, and afterwards there is no way to
    // tell from the table that anything was there.
    tracing::info!(removed, before_ms, "audit records purged");
    Ok(removed)
}
