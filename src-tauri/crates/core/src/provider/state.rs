use serde::{Deserialize, Serialize};

const STORAGE_VERSION: u32 = 1;
pub const GOOGLE_OPENAI_CHAT_PROTOCOL: &str = "openai_chat_completions";
pub const GOOGLE_GENERATE_CONTENT_PROTOCOL: &str = "google_generate_content";
/// The Responses API as reached through ChatGPT's Codex backend.
///
/// Its own protocol rather than plain `responses`, because what makes this state
/// meaningful is `store: false`: the upstream keeps nothing, so the reasoning
/// has to travel with the next request. A provider that stores its own responses
/// produces none of this.
pub const CODEX_RESPONSES_PROTOCOL: &str = "codex_responses";

/// Provider-owned continuation state attached to one assistant message.
///
/// It is a domain object: wire DTOs convert into it, and the database codec
/// below converts it into a versioned storage DTO. It is never an IPC DTO.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderState {
    pub version: u32,
    pub producer: ProviderStateProducer,
    pub payload: ProviderStatePayload,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderStateProducer {
    pub vendor: String,
    pub protocol: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderStatePayload {
    GoogleThoughtSignatures {
        signatures: Vec<GoogleThoughtSignature>,
    },
    AnthropicThinkingSignature {
        signature: String,
    },
    /// Reasoning items from a `store: false` Responses turn, kept to be sent
    /// back on the next request of the same turn.
    ///
    /// Not a signature like the two above: this is the whole item, opaque and
    /// encrypted. See [`CodexReasoningItem`].
    CodexReasoning {
        items: Vec<CodexReasoningItem>,
    },
}

/// One reasoning item, exactly as the upstream sent it.
///
/// Stored as raw JSON rather than as fields we picked out. The payload is
/// encrypted and meant only to be handed back, so there is nothing to gain by
/// understanding it — and a schema we invented would silently drop whatever the
/// upstream adds next, which is the one thing that must not happen to a blob
/// whose whole purpose is to survive a round trip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexReasoningItem {
    /// Where this item sat in the response's `output` array.
    ///
    /// Kept because order is not free to choose. Reasoning and the calls it led
    /// to have to go back in the order they came out; a turn with two reasoning
    /// items and two calls, replayed with the reasoning bunched at the front, is
    /// a different conversation from the one that happened. Recording the index
    /// costs nothing now and cannot be reconstructed later.
    pub position: usize,
    pub item_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleThoughtSignature {
    pub location: GoogleSignatureLocation,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoogleSignatureLocation {
    Message,
    ContentPart { index: usize },
    ToolCall { index: usize, call_id: Option<String> },
}

/// The only representation allowed to cross the persistence boundary.
#[derive(Serialize, Deserialize)]
struct StoredProviderStateV1 {
    version: u32,
    producer: StoredProviderStateProducer,
    #[serde(flatten)]
    payload: StoredProviderStatePayload,
}

#[derive(Serialize, Deserialize)]
struct StoredProviderStateProducer {
    vendor: String,
    protocol: String,
    model: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
enum StoredProviderStatePayload {
    GoogleThoughtSignatures {
        signatures: Vec<StoredGoogleThoughtSignature>,
    },
    AnthropicThinkingSignature {
        signature: String,
    },
    CodexReasoning {
        items: Vec<StoredCodexReasoningItem>,
    },
}

#[derive(Serialize, Deserialize)]
struct StoredCodexReasoningItem {
    position: usize,
    item_json: String,
}

#[derive(Serialize, Deserialize)]
struct StoredGoogleThoughtSignature {
    location: StoredGoogleSignatureLocation,
    signature: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StoredGoogleSignatureLocation {
    Message,
    ContentPart {
        index: usize,
    },
    ToolCall {
        index: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        call_id: Option<String>,
    },
}

/// Typed provider-state changes emitted by streaming wire adapters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderStateUpdate {
    AnthropicSignatureDelta {
        model: String,
        delta: String,
    },
    /// A whole reasoning item, not a delta — the Responses API sends it complete
    /// on `response.output_item.done`, so there is nothing to accumulate.
    CodexReasoningItem {
        model: String,
        position: usize,
        item_json: String,
    },
    GoogleThoughtSignatureDelta {
        protocol: String,
        model: String,
        location: GoogleSignatureLocation,
        delta: String,
    },
}

impl ProviderState {
    pub fn from_storage_json(raw: &str) -> Result<Self, String> {
        let stored: StoredProviderStateV1 =
            serde_json::from_str(raw).map_err(|e| format!("invalid provider-state JSON: {e}"))?;
        let state = Self::from(stored);
        state.validate()?;
        Ok(state)
    }

    pub fn to_storage_json(&self) -> Result<String, String> {
        self.validate()?;
        serde_json::to_string(&StoredProviderStateV1::from(self))
            .map_err(|e| format!("could not encode provider state: {e}"))
    }

    pub fn anthropic_signature_for(&self, model: &str) -> Option<&str> {
        if self.producer.vendor != "anthropic" || self.producer.protocol != "messages" || self.producer.model != model {
            return None;
        }
        match &self.payload {
            ProviderStatePayload::AnthropicThinkingSignature { signature } => Some(signature),
            _ => None,
        }
    }

    pub fn google_signatures_for(&self, protocol: &str, model: &str) -> Option<&[GoogleThoughtSignature]> {
        if self.producer.vendor != "google" || self.producer.protocol != protocol || self.producer.model != model {
            return None;
        }
        match &self.payload {
            ProviderStatePayload::GoogleThoughtSignatures { signatures } => Some(signatures),
            _ => None,
        }
    }

    /// The reasoning to replay, in the order it was produced.
    ///
    /// Model-matched like the two above: reasoning from one model is not
    /// something another can be asked to continue from, and the upstream would
    /// reject it. Switching models mid-conversation therefore starts the
    /// reasoning chain over rather than sending something that cannot be used.
    pub fn codex_reasoning_for(&self, model: &str) -> Option<&[CodexReasoningItem]> {
        if self.producer.vendor != "openai"
            || self.producer.protocol != CODEX_RESPONSES_PROTOCOL
            || self.producer.model != model
        {
            return None;
        }
        match &self.payload {
            ProviderStatePayload::CodexReasoning { items } => Some(items),
            _ => None,
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != STORAGE_VERSION {
            return Err(format!("unsupported provider-state version {}", self.version));
        }
        if self.producer.vendor.is_empty() || self.producer.protocol.is_empty() || self.producer.model.is_empty() {
            return Err("provider-state producer is incomplete".into());
        }
        match &self.payload {
            ProviderStatePayload::GoogleThoughtSignatures { signatures } => {
                if self.producer.vendor != "google"
                    || !matches!(
                        self.producer.protocol.as_str(),
                        GOOGLE_OPENAI_CHAT_PROTOCOL | GOOGLE_GENERATE_CONTENT_PROTOCOL
                    )
                {
                    return Err("Google thought signatures have the wrong producer".into());
                }
                if signatures.is_empty() || signatures.iter().any(|s| s.signature.is_empty()) {
                    return Err("Google thought signatures are empty".into());
                }
            }
            ProviderStatePayload::AnthropicThinkingSignature { signature } => {
                if self.producer.vendor != "anthropic" || self.producer.protocol != "messages" {
                    return Err("Anthropic thinking signature has the wrong producer".into());
                }
                if signature.is_empty() {
                    return Err("Anthropic thinking signature is empty".into());
                }
            }
            ProviderStatePayload::CodexReasoning { items } => {
                if self.producer.vendor != "openai" || self.producer.protocol != CODEX_RESPONSES_PROTOCOL {
                    return Err("Codex reasoning has the wrong producer".into());
                }
                if items.is_empty() || items.iter().any(|item| item.item_json.is_empty()) {
                    return Err("Codex reasoning is empty".into());
                }
            }
        }
        Ok(())
    }
}

impl From<&ProviderState> for StoredProviderStateV1 {
    fn from(state: &ProviderState) -> Self {
        let payload = match &state.payload {
            ProviderStatePayload::GoogleThoughtSignatures { signatures } => {
                StoredProviderStatePayload::GoogleThoughtSignatures {
                    signatures: signatures
                        .iter()
                        .map(|item| StoredGoogleThoughtSignature {
                            location: StoredGoogleSignatureLocation::from(&item.location),
                            signature: item.signature.clone(),
                        })
                        .collect(),
                }
            }
            ProviderStatePayload::AnthropicThinkingSignature { signature } => {
                StoredProviderStatePayload::AnthropicThinkingSignature {
                    signature: signature.clone(),
                }
            }
            ProviderStatePayload::CodexReasoning { items } => StoredProviderStatePayload::CodexReasoning {
                items: items
                    .iter()
                    .map(|item| StoredCodexReasoningItem {
                        position: item.position,
                        item_json: item.item_json.clone(),
                    })
                    .collect(),
            },
        };
        Self {
            version: state.version,
            producer: StoredProviderStateProducer {
                vendor: state.producer.vendor.clone(),
                protocol: state.producer.protocol.clone(),
                model: state.producer.model.clone(),
            },
            payload,
        }
    }
}

impl From<StoredProviderStateV1> for ProviderState {
    fn from(stored: StoredProviderStateV1) -> Self {
        let payload = match stored.payload {
            StoredProviderStatePayload::GoogleThoughtSignatures { signatures } => {
                ProviderStatePayload::GoogleThoughtSignatures {
                    signatures: signatures
                        .into_iter()
                        .map(|item| GoogleThoughtSignature {
                            location: GoogleSignatureLocation::from(item.location),
                            signature: item.signature,
                        })
                        .collect(),
                }
            }
            StoredProviderStatePayload::AnthropicThinkingSignature { signature } => {
                ProviderStatePayload::AnthropicThinkingSignature { signature }
            }
            StoredProviderStatePayload::CodexReasoning { items } => ProviderStatePayload::CodexReasoning {
                items: items
                    .into_iter()
                    .map(|item| CodexReasoningItem {
                        position: item.position,
                        item_json: item.item_json,
                    })
                    .collect(),
            },
        };
        Self {
            version: stored.version,
            producer: ProviderStateProducer {
                vendor: stored.producer.vendor,
                protocol: stored.producer.protocol,
                model: stored.producer.model,
            },
            payload,
        }
    }
}

impl From<&GoogleSignatureLocation> for StoredGoogleSignatureLocation {
    fn from(location: &GoogleSignatureLocation) -> Self {
        match location {
            GoogleSignatureLocation::Message => Self::Message,
            GoogleSignatureLocation::ContentPart { index } => Self::ContentPart { index: *index },
            GoogleSignatureLocation::ToolCall { index, call_id } => Self::ToolCall {
                index: *index,
                call_id: call_id.clone(),
            },
        }
    }
}

impl From<StoredGoogleSignatureLocation> for GoogleSignatureLocation {
    fn from(location: StoredGoogleSignatureLocation) -> Self {
        match location {
            StoredGoogleSignatureLocation::Message => Self::Message,
            StoredGoogleSignatureLocation::ContentPart { index } => Self::ContentPart { index },
            StoredGoogleSignatureLocation::ToolCall { index, call_id } => Self::ToolCall { index, call_id },
        }
    }
}

#[derive(Default)]
pub struct ProviderStateAccumulator {
    state: Option<ProviderState>,
}

impl ProviderStateAccumulator {
    pub fn apply(&mut self, update: ProviderStateUpdate) -> Result<(), String> {
        match update {
            ProviderStateUpdate::AnthropicSignatureDelta { model, delta } => {
                if delta.is_empty() {
                    return Ok(());
                }
                match self.state.as_mut() {
                    None => {
                        self.state = Some(ProviderState {
                            version: STORAGE_VERSION,
                            producer: ProviderStateProducer {
                                vendor: "anthropic".into(),
                                protocol: "messages".into(),
                                model,
                            },
                            payload: ProviderStatePayload::AnthropicThinkingSignature { signature: delta },
                        });
                    }
                    Some(ProviderState {
                        producer,
                        payload: ProviderStatePayload::AnthropicThinkingSignature { signature },
                        ..
                    }) if producer.model == model => signature.push_str(&delta),
                    Some(_) => return Err("a response mixed incompatible provider state".into()),
                }
            }
            ProviderStateUpdate::CodexReasoningItem {
                model,
                position,
                item_json,
            } => {
                if item_json.is_empty() {
                    return Ok(());
                }
                let arriving = CodexReasoningItem { position, item_json };
                match self.state.as_mut() {
                    None => {
                        self.state = Some(ProviderState {
                            version: STORAGE_VERSION,
                            producer: ProviderStateProducer {
                                vendor: "openai".into(),
                                protocol: CODEX_RESPONSES_PROTOCOL.into(),
                                model,
                            },
                            payload: ProviderStatePayload::CodexReasoning { items: vec![arriving] },
                        });
                    }
                    Some(ProviderState {
                        producer,
                        payload: ProviderStatePayload::CodexReasoning { items },
                        ..
                    }) if producer.model == model => {
                        // The upstream announces an item once, but a repeat
                        // would otherwise be replayed twice at the same index.
                        match items.iter_mut().find(|item| item.position == arriving.position) {
                            Some(existing) => *existing = arriving,
                            None => items.push(arriving),
                        }
                    }
                    Some(_) => return Err("a response mixed incompatible provider state".into()),
                }
            }
            ProviderStateUpdate::GoogleThoughtSignatureDelta {
                protocol,
                model,
                location,
                delta,
            } => {
                if delta.is_empty() {
                    return Ok(());
                }
                match self.state.as_mut() {
                    None => {
                        self.state = Some(ProviderState {
                            version: STORAGE_VERSION,
                            producer: ProviderStateProducer {
                                vendor: "google".into(),
                                protocol,
                                model,
                            },
                            payload: ProviderStatePayload::GoogleThoughtSignatures {
                                signatures: vec![GoogleThoughtSignature {
                                    location,
                                    signature: delta,
                                }],
                            },
                        });
                    }
                    Some(ProviderState {
                        producer,
                        payload: ProviderStatePayload::GoogleThoughtSignatures { signatures },
                        ..
                    }) if producer.protocol == protocol && producer.model == model => {
                        if let Some(existing) = signatures.iter_mut().find(|s| same_location(&s.location, &location)) {
                            merge_location(&mut existing.location, location);
                            existing.signature.push_str(&delta);
                        } else {
                            signatures.push(GoogleThoughtSignature {
                                location,
                                signature: delta,
                            });
                        }
                    }
                    Some(_) => return Err("a response mixed incompatible provider state".into()),
                }
            }
        }
        Ok(())
    }

    pub fn finish(self) -> Option<ProviderState> {
        self.state
    }
}

fn same_location(a: &GoogleSignatureLocation, b: &GoogleSignatureLocation) -> bool {
    match (a, b) {
        (GoogleSignatureLocation::Message, GoogleSignatureLocation::Message) => true,
        (GoogleSignatureLocation::ContentPart { index: a }, GoogleSignatureLocation::ContentPart { index: b }) => {
            a == b
        }
        (GoogleSignatureLocation::ToolCall { index: a, .. }, GoogleSignatureLocation::ToolCall { index: b, .. }) => {
            a == b
        }
        _ => false,
    }
}

fn merge_location(existing: &mut GoogleSignatureLocation, incoming: GoogleSignatureLocation) {
    if let (
        GoogleSignatureLocation::ToolCall { call_id: current, .. },
        GoogleSignatureLocation::ToolCall { call_id: incoming, .. },
    ) = (existing, incoming)
        && current.is_none()
    {
        *current = incoming;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_round_trip_is_versioned_and_typed() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(ProviderStateUpdate::GoogleThoughtSignatureDelta {
            protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
            model: "gemini-3.7-flash".into(),
            location: GoogleSignatureLocation::ToolCall {
                index: 0,
                call_id: Some("call-1".into()),
            },
            delta: "sig".into(),
        })
        .unwrap();
        let state = acc.finish().unwrap();
        let raw = state.to_storage_json().unwrap();
        assert_eq!(ProviderState::from_storage_json(&raw).unwrap(), state);
        assert!(raw.contains("google_thought_signatures"));
    }

    #[test]
    fn native_content_part_state_round_trips_with_its_protocol() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(ProviderStateUpdate::GoogleThoughtSignatureDelta {
            protocol: GOOGLE_GENERATE_CONTENT_PROTOCOL.into(),
            model: "gemini-3.7-flash".into(),
            location: GoogleSignatureLocation::ContentPart { index: 2 },
            delta: "native-sig".into(),
        })
        .unwrap();
        let state = acc.finish().unwrap();
        let raw = state.to_storage_json().unwrap();
        let restored = ProviderState::from_storage_json(&raw).unwrap();
        assert_eq!(restored, state);
        assert!(raw.contains("google_generate_content"));
        assert!(raw.contains("content_part"));
    }

    #[test]
    fn unknown_storage_version_is_rejected() {
        let raw = r#"{"version":2,"producer":{"vendor":"anthropic","protocol":"messages","model":"m"},"kind":"anthropic_thinking_signature","payload":{"signature":"sig"}}"#;
        assert!(ProviderState::from_storage_json(raw).unwrap_err().contains("version"));
    }

    #[test]
    fn state_is_only_replayed_to_its_producing_model() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(ProviderStateUpdate::GoogleThoughtSignatureDelta {
            protocol: GOOGLE_OPENAI_CHAT_PROTOCOL.into(),
            model: "gemini-3.7-flash".into(),
            location: GoogleSignatureLocation::Message,
            delta: "sig".into(),
        })
        .unwrap();
        let state = acc.finish().unwrap();
        assert!(
            state
                .google_signatures_for(GOOGLE_OPENAI_CHAT_PROTOCOL, "gemini-3.7-flash")
                .is_some()
        );
        assert!(
            state
                .google_signatures_for(GOOGLE_GENERATE_CONTENT_PROTOCOL, "gemini-3.7-flash")
                .is_none()
        );
        assert!(
            state
                .google_signatures_for(GOOGLE_OPENAI_CHAT_PROTOCOL, "gemini-3.6-flash")
                .is_none()
        );
        assert!(state.anthropic_signature_for("gemini-3.7-flash").is_none());
    }

    fn codex_item(position: usize, id: &str) -> ProviderStateUpdate {
        ProviderStateUpdate::CodexReasoningItem {
            model: "gpt-5.6".into(),
            position,
            item_json: serde_json::json!({
                "type": "reasoning",
                "id": id,
                "encrypted_content": "opaque-blob",
            })
            .to_string(),
        }
    }

    /// The blob has to come back byte-for-byte: it is encrypted, and the only
    /// thing that can be done with it is hand it back.
    #[test]
    fn codex_reasoning_survives_storage_verbatim() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(0, "rs_1")).unwrap();
        acc.apply(codex_item(2, "rs_2")).unwrap();
        let state = acc.finish().unwrap();

        let json = state.to_storage_json().unwrap();
        let back = ProviderState::from_storage_json(&json).unwrap();
        assert_eq!(back, state);

        let items = back.codex_reasoning_for("gpt-5.6").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].position, 0);
        assert_eq!(items[1].position, 2);
        assert!(items[0].item_json.contains("opaque-blob"));
    }

    /// Position is kept because replay order is not free to choose: reasoning
    /// and the calls it led to have to go back in the order they came out.
    #[test]
    fn out_of_order_arrival_keeps_each_items_own_position() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(3, "rs_late")).unwrap();
        acc.apply(codex_item(1, "rs_early")).unwrap();
        let state = acc.finish().unwrap();

        let items = state.codex_reasoning_for("gpt-5.6").unwrap();
        assert_eq!(items.iter().map(|i| i.position).collect::<Vec<_>>(), vec![3, 1]);
    }

    /// A repeat at the same index revises rather than duplicating — replaying an
    /// item twice would put two copies of the same reasoning into the next
    /// request.
    #[test]
    fn a_repeated_position_revises_rather_than_appends() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(0, "first")).unwrap();
        acc.apply(codex_item(0, "revised")).unwrap();
        let state = acc.finish().unwrap();

        let items = state.codex_reasoning_for("gpt-5.6").unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].item_json.contains("revised"));
    }

    /// Reasoning from one model cannot be continued by another — the upstream
    /// would reject it, so the chain starts over instead.
    #[test]
    fn codex_reasoning_is_not_offered_to_another_model_or_protocol() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(0, "rs_1")).unwrap();
        let mut state = acc.finish().unwrap();

        assert!(state.codex_reasoning_for("gpt-5.6").is_some());
        assert!(state.codex_reasoning_for("gpt-5.4").is_none());

        // The same vendor over the ordinary Responses API stores its own
        // reasoning, so this state does not belong to it either.
        state.producer.protocol = "responses".into();
        assert!(state.codex_reasoning_for("gpt-5.6").is_none());
    }

    /// Two providers' state in one reply is a bug worth failing on, not merging.
    #[test]
    fn codex_reasoning_will_not_mix_with_another_vendors_state() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(0, "rs_1")).unwrap();
        let err = acc
            .apply(ProviderStateUpdate::AnthropicSignatureDelta {
                model: "claude".into(),
                delta: "sig".into(),
            })
            .unwrap_err();
        assert!(err.contains("mixed incompatible"));
    }

    /// Storage refuses a producer that does not match the payload, so a
    /// hand-edited row cannot make one vendor's state look like another's.
    #[test]
    fn stored_codex_reasoning_must_name_its_own_producer() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(codex_item(0, "rs_1")).unwrap();
        let mut state = acc.finish().unwrap();

        state.producer.vendor = "anthropic".into();
        assert!(state.to_storage_json().is_err());
    }

    /// An empty item says nothing and is not worth a row.
    #[test]
    fn an_empty_codex_item_is_ignored() {
        let mut acc = ProviderStateAccumulator::default();
        acc.apply(ProviderStateUpdate::CodexReasoningItem {
            model: "gpt-5.6".into(),
            position: 0,
            item_json: String::new(),
        })
        .unwrap();
        assert!(acc.finish().is_none());
    }
}
