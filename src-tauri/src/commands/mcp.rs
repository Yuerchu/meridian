use tauri::Manager;

use crate::db;
use crate::db::models::mcp_server::{McpServer, McpServerUpdate, NewMcpServer};
use crate::mcp;
use crate::state::{AppDb, AppMcp, AppTools};
use crate::util::{double_option, now_ms};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerPatch {
    name: Option<String>,
    transport_type: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    command: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    args: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    env: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    url: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    headers: Option<Option<String>>,
    is_enabled: Option<i32>,
}

#[tauri::command]
pub async fn list_mcp_servers(app: tauri::AppHandle) -> Result<Vec<McpServer>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::list_mcp_servers(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_mcp_server(
    app: tauri::AppHandle,
    name: String,
    transport_type: String,
    command: Option<String>,
    args: Option<String>,
    env: Option<String>,
    url: Option<String>,
    headers: Option<String>,
) -> Result<McpServer, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        db::ops::mcp_server::create_mcp_server(&mut conn, &NewMcpServer {
            id: &id, name: &name, transport_type: &transport_type,
            command: command.as_deref(), args: args.as_deref(),
            env: env.as_deref(), url: url.as_deref(),
            headers: headers.as_deref(),
            is_enabled: 1, sort_order: 0, created_at: now, updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_mcp_server(
    app: tauri::AppHandle,
    id: String,
    updates: McpServerPatch,
) -> Result<McpServer, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::update_mcp_server(&mut conn, &id, &McpServerUpdate {
            name: updates.name,
            transport_type: updates.transport_type,
            command: updates.command,
            args: updates.args,
            env: updates.env,
            url: updates.url,
            headers: updates.headers,
            is_enabled: updates.is_enabled,
            updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    {
        let mcp = app.state::<AppMcp>();
        mcp.0.lock().await.disconnect_server(&id).await;
    }
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::delete_mcp_server(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn connect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let server = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::get_mcp_server(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    let mcp = app.state::<AppMcp>();
    mcp.0.lock().await.connect_server(&server).await
}

#[tauri::command]
pub async fn disconnect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mcp = app.state::<AppMcp>();
    mcp.0.lock().await.disconnect_server(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_tools(app: tauri::AppHandle, server_id: Option<String>) -> Result<Vec<mcp::McpToolDef>, String> {
    let mcp = app.state::<AppMcp>();
    let mgr = mcp.0.lock().await;
    if let Some(sid) = server_id {
        Ok(mgr.tool_defs_for_server(&sid).into_iter().cloned().collect())
    } else {
        Ok(mgr.tools.iter().cloned().collect::<Vec<_>>())
    }
}

#[tauri::command]
pub async fn list_all_tool_names(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let tool_registry = app.state::<AppTools>();
    let mcp = app.state::<AppMcp>();
    let mgr = mcp.0.lock().await;

    let mut result: Vec<serde_json::Value> = tool_registry.0.definitions().iter().map(|t| {
        serde_json::json!({"name": t.name, "description": t.description, "source": "builtin"})
    }).collect();

    for t in &mgr.tools {
        result.push(serde_json::json!({
            "name": t.qualified_name, "description": t.description,
            "source": "mcp", "server_name": t.server_name
        }));
    }

    // Session-scoped QQ tools (OneBot is desktop-only); listed for visibility,
    // they are offered to the model only inside OneBot sessions.
    #[cfg(not(target_os = "android"))]
    result.extend(crate::onebot::qq_tool_catalog());

    Ok(result)
}
