use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent, ToolCall, ToolDefinition, TokenUsage};
use super::openai_compat::{ChatChunk, parse_openai_sse_events};

pub struct DeepSeekProvider {
    base_url: String,
    api_key: String,
}

impl DeepSeekProvider {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        }
    }

    fn serialize_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages.iter().map(|m| {
            let rendered = super::render_message(m, super::SenderRendering::NameField);
            let mut msg = serde_json::json!({ "role": m.role, "content": rendered.content });
            if let Some(ref name) = rendered.name {
                msg["name"] = serde_json::json!(name);
            }
            // DeepSeek requires reasoning_content only for assistant messages with
            // tool_calls; for plain assistant replies it is ignored by the API and
            // stripping it keeps the prefix shorter → better cache hit rate.
            if let Some(ref rc) = m.reasoning_content {
                if m.tool_calls.is_some() {
                    msg["reasoning_content"] = serde_json::json!(rc);
                }
            }
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
        if stream {
            body["stream_options"] = serde_json::json!({"include_usage": true});
        }
        if let Some(m) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }
        if !params.thinking_enabled {
            body["thinking"] = serde_json::json!({"type": "disabled"});
        }
        if let Some(ref effort) = params.thinking_effort {
            body["reasoning_effort"] = serde_json::json!(effort);
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
            super::auth_header_value(&format!("Bearer {}", self.api_key)),
        );
        req.body = Some(RequestBody::Json(body));
        req
    }
}

#[async_trait]
impl ChatProvider for DeepSeekProvider {
    async fn stream_chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        let tools_opt = if tools.is_empty() { None } else { Some(tools.as_slice()) };
        let transport = ReqwestTransport::shared();
        let req = self.build_request(&messages, tools_opt, &params, true);
        let resp = transport.stream(req).await?;

        let stream = resp.bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .flat_map(move |event| {
                let events: Vec<Result<StreamEvent, ProviderError>> = match event {
                    Ok(ev) => {
                        if ev.data == "[DONE]" {
                            return futures::stream::iter(vec![]);
                        }
                        match serde_json::from_str::<ChatChunk>(&ev.data) {
                            Ok(chunk) => {
                                let (mut stream_events, finish_reason, usage) = parse_openai_sse_events(&chunk);
                                if let Some(u) = usage {
                                    stream_events.push(StreamEvent::UsageUpdate { usage: u });
                                }
                                if let Some(fr) = finish_reason {
                                    stream_events.push(StreamEvent::Stop { reason: fr, usage: None });
                                }
                                stream_events.into_iter().map(Ok).collect()
                            }
                            Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
                        }
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
        let transport = ReqwestTransport::shared();
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
        let transport = ReqwestTransport::shared();
        let req = self.build_request(&messages, Some(&tools), &params, false);
        let resp = transport.execute(req).await?;

        let parsed: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| ProviderError::Parse(e.to_string()))?;

        let message = &parsed["choices"][0]["message"];
        let text = message["content"].as_str().unwrap_or("").to_string();
        let reasoning_content = message["reasoning_content"].as_str().map(|s| s.to_string());

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

        let usage = parsed.get("usage").map(|u| TokenUsage {
            prompt_tokens: u["prompt_tokens"].as_i64().map(|v| v as i32),
            completion_tokens: u["completion_tokens"].as_i64().map(|v| v as i32),
            total_tokens: u["total_tokens"].as_i64().map(|v| v as i32),
            cache_hit_tokens: u["prompt_cache_hit_tokens"].as_i64().map(|v| v as i32),
            cache_miss_tokens: u["prompt_cache_miss_tokens"].as_i64().map(|v| v as i32),
        });

        Ok(AgentResponse { text, reasoning_content, tool_calls, usage })
    }
}
