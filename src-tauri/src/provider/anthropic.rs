use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent, ToolCall, ToolDefinition, TokenUsage};

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

    fn serialize_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages.iter()
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
                if m.content.starts_with('[') {
                    if let Ok(parts) = serde_json::from_str::<Vec<serde_json::Value>>(&m.content) {
                        let anthropic_parts: Vec<serde_json::Value> = parts.iter().map(|p| {
                            match p.get("type").and_then(|t| t.as_str()) {
                                Some("image_url") => {
                                    if let Some(url) = p.pointer("/image_url/url").and_then(|u| u.as_str()) {
                                        if let Some(data_uri) = url.strip_prefix("data:") {
                                            if let Some((media_type, b64)) = data_uri.split_once(";base64,") {
                                                return serde_json::json!({
                                                    "type": "image",
                                                    "source": { "type": "base64", "media_type": media_type, "data": b64 }
                                                });
                                            }
                                        }
                                    }
                                    p.clone()
                                }
                                _ => p.clone()
                            }
                        }).collect();
                        return serde_json::json!({"role": m.role, "content": anthropic_parts});
                    }
                }
                serde_json::json!({"role": m.role, "content": m.content})
            })
            .collect()
    }

    fn build_request(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        params: &ChatParams,
        stream: bool,
    ) -> Request {
        let system = messages.iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        let mut body = serde_json::json!({
            "model": params.model,
            "messages": Self::serialize_messages(messages),
            "stream": stream,
        });

        if let Some(m) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }

        if params.thinking_enabled {
            if let Some(budget) = params.thinking_budget {
                body["thinking"] = serde_json::json!({
                    "type": "enabled",
                    "budget_tokens": budget
                });
            }
        }

        if !system.is_empty() {
            body["system"] = serde_json::json!(system);
        }
        if let Some(ref effort) = params.thinking_effort {
            body["output_config"] = serde_json::json!({"effort": effort});
        }
        if !params.thinking_enabled {
            if let Some(t) = params.temperature {
                body["temperature"] = serde_json::json!(t);
            }
        }
        if let Some(p) = params.top_p {
            body["top_p"] = serde_json::json!(p);
        }

        if let Some(tools) = tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::json!(tools.iter().map(|t| {
                    serde_json::json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters,
                    })
                }).collect::<Vec<_>>());
            }
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
    index: Option<usize>,
    delta: Option<AnthropicDelta>,
    content_block: Option<AnthropicContentBlock>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    thinking: Option<String>,
    partial_json: Option<String>,
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: Option<i32>,
    output_tokens: Option<i32>,
}

#[async_trait]
impl ChatProvider for AnthropicProvider {
    async fn stream_chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        let tools_opt = if tools.is_empty() { None } else { Some(tools.as_slice()) };
        let transport = ReqwestTransport::new(reqwest::Client::new());
        let req = self.build_request(&messages, tools_opt, &params, true);
        let resp = transport.stream(req).await?;

        let stream = resp.bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .flat_map(|event| {
                let events: Vec<Result<StreamEvent, ProviderError>> = match event {
                    Ok(ev) => {
                        let parsed = match serde_json::from_str::<AnthropicStreamEvent>(&ev.data) {
                            Ok(p) => p,
                            Err(e) => return futures::stream::iter(vec![Err(ProviderError::Parse(e.to_string()))]),
                        };
                        let mut out = Vec::new();
                        match parsed.event_type.as_str() {
                            "content_block_start" => {
                                if let Some(ref cb) = parsed.content_block {
                                    if cb.block_type.as_deref() == Some("tool_use") {
                                        if let (Some(id), Some(name)) = (&cb.id, &cb.name) {
                                            out.push(Ok(StreamEvent::ToolCallStart {
                                                index: parsed.index.unwrap_or(0),
                                                id: id.clone(),
                                                name: name.clone(),
                                            }));
                                        }
                                    }
                                }
                            }
                            "content_block_delta" => {
                                if let Some(ref delta) = parsed.delta {
                                    match delta.delta_type.as_deref() {
                                        Some("thinking_delta") => {
                                            if let Some(ref t) = delta.thinking {
                                                if !t.is_empty() {
                                                    out.push(Ok(StreamEvent::Reasoning(t.clone())));
                                                }
                                            }
                                        }
                                        Some("input_json_delta") => {
                                            if let Some(ref pj) = delta.partial_json {
                                                out.push(Ok(StreamEvent::ToolCallDelta {
                                                    index: parsed.index.unwrap_or(0),
                                                    arguments: pj.clone(),
                                                }));
                                            }
                                        }
                                        _ => {
                                            if let Some(ref t) = delta.text {
                                                if !t.is_empty() {
                                                    out.push(Ok(StreamEvent::Text(t.clone())));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "message_delta" => {
                                if let Some(ref delta) = parsed.delta {
                                    if let Some(ref sr) = delta.stop_reason {
                                        let usage = parsed.usage.map(|u| TokenUsage {
                                            prompt_tokens: u.input_tokens,
                                            completion_tokens: u.output_tokens,
                                            total_tokens: None,
                                        });
                                        out.push(Ok(StreamEvent::Done {
                                            usage,
                                            finish_reason: Some(sr.clone()),
                                        }));
                                    }
                                }
                            }
                            "message_stop" => {}
                            _ => {}
                        }
                        out
                    }
                    Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
                };
                futures::stream::iter(events)
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
        let req = self.build_request(&messages, Some(&tools), &params, false);
        let resp = transport.execute(req).await?;
        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        let mut text = String::new();
        let mut reasoning_content = String::new();
        let mut tool_calls = Vec::new();

        if let Some(content) = parsed["content"].as_array() {
            for block in content {
                match block["type"].as_str() {
                    Some("thinking") => {
                        if let Some(t) = block["thinking"].as_str() {
                            reasoning_content.push_str(t);
                        }
                    }
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

        let usage = parsed.get("usage").map(|u| TokenUsage {
            prompt_tokens: u["input_tokens"].as_i64().map(|v| v as i32),
            completion_tokens: u["output_tokens"].as_i64().map(|v| v as i32),
            total_tokens: None,
        });

        let reasoning = if reasoning_content.is_empty() { None } else { Some(reasoning_content) };
        Ok(AgentResponse { text, reasoning_content: reasoning, tool_calls, usage })
    }
}
