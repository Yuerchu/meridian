use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, ToolCall, ToolDefinition};

pub struct AnthropicProvider {
    base_url: String,
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        }
    }

    fn build_request(&self, messages: &[ChatMessage], params: &ChatParams, stream: bool) -> Request {
        let system = messages.iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        let api_messages: Vec<serde_json::Value> = messages.iter()
            .filter(|m| m.role != "system")
            .map(|m| serde_json::json!({
                "role": m.role,
                "content": m.content,
            }))
            .collect();

        let mut body = serde_json::json!({
            "model": params.model,
            "messages": api_messages,
            "stream": stream,
            "max_tokens": params.max_tokens.unwrap_or(4096),
        });

        if !system.is_empty() {
            body["system"] = serde_json::json!(system);
        }
        if let Some(t) = params.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(p) = params.top_p {
            body["top_p"] = serde_json::json!(p);
        }

        let mut req = Request::new(
            http::Method::POST,
            format!("{}/v1/messages", self.base_url),
        );
        req.headers.insert("x-api-key", self.api_key.parse().unwrap());
        req.headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        req.body = Some(RequestBody::Json(body));
        req
    }
}

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    delta: Option<AnthropicDelta>,
    content_block: Option<AnthropicContentBlock>,
}

#[derive(Deserialize)]
struct AnthropicDelta {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    text: Option<String>,
}

#[async_trait]
impl ChatProvider for AnthropicProvider {
    async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        let transport = ReqwestTransport::new(reqwest::Client::new());
        let req = self.build_request(&messages, &params, true);
        let resp = transport.stream(req).await?;

        let stream = resp.bytes
            .map(|r| r.map_err(|e| ProviderError::Transport(e)))
            .eventsource()
            .filter_map(|event| async {
                match event {
                    Ok(ev) => {
                        let parsed = serde_json::from_str::<AnthropicStreamEvent>(&ev.data).ok()?;
                        match parsed.event_type.as_str() {
                            "content_block_delta" => {
                                let text = parsed.delta?.text?;
                                if text.is_empty() { None } else { Some(Ok(text)) }
                            }
                            "message_stop" | "error" => None,
                            _ => None,
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
        let req = self.build_request(&messages, &params, false);
        let resp = transport.execute(req).await?;

        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        parsed["content"][0]["text"]
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

        let system = messages.iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        let api_messages: Vec<serde_json::Value> = messages.iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                if m.role == "assistant" {
                    if let Some(ref tcs) = m.tool_calls {
                        let mut content: Vec<serde_json::Value> = Vec::new();
                        if !m.content.is_empty() {
                            content.push(serde_json::json!({"type": "text", "text": m.content}));
                        }
                        for tc in tcs {
                            let args: serde_json::Value = serde_json::from_str(&tc.arguments).unwrap_or_default();
                            content.push(serde_json::json!({
                                "type": "tool_use", "id": tc.id, "name": tc.name, "input": args
                            }));
                        }
                        return serde_json::json!({"role": "assistant", "content": content});
                    }
                }
                if m.role == "tool" {
                    return serde_json::json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id.as_deref().unwrap_or(""),
                            "content": m.content,
                        }]
                    });
                }
                serde_json::json!({"role": m.role, "content": m.content})
            })
            .collect();

        let mut body = serde_json::json!({
            "model": params.model,
            "messages": api_messages,
            "max_tokens": params.max_tokens.unwrap_or(4096),
        });
        if !system.is_empty() {
            body["system"] = serde_json::json!(system);
        }
        if let Some(t) = params.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools.iter().map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            }).collect::<Vec<_>>());
        }

        let mut req = Request::new(
            http::Method::POST,
            format!("{}/v1/messages", self.base_url.trim_end_matches('/')),
        );
        req.headers.insert("x-api-key", self.api_key.parse().unwrap());
        req.headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        req.body = Some(RequestBody::Json(body));

        let resp = transport.execute(req).await?;
        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        let mut text = String::new();
        let mut tool_calls = Vec::new();

        if let Some(content) = parsed["content"].as_array() {
            for block in content {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            text.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                            tool_calls.push(ToolCall {
                                id: id.to_string(),
                                name: name.to_string(),
                                arguments: block["input"].to_string(),
                            });
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok(AgentResponse { text, reasoning_content: None, tool_calls })
    }
}
