pub mod anthropic;
pub mod capabilities;
pub mod deepseek;
pub mod gemma_tool;
pub mod models;
pub mod openai_compat;
pub mod openai_responses;
pub mod registry;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    /// Anthropic extended-thinking signature for the reasoning block. Kept only
    /// in-memory for the current turn's tool loop; never persisted to the DB.
    pub signature: Option<String>,
}

impl ChatMessage {
    pub fn user(content: &str) -> Self {
        Self { role: "user".into(), content: content.into(), reasoning_content: None, tool_calls: None, tool_call_id: None, signature: None }
    }
    pub fn assistant(content: &str) -> Self {
        Self { role: "assistant".into(), content: content.into(), reasoning_content: None, tool_calls: None, tool_call_id: None, signature: None }
    }
    pub fn assistant_with_tools(content: &str, reasoning_content: Option<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self { role: "assistant".into(), content: content.into(), reasoning_content, tool_calls: Some(tool_calls), tool_call_id: None, signature: None }
    }
    pub fn tool_result(tool_call_id: &str, content: &str) -> Self {
        Self { role: "tool".into(), content: content.into(), reasoning_content: None, tool_calls: None, tool_call_id: Some(tool_call_id.into()), signature: None }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ChatParams {
    pub model: String,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i32>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<i32>,
    pub thinking_effort: Option<String>,
    /// Low-latency tier. Providers translate this to their own wire format:
    /// OpenAI sends `service_tier: "priority"`, Anthropic sends `speed: "fast"`
    /// plus the fast-mode beta header.
    pub fast: bool,
    /// OpenAI Responses `text.verbosity`. Ignored by every other provider.
    pub verbosity: Option<String>,
    /// Copied in by `capabilities::filter_params` so providers can pick the
    /// right request shape without needing the whole capability struct.
    pub thinking_style: ThinkingStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart { message_id: String },
    Text { content: String },
    Reasoning { content: String },
    ReasoningSignature { signature: String },
    ToolCallStart { index: usize, id: String, name: String },
    ToolCallDelta { index: usize, arguments: String },
    ToolCallDone { index: usize, arguments: String },
    UsageUpdate { usage: TokenUsage },
    Stop { reason: String, usage: Option<TokenUsage> },
    Error { message: String },
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub total_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_hit_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_miss_tokens: Option<i32>,
}

/// How a model expects its reasoning to be switched on. Each provider maps this
/// to a different request shape, and getting it wrong is a hard 400 on the
/// newer Anthropic models rather than a silently ignored field.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThinkingStyle {
    /// No reasoning support at all.
    #[default]
    None,
    /// Effort is the only knob; there is no on/off switch (OpenAI o-series, gpt-5.x).
    EffortOnly,
    /// `thinking: {type: "enabled", budget_tokens: N}` (Claude Sonnet 4.5 / Haiku 4.5 and earlier).
    Budget,
    /// `thinking: {type: "adaptive"}` plus `output_config.effort` (Claude Opus 4.6-4.8, Sonnet 4.6/5).
    /// `budget_tokens` is rejected with a 400 on Opus 4.7+ and Sonnet 5.
    Adaptive,
    /// Thinking is always on and the `thinking` field must be omitted entirely (Claude Fable 5).
    AlwaysOn,
    /// Only the off-switch is sent, as `thinking: {type: "disabled"}` (DeepSeek).
    ToggleOff,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_tools: bool,
    pub supports_streaming_tools: bool,
    pub supports_thinking: bool,
    pub supports_images: bool,
    pub max_context_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub supports_pdf: bool,
    pub supports_temperature: bool,
    pub supports_top_p: bool,
    /// Mirrors `!supported_efforts.is_empty()`. Kept as its own field so older
    /// frontend builds keep working against the new backend.
    pub supports_reasoning_effort: bool,
    pub max_temperature: Option<f32>,
    pub thinking_style: ThinkingStyle,
    /// Effort tiers this model actually accepts, in ascending order. Anything
    /// outside this list is coerced before it reaches the wire.
    pub supported_efforts: Vec<String>,
    pub default_effort: Option<String>,
    pub supports_fast: bool,
    pub supports_verbosity: bool,
    pub default_verbosity: Option<String>,
}

pub struct AgentResponse {
    pub text: String,
    pub reasoning_content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Option<TokenUsage>,
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

pub type ChatStream = Pin<Box<dyn futures::Stream<Item = Result<StreamEvent, ProviderError>> + Send>>;

#[async_trait]
pub trait ChatProvider: Send + Sync {
    fn capabilities(&self, _model: &str) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_tools: true,
            supports_streaming_tools: true,
            ..Default::default()
        }
    }

    async fn stream_chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError>;

    async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        self.stream_chat_with_tools(messages, vec![], params).await
    }

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
