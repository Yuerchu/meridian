//! The Responses API as reached through a ChatGPT subscription.
//!
//! Its own adapter rather than a flavour of [`super::openai_responses`], because
//! the differences are not cosmetic: the endpoint is different, `store` is off
//! so reasoning has to travel back with the next request, sampling parameters
//! mean nothing, four extra headers are required, and the credential is a
//! session that expires rather than a key that does not.
//!
//! **The parsing is shared, the building is not.** `parse_responses_event` is a
//! pure function over the same event grammar and is reused as-is; the request
//! shape is forked. Parameterising one builder for both would need five or six
//! switches, and — more to the point — the file boundary is what guarantees that
//! xAI and DeepSeek can never start sending `include` or `store: false`. That is
//! a structural guarantee rather than a default nobody has changed yet.

use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use std::sync::Arc;

use super::openai_responses::{StreamState, parse_responses_event};
use super::{
    AgentResponse, ChatMessage, ChatParams, ChatProvider, ChatStream, ProviderError, StreamEvent, ToolDefinition,
};
use crate::client::{HttpTransport, Request, RequestBody, ReqwestTransport};
use crate::codex_auth::{AuthError, Bearer, Manager};

/// What this app calls itself to the ChatGPT backend.
///
/// **Not `codex_cli_rs`.** Impersonating the CLI would very likely work and was
/// considered; sending our own name is the honest option and was measured to be
/// accepted. If a future refusal names the originator, that is a decision to
/// revisit deliberately rather than a value to quietly change — see
/// `tests/codex_smoke.rs`, which exists to answer exactly this.
const ORIGINATOR: &str = "meridian";

pub struct CodexProvider {
    base_url: String,
    auth: Arc<Manager>,
    transport: Arc<dyn HttpTransport>,
    /// Stable for the life of this provider, which is one turn. The backend uses
    /// it to group requests; a fresh one per request would look like a fresh
    /// conversation each time.
    session_id: String,
}

impl CodexProvider {
    pub fn new(base_url: &str, auth: Arc<Manager>) -> Self {
        Self::with_transport(base_url, auth, Arc::new(ReqwestTransport::shared()))
    }

    pub fn with_transport(base_url: &str, auth: Arc<Manager>, transport: Arc<dyn HttpTransport>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            auth,
            transport,
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    fn build_request(
        &self,
        bearer: &Bearer,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        params: &ChatParams,
        stream: bool,
    ) -> Request {
        let (instructions, input) = serialize_codex_input(messages, &params.model);

        let mut body = serde_json::json!({
            "model": params.model,
            "input": input,
            "stream": stream,
            // The upstream keeps nothing. That is what makes the reasoning
            // round-trip above necessary, and it is not negotiable here: this
            // backend does not offer stored responses.
            "store": false,
            // Ask for the reasoning in a form that can be sent back. Without
            // it the items arrive with nothing replayable inside them.
            "include": ["reasoning.encrypted_content"],
        });

        if let Some(instructions) = instructions {
            body["instructions"] = serde_json::Value::String(instructions);
        }

        // Deliberately absent: temperature, top_p, service_tier. The first two
        // are not honoured on this backend, and `service_tier` prices a request
        // against an API account that a subscription does not have.
        if let Some(max) = params.max_tokens {
            body["max_output_tokens"] = serde_json::json!(max);
        }
        if let Some(effort) = params.thinking_effort.as_deref() {
            body["reasoning"] = serde_json::json!({ "effort": effort, "summary": "auto" });
        }
        if let Some(verbosity) = params.verbosity.as_deref() {
            body["text"] = serde_json::json!({ "verbosity": verbosity });
        }
        if let Some(key) = params.cache_key.as_deref() {
            body["prompt_cache_key"] = serde_json::json!(key);
        }

        if let Some(tools) = tools.filter(|t| !t.is_empty()) {
            body["tools"] = serde_json::json!(
                tools
                    .iter()
                    .map(|t| serde_json::json!({
                        "type": "function",
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                        "strict": false,
                    }))
                    .collect::<Vec<_>>()
            );
            body["tool_choice"] = serde_json::json!("auto");
            body["parallel_tool_calls"] = serde_json::json!(true);
        }

        let mut req = Request::new(http::Method::POST, format!("{}/responses", self.base_url));
        req.headers.insert(
            http::header::AUTHORIZATION,
            super::auth_header_value(&format!("Bearer {}", bearer.access_token)),
        );
        insert_header(&mut req, "chatgpt-account-id", &bearer.account_id);
        insert_header(&mut req, "originator", ORIGINATOR);
        insert_header(
            &mut req,
            "user-agent",
            &format!("{ORIGINATOR}/{}", env!("CARGO_PKG_VERSION")),
        );
        insert_header(&mut req, "session_id", &self.session_id);
        if bearer.is_fedramp {
            // Not an endpoint change — the same URL, routed differently.
            insert_header(&mut req, "x-openai-fedramp", "true");
        }
        req.body = Some(RequestBody::Json(body));
        req
    }

    /// Send, and if the session was refused once, renew it and send again.
    ///
    /// One retry, and only before the first byte. `transport.stream` resolves
    /// the status before handing back a body, so a 401 here cannot arrive with
    /// events already delivered downstream — which is what makes retrying safe
    /// at all. A failure mid-stream is a different thing and is not retried.
    async fn send<T, F, Fut>(&self, attempt: F) -> Result<T, ProviderError>
    where
        F: Fn(Bearer) -> Fut,
        Fut: Future<Output = Result<T, ProviderError>>,
    {
        let bearer = self.auth.bearer().await.map_err(to_provider_error)?;
        match attempt(bearer.clone()).await {
            Err(ProviderError::Api { status: 401, .. }) => {
                self.auth
                    .refresh_after_rejection(&bearer.access_token)
                    .await
                    .map_err(to_provider_error)?;
                let renewed = self.auth.bearer().await.map_err(to_provider_error)?;
                attempt(renewed).await
            }
            other => other,
        }
    }
}

fn insert_header(req: &mut Request, name: &'static str, value: &str) {
    if let Ok(value) = http::HeaderValue::from_str(value) {
        req.headers.insert(http::HeaderName::from_static(name), value);
    }
}

/// A credential problem, in the vocabulary the turn loop understands.
///
/// Everything maps to 401 so the turn stops rather than retrying: none of these
/// gets better by being asked again, and the message says what would fix it.
fn to_provider_error(e: AuthError) -> ProviderError {
    ProviderError::Api {
        status: 401,
        body: e.to_string(),
    }
}

/// Build the `input` array, replaying reasoning where the model can use it.
///
/// Forked from `openai_responses::serialize_responses_input`; the difference is
/// the reasoning, which that one has no reason to carry.
fn serialize_codex_input(messages: &[ChatMessage], model: &str) -> (Option<String>, Vec<serde_json::Value>) {
    let mut instructions: Option<String> = None;
    let mut input = Vec::new();

    for m in messages {
        match m.role.as_str() {
            "system" => match instructions {
                Some(ref mut existing) => {
                    existing.push('\n');
                    existing.push_str(&m.content);
                }
                None => instructions = Some(m.content.clone()),
            },
            "user" => {
                // Responses input items have no `name` field, so the speaker
                // goes in as a prefix.
                let rendered = super::render_message(m, super::SenderRendering::Prefix);
                input.push(serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": rendered.content}],
                }));
            }
            "assistant" => {
                // The reasoning that produced this reply goes back first and in
                // its original order, so the model sees the same sequence it
                // emitted. Items whose stored JSON no longer parses are skipped
                // rather than failing the turn: losing the reasoning costs
                // continuity, sending malformed input costs the whole request.
                let mut replayed: Vec<_> = m
                    .provider_state
                    .as_ref()
                    .and_then(|state| state.codex_reasoning_for(model))
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|item| {
                        serde_json::from_str::<serde_json::Value>(&item.item_json)
                            .ok()
                            .map(|value| (item.position, value))
                    })
                    .collect();
                replayed.sort_by_key(|(position, _)| *position);
                input.extend(replayed.into_iter().map(|(_, value)| value));

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

/// Turn a completed `reasoning` output item into state to be stored.
///
/// Everything else about the event is left to the shared parser; this only
/// intercepts what that parser has no reason to keep.
fn reasoning_update(data: &str, model: &str) -> Option<StreamEvent> {
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let item = value.get("item")?;
    if item.get("type")?.as_str()? != "reasoning" {
        return None;
    }
    // Without `encrypted_content` there is nothing replayable — a summary alone
    // cannot be sent back, and storing it would produce input the upstream
    // rejects.
    item.get("encrypted_content")?.as_str()?;
    Some(StreamEvent::ProviderStateUpdate {
        update: super::state::ProviderStateUpdate::CodexReasoningItem {
            model: model.to_string(),
            position: value.get("output_index").and_then(|i| i.as_u64()).unwrap_or(0) as usize,
            item_json: item.to_string(),
        },
    })
}

#[async_trait]
impl ChatProvider for CodexProvider {
    #[cfg(test)]
    fn adapter_name(&self) -> &'static str {
        "CodexProvider"
    }

    async fn stream_chat_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        params: ChatParams,
    ) -> Result<ChatStream, ProviderError> {
        let model = params.model.clone();
        let resp = self
            .send(|bearer| {
                let req = self.build_request(&bearer, &messages, Some(&tools), &params, true);
                async move { self.transport.stream(req).await.map_err(ProviderError::from) }
            })
            .await?;

        let mut state = StreamState::default();
        let stream = resp
            .bytes
            .map(|r| r.map_err(ProviderError::Transport))
            .eventsource()
            .flat_map(move |event| {
                let events: Vec<Result<StreamEvent, ProviderError>> = match event {
                    Ok(ev) => {
                        let mut out = Vec::new();
                        // Intercept first, then delegate: the shared parser has
                        // no interest in reasoning items and drops them.
                        if ev.event == "response.output_item.done"
                            && let Some(captured) = reasoning_update(&ev.data, &model)
                        {
                            out.push(Ok(captured));
                        }
                        out.extend(parse_responses_event(&ev.event, &ev.data, &mut state));
                        out
                    }
                    Err(e) => vec![Err(ProviderError::Parse(e.to_string()))],
                };
                futures::stream::iter(events)
            });

        Ok(Box::pin(stream))
    }

    async fn chat(&self, messages: Vec<ChatMessage>, params: ChatParams) -> Result<String, ProviderError> {
        let resp = self
            .send(|bearer| {
                let req = self.build_request(&bearer, &messages, None, &params, false);
                async move { self.transport.execute(req).await.map_err(ProviderError::from) }
            })
            .await?;

        let parsed: serde_json::Value =
            serde_json::from_slice(&resp.body).map_err(|e| ProviderError::Parse(e.to_string()))?;

        let mut text = String::new();
        for item in parsed["output"].as_array().into_iter().flatten() {
            if item["type"].as_str() != Some("message") {
                continue;
            }
            for part in item["content"].as_array().into_iter().flatten() {
                if part["type"].as_str() == Some("output_text")
                    && let Some(t) = part["text"].as_str()
                {
                    text.push_str(t);
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
        _messages: Vec<ChatMessage>,
        _tools: Vec<ToolDefinition>,
        _params: ChatParams,
    ) -> Result<AgentResponse, ProviderError> {
        // The non-streaming tool path has no callers anywhere in this app; the
        // turn loop streams. Refusing beats a second, untested implementation of
        // the reasoning capture that would silently diverge from the streaming
        // one.
        Err(ProviderError::Parse(
            "the Codex transport is only used through streaming".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::state::{
        CODEX_RESPONSES_PROTOCOL, CodexReasoningItem, ProviderState, ProviderStatePayload, ProviderStateProducer,
        ProviderStateUpdate,
    };

    fn reasoning_state(model: &str, items: Vec<(usize, &str)>) -> ProviderState {
        ProviderState {
            version: 1,
            producer: ProviderStateProducer {
                vendor: "openai".into(),
                protocol: CODEX_RESPONSES_PROTOCOL.into(),
                model: model.into(),
            },
            payload: ProviderStatePayload::CodexReasoning {
                items: items
                    .into_iter()
                    .map(|(position, id)| CodexReasoningItem {
                        position,
                        item_json: serde_json::json!({
                            "type": "reasoning",
                            "id": id,
                            "encrypted_content": "blob",
                        })
                        .to_string(),
                    })
                    .collect(),
            },
        }
    }

    fn assistant(content: &str, state: Option<ProviderState>) -> ChatMessage {
        ChatMessage {
            provider_state: state,
            ..ChatMessage::assistant(content)
        }
    }

    /// Reasoning goes back ahead of the reply it produced, and in the order it
    /// came out — the model has to see the sequence it actually emitted.
    #[test]
    fn reasoning_is_replayed_before_the_reply_in_its_original_order() {
        let messages = vec![assistant(
            "done",
            Some(reasoning_state("gpt-5.6", vec![(2, "second"), (0, "first")])),
        )];
        let (_, input) = serialize_codex_input(&messages, "gpt-5.6");

        let kinds: Vec<_> = input.iter().map(|i| i["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, vec!["reasoning", "reasoning", "message"]);
        assert_eq!(input[0]["id"], "first", "sorted by position, not arrival");
        assert_eq!(input[1]["id"], "second");
    }

    /// Another model's reasoning is not replayed: the upstream would reject it,
    /// so the chain starts over instead.
    #[test]
    fn another_models_reasoning_is_left_out() {
        let messages = vec![assistant("done", Some(reasoning_state("gpt-5.4", vec![(0, "old")])))];
        let (_, input) = serialize_codex_input(&messages, "gpt-5.6");
        assert_eq!(input.len(), 1);
        assert_eq!(input[0]["type"], "message");
    }

    /// Losing the reasoning costs continuity; sending malformed input costs the
    /// whole request. So a corrupt item is skipped, not fatal.
    #[test]
    fn an_unparseable_stored_item_is_skipped() {
        let mut state = reasoning_state("gpt-5.6", vec![(0, "good")]);
        if let ProviderStatePayload::CodexReasoning { items } = &mut state.payload {
            items.push(CodexReasoningItem {
                position: 1,
                item_json: "{not json".into(),
            });
        }
        let (_, input) = serialize_codex_input(&[assistant("done", Some(state))], "gpt-5.6");
        let kinds: Vec<_> = input.iter().map(|i| i["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, vec!["reasoning", "message"]);
    }

    /// The two fields that make this transport what it is, plus the absence of
    /// the three that do not belong on a subscription.
    #[test]
    fn the_request_asks_for_replayable_reasoning_and_stores_nothing() {
        let provider = CodexProvider::new("https://example.invalid", test_manager());
        let params = ChatParams {
            model: "gpt-5.6".into(),
            temperature: Some(0.7),
            top_p: Some(0.9),
            fast: true,
            ..Default::default()
        };
        let req = provider.build_request(&test_bearer(false), &[], None, &params, true);
        let Some(RequestBody::Json(body)) = req.body else {
            panic!("expected a JSON body")
        };

        assert_eq!(body["store"], false);
        assert_eq!(body["include"][0], "reasoning.encrypted_content");
        assert!(body.get("temperature").is_none(), "not honoured on this backend");
        assert!(body.get("top_p").is_none());
        assert!(
            body.get("service_tier").is_none(),
            "priority pricing belongs to an API account"
        );
    }

    /// The headers the backend requires, and the one that is ours to choose.
    #[test]
    fn the_request_identifies_this_app_and_the_account() {
        let provider = CodexProvider::new("https://example.invalid", test_manager());
        let req = provider.build_request(&test_bearer(false), &[], None, &ChatParams::default(), true);

        assert_eq!(req.headers["chatgpt-account-id"], "acct-1");
        assert_eq!(req.headers["originator"], ORIGINATOR);
        assert!(req.headers["user-agent"].to_str().unwrap().starts_with(ORIGINATOR));
        assert!(req.headers.contains_key("session_id"));
        assert!(
            !req.headers.contains_key("x-openai-fedramp"),
            "only sent for a workspace that needs it"
        );
        assert!(req.url.ends_with("/responses"));
    }

    #[test]
    fn a_fedramp_workspace_is_routed_with_a_header() {
        let provider = CodexProvider::new("https://example.invalid", test_manager());
        let req = provider.build_request(&test_bearer(true), &[], None, &ChatParams::default(), true);
        assert_eq!(req.headers["x-openai-fedramp"], "true");
    }

    /// The session groups a turn's requests; a new one each time would look like
    /// a new conversation to the backend.
    #[test]
    fn the_session_is_stable_across_requests() {
        let provider = CodexProvider::new("https://example.invalid", test_manager());
        let first = provider.build_request(&test_bearer(false), &[], None, &ChatParams::default(), true);
        let second = provider.build_request(&test_bearer(false), &[], None, &ChatParams::default(), true);
        assert_eq!(first.headers["session_id"], second.headers["session_id"]);
    }

    /// A completed reasoning item becomes state; anything without replayable
    /// content does not, because sending a summary back is input the upstream
    /// rejects.
    #[test]
    fn only_a_replayable_reasoning_item_is_captured() {
        let captured = reasoning_update(
            &serde_json::json!({
                "output_index": 3,
                "item": { "type": "reasoning", "id": "rs_1", "encrypted_content": "blob" }
            })
            .to_string(),
            "gpt-5.6",
        );
        let Some(StreamEvent::ProviderStateUpdate {
            update: ProviderStateUpdate::CodexReasoningItem { position, model, .. },
        }) = captured
        else {
            panic!("expected a reasoning update")
        };
        assert_eq!(position, 3);
        assert_eq!(model, "gpt-5.6");

        // A summary with nothing encrypted inside it.
        assert!(
            reasoning_update(
                &serde_json::json!({ "item": { "type": "reasoning", "summary": ["thinking"] } }).to_string(),
                "gpt-5.6"
            )
            .is_none()
        );
        // And an ordinary message item is somebody else's business.
        assert!(
            reasoning_update(
                &serde_json::json!({ "item": { "type": "message" } }).to_string(),
                "gpt-5.6"
            )
            .is_none()
        );
    }

    fn test_bearer(is_fedramp: bool) -> Bearer {
        Bearer {
            access_token: "token-1".into(),
            account_id: "acct-1".into(),
            is_fedramp,
        }
    }

    fn test_manager() -> Arc<Manager> {
        Arc::new(Manager::new(
            crate::codex_auth::StoreId::CodexCli {
                home: std::path::PathBuf::from("/nonexistent"),
            },
            Arc::new(crate::keyring::DefaultKeyringStore),
            Arc::new(ReqwestTransport::shared()),
        ))
    }
}
