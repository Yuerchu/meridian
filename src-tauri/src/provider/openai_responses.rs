use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;

use crate::client::{HttpTransport, ReqwestTransport, Request, RequestBody};
use super::{
    AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent,
    ToolCall, ToolDefinition, TokenUsage,
};

pub struct OpenAIResponsesProvider {
    base_url: String,
    api_key: String,
}

impl OpenAIResponsesProvider {
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
        let (instructions, input) = serialize_responses_input(messages);

        let mut body = serde_json::json!({
            "model": params.model,
            "input": input,
            "stream": stream,
            "store": false,
        });
        if let Some(instructions) = instructions {
            body["instructions"] = serde_json::json!(instructions);
        }
        if let Some(t) = params.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(p) = params.top_p {
            body["top_p"] = serde_json::json!(p);
        }
        if let Some(m) = params.max_tokens {
            body["max_output_tokens"] = serde_json::json!(m);
        }
        if let Some(ref effort) = params.thinking_effort {
            body["reasoning"] = serde_json::json!({"effort": effort});
        }
        if let Some(tools) = tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::json!(tools.iter().map(|t| {
                    serde_json::json!({
                        "type": "function",
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                        "strict": false,
                    })
                }).collect::<Vec<_>>());
                body["tool_choice"] = serde_json::json!("auto");
            }
        }

        let mut req = Request::new(
            http::Method::POST,
            format!("{}/responses", self.base_url),
        );
        req.headers.insert(
            http::header::AUTHORIZATION,
            format!("Bearer {}", self.api_key).parse().unwrap(),
        );
        req.body = Some(RequestBody::Json(body));
        req
    }
}

fn serialize_responses_input(messages: &[ChatMessage]) -> (Option<String>, Vec<serde_json::Value>) {
    let mut instructions: Option<String> = None;
    let mut input = Vec::new();

    for m in messages {
        match m.role.as_str() {
            "system" => {
                if let Some(ref mut existing) = instructions {
                    existing.push('\n');
                    existing.push_str(&m.content);
                } else {
                    instructions = Some(m.content.clone());
                }
            }
            "user" => {
                input.push(serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": m.content}],
                }));
            }
            "assistant" => {
                if !m.content.is_empty() {
                    input.push(serde_json::json!({
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": m.content}],
                    }));
                }
                if let Some(ref tool_calls) = m.tool_calls {
                    for tc in tool_calls {
                        input.push(serde_json::json!({
                            "type": "function_call",
                            "name": tc.name,
                            "arguments": tc.arguments,
                            "call_id": tc.id,
                        }));
                    }
                }
            }
            "tool" => {
                if let Some(ref call_id) = m.tool_call_id {
                    input.push(serde_json::json!({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": m.content,
                    }));
                }
            }
            _ => {}
        }
    }

    (instructions, input)
}

#[derive(Default)]
struct StreamState {
    call_id_to_index: HashMap<String, usize>,
    next_index: usize,
}

#[derive(Deserialize)]
struct ResponseCompletedPayload {
    usage: Option<ResponseUsage>,
}

#[derive(Deserialize)]
struct ResponseUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(Deserialize)]
struct ResponseFailedPayload {
    error: Option<ResponseError>,
}

#[derive(Deserialize)]
struct ResponseError {
    code: Option<String>,
    message: Option<String>,
}

fn parse_responses_event(
    event_type: &str,
    data: &str,
    state: &mut StreamState,
) -> Vec<Result<StreamEvent, ProviderError>> {
    match event_type {
        "response.output_text.delta" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    if let Some(delta) = v["delta"].as_str() {
                        if !delta.is_empty() {
                            return vec![Ok(StreamEvent::Text(delta.to_string()))];
                        }
                    }
                    vec![]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.reasoning_summary_text.delta" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    if let Some(delta) = v["delta"].as_str() {
                        if !delta.is_empty() {
                            return vec![Ok(StreamEvent::Reasoning(delta.to_string()))];
                        }
                    }
                    vec![]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.output_item.added" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    let item = &v["item"];
                    if item["type"].as_str() == Some("function_call") {
                        let call_id = item["call_id"].as_str().unwrap_or("").to_string();
                        let name = item["name"].as_str().unwrap_or("").to_string();
                        let index = state.next_index;
                        state.next_index += 1;
                        if !call_id.is_empty() {
                            state.call_id_to_index.insert(call_id.clone(), index);
                        }
                        return vec![Ok(StreamEvent::ToolCallStart {
                            index,
                            id: call_id,
                            name,
                        })];
                    }
                    vec![]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.function_call_arguments.delta" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    let delta = v["delta"].as_str().unwrap_or("");
                    if delta.is_empty() {
                        return vec![];
                    }
                    let call_id = v["call_id"].as_str()
                        .or_else(|| v["item_id"].as_str())
                        .unwrap_or("");
                    if let Some(&index) = state.call_id_to_index.get(call_id) {
                        return vec![Ok(StreamEvent::ToolCallDelta {
                            index,
                            arguments: delta.to_string(),
                        })];
                    }
                    vec![]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.completed" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    let response = &v["response"];
                    let usage = response.get("usage").and_then(|u| {
                        serde_json::from_value::<ResponseUsage>(u.clone()).ok()
                    }).map(|u| TokenUsage {
                        prompt_tokens: u.input_tokens.map(|v| v as i32),
                        completion_tokens: u.output_tokens.map(|v| v as i32),
                        total_tokens: u.total_tokens.map(|v| v as i32),
                    });
                    vec![Ok(StreamEvent::Done { usage, finish_reason: Some("stop".into()) })]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.failed" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    let response = &v["response"];
                    let error = response.get("error").and_then(|e| {
                        serde_json::from_value::<ResponseError>(e.clone()).ok()
                    });
                    let code = error.as_ref().and_then(|e| e.code.as_deref()).unwrap_or("unknown");
                    let message = error.as_ref().and_then(|e| e.message.as_deref()).unwrap_or("Unknown error");
                    vec![Err(ProviderError::Api {
                        status: 400,
                        body: format!("{}: {}", code, message),
                    })]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        "response.incomplete" => {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
            match parsed {
                Ok(v) => {
                    let reason = v["response"]["incomplete_details"]["reason"]
                        .as_str()
                        .unwrap_or("unknown");
                    let usage = v["response"].get("usage").and_then(|u| {
                        serde_json::from_value::<ResponseUsage>(u.clone()).ok()
                    }).map(|u| TokenUsage {
                        prompt_tokens: u.input_tokens.map(|v| v as i32),
                        completion_tokens: u.output_tokens.map(|v| v as i32),
                        total_tokens: u.total_tokens.map(|v| v as i32),
                    });
                    vec![Ok(StreamEvent::Done {
                        usage,
                        finish_reason: Some(reason.to_string()),
                    })]
                }
                Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
            }
        }
        _ => vec![],
    }
}

#[async_trait]
impl ChatProvider for OpenAIResponsesProvider {
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

        let mut state = StreamState::default();

        let stream = resp.bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .flat_map(move |event| {
                let events: Vec<Result<StreamEvent, ProviderError>> = match event {
                    Ok(ev) => parse_responses_event(&ev.event, &ev.data, &mut state),
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

        let mut text = String::new();
        if let Some(output) = parsed["output"].as_array() {
            for item in output {
                if item["type"].as_str() == Some("message") {
                    if let Some(content) = item["content"].as_array() {
                        for part in content {
                            if part["type"].as_str() == Some("output_text") {
                                if let Some(t) = part["text"].as_str() {
                                    text.push_str(t);
                                }
                            }
                        }
                    }
                }
            }
        }

        if text.is_empty() {
            Err(ProviderError::Parse("no content in response".into()))
        } else {
            Ok(text)
        }
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
        let mut reasoning_content: Option<String> = None;
        let mut tool_calls = Vec::new();

        if let Some(output) = parsed["output"].as_array() {
            for item in output {
                match item["type"].as_str() {
                    Some("message") => {
                        if let Some(content) = item["content"].as_array() {
                            for part in content {
                                if part["type"].as_str() == Some("output_text") {
                                    if let Some(t) = part["text"].as_str() {
                                        text.push_str(t);
                                    }
                                }
                            }
                        }
                    }
                    Some("function_call") => {
                        if let (Some(call_id), Some(name)) = (
                            item["call_id"].as_str(),
                            item["name"].as_str(),
                        ) {
                            let arguments = item["arguments"].as_str().unwrap_or("{}").to_string();
                            tool_calls.push(ToolCall {
                                id: call_id.to_string(),
                                name: name.to_string(),
                                arguments,
                            });
                        }
                    }
                    Some("reasoning") => {
                        if let Some(summary) = item["summary"].as_array() {
                            let mut parts = Vec::new();
                            for s in summary {
                                if let Some(t) = s["text"].as_str() {
                                    parts.push(t);
                                }
                            }
                            if !parts.is_empty() {
                                reasoning_content = Some(parts.join(""));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        let usage = parsed.get("usage").and_then(|u| {
            serde_json::from_value::<ResponseUsage>(u.clone()).ok()
        }).map(|u| TokenUsage {
            prompt_tokens: u.input_tokens.map(|v| v as i32),
            completion_tokens: u.output_tokens.map(|v| v as i32),
            total_tokens: u.total_tokens.map(|v| v as i32),
        });

        Ok(AgentResponse { text, reasoning_content, tool_calls, usage })
    }
}
