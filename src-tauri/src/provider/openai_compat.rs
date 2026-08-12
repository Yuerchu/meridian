use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent, ToolCall, ToolDefinition, TokenUsage};

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

    fn build_request(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        params: &ChatParams,
        stream: bool,
    ) -> Request {
        let mut body = serde_json::json!({
            "model": params.model,
            "messages": serialize_openai_messages(messages),
            "stream": stream,
        });
        if stream {
            body["stream_options"] = serde_json::json!({"include_usage": true});
        }
        if let Some(t) = params.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(p) = params.top_p {
            body["top_p"] = serde_json::json!(p);
        }
        if let Some(m) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }
        if let Some(ref effort) = params.thinking_effort {
            body["reasoning_effort"] = serde_json::json!(effort);
        }
        if params.fast {
            // The config-facing name is "fast"; the wire value is the priority tier.
            body["service_tier"] = serde_json::json!("priority");
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

fn content_value(content: &str) -> serde_json::Value {
    if content.starts_with('[') {
        if let Ok(parts) = serde_json::from_str::<Vec<serde_json::Value>>(content) {
            return serde_json::Value::Array(parts);
        }
    }
    serde_json::Value::String(content.to_string())
}

pub fn serialize_openai_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages.iter().map(|m| {
        // chat-completions has a native `name`, so identity never touches the body.
        let rendered = super::render_message(m, super::SenderRendering::NameField);
        let mut msg = serde_json::json!({ "role": m.role, "content": content_value(&rendered.content) });
        if let Some(ref name) = rendered.name {
            msg["name"] = serde_json::json!(name);
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

#[derive(Deserialize)]
pub struct ChatChunk {
    pub choices: Vec<ChunkChoice>,
    pub usage: Option<ChunkUsage>,
}

#[derive(Deserialize)]
pub struct ChunkChoice {
    pub delta: Option<Delta>,
    pub finish_reason: Option<String>,
}

#[derive(Deserialize)]
pub struct Delta {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<DeltaToolCall>>,
}

#[derive(Deserialize)]
pub struct DeltaToolCall {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<DeltaFunction>,
}

#[derive(Deserialize)]
pub struct DeltaFunction {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Deserialize)]
pub struct ChunkUsage {
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub total_tokens: Option<i32>,
    /// DeepSeek's flat split of the prompt, where `hit + miss == prompt_tokens`.
    pub prompt_cache_hit_tokens: Option<i32>,
    pub prompt_cache_miss_tokens: Option<i32>,
    /// OpenAI's own chat-completions shape for the same information, one object
    /// deeper. It needs a struct rather than another `Option<i32>` because serde
    /// cannot reach into a nested object from a flat field, and a
    /// `serde_json::Value` here would push "is this key present" down into the
    /// normaliser where it is easy to get wrong.
    pub prompt_tokens_details: Option<PromptTokensDetails>,
}

/// Only the field we price on. Everything else OpenAI puts here — audio token
/// counts, future additions — is ignored rather than rejected, because a
/// compatible gateway adding a key must not turn a working response into a parse
/// error.
#[derive(Deserialize)]
pub struct PromptTokensDetails {
    pub cached_tokens: Option<i32>,
}

/// The one place both chat-completions dialects become the same thing.
///
/// They spell the cached prefix differently — DeepSeek puts
/// `prompt_cache_hit_tokens` at the top level, OpenAI nests `cached_tokens`
/// under `prompt_tokens_details` — but they agree that `prompt_tokens` is
/// already the whole prompt, so only the cache field has to be reconciled.
///
/// Neither dialect has a notion of a *paid* cache write, so `cache_write_tokens`
/// stays `None`: writing `Some(0)` would claim the endpoint reported a zero it
/// never mentioned, and the cost formula would then have no way to tell a
/// provider without caching apart from one whose cache was merely cold.
///
/// The DeepSeek field wins when both are present. A gateway emitting both is
/// almost certainly a DeepSeek proxy padding its response into OpenAI's shape,
/// and its native field is the one its own billing derives from.
pub fn normalise_openai_usage(u: &ChunkUsage) -> TokenUsage {
    let cache_read = u
        .prompt_cache_hit_tokens
        .or_else(|| u.prompt_tokens_details.as_ref().and_then(|d| d.cached_tokens));
    TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        cache_read_tokens: cache_read,
        cache_write_tokens: None,
    }
}

pub fn parse_openai_sse_events(chunk: &ChatChunk) -> (Vec<StreamEvent>, Option<String>, Option<TokenUsage>) {
    let mut events = Vec::new();
    let mut finish_reason = None;
    let mut usage = None;

    if let Some(ref u) = chunk.usage {
        usage = Some(normalise_openai_usage(u));
    }

    if let Some(choice) = chunk.choices.first() {
        if let Some(ref fr) = choice.finish_reason {
            finish_reason = Some(fr.clone());
        }
        if let Some(ref delta) = choice.delta {
            if let Some(ref r) = delta.reasoning_content {
                if !r.is_empty() {
                    events.push(StreamEvent::Reasoning { content: r.clone() });
                }
            }
            if let Some(ref c) = delta.content {
                if !c.is_empty() {
                    events.push(StreamEvent::Text { content: c.clone() });
                }
            }
            if let Some(ref tcs) = delta.tool_calls {
                for tc in tcs {
                    if let Some(ref id) = tc.id {
                        let name = tc.function.as_ref()
                            .and_then(|f| f.name.clone())
                            .unwrap_or_default();
                        events.push(StreamEvent::ToolCallStart {
                            index: tc.index,
                            id: id.clone(),
                            name,
                        });
                    }
                    if let Some(ref f) = tc.function {
                        if let Some(ref args) = f.arguments {
                            if !args.is_empty() {
                                events.push(StreamEvent::ToolCallDelta {
                                    index: tc.index,
                                    arguments: args.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    (events, finish_reason, usage)
}

#[async_trait]
impl ChatProvider for OpenAICompatProvider {
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

        // Parsed through the same struct the streaming path uses, so the two
        // cannot drift: a field added to `ChunkUsage` reaches both, and a
        // normalisation rule fixed in one is fixed in both.
        let usage = parsed
            .get("usage")
            .and_then(|u| serde_json::from_value::<ChunkUsage>(u.clone()).ok())
            .map(|u| normalise_openai_usage(&u));

        Ok(AgentResponse { text, reasoning_content, tool_calls, usage })
    }
}
