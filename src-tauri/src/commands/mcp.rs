use std::collections::BTreeMap;

use crate::ServicesExt;
use crate::commands::entity_response::{McpServerInfoResponse, McpServerListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::entity::mcp_server;
use meridian_core::db::entity::mcp_server::{McpServerChangeset, McpTransport};
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::ops::mcp_server as mcp_server_ops;
use meridian_core::db::types::{Json, SqlBool};
use meridian_core::mcp;
use meridian_core::util::{double_option, now_ms};

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct McpResolvedToolPolicyInfoResponse {
    pub scope: meridian_core::agent::hooks::ToolScope,
    pub loading: meridian_core::agent::hooks::ToolLoading,
    pub approval: meridian_core::agent::hooks::ToolApprovalPolicy,
    pub needs_always_reapproval: bool,
}

impl From<mcp::policy::ResolvedMcpToolPolicy> for McpResolvedToolPolicyInfoResponse {
    fn from(value: mcp::policy::ResolvedMcpToolPolicy) -> Self {
        Self {
            scope: value.scope,
            loading: value.loading,
            approval: value.approval,
            needs_always_reapproval: value.needs_always_reapproval,
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct McpDefaultPolicyInfoResponse {
    pub scope: meridian_core::agent::hooks::ToolScope,
    pub loading: meridian_core::agent::hooks::ToolLoading,
    pub approval: meridian_core::agent::hooks::ToolApprovalPolicy,
}

impl From<mcp::policy::McpToolPolicy> for McpDefaultPolicyInfoResponse {
    fn from(value: mcp::policy::McpToolPolicy) -> Self {
        Self {
            scope: value.scope,
            loading: value.loading,
            approval: value.approval,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerToolInfoResponse {
    pub server_id: String,
    pub server_name: String,
    pub qualified_name: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub enabled: bool,
    pub definition_tokens: usize,
    pub resolved_policy: McpResolvedToolPolicyInfoResponse,
}

fn tool_response(
    value: mcp::McpToolDef,
    enabled: bool,
    resolved_policy: mcp::policy::ResolvedMcpToolPolicy,
) -> McpServerToolInfoResponse {
    let definition_tokens = mcp::definition_tokens(&value.qualified_name, &value.description, &value.input_schema);
    McpServerToolInfoResponse {
        server_id: value.server_id,
        server_name: value.server_name,
        qualified_name: value.qualified_name,
        name: value.name,
        description: value.description,
        input_schema: value.input_schema,
        enabled,
        definition_tokens,
        resolved_policy: resolved_policy.into(),
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerDeleteRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerConnectRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerDisconnectRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpToolListRequest {
    server_id: RequiredNullable<String>,
}

#[tauri::command]
pub async fn list_mcp_servers(app: tauri::AppHandle) -> Result<McpServerListResponse, String> {
    let services = app.services();
    let rows = mcp_server_ops::list(&services.db).await.map_err(|e| e.to_string())?;
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
        disabled_tools: Json(Vec::new()),
        default_policy_json: None,
        tool_policies_json: None,
        approved_always_tools_json: None,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };
    let row = services
        .db
        .write(async |tx| mcp_server_ops::create(tx, row).await)
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
        disabled_tools: None,
        default_policy_json: None,
        tool_policies_json: None,
        approved_always_tools_json: None,
        updated_at: Some(now_ms()),
    };
    let row = services
        .db
        .write(async |tx| mcp_server_ops::update(tx, &request.id, changeset).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

#[tauri::command]
pub async fn delete_mcp_server(app: tauri::AppHandle, request: McpServerDeleteRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    services.mcp.disconnect(&id).await;
    services
        .db
        .write(async |tx| mcp_server_ops::delete(tx, &id).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn connect_mcp_server(app: tauri::AppHandle, request: McpServerConnectRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    let server = mcp_server_ops::get(&services.db, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("MCP server `{id}` not found"))?;

    let registry = services.mcp.clone();
    registry.connect(&server).await
}

#[tauri::command]
pub async fn disconnect_mcp_server(app: tauri::AppHandle, request: McpServerDisconnectRequest) -> Result<(), String> {
    // Deliberately leaves `is_enabled` alone. Disconnecting is something you do
    // now; auto-connect is something you meant for next time.
    let services = app.services();
    services.mcp.disconnect(&request.id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_tools(
    app: tauri::AppHandle,
    request: McpToolListRequest,
) -> Result<McpServerToolListResponse, String> {
    let services = app.services();
    let registry = services.mcp.clone();
    let tools = match request.server_id.0 {
        Some(sid) => registry.tools_for_server(&sid),
        None => registry.tools().as_ref().clone(),
    };
    let (global_default, servers) = services
        .db
        .read(async |tx| {
            let global = match mcp::policy::read_global_default(tx).await {
                Ok(policy) => policy,
                Err(error) => return Ok::<_, DbErr>(Err(error)),
            };
            let rows = mcp_server_ops::list(tx).await?;
            Ok(Ok((global, rows)))
        })
        .await
        .map_err(|e| e.to_string())??;
    let by_id: std::collections::HashMap<&str, &mcp_server::Model> =
        servers.iter().map(|s| (s.id.as_str(), s)).collect();
    Ok(tools
        .into_iter()
        .map(|tool| {
            let enabled = registry.is_tool_enabled(&tool.server_id, &tool.name);
            let server_row = by_id.get(tool.server_id.as_str()).copied();
            let resolved = mcp::policy::resolve_tool_policy(
                global_default,
                server_row.and_then(|s| s.default_policy_json.as_ref().map(|j| &j.0)),
                server_row
                    .and_then(|s| s.tool_policies_json.as_ref())
                    .and_then(|j| j.0.get(&tool.name)),
                server_row
                    .and_then(|s| s.approved_always_tools_json.as_ref())
                    .map(|j| j.0.as_slice()),
                &tool.name,
            );
            tool_response(tool, enabled, resolved)
        })
        .collect())
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpDefaultPolicyUpdateRequest {
    scope: meridian_core::agent::hooks::ToolScope,
    loading: meridian_core::agent::hooks::ToolLoading,
    approval: meridian_core::agent::hooks::ToolApprovalPolicy,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerPolicyUpdateRequest {
    server_id: String,
    scope: RequiredNullable<meridian_core::agent::hooks::ToolScope>,
    loading: RequiredNullable<meridian_core::agent::hooks::ToolLoading>,
    approval: RequiredNullable<meridian_core::agent::hooks::ToolApprovalPolicy>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpToolPolicyUpdateRequest {
    server_id: String,
    tool_name: String,
    scope: RequiredNullable<meridian_core::agent::hooks::ToolScope>,
    loading: RequiredNullable<meridian_core::agent::hooks::ToolLoading>,
    approval: RequiredNullable<meridian_core::agent::hooks::ToolApprovalPolicy>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerApproveAlwaysToolsRequest {
    server_id: String,
    tool_names: Vec<String>,
}

#[tauri::command]
pub async fn get_mcp_default_policy(app: tauri::AppHandle) -> Result<McpDefaultPolicyInfoResponse, String> {
    let services = app.services();
    let policy = mcp::policy::read_global_default(&services.db).await?;
    Ok(policy.into())
}

#[tauri::command]
pub async fn set_mcp_default_policy(
    app: tauri::AppHandle,
    request: McpDefaultPolicyUpdateRequest,
) -> Result<McpDefaultPolicyInfoResponse, String> {
    let services = app.services();
    let policy = mcp::policy::McpToolPolicy {
        scope: request.scope,
        loading: request.loading,
        approval: request.approval,
    };
    let now = now_ms();
    services
        .db
        .write(
            async |tx| match mcp::policy::write_global_default(tx, policy, now).await {
                Ok(()) => Ok::<_, DbErr>(Ok(())),
                Err(error) => Ok(Err(error)),
            },
        )
        .await
        .map_err(|e| e.to_string())??;
    Ok(policy.into())
}

/// Set or clear server-level MCP policy overrides.
///
/// When `approval` is explicitly set to `always`, snapshots the server's
/// currently connected tool names into `approved_always_tools_json` so
/// existing tools can run automatically while any unseen tools introduced by a
/// future upstream MCP upgrade fall back to `request_approve`.
#[tauri::command]
pub async fn set_mcp_server_policy(
    app: tauri::AppHandle,
    request: McpServerPolicyUpdateRequest,
) -> Result<McpServerInfoResponse, String> {
    let services = app.services();
    let override_policy = mcp::policy::McpToolPolicyOverride {
        scope: request.scope.0,
        loading: request.loading.0,
        approval: request.approval.0,
    };
    let connected_tool_names: Vec<String> = services
        .mcp
        .tools_for_server(&request.server_id)
        .into_iter()
        .map(|t| t.name)
        .collect();
    let row = services
        .db
        .write(async |tx| {
            let server = mcp_server_ops::get(tx, &request.server_id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("MCP server `{}`", request.server_id)))?;
            let approved_always =
                if override_policy.approval == Some(meridian_core::agent::hooks::ToolApprovalPolicy::Always) {
                    let mut approved = server
                        .approved_always_tools_json
                        .map(Json::into_inner)
                        .unwrap_or_default();
                    for name in &connected_tool_names {
                        if !approved.iter().any(|existing| existing == name) {
                            approved.push(name.clone());
                        }
                    }
                    approved.sort();
                    Some(Some(Json(approved)))
                } else {
                    None
                };
            let default_policy_json = if override_policy.is_empty() {
                Some(None)
            } else {
                Some(Some(Json(override_policy)))
            };
            mcp_server_ops::update(
                tx,
                &request.server_id,
                McpServerChangeset {
                    default_policy_json,
                    approved_always_tools_json: approved_always,
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

/// Set or clear a per-tool MCP policy override keyed by the server-native tool name.
#[tauri::command]
pub async fn set_mcp_tool_policy(
    app: tauri::AppHandle,
    request: McpToolPolicyUpdateRequest,
) -> Result<McpServerInfoResponse, String> {
    if request.tool_name.is_empty() {
        return Err("tool name is empty".into());
    }
    let services = app.services();
    let override_policy = mcp::policy::McpToolPolicyOverride {
        scope: request.scope.0,
        loading: request.loading.0,
        approval: request.approval.0,
    };
    let row = services
        .db
        .write(async |tx| {
            let server = mcp_server_ops::get(tx, &request.server_id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("MCP server `{}`", request.server_id)))?;
            let mut map = server.tool_policies_json.map(Json::into_inner).unwrap_or_default();
            if override_policy.is_empty() {
                map.remove(&request.tool_name);
            } else {
                map.insert(request.tool_name.clone(), override_policy);
            }
            let tool_policies_json = if map.is_empty() {
                Some(None)
            } else {
                Some(Some(Json(map)))
            };
            mcp_server_ops::update(
                tx,
                &request.server_id,
                McpServerChangeset {
                    tool_policies_json,
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

/// Explicitly acknowledge newly appeared tool names under an `always` server/global policy.
#[tauri::command]
pub async fn set_mcp_approved_always_tools(
    app: tauri::AppHandle,
    request: McpServerApproveAlwaysToolsRequest,
) -> Result<McpServerInfoResponse, String> {
    if request.tool_names.iter().any(|name| name.is_empty()) {
        return Err("tool name is empty".into());
    }
    let services = app.services();
    let row = services
        .db
        .write(async |tx| {
            let server = mcp_server_ops::get(tx, &request.server_id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("MCP server `{}`", request.server_id)))?;
            let mut approved = server
                .approved_always_tools_json
                .map(Json::into_inner)
                .unwrap_or_default();
            for name in &request.tool_names {
                if !approved.iter().any(|existing| existing == name) {
                    approved.push(name.clone());
                }
            }
            approved.sort();
            mcp_server_ops::update(
                tx,
                &request.server_id,
                McpServerChangeset {
                    approved_always_tools_json: Some(Some(Json(approved))),
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.into())
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpToolEnabledUpdateRequest {
    server_id: String,
    tool_name: String,
    enabled: bool,
}

/// Turn one of a server's tools on or off. The name is the server's own, not
/// the `mcp__…` qualified form. Writes first, then the live snapshot, so a
/// failed save cannot leave the model seeing a tool the row still offers.
#[tauri::command]
pub async fn set_mcp_tool_enabled(
    app: tauri::AppHandle,
    request: McpToolEnabledUpdateRequest,
) -> Result<McpServerInfoResponse, String> {
    if request.tool_name.is_empty() {
        return Err("tool name is empty".into());
    }
    let services = app.services();
    let row = services
        .db
        .write(async |tx| {
            let server = mcp_server_ops::get(tx, &request.server_id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("MCP server `{}`", request.server_id)))?;
            let mut names = server.disabled_tools.0.clone();
            if request.enabled {
                names.retain(|name| name != &request.tool_name);
            } else if !names.iter().any(|name| name == &request.tool_name) {
                names.push(request.tool_name.clone());
            }
            mcp_server_ops::update(
                tx,
                &request.server_id,
                McpServerChangeset {
                    disabled_tools: Some(Json(names)),
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
        })
        .await
        .map_err(|e| e.to_string())?;
    services
        .mcp
        .set_tool_enabled(&request.server_id, &request.tool_name, request.enabled);
    Ok(row.into())
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
pub async fn list_tools(app: tauri::AppHandle) -> Result<McpToolListResponse, String> {
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
        if !services.mcp.is_tool_enabled(&t.server_id, &t.name) {
            continue;
        }
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

    Ok(result)
}

#[cfg(test)]
mod response_contract_tests {
    use super::*;

    #[test]
    fn tool_response_is_closed_and_complete() {
        let valid = serde_json::json!({
            "name": "read_file",
            "description": "",
            "source": "builtin",
            "admin_only": false,
            "needs_approval": false,
            "scope": "any"
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
