use crate::client::{
    HttpTransport, ReqwestTransport, StreamResponse, TransportError,
    Request, RequestBody,
};
use futures::stream::{Stream, StreamExt};
use eventsource_stream::Eventsource;
use http::Method;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("transport: {0}")]
    Transport(#[from] TransportError),
    #[error("parse: {0}")]
    Parse(String),
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatChunk {
    choices: Vec<ChunkChoice>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    delta: Delta,
}

#[derive(Deserialize)]
struct Delta {
    content: Option<String>,
}

pub async fn stream_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    user_message: &str,
) -> Result<Pin<Box<dyn Stream<Item = Result<String, ProviderError>> + Send>>, ProviderError> {
    let transport = ReqwestTransport::new(reqwest::Client::new());

    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: user_message.to_string(),
        }],
        stream: true,
    };

    let mut req = Request::new(Method::POST, format!("{base_url}/chat/completions"));
    req.headers.insert(
        http::header::AUTHORIZATION,
        format!("Bearer {api_key}").parse().map_err(|e: http::header::InvalidHeaderValue| {
            ProviderError::Parse(e.to_string())
        })?,
    );
    req.body = serde_json::to_value(&body)
        .ok()
        .map(RequestBody::Json);

    let StreamResponse { bytes, .. } = transport.stream(req).await?;

    let stream = bytes
        .map(|r| r.map_err(|e| ProviderError::Transport(e)))
        .eventsource()
        .filter_map(|event| async {
            match event {
                Ok(ev) => {
                    if ev.data == "[DONE]" {
                        return None;
                    }
                    match serde_json::from_str::<ChatChunk>(&ev.data) {
                        Ok(chunk) => {
                            let content = chunk
                                .choices
                                .first()
                                .and_then(|c| c.delta.content.clone())
                                .unwrap_or_default();
                            if content.is_empty() {
                                None
                            } else {
                                Some(Ok(content))
                            }
                        }
                        Err(e) => Some(Err(ProviderError::Parse(e.to_string()))),
                    }
                }
                Err(e) => Some(Err(ProviderError::Parse(e.to_string()))),
            }
        });

    Ok(Box::pin(stream))
}
