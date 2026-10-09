use std::collections::BTreeMap;

use crate::ServicesExt;
use crate::commands::entity_response::{McpServerInfoResponse, McpServerListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::entity::mcp_server;
use meridian_core::db::entity::mcp_server::{McpServerChangeset, McpTransport};
use meridian_core::db::sea::ops::mcp_server as mcp_server_ops;
use meridian_core::db::types::{Json, SqlBool};
use meridian_core::mcp;
use meridian_core::util::{double_option, now_ms};

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerToolInfoResponse {
    pub server_id: String,
    pub server_name: String,
    pub qualified_name: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

impl From<mcp::McpToolDef> for McpServerToolInfoResponse {
    fn from(value: mcp::McpToolDef) -> Self {
        Self {
            server_id: value.server_id,
            server_name: value.server_name,
            qualified_name: value.qualified_name,
            name: value.name,
            description: value.description,
            input_schema: value.input_schema,
        }
    }
}

pub type McpServerToolListResponse = Vec<McpServerToolInfoResponse>;

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpConnectionStateResponse {
    Disconnected,
    Connecting,
    Connected,
}

impl From<mcp::ConnectionState> for McpConnectionStateResponse {
    fn from(value: mcp::ConnectionState) -> Self {
        match value {
            mcp::ConnectionState::Disconnected => Self::Disconnected,
            mcp::ConnectionState::Connecting => Self::Connecting,
            mcp::ConnectionState::Connected => Self::Connected,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpConnectionStatusInfoResponse {
    pub server_id: String,
    pub state: McpConnectionStateResponse,
    pub tool_count: usize,
}

impl From<mcp::McpConnectionStatus> for McpConnectionStatusInfoResponse {
    fn from(value: mcp::McpConnectionStatus) -> Self {
        Self {
            server_id: value.server_id,
            state: value.state.into(),
            tool_count: value.tool_count,
        }
    }
}

pub type McpConnectionStatusListResponse = Vec<McpConnectionStatusInfoResponse>;

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpToolSource {
    Builtin,
    Mcp,
    Onebot,
}

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpToolScope {
    Any,
    Group,
    Private,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpToolInfoResponse {
    pub name: String,
    pub description: String,
    pub source: McpToolSource,
    pub server_name: Option<String>,
    pub admin_only: Option<bool>,
    pub needs_approval: Option<bool>,
    pub scope: Option<McpToolScope>,
}

pub type McpToolListResponse = Vec<McpToolInfoResponse>;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerCreateRequest {
    name: String,
    transport_type: McpTransport,
    command: RequiredNullable<String>,
    args: RequiredNullable<Vec<String>>,
    env: RequiredNullable<BTreeMap<String, String>>,
    url: RequiredNullable<String>,
    headers: RequiredNullable<BTreeMap<String, String>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerUpdateRequest {
    id: String,
    name: Option<String>,
    transport_type: Option<McpTransport>,
    #[serde(default, deserialize_with = "double_option")]
    command: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    args: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "double_option")]
    env: Option<Option<BTreeMap<String, String>>>,
    #[serde(default, deserialize_with = "double_option")]
    url: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    headers: Option<Option<BTreeMap<String, String>>>,
    is_enabled: Option<bool>,
}

#[tauri::command]
pub async fn list_mcp_servers(app: tauri::AppHandle) -> Result<McpServerListResponse, String> {
    let services = app.services();
    let rows = mcp_server_ops::list_mcp_servers(&services.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn create_mcp_server(
    app: tauri::AppHandle,
    request: McpServerCreateRequest,
) -> Result<McpServerInfoResponse, String> {
    let services = app.services();
    let now = now_ms();
    let row = mcp_server::Model {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        transport_type: request.transport_type,
        command: request.command.0,
        args: request.args.0.map(Json),
        env: request.env.0.map(Json),
        url: request.url.0,
        headers: request.headers.0.map(Json),
        // `is_enabled` now means "connect this one at startup", which is
        // not something a server should opt into merely by existing. The
        // user turns it on once they know the configuration works.
        is_enabled: SqlBool::FALSE,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };
    let row = services
        .db
        .write(async |tx| mcp_server_ops::create_mcp_server(tx, row).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

#[tauri::command]
pub async fn update_mcp_server(
    app: tauri::AppHandle,
    request: McpServerUpdateRequest,
) -> Result<McpServerInfoResponse, String> {
    let services = app.services();
    let changeset = McpServerChangeset {
        name: request.name,
        transport_type: request.transport_type,
        command: request.command,
        args: request.args.map(|args| args.map(Json)),
        env: request.env.map(|env| env.map(Json)),
        url: request.url,
        headers: request.headers.map(|headers| headers.map(Json)),
        is_enabled: request.is_enabled.map(SqlBool::from),
        updated_at: Some(now_ms()),
    };
    let row = services
        .db
        .write(async |tx| mcp_server_ops::update_mcp_server(tx, &request.id, changeset).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

#[tauri::command]
pub async fn delete_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    services.mcp.disconnect(&id).await;
    services
        .db
        .write(async |tx| mcp_server_ops::delete_mcp_server(tx, &id).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn connect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let server = mcp_server_ops::get_mcp_server(&services.db, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("MCP server `{id}` not found"))?;

    let registry = services.mcp.clone();
    registry.connect(&server).await
}

#[tauri::command]
pub async fn disconnect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Deliberately leaves `is_enabled` alone. Disconnecting is something you do
    // now; auto-connect is something you meant for next time.
    let services = app.services();
    services.mcp.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_tools(
    app: tauri::AppHandle,
    server_id: Option<String>,
) -> Result<McpServerToolListResponse, String> {
    let services = app.services();
    let registry = services.mcp.clone();
    let tools = match server_id {
        Some(sid) => registry.tools_for_server(&sid),
        None => registry.tools().as_ref().clone(),
    };
    Ok(tools.into_iter().map(Into::into).collect())
}

/// Whether each server is actually connected.
///
/// The settings page used to infer this from the tool list, which showed a
/// server that connects and exposes nothing as disconnected while its process
/// was running quite happily.
#[tauri::command]
pub async fn list_mcp_connection_statuses(app: tauri::AppHandle) -> Result<McpConnectionStatusListResponse, String> {
    let services = app.services();
    Ok(services
        .mcp
        .all_connection_statuses()
        .into_iter()
        .map(Into::into)
        .collect())
}

#[tauri::command]
pub async fn list_all_tool_names(app: tauri::AppHandle) -> Result<McpToolListResponse, String> {
    let services = app.services();
    let tool_registry = &services.tools;
    let mcp_tools = services.mcp.tools();

    // Mode transitions are left out on purpose: which of them is offered follows
    // from the conversation's mode, not from the assistant, so ticking one here
    // would promise something the tool assembly immediately overrides.
    let mut result: McpToolListResponse = tool_registry
        .definitions()
        .iter()
        .filter(|t| !meridian_core::agent::modes::transition_tools().any(|n| n == t.name))
        .map(|t| McpToolInfoResponse {
            name: t.name.clone(),
            description: t.description.clone(),
            source: McpToolSource::Builtin,
            server_name: None,
            admin_only: None,
            needs_approval: None,
            scope: None,
        })
        .collect();

    for t in mcp_tools.iter() {
        result.push(McpToolInfoResponse {
            name: t.qualified_name.clone(),
            description: t.description.clone(),
            source: McpToolSource::Mcp,
            server_name: Some(t.server_name.clone()),
            admin_only: None,
            needs_approval: None,
            scope: None,
        });
    }

    // Session-scoped QQ tools (OneBot is desktop-only); listed for visibility,
    // they are offered to the model only inside OneBot sessions.
    #[cfg(not(target_os = "android"))]
    for tool in meridian_core::onebot::qq_tool_catalog() {
        result.push(
            serde_json::from_value(tool)
                .map_err(|error| format!("invalid built-in OneBot tool catalog entry: {error}"))?,
        );
    }

    Ok(result)
}

#[cfg(test)]
mod response_contract_tests {
    use super::*;

    #[test]
    fn tool_response_is_closed_and_complete() {
        let valid = serde_json::json!({
            "name": "qq_get_group_info",
            "description": "",
            "source": "onebot",
            "admin_only": false,
            "needs_approval": false,
            "scope": "group"
        });
        let response: McpToolInfoResponse = serde_json::from_value(valid).unwrap();
        let serialized = serde_json::to_value(response).unwrap();
        assert!(serialized.get("server_name").is_some_and(serde_json::Value::is_null));

        let unknown_source = serde_json::json!({
            "name": "x", "description": "", "source": "plugin"
        });
        assert!(serde_json::from_value::<McpToolInfoResponse>(unknown_source).is_err());

        let unknown_field = serde_json::json!({
            "name": "x", "description": "", "source": "builtin", "future": true
        });
        assert!(serde_json::from_value::<McpToolInfoResponse>(unknown_field).is_err());
    }
}
