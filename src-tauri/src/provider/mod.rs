pub mod anthropic;
pub mod models;
pub mod openai_compat;
pub mod registry;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn user(content: &str) -> Self {
        Self { role: "user".into(), content: content.into(), tool_calls: None, tool_call_id: None }
    }
    pub fn assistant(content: &str) -> Self {
        Self { role: "assistant".into(), content: content.into(), tool_calls: None, tool_call_id: None }
    }
    pub fn assistant_with_tools(content: &str, tool_calls: Vec<ToolCall>) -> Self {
        Self { role: "assistant".into(), content: content.into(), tool_calls: Some(tool_calls), tool_call_id: None }
    }
    pub fn tool_result(tool_call_id: &str, content: &str) -> Self {
        Self { role: "tool".into(), content: content.into(), tool_calls: None, tool_call_id: Some(tool_call_id.into()) }
    }
}

#[derive(Debug, Clone)]
pub struct ChatParams {
    pub model: String,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i32>,
}

impl Default for ChatParams {
    fn default() -> Self {
        Self {
            model: "gpt-4.1-mini".to_string(),
            temperature: None,
            top_p: None,
            max_tokens: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

pub struct AgentResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("transport: {0}")]
    Transport(#[from] crate::client::TransportError),
    #[error("API error {status}: {body}")]
    Api { status: u16, body: String },
    #[error("parse: {0}")]
    Parse(String),
    #[error("not implemented: {0}")]
    NotImplemented(String),
}

pub type ChatStream = Pin<Box<dyn futures::Stream<Item = Result<String, ProviderError>> + Send>>;

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError>;

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<String, ProviderError>;

    async fn chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<AgentResponse, ProviderError>;
}
