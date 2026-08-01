pub mod protocol;
pub mod stdio;
pub mod streamable_http;

use std::collections::HashMap;
use serde::Serialize;

use crate::db::models::mcp_server::McpServer;
use crate::provider::ToolDefinition;
use protocol::{McpCallToolResult, McpToolsListResult};
use stdio::StdioTransport;
use streamable_http::StreamableHttpTransport;

#[async_trait::async_trait]
pub trait McpTransport: Send {
    async fn request(&mut self, method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String>;
    async fn notify(&mut self, method: &str, params: Option<serde_json::Value>) -> Result<(), String>;
    async fn shutdown(&mut self);
}

#[derive(Debug, Clone, Serialize)]
pub struct McpToolDef {
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub qualified_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

pub struct McpManager {
    clients: HashMap<String, Box<dyn McpTransport>>,
    pub tools: Vec<McpToolDef>,
}

fn sanitize_name(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect()
}

fn build_qualified_name(server_name: &str, tool_name: &str) -> String {
    format!("mcp__{}__{}", sanitize_name(server_name), sanitize_name(tool_name))
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            tools: Vec::new(),
        }
    }

    /// Connect, handshake and list tools.
    ///
    /// Every stage is logged with a `stage` field, because from the user's side
    /// they all end as one red toast: a server that never started and a server
    /// that started but exposes nothing both show up as an empty tool list.
    pub async fn connect_server(&mut self, server: &McpServer) -> Result<(), String> {
        let started = std::time::Instant::now();
        let fail = |stage: &'static str, error: String| -> String {
            tracing::warn!(
                server_id = %server.id,
                server_name = %server.name,
                transport = %server.transport_type,
                stage,
                error = %error,
                "MCP server connection failed"
            );
            error
        };

        let mut transport: Box<dyn McpTransport> = match server.transport_type.as_str() {
            "stdio" => {
                let command = server.command.as_deref()
                    .ok_or_else(|| fail("config", "missing command".into()))?;
                let args = Self::parse_config_field::<Vec<String>>(server.args.as_deref(), "args", &server.id);
                // A malformed env is the worst of the three: the server starts
                // without its token and fails every call with a 401 that looks
                // like the user's key is wrong.
                let env = Self::parse_config_field::<HashMap<String, String>>(server.env.as_deref(), "env", &server.id);
                Box::new(
                    StdioTransport::spawn(command, &args, &env, None)
                        .await
                        .map_err(|e| fail("spawn", e))?,
                )
            }
            "streamablehttp" => {
                let url = server.url.as_deref()
                    .ok_or_else(|| fail("config", "missing URL".into()))?;
                let headers = Self::parse_config_field::<HashMap<String, String>>(
                    server.headers.as_deref(), "headers", &server.id,
                );
                Box::new(StreamableHttpTransport::new(url, &headers).map_err(|e| fail("connect", e))?)
            }
            other => return Err(fail("config", format!("unsupported transport: {other}"))),
        };

        transport.request("initialize", Some(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "meridian", "version": "0.1.0" }
        }))).await.map_err(|e| fail("initialize", e))?;

        if let Err(e) = transport.notify("notifications/initialized", None).await {
            // Some servers refuse later requests without it, so a failure here
            // explains an otherwise baffling timeout further down.
            tracing::debug!(server_id = %server.id, error = %e, "MCP initialized notification failed");
        }

        let result = transport.request("tools/list", None).await.map_err(|e| fail("tools_list", e))?;
        let tools_result: McpToolsListResult = serde_json::from_value(result)
            .map_err(|e| fail("parse_tools", format!("parse tools/list: {e}")))?;

        self.tools.retain(|t| t.server_id != server.id);
        for tool in tools_result.tools {
            let mut qualified_name = build_qualified_name(&server.name, &tool.name);
            // sanitize_name folds distinct names onto the same string (e.g.
            // "foo-bar" and "foo_bar"). If another server already owns this
            // qualified name, disambiguate with the server id so a call can't
            // route to the wrong server.
            if self.tools.iter().any(|t| t.qualified_name == qualified_name && t.server_id != server.id) {
                qualified_name = format!("{qualified_name}__{}", sanitize_name(&server.id));
                tracing::warn!("MCP tool name collision on '{qualified_name}'; disambiguated by server id");
            }
            self.tools.push(McpToolDef {
                server_id: server.id.clone(),
                server_name: server.name.clone(),
                name: tool.name.clone(),
                qualified_name,
                description: tool.description.unwrap_or_default(),
                input_schema: tool.input_schema.unwrap_or(serde_json::json!({"type": "object"})),
            });
        }

        let tool_count = self.tools.iter().filter(|t| t.server_id == server.id).count();
        self.clients.insert(server.id.clone(), transport);
        // Connecting is a user-initiated, low-frequency state change, and the
        // tool count is what distinguishes "connected" from "connected but
        // useless".
        tracing::info!(
            server_id = %server.id,
            server_name = %server.name,
            transport = %server.transport_type,
            tool_count,
            duration_ms = started.elapsed().as_millis() as u64,
            "MCP server connected"
        );
        Ok(())
    }

    /// Parse one JSON-encoded config field, falling back to the default.
    ///
    /// The value is never logged: `env` and `headers` are exactly where tokens
    /// live. serde's message carries a position, not the contents.
    fn parse_config_field<T: Default + serde::de::DeserializeOwned>(
        raw: Option<&str>,
        field: &'static str,
        server_id: &str,
    ) -> T {
        let Some(raw) = raw.filter(|s| !s.trim().is_empty()) else { return T::default() };
        match serde_json::from_str(raw) {
            Ok(value) => value,
            Err(e) => {
                tracing::warn!(
                    server_id = %server_id,
                    field,
                    line = e.line(),
                    column = e.column(),
                    "malformed MCP server config; continuing without it"
                );
                T::default()
            }
        }
    }

    pub async fn disconnect_server(&mut self, server_id: &str) {
        let tool_count = self.tools.iter().filter(|t| t.server_id == server_id).count();
        if let Some(mut transport) = self.clients.remove(server_id) {
            transport.shutdown().await;
        }
        self.tools.retain(|t| t.server_id != server_id);
        tracing::info!(server_id = %server_id, tools_removed = tool_count, "MCP server disconnected");
    }

    pub async fn call_tool(
        &mut self,
        qualified_name: &str,
        args: serde_json::Value,
    ) -> Result<String, String> {
        let tool_def = self.tools.iter()
            .find(|t| t.qualified_name == qualified_name)
            .ok_or_else(|| format!("MCP tool not found: {qualified_name}"))?;

        let server_id = tool_def.server_id.clone();
        let original_name = tool_def.name.clone();

        let transport = self.clients.get_mut(&server_id).ok_or_else(|| {
            // The tool list and the client map disagree — a bug rather than a
            // configuration problem, and the model just sees "MCP error".
            tracing::error!(
                server_id = %server_id,
                qualified_name,
                "MCP tool is listed but its server has no live connection"
            );
            "MCP server not connected"
        })?;

        let result = transport.request("tools/call", Some(serde_json::json!({
            "name": original_name,
            "arguments": args,
        }))).await.map_err(|e| {
            tracing::warn!(
                server_id = %server_id,
                tool = %original_name,
                error = %e,
                "MCP tool call failed"
            );
            e
        })?;

        let call_result: McpCallToolResult = serde_json::from_value(result).map_err(|e| {
            tracing::warn!(
                server_id = %server_id,
                tool = %original_name,
                error = %e,
                "MCP tool result did not match the expected shape"
            );
            format!("parse tools/call result: {e}")
        })?;

        let text = call_result.content.iter()
            .filter(|c| c.content_type == "text")
            .filter_map(|c| c.text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");

        if call_result.is_error {
            // Length only: the text is tool output and goes to the model, not
            // into a file the user may export.
            tracing::warn!(
                server_id = %server_id,
                tool = %original_name,
                result_len = text.len(),
                "MCP tool reported an error"
            );
            Err(text)
        } else {
            Ok(if text.is_empty() { "(no output)".to_string() } else { text })
        }
    }

    pub fn all_tool_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|t| ToolDefinition {
            name: t.qualified_name.clone(),
            description: t.description.clone(),
            parameters: t.input_schema.clone(),
        }).collect()
    }

    pub fn tool_defs_for_server(&self, server_id: &str) -> Vec<&McpToolDef> {
        self.tools.iter().filter(|t| t.server_id == server_id).collect()
    }

    pub async fn shutdown_all(&mut self) {
        let ids: Vec<String> = self.clients.keys().cloned().collect();
        for id in ids {
            self.disconnect_server(&id).await;
        }
    }
}
