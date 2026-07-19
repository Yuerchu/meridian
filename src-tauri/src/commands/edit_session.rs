use tauri::Manager;

use crate::state::EditSessions;
use crate::tools;

#[derive(serde::Serialize)]
pub struct StagedEditInfo {
    path: String,
    diff: String,
    tool_name: String,
}

#[tauri::command]
pub async fn list_staged_edits(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Vec<StagedEditInfo>, String> {
    let sessions = app.state::<EditSessions>();
    let map = sessions.0.lock().await;
    if let Some(session) = map.get(&conversation_id) {
        let s = session.lock().await;
        Ok(s.pending_files().into_iter().map(|(p, e)| StagedEditInfo {
            path: p.display().to_string(),
            diff: e.diff.clone(),
            tool_name: e.tool_name.clone(),
        }).collect())
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn approve_staged_edit(
    app: tauri::AppHandle,
    conversation_id: String,
    path: String,
) -> Result<(), String> {
    let sessions = app.state::<EditSessions>();
    let map = sessions.0.lock().await;
    let session = map.get(&conversation_id).ok_or("No edit session for this conversation")?;
    let mut s = session.lock().await;
    let pb = std::path::PathBuf::from(&path);
    let edit = s.approve(&pb).ok_or("No staged edit for this path")?;
    let target = tools::ResolvedTarget::Real(pb);
    tools::backend::write_string(&target, &edit.proposed).await?;
    Ok(())
}

#[tauri::command]
pub async fn approve_all_staged_edits(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<usize, String> {
    let sessions = app.state::<EditSessions>();
    let map = sessions.0.lock().await;
    let session = map.get(&conversation_id).ok_or("No edit session for this conversation")?;
    let mut s = session.lock().await;
    let edits = s.approve_all();
    let count = edits.len();
    for (path, edit) in edits {
        let target = tools::ResolvedTarget::Real(path);
        tools::backend::write_string(&target, &edit.proposed).await?;
    }
    Ok(count)
}

#[tauri::command]
pub async fn reject_staged_edit(
    app: tauri::AppHandle,
    conversation_id: String,
    path: String,
) -> Result<(), String> {
    let sessions = app.state::<EditSessions>();
    let map = sessions.0.lock().await;
    let session = map.get(&conversation_id).ok_or("No edit session for this conversation")?;
    let mut s = session.lock().await;
    let pb = std::path::PathBuf::from(&path);
    s.reject(&pb).ok_or("No staged edit for this path")?;
    Ok(())
}
