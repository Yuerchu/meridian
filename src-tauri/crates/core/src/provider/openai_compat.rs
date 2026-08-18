use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};

use super::{
    AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent, TokenUsage, ToolCall,
    ToolDefinition,
};
use crate::client::{HttpTransport, Request, RequestBody, ReqwestTransport};
use crate::provider::dto::{ExtraIgnore, embedded_upstream_error, warn_extra_fields};
use crate::provider::state::GOOGLE_OPENAI_CHAT_PROTOCOL;

pub struct OpenAICompatProvider {
    base_url: String,
    api_key: String,
    flavor: OpenAICompatFlavor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenAICompatFlavor {
    Generic,
    Google,
}

impl OpenAICompatProvider {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            flavor: OpenAICompatFlavor::Generic,
        }
    }

    pub fn new_google(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            flavor: OpenAICompatFlavor::Google,
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
            "messages": match self.flavor {
                OpenAICompatFlavor::Generic => serialize_openai_messages(messages),
                OpenAICompatFlavor::Google => serialize_google_messages(messages, &params.model),
            },
            "stream": stream,
        });
        if stream {
            body["stream_options"] = serde_json::json!({"include_usage": true});
        }
        if self.flavor != OpenAICompatFlavor::Google
            && let Some(t) = params.temperature
        {
            body["temperature"] = serde_json::json!(t);
        }
        if self.flavor != OpenAICompatFlavor::Google
            && let Some(p) = params.top_p
        {
            body["top_p"] = serde_json::json!(p);
        }
        if let Some(m) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }
        if let Some(ref effort) = params.thinking_effort {
            body["reasoning_effort"] = serde_json::json!(effort);
        }
        if self.flavor == OpenAICompatFlavor::Google {
            body["extra_body"] = serde_json::json!({
                "google": {
                    "thinking_config": { "include_thoughts": true }
                }
            });
        }
        if self.flavor != OpenAICompatFlavor::Google && params.fast {
            // The config-facing name is "fast"; the wire value is the priority tier.
            body["service_tier"] = serde_json::json!("priority");
        }
        if let Some(tools) = tools
            && !tools.is_empty()
        {
            body["tools"] = serde_json::json!(
                tools
                    .iter()
                    .map(|t| {
                        serde_json::json!({
                            "type": "function",
                            "function": {
                                "name": t.name,
                                "description": t.description,
                                "parameters": t.parameters,
                            }
                        })
                    })
                    .collect::<Vec<_>>()
            );
        }

        let mut req = Request::new(http::Method::POST, format!("{}/chat/completions", self.base_url));
        req.headers.insert(
            http::header::AUTHORIZATION,
            super::auth_header_value(&format!("Bearer {}", self.api_key)),
        );
        req.body = Some(RequestBody::Json(body));
        req
    }
}

fn content_value(content: &str) -> serde_json::Value {
    if content.starts_with('[')
        && let Ok(parts) = serde_json::from_str::<Vec<serde_json::Value>>(content)
    {
        return serde_json::Value::Array(parts);
    }
    serde_json::Value::String(content.to_string())
}

pub fn serialize_openai_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            // chat-completions has a native `name`, so identity never touches the body.
            let rendered = super::render_message(m, super::SenderRendering::NameField);
            let mut msg = serde_json::json!({ "role": m.role, "content": content_value(&rendered.content) });
            if let Some(ref name) = rendered.name {
                msg["name"] = serde_json::json!(name);
            }
            if let Some(ref tool_calls) = m.tool_calls {
                msg["tool_calls"] = serde_json::json!(
                    tool_calls
                        .iter()
                        .map(|tc| {
                            serde_json::json!({
                                "id": tc.id,
                                "type": "function",
                                "function": { "name": tc.name, "arguments": tc.arguments }
                            })
                        })
                        .collect::<Vec<_>>()
                );
            }
            if let Some(ref tool_call_id) = m.tool_call_id {
                msg["tool_call_id"] = serde_json::json!(tool_call_id);
            }
            msg
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleExtraContent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    google: Option<GoogleThoughtSignatureDto>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoogleThoughtSignatureDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thought_signature: Option<String>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl GoogleExtraContent {
    fn thought_signature(&self) -> Option<&str> {
        self.google
            .as_ref()?
            .thought_signature
            .as_deref()
            .filter(|s| !s.is_empty())
    }

    fn warn_ignored_fields(&self) {
        warn_extra_fields("google_extra_content", &self.extra);
        if let Some(google) = &self.google {
            warn_extra_fields("google_thought_signature", &google.extra);
        }
    }
}

fn google_extra(signature: &str) -> serde_json::Value {
    serde_json::to_value(GoogleExtraContent {
        google: Some(GoogleThoughtSignatureDto {
            thought_signature: Some(signature.to_string()),
            extra: ExtraIgnore::default(),
        }),
        extra: ExtraIgnore::default(),
    })
    .expect("Google signature DTO is serializable")
}

/// Google validates historical Gemini 3 function calls. A call produced by a
/// different vendor (or by Meridian before signatures were durable) cannot be
/// sent as a native tool call, so it becomes ordinary transcript text instead.
fn serialize_google_messages(messages: &[ChatMessage], model: &str) -> Vec<serde_json::Value> {
    use super::state::GoogleSignatureLocation;
    use std::collections::{HashMap, HashSet};

    let mut flattened_calls = HashSet::<String>::new();
    let mut signed_tool_names = HashMap::<String, String>::new();
    let mut interrupted_results = Vec::<(String, String)>::new();
    let mut out = Vec::new();

    for (message_index, m) in messages.iter().enumerate() {
        if m.role != "tool" {
            append_interrupted_results(&mut out, std::mem::take(&mut interrupted_results));
            flattened_calls.clear();
            signed_tool_names.clear();
        }
        if m.role == "assistant"
            && let Some(tool_calls) = m.tool_calls.as_ref()
        {
            // Call ids are only unique within one provider round. A later
            // assistant message may legally reuse one, so flattening state is
            // scoped to the immediately following result group.
            let signatures = m
                .provider_state
                .as_ref()
                .and_then(|s| s.google_signatures_for(GOOGLE_OPENAI_CHAT_PROTOCOL, model));
            let has_tool_signature = signatures.is_some_and(|items| {
                items
                    .iter()
                    .any(|item| matches!(item.location, GoogleSignatureLocation::ToolCall { .. }))
            });
            if !has_tool_signature {
                let mut content = m.content.clone();
                for tc in tool_calls {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(&format!("[Historical tool call: {}({})]", tc.name, tc.arguments));
                    flattened_calls.insert(tc.id.clone());
                }
                out.push(serde_json::json!({ "role": "assistant", "content": content }));
                continue;
            }
            signed_tool_names.extend(tool_calls.iter().map(|tc| (tc.id.clone(), tc.name.clone())));
        }

        if m.role == "tool" && m.tool_call_id.as_ref().is_some_and(|id| flattened_calls.contains(id)) {
            out.push(serde_json::json!({
                "role": "user",
                "content": format!(
                    "[Historical tool result for {}]\n{}",
                    m.tool_call_id.as_deref().unwrap_or("unknown"),
                    m.content
                )
            }));
            continue;
        }

        let rendered = super::render_message(m, super::SenderRendering::NameField);
        let mut msg = serde_json::json!({ "role": m.role, "content": content_value(&rendered.content) });
        if let Some(name) = rendered.name {
            msg["name"] = serde_json::json!(name);
        }
        let signatures = m
            .provider_state
            .as_ref()
            .and_then(|s| s.google_signatures_for(GOOGLE_OPENAI_CHAT_PROTOCOL, model));
        if let Some(message_signature) = signatures.and_then(|items| {
            items
                .iter()
                .find(|item| matches!(item.location, GoogleSignatureLocation::Message))
        }) {
            msg["extra_content"] = google_extra(&message_signature.signature);
        }
        if let Some(tool_calls) = m.tool_calls.as_ref() {
            let mut wire_calls = Vec::with_capacity(tool_calls.len());
            for (index, tc) in tool_calls.iter().enumerate() {
                let mut wire = serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": { "name": tc.name, "arguments": tc.arguments }
                });
                if let Some(signature) = signatures.and_then(|items| {
                    items.iter().find(|item| match &item.location {
                        GoogleSignatureLocation::ToolCall { index: stored, call_id } => {
                            *stored == index || call_id.as_deref() == Some(tc.id.as_str())
                        }
                        _ => false,
                    })
                }) {
                    wire["extra_content"] = google_extra(&signature.signature);
                }
                wire_calls.push(wire);
            }
            msg["tool_calls"] = serde_json::Value::Array(wire_calls);
            // A killed process may leave the signed call durable but no result.
            // Close that protocol edge deterministically without re-running it.
            out.push(msg);
            for tc in tool_calls {
                let has_result = messages[message_index + 1..]
                    .iter()
                    .take_while(|next| next.role == "tool")
                    .any(|next| next.tool_call_id.as_deref() == Some(tc.id.as_str()));
                if !has_result {
                    interrupted_results.push((tc.id.clone(), tc.name.clone()));
                }
            }
            continue;
        }
        if let Some(tool_call_id) = m.tool_call_id.as_ref() {
            msg["tool_call_id"] = serde_json::json!(tool_call_id);
            if let Some(name) = signed_tool_names.get(tool_call_id) {
                msg["name"] = serde_json::json!(name);
            }
        }
        out.push(msg);
    }
    append_interrupted_results(&mut out, interrupted_results);
    out
}

fn append_interrupted_results(out: &mut Vec<serde_json::Value>, results: Vec<(String, String)>) {
    out.extend(results.into_iter().map(|(id, name)| {
        serde_json::json!({
            "role": "tool",
            "name": name,
            "tool_call_id": id,
            "content": "Tool execution was interrupted before a result was recorded. It was not retried."
        })
    }));
}

#[derive(Deserialize)]
pub struct ChatChunk {
    /// This is the required OpenAI chat-completions envelope field. A relay
    /// returning a different success body must fail here instead of being
    /// mistaken for an empty token chunk.
    pub choices: Vec<ChunkChoice>,
    pub usage: Option<ChunkUsage>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ChatChunk {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("chat_chunk", &self.extra);
        for choice in &self.choices {
            choice.warn_ignored_fields();
        }
        if let Some(usage) = &self.usage {
            usage.warn_ignored_fields();
        }
    }
}

fn parse_chat_chunk(raw: &str) -> Result<ChatChunk, ProviderError> {
    serde_json::from_str(raw).map_err(|error| {
        embedded_upstream_error(raw.as_bytes())
            .map(ProviderError::Upstream)
            .unwrap_or_else(|| ProviderError::Parse(error.to_string()))
    })
}

#[derive(Deserialize)]
pub struct ChunkChoice {
    pub delta: Option<Delta>,
    pub finish_reason: Option<String>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ChunkChoice {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("chunk_choice", &self.extra);
        if let Some(delta) = &self.delta {
            delta.warn_ignored_fields();
        }
    }
}

#[derive(Deserialize)]
pub struct Delta {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<DeltaToolCall>>,
    pub extra_content: Option<GoogleExtraContent>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl Delta {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("delta", &self.extra);
        if let Some(extra_content) = &self.extra_content {
            extra_content.warn_ignored_fields();
        }
        if let Some(tool_calls) = &self.tool_calls {
            for tool_call in tool_calls {
                tool_call.warn_ignored_fields();
            }
        }
    }
}

#[derive(Deserialize)]
pub struct DeltaToolCall {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<DeltaFunction>,
    pub extra_content: Option<GoogleExtraContent>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl DeltaToolCall {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("delta_tool_call", &self.extra);
        if let Some(function) = &self.function {
            function.warn_ignored_fields();
        }
        if let Some(extra_content) = &self.extra_content {
            extra_content.warn_ignored_fields();
        }
    }
}

#[derive(Deserialize)]
pub struct DeltaFunction {
    pub name: Option<String>,
    pub arguments: Option<String>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl DeltaFunction {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("delta_function", &self.extra);
    }
}

#[derive(Deserialize)]
pub struct ChunkUsage {
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub total_tokens: Option<i32>,
    /// DeepSeek's flat split of the prompt, where hit + miss == `prompt_tokens`;
    /// only the hit half is read, the miss half being derivable.
    pub prompt_cache_hit_tokens: Option<i32>,
    /// OpenAI's own chat-completions shape for the same information, one object
    /// deeper. It needs a struct rather than another `Option<i32>` because serde
    /// cannot reach into a nested object from a flat field, and a
    /// `serde_json::Value` here would push "is this key present" down into the
    /// normaliser where it is easy to get wrong.
    pub prompt_tokens_details: Option<PromptTokensDetails>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ChunkUsage {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("chunk_usage", &self.extra);
        if let Some(details) = &self.prompt_tokens_details {
            details.warn_ignored_fields();
        }
    }
}

/// Only the field we price on. Additions remain forward-compatible, but are
/// captured by `ExtraIgnore` and warned rather than disappearing silently.
#[derive(Deserialize)]
pub struct PromptTokensDetails {
    pub cached_tokens: Option<i32>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl PromptTokensDetails {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("prompt_tokens_details", &self.extra);
    }
}

#[derive(Deserialize)]
struct ChatResponseDto {
    choices: Vec<ResponseChoiceDto>,
    usage: Option<ChunkUsage>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ChatResponseDto {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("chat_response", &self.extra);
        for choice in &self.choices {
            choice.warn_ignored_fields();
        }
        if let Some(usage) = &self.usage {
            usage.warn_ignored_fields();
        }
    }
}

fn parse_chat_response(raw: &[u8]) -> Result<ChatResponseDto, ProviderError> {
    serde_json::from_slice(raw).map_err(|error| {
        embedded_upstream_error(raw)
            .map(ProviderError::Upstream)
            .unwrap_or_else(|| ProviderError::Parse(error.to_string()))
    })
}

#[derive(Deserialize)]
struct ResponseChoiceDto {
    message: ResponseMessageDto,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ResponseChoiceDto {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("response_choice", &self.extra);
        self.message.warn_ignored_fields();
    }
}

#[derive(Deserialize)]
struct ResponseMessageDto {
    content: Option<String>,
    reasoning_content: Option<String>,
    tool_calls: Option<Vec<ResponseToolCallDto>>,
    extra_content: Option<GoogleExtraContent>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ResponseMessageDto {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("response_message", &self.extra);
        if let Some(extra_content) = &self.extra_content {
            extra_content.warn_ignored_fields();
        }
        if let Some(tool_calls) = &self.tool_calls {
            for tool_call in tool_calls {
                tool_call.warn_ignored_fields();
            }
        }
    }
}

#[derive(Deserialize)]
struct ResponseToolCallDto {
    id: String,
    function: ResponseFunctionDto,
    extra_content: Option<GoogleExtraContent>,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ResponseToolCallDto {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("response_tool_call", &self.extra);
        self.function.warn_ignored_fields();
        if let Some(extra_content) = &self.extra_content {
            extra_content.warn_ignored_fields();
        }
    }
}

#[derive(Deserialize)]
struct ResponseFunctionDto {
    name: String,
    arguments: String,
    #[serde(default, flatten)]
    extra: ExtraIgnore,
}

impl ResponseFunctionDto {
    fn warn_ignored_fields(&self) {
        warn_extra_fields("response_function", &self.extra);
    }
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
    parse_openai_sse_events_for(chunk, None)
}

fn parse_openai_sse_events_for(
    chunk: &ChatChunk,
    google_model: Option<&str>,
) -> (Vec<StreamEvent>, Option<String>, Option<TokenUsage>) {
    use super::state::{GoogleSignatureLocation, ProviderStateUpdate};

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
            if let (Some(model), Some(signature)) = (
                google_model,
                delta
                    .extra_content
                    .as_ref()
                    .and_then(GoogleExtraContent::thought_signature),
            ) {
                events.push(StreamEvent::ProviderStateUpdate {
                    update: ProviderStateUpdate::GoogleThoughtSignatureDelta {
                        protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
                        model: model.to_string(),
                        location: GoogleSignatureLocation::Message,
                        delta: signature.to_string(),
                    },
                });
            }
            if let Some(ref r) = delta.reasoning_content
                && !r.is_empty()
            {
                events.push(StreamEvent::Reasoning { content: r.clone() });
            }
            if let Some(ref c) = delta.content
                && !c.is_empty()
            {
                events.push(StreamEvent::Text { content: c.clone() });
            }
            if let Some(ref tcs) = delta.tool_calls {
                for tc in tcs {
                    if let (Some(model), Some(signature)) = (
                        google_model,
                        tc.extra_content
                            .as_ref()
                            .and_then(GoogleExtraContent::thought_signature),
                    ) {
                        events.push(StreamEvent::ProviderStateUpdate {
                            update: ProviderStateUpdate::GoogleThoughtSignatureDelta {
                                protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
                                model: model.to_string(),
                                location: GoogleSignatureLocation::ToolCall {
                                    index: tc.index,
                                    call_id: tc.id.clone(),
                                },
                                delta: signature.to_string(),
                            },
                        });
                    }
                    if let Some(ref id) = tc.id {
                        let name = tc.function.as_ref().and_then(|f| f.name.clone()).unwrap_or_default();
                        events.push(StreamEvent::ToolCallStart {
                            index: tc.index,
                            id: id.clone(),
                            name,
                        });
                    }
                    if let Some(ref f) = tc.function
                        && let Some(ref args) = f.arguments
                        && !args.is_empty()
                    {
                        events.push(StreamEvent::ToolCallDelta {
                            index: tc.index,
                            arguments: args.clone(),
                        });
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
        let google_model = (self.flavor == OpenAICompatFlavor::Google).then(|| params.model.clone());

        let stream = resp
            .bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .flat_map(move |event| {
                let events: Vec<Result<StreamEvent, ProviderError>> = match event {
                    Ok(ev) => {
                        if ev.data == "[DONE]" {
                            return futures::stream::iter(vec![]);
                        }
                        match parse_chat_chunk(&ev.data) {
                            Ok(chunk) => {
                                chunk.warn_ignored_fields();
                                let (mut stream_events, finish_reason, usage) =
                                    parse_openai_sse_events_for(&chunk, google_model.as_deref());
                                if let Some(u) = usage {
                                    stream_events.push(StreamEvent::UsageUpdate { usage: u });
                                }
                                if let Some(fr) = finish_reason {
                                    stream_events.push(StreamEvent::Stop {
                                        reason: fr,
                                        usage: None,
                                    });
                                }
                                stream_events.into_iter().map(Ok).collect()
                            }
                            Err(error) => vec![Err(error)],
                        }
                    }
                    Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
                };
                futures::stream::iter(events)
            });

        Ok(Box::pin(stream))
    }

    async fn chat(&self, messages: Vec<ChatMessage>, params: ChatParams) -> Result<String, ProviderError> {
        let transport = ReqwestTransport::shared();
        let req = self.build_request(&messages, None, &params, false);
        let resp = transport.execute(req).await?;

        let parsed = parse_chat_response(&resp.body)?;
        parsed.warn_ignored_fields();

        parsed
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
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

        let parsed = parse_chat_response(&resp.body)?;
        parsed.warn_ignored_fields();

        let usage = parsed.usage.as_ref().map(normalise_openai_usage);
        let message = parsed
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message)
            .ok_or_else(|| ProviderError::Parse("response choices is empty".into()))?;
        let provider_state = if self.flavor == OpenAICompatFlavor::Google {
            google_state_from_message(&message, &params.model)?
        } else {
            None
        };
        let text = message.content.unwrap_or_default();
        let reasoning_content = message.reasoning_content;
        let tool_calls = message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|tool_call| ToolCall {
                id: tool_call.id,
                name: tool_call.function.name,
                arguments: tool_call.function.arguments,
            })
            .collect();

        Ok(AgentResponse {
            text,
            reasoning_content,
            tool_calls,
            usage,
            provider_state,
        })
    }
}

fn google_state_from_message(
    message: &ResponseMessageDto,
    model: &str,
) -> Result<Option<super::state::ProviderState>, ProviderError> {
    use super::state::{GoogleSignatureLocation, ProviderStateAccumulator, ProviderStateUpdate};

    let mut state = ProviderStateAccumulator::default();
    if let Some(extra) = &message.extra_content {
        if let Some(signature) = extra.thought_signature() {
            state
                .apply(ProviderStateUpdate::GoogleThoughtSignatureDelta {
                    protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
                    model: model.to_string(),
                    location: GoogleSignatureLocation::Message,
                    delta: signature.to_string(),
                })
                .map_err(ProviderError::Parse)?;
        }
    }
    if let Some(tool_calls) = &message.tool_calls {
        for (index, call) in tool_calls.iter().enumerate() {
            let Some(extra) = &call.extra_content else {
                continue;
            };
            if let Some(signature) = extra.thought_signature() {
                state
                    .apply(ProviderStateUpdate::GoogleThoughtSignatureDelta {
                        protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
                        model: model.to_string(),
                        location: GoogleSignatureLocation::ToolCall {
                            index,
                            call_id: Some(call.id.clone()),
                        },
                        delta: signature.to_string(),
                    })
                    .map_err(ProviderError::Parse)?;
            }
        }
    }
    Ok(state.finish())
}

#[cfg(test)]
mod google_tests {
    use super::*;
    use crate::client::RequestBody;
    use crate::provider::state::{
        GoogleSignatureLocation, GoogleThoughtSignature, ProviderState, ProviderStatePayload, ProviderStateProducer,
    };

    fn google_state(location: GoogleSignatureLocation) -> ProviderState {
        ProviderState {
            version: 1,
            producer: ProviderStateProducer {
                vendor: "google".into(),
                protocol: "openai_chat_completions".into(),
                model: "gemini-3.7-flash".into(),
            },
            payload: ProviderStatePayload::GoogleThoughtSignatures {
                signatures: vec![GoogleThoughtSignature {
                    location,
                    signature: "signed-state".into(),
                }],
            },
        }
    }

    #[test]
    fn google_request_uses_effort_and_thought_summaries_without_sampling() {
        let provider = OpenAICompatProvider::new_google("https://example.test", "key");
        let params = ChatParams {
            model: "gemini-3.7-flash".into(),
            thinking_enabled: true,
            thinking_effort: Some("high".into()),
            temperature: Some(0.8),
            top_p: Some(0.9),
            ..Default::default()
        };
        let req = provider.build_request(&[ChatMessage::user("hello")], None, &params, true);
        let Some(RequestBody::Json(body)) = req.body else {
            panic!("JSON body")
        };
        assert_eq!(body["reasoning_effort"], "high");
        assert_eq!(
            body["extra_body"]["google"]["thinking_config"]["include_thoughts"],
            true
        );
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
    }

    #[test]
    fn embedded_relay_error_is_not_reported_as_missing_choices() {
        let error = parse_chat_chunk(
            r#"{"error":{"message":"request parameters are invalid","type":"invalid_request_error"}}"#,
        )
        .err()
        .expect("error envelope must fail");
        assert!(matches!(error, ProviderError::Upstream(ref message) if message.contains("request parameters")));
    }

    #[test]
    fn malformed_success_still_reports_the_required_choices_field() {
        let error = parse_chat_chunk(r#"{"usage":{}}"#).err().expect("choices is required");
        assert!(matches!(error, ProviderError::Parse(ref message) if message.contains("missing field `choices`")));
    }

    #[test]
    fn signed_tool_call_is_replayed_and_an_interrupted_result_is_closed() {
        let mut assistant = ChatMessage::assistant_with_tools(
            "",
            Some("summary".into()),
            vec![ToolCall {
                id: "call-1".into(),
                name: "read_file".into(),
                arguments: r#"{"path":"a"}"#.into(),
            }],
        );
        assistant.provider_state = Some(google_state(GoogleSignatureLocation::ToolCall {
            index: 0,
            call_id: Some("call-1".into()),
        }));
        let wire = serialize_google_messages(&[assistant], "gemini-3.7-flash");
        assert_eq!(
            wire[0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            "signed-state"
        );
        assert_eq!(wire[1]["role"], "tool");
        assert_eq!(wire[1]["tool_call_id"], "call-1");
        assert!(wire[1]["content"].as_str().unwrap().contains("not retried"));
    }

    #[test]
    fn unsigned_foreign_tool_history_is_flattened() {
        let assistant = ChatMessage::assistant_with_tools(
            "",
            None,
            vec![ToolCall {
                id: "foreign".into(),
                name: "search".into(),
                arguments: "{}".into(),
            }],
        );
        let wire = serialize_google_messages(
            &[assistant, ChatMessage::tool_result("foreign", "done")],
            "gemini-3.7-flash",
        );
        assert_eq!(wire[0]["role"], "assistant");
        assert!(wire[0].get("tool_calls").is_none());
        assert!(wire[0]["content"].as_str().unwrap().contains("Historical tool call"));
        assert_eq!(wire[1]["role"], "user");
    }

    #[test]
    fn parallel_calls_keep_the_signature_on_the_first_call_only() {
        let mut assistant = ChatMessage::assistant_with_tools(
            "",
            None,
            vec![
                ToolCall {
                    id: "first".into(),
                    name: "one".into(),
                    arguments: "{}".into(),
                },
                ToolCall {
                    id: "second".into(),
                    name: "two".into(),
                    arguments: "{}".into(),
                },
            ],
        );
        assistant.provider_state = Some(google_state(GoogleSignatureLocation::ToolCall {
            index: 0,
            call_id: Some("first".into()),
        }));
        let messages = [
            assistant,
            ChatMessage::tool_result("first", "one-result"),
            ChatMessage::tool_result("second", "two-result"),
        ];
        let wire = serialize_google_messages(&messages, "gemini-3.7-flash");
        assert_eq!(
            wire[0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            "signed-state"
        );
        assert!(wire[0]["tool_calls"][1].get("extra_content").is_none());
        assert_eq!(wire[1]["name"], "one");
        assert_eq!(wire[2]["name"], "two");
    }

    #[test]
    fn interrupted_parallel_results_follow_the_recorded_prefix() {
        let mut assistant = ChatMessage::assistant_with_tools(
            "",
            None,
            vec![
                ToolCall {
                    id: "first".into(),
                    name: "one".into(),
                    arguments: "{}".into(),
                },
                ToolCall {
                    id: "second".into(),
                    name: "two".into(),
                    arguments: "{}".into(),
                },
            ],
        );
        assistant.provider_state = Some(google_state(GoogleSignatureLocation::ToolCall {
            index: 0,
            call_id: Some("first".into()),
        }));
        let wire = serialize_google_messages(
            &[assistant, ChatMessage::tool_result("first", "one-result")],
            "gemini-3.7-flash",
        );
        assert_eq!(wire[1]["tool_call_id"], "first");
        assert_eq!(wire[2]["tool_call_id"], "second");
        assert!(wire[2]["content"].as_str().unwrap().contains("not retried"));
    }

    #[test]
    fn final_empty_chunk_still_emits_message_signature() {
        let chunk: ChatChunk = serde_json::from_value(serde_json::json!({
            "choices": [{
                "delta": {
                    "content": "",
                    "extra_content": {"google": {"thought_signature": "tail-signature"}}
                },
                "finish_reason": "stop"
            }]
        }))
        .unwrap();
        let (events, finish, _) = parse_openai_sse_events_for(&chunk, Some("gemini-3.7-flash"));
        assert!(
            events
                .iter()
                .any(|event| matches!(event, StreamEvent::ProviderStateUpdate { .. }))
        );
        assert_eq!(finish.as_deref(), Some("stop"));
    }

    #[test]
    fn missing_required_choices_is_rejected() {
        let error = serde_json::from_value::<ChatChunk>(serde_json::json!({
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 3,
                "total_tokens": 15
            }
        }))
        .err()
        .expect("choices must be required");
        assert!(error.to_string().contains("missing field `choices`"));
    }

    #[test]
    fn null_required_choices_is_rejected() {
        let error = serde_json::from_value::<ChatChunk>(serde_json::json!({
            "choices": null,
            "usage": { "total_tokens": 15 }
        }))
        .err()
        .expect("choices must be an array");
        assert!(error.to_string().contains("invalid type: null"));
    }

    #[test]
    fn extra_fields_are_captured_without_entering_the_domain_model() {
        let chunk: ChatChunk = serde_json::from_value(serde_json::json!({
            "id": "relay-chunk-id",
            "choices": [{
                "index": 0,
                "delta": { "content": "hello", "relay_trace": "not logged" },
                "finish_reason": null
            }],
            "usage": null
        }))
        .unwrap();
        assert!(chunk.extra.contains_key("id"));
        assert!(chunk.choices[0].extra.contains_key("index"));
        assert!(
            chunk.choices[0]
                .delta
                .as_ref()
                .unwrap()
                .extra
                .contains_key("relay_trace")
        );
    }

    #[test]
    fn relay_error_envelope_is_rejected_as_missing_the_required_shape() {
        let error = serde_json::from_value::<ChatChunk>(serde_json::json!({
            "error": { "code": 400, "type": "invalid_request", "message": "not logged" }
        }))
        .err()
        .expect("an error envelope is not a chat chunk");
        assert!(error.to_string().contains("missing field `choices`"));
    }
}
