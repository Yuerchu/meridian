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

    pub async fn connect_server(&mut self, server: &McpServer) -> Result<(), String> {
        let mut transport: Box<dyn McpTransport> = match server.transport_type.as_str() {
            "stdio" => {
                let command = server.command.as_deref().ok_or("missing command")?;
                let args: Vec<String> = server.args.as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                let env: HashMap<String, String> = server.env.as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                Box::new(StdioTransport::spawn(command, &args, &env, None).await?)
            }
            "streamablehttp" => {
                let url = server.url.as_deref().ok_or("missing URL")?;
                let headers: HashMap<String, String> = server.headers.as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                Box::new(StreamableHttpTransport::new(url, &headers)?)
            }
            other => return Err(format!("unsupported transport: {}", other)),
        };

        transport.request("initialize", Some(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "meridian", "version": "0.1.0" }
        }))).await?;

        transport.notify("notifications/initialized", None).await.ok();

        let result = transport.request("tools/list", None).await?;
        let tools_result: McpToolsListResult = serde_json::from_value(result)
            .map_err(|e| format!("parse tools/list: {e}"))?;

        self.tools.retain(|t| t.server_id != server.id);
        for tool in tools_result.tools {
            self.tools.push(McpToolDef {
                server_id: server.id.clone(),
                server_name: server.name.clone(),
                name: tool.name.clone(),
                qualified_name: build_qualified_name(&server.name, &tool.name),
                description: tool.description.unwrap_or_default(),
                input_schema: tool.input_schema.unwrap_or(serde_json::json!({"type": "object"})),
            });
        }

        self.clients.insert(server.id.clone(), transport);
        Ok(())
    }

    pub async fn disconnect_server(&mut self, server_id: &str) {
        if let Some(mut transport) = self.clients.remove(server_id) {
            transport.shutdown().await;
        }
        self.tools.retain(|t| t.server_id != server_id);
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

        let transport = self.clients.get_mut(&server_id)
            .ok_or("MCP server not connected")?;

        let result = transport.request("tools/call", Some(serde_json::json!({
            "name": original_name,
            "arguments": args,
        }))).await?;

        let call_result: McpCallToolResult = serde_json::from_value(result)
            .map_err(|e| format!("parse tools/call result: {e}"))?;

        let text = call_result.content.iter()
            .filter(|c| c.content_type == "text")
            .filter_map(|c| c.text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");

        if call_result.is_error {
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
