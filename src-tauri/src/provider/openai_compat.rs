use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, ToolCall, ToolDefinition};

pub struct OpenAICompatProvider {
    base_url: String,
    api_key: String,
}

impl OpenAICompatProvider {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        }
    }

    fn serialize_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages.iter().map(|m| {
            let mut msg = serde_json::json!({ "role": m.role, "content": m.content });
            if let Some(ref tool_calls) = m.tool_calls {
                msg["tool_calls"] = serde_json::json!(tool_calls.iter().map(|tc| {
                    serde_json::json!({
                        "id": tc.id,
                        "type": "function",
                        "function": { "name": tc.name, "arguments": tc.arguments }
                    })
                }).collect::<Vec<_>>());
            }
            if let Some(ref tool_call_id) = m.tool_call_id {
                msg["tool_call_id"] = serde_json::json!(tool_call_id);
            }
            msg
        }).collect()
    }

    fn build_request(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        params: &ChatParams,
        stream: bool,
    ) -> Request {
        let mut body = serde_json::json!({
            "model": params.model,
            "messages": Self::serialize_messages(messages),
            "stream": stream,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(p) = params.top_p {
            body["top_p"] = serde_json::json!(p);
        }
        if let Some(m) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }
        if let Some(tools) = tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::json!(tools.iter().map(|t| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                }).collect::<Vec<_>>());
            }
        }

        let mut req = Request::new(
            http::Method::POST,
            format!("{}/chat/completions", self.base_url),
        );
        req.headers.insert(
            http::header::AUTHORIZATION,
            format!("Bearer {}", self.api_key).parse().unwrap(),
        );
        req.body = Some(RequestBody::Json(body));
        req
    }
}

#[derive(Deserialize)]
struct ChatChunk {
    choices: Vec<ChunkChoice>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    delta: Option<Delta>,
    message: Option<FullMessage>,
}

#[derive(Deserialize)]
struct Delta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct FullMessage {
    content: Option<String>,
    tool_calls: Option<Vec<FullToolCall>>,
}

#[derive(Deserialize)]
struct FullToolCall {
    id: String,
    function: FullToolCallFunction,
}

#[derive(Deserialize)]
struct FullToolCallFunction {
    name: String,
    arguments: String,
}

#[async_trait]
impl ChatProvider for OpenAICompatProvider {
    async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        let transport = ReqwestTransport::new(reqwest::Client::new());
        let req = self.build_request(&messages, None, &params, true);
        let resp = transport.stream(req).await?;

        let stream = resp.bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .filter_map(|event| async {
                match event {
                    Ok(ev) => {
                        if ev.data == "[DONE]" {
                            return None;
                        }
                        match serde_json::from_str::<ChatChunk>(&ev.data) {
                            Ok(chunk) => {
                                let content = chunk.choices.first()
                                    .and_then(|c| c.delta.as_ref())
                                    .and_then(|d| d.content.clone())
                                    .unwrap_or_default();
                                if content.is_empty() { None } else { Some(Ok(content)) }
                            }
                            Err(e) => Some(Err(ProviderError::Parse(e.to_string()))),
                        }
                    }
                    Err(e) => Some(Err(ProviderError::Parse(e.to_string()))),
                }
            });

        Ok(Box::pin(stream))
    }

    async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<String, ProviderError> {
        let transport = ReqwestTransport::new(reqwest::Client::new());
        let req = self.build_request(&messages, None, &params, false);
        let resp = transport.execute(req).await?;

        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        parsed["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| ProviderError::Parse("no content in response".into()))
    }

    async fn chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<AgentResponse, ProviderError> {
        let transport = ReqwestTransport::new(reqwest::Client::new());
        let req = self.build_request(&messages, Some(&tools), &params, false);
        let resp = transport.execute(req).await?;

        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        let message = &parsed["choices"][0]["message"];
        let text = message["content"].as_str().unwrap_or("").to_string();

        let tool_calls = if let Some(tcs) = message["tool_calls"].as_array() {
            tcs.iter().filter_map(|tc| {
                Some(ToolCall {
                    id: tc["id"].as_str()?.to_string(),
                    name: tc["function"]["name"].as_str()?.to_string(),
                    arguments: tc["function"]["arguments"].as_str()?.to_string(),
                })
            }).collect()
        } else {
            Vec::new()
        };

        Ok(AgentResponse { text, tool_calls })
    }
}
