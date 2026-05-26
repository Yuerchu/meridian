pub mod anthropic;
pub mod openai_compat;
pub mod registry;

use async_trait::async_trait;
use futures::stream::BoxStream;
use std::pin::Pin;

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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
}
