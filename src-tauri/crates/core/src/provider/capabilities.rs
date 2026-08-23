use super::{ChatParams, ProviderCapabilities, ThinkingStyle};
use serde::Deserialize;
use std::sync::LazyLock;

/// Every effort tier we know how to talk about, ascending. The frontend mirrors
/// this list; per-model subsets live in the catalog.
pub const EFFORT_LADDER: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Catalog {
    models: Vec<CatalogEntry>,
}

/// A patch over the provider default. Every capability is `Option` so an entry
/// only states what differs; omitted fields inherit.
#[derive(Debug, Deserialize)]
struct CatalogEntry {
    provider: String,
    prefix: String,
    supports_tools: Option<bool>,
    supports_streaming_tools: Option<bool>,
    supports_thinking: Option<bool>,
    supports_thinking_off: Option<bool>,
    supports_images: Option<bool>,
    supports_pdf: Option<bool>,
    supports_temperature: Option<bool>,
    supports_top_p: Option<bool>,
    max_context_tokens: Option<u32>,
    max_output_tokens: Option<u32>,
    max_temperature: Option<f32>,
    thinking_style: Option<ThinkingStyle>,
    supported_efforts: Option<Vec<String>>,
    default_effort: Option<String>,
    supports_fast: Option<bool>,
    supports_verbosity: Option<bool>,
    default_verbosity: Option<String>,
    server_tools: Option<Vec<String>>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    // Parsed once at first use. A malformed catalog is a build-time authoring
    // error, not something to degrade around at runtime.
    serde_json::from_str(include_str!("model_catalog.json")).expect("model_catalog.json is malformed")
});

fn apply(base: &mut ProviderCapabilities, entry: &CatalogEntry) {
    if let Some(v) = entry.supports_tools {
        base.supports_tools = v;
    }
    if let Some(v) = entry.supports_streaming_tools {
        base.supports_streaming_tools = v;
    }
    if let Some(v) = entry.supports_thinking {
        base.supports_thinking = v;
    }
    if let Some(v) = entry.supports_thinking_off {
        base.supports_thinking_off = v;
    }
    if let Some(v) = entry.supports_images {
        base.supports_images = v;
    }
    if let Some(v) = entry.supports_pdf {
        base.supports_pdf = v;
    }
    if let Some(v) = entry.supports_temperature {
        base.supports_temperature = v;
    }
    if let Some(v) = entry.supports_top_p {
        base.supports_top_p = v;
    }
    if let Some(v) = entry.max_context_tokens {
        base.max_context_tokens = Some(v);
    }
    if let Some(v) = entry.max_output_tokens {
        base.max_output_tokens = Some(v);
    }
    if let Some(v) = entry.max_temperature {
        base.max_temperature = Some(v);
    }
    if let Some(v) = entry.thinking_style {
        base.thinking_style = v;
    }
    if let Some(ref v) = entry.supported_efforts {
        base.supported_efforts = v.clone();
    }
    if let Some(ref v) = entry.default_effort {
        base.default_effort = Some(v.clone());
    }
    if let Some(v) = entry.supports_fast {
        base.supports_fast = v;
    }
    if let Some(v) = entry.supports_verbosity {
        base.supports_verbosity = v;
    }
    if let Some(ref v) = entry.default_verbosity {
        base.default_verbosity = Some(v.clone());
    }
    if let Some(ref v) = entry.server_tools {
        base.server_tools = v.clone();
    }
}

fn find_longest_prefix_match<'a>(provider: &str, model: &str) -> Option<&'a CatalogEntry> {
    let lower = model.to_ascii_lowercase();
    let lower = lower.strip_prefix("models/").unwrap_or(&lower);
    CATALOG
        .models
        .iter()
        .filter(|e| e.provider == provider && lower.starts_with(&e.prefix))
        .max_by_key(|e| e.prefix.len())
}

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

fn anthropic_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_thinking_off: true,
        supports_images: true,
        supports_pdf: true,
        supports_temperature: true,
        supports_top_p: true,
        max_context_tokens: Some(200_000),
        max_output_tokens: Some(64_000),
        max_temperature: Some(1.0),
        thinking_style: ThinkingStyle::Budget,
        ..Default::default()
    }
}

fn openai_responses_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_thinking_off: true,
        supports_images: true,
        supports_temperature: true,
        supports_top_p: true,
        max_context_tokens: Some(200_000),
        max_output_tokens: Some(100_000),
        max_temperature: Some(2.0),
        thinking_style: ThinkingStyle::EffortOnly,
        supported_efforts: vec!["low".into(), "medium".into(), "high".into()],
        ..Default::default()
    }
}

fn deepseek_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_thinking_off: true,
        max_context_tokens: Some(128_000),
        max_output_tokens: Some(16_000),
        max_temperature: Some(2.0),
        thinking_style: ThinkingStyle::ToggleOff,
        supported_efforts: vec!["low".into(), "medium".into(), "high".into()],
        ..Default::default()
    }
}

/// Every Grok in the catalog reasons and none of them can be told not to —
/// xAI's own wording is "reasoning cannot be disabled" — so the default is
/// thinking on with effort as the only knob.
///
/// `grok-4.20-non-reasoning` is the exception and this cannot express it: the
/// variant is a *suffix* of the model id, which longest-prefix matching cannot
/// reach, so it inherits `supports_thinking` and needs a `capability_overrides`
/// entry to correct. The catalog entry for `grok-4.20` says so.
///
/// The context window is deliberately the smallest of the family (256k, which
/// is `grok-code-fast`'s) rather than 4.6's 500k: an unknown model inheriting
/// this gets a limit that is too small at worst, and a limit that is too large
/// is a request the provider refuses after the whole prompt has been assembled.
fn xai_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_thinking_off: false,
        supports_images: true,
        supports_temperature: true,
        supports_top_p: true,
        max_context_tokens: Some(256_000),
        max_output_tokens: Some(64_000),
        max_temperature: Some(2.0),
        thinking_style: ThinkingStyle::EffortOnly,
        supported_efforts: vec!["low".into(), "medium".into(), "high".into()],
        default_effort: Some("high".into()),
        ..Default::default()
    }
}

fn generic_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking_off: true,
        supports_temperature: true,
        supports_top_p: true,
        max_temperature: Some(2.0),
        ..Default::default()
    }
}

/// The gemma_tool format simulates function calling through prompt injection on
/// a plain chat/completions endpoint, so it has no reasoning surface at all and
/// must not inherit OpenAI model rules -- a gemma_tool provider serving a model
/// named `gpt-4o` is not GPT-4o.
fn gemma_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking_off: true,
        supports_temperature: true,
        supports_top_p: true,
        max_temperature: Some(2.0),
        ..Default::default()
    }
}

fn google_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_thinking_off: false,
        supports_images: true,
        supports_pdf: false,
        supports_temperature: false,
        supports_top_p: false,
        max_context_tokens: Some(1_048_576),
        max_output_tokens: Some(65_536),
        thinking_style: ThinkingStyle::EffortOnly,
        supported_efforts: vec!["low".into(), "medium".into(), "high".into()],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn resolve(provider_type: &str, api_format: Option<&str>, model: &str) -> ProviderCapabilities {
    // `catalog_provider` scopes the prefix search. gemma_tool deliberately maps
    // to a namespace with no entries so it only ever gets its default.
    let (mut caps, catalog_provider) = match provider_type {
        "anthropic" => (anthropic_default(), "anthropic"),
        "deepseek" => {
            let mut caps = deepseek_default();
            if api_format == Some("responses") {
                // `ToggleOff` exists only in the chat adapter, which sends
                // `thinking: {"type": "disabled"}`. The Responses adapter has
                // never heard of it, so turning thinking off there sent nothing
                // at all and the model reasoned anyway — a switch that reported
                // itself off while having no effect. Effort is what this dialect
                // does support, per DeepSeek's own compatibility table.
                caps.supports_thinking_off = false;
                caps.thinking_style = ThinkingStyle::EffortOnly;
            }
            (caps, "deepseek")
        }
        "xai" => (xai_default(), "xai"),
        "google" => (google_default(), "google"),
        _ => match api_format {
            Some("responses") => (openai_responses_default(), "openai"),
            Some("gemma_tool") => (gemma_default(), "gemma"),
            _ => (generic_default(), "openai"),
        },
    };
    caps.server_tools = server_tools_for(provider_type, api_format);
    if let Some(entry) = find_longest_prefix_match(catalog_provider, model) {
        apply(&mut caps, entry);
    }
    caps.supports_reasoning_effort = !caps.supported_efforts.is_empty();
    caps
}

/// Which provider-side tools this dialect offers at all.
///
/// Gated on the Responses API because that is the only place they exist. xAI's
/// chat-completions endpoint answers `{"type":"web_search"}` with a 422 —
/// "expected `function` or `live_search`" — so offering the switch there would
/// be offering a setting that turns every request into an error.
///
/// Deliberately short. Only what has been measured against a live endpoint
/// (xAI) or spelled out in a compatibility table (DeepSeek) is listed; OpenAI's
/// own Responses tools are absent because their wire names have moved around
/// (`web_search_preview`) and a wrong name here is a 400 on every request. A
/// model that needs one it does not inherit can be given it in
/// `capability_overrides`.
fn server_tools_for(provider_type: &str, api_format: Option<&str>) -> Vec<String> {
    if api_format != Some("responses") {
        return Vec::new();
    }
    let names: &[&str] = match provider_type {
        "xai" => &[
            crate::provider::SERVER_TOOL_WEB_SEARCH,
            crate::provider::SERVER_TOOL_X_SEARCH,
            crate::provider::SERVER_TOOL_CODE_EXECUTION,
        ],
        // Its compatibility table lists `function` and `web_search` as the
        // supported tool types and says everything else is ignored.
        "deepseek" => &[crate::provider::SERVER_TOOL_WEB_SEARCH],
        _ => &[],
    };
    names.iter().map(|name| (*name).to_string()).collect()
}

/// Merge a user-authored JSON patch from `model_configs.capability_overrides`.
/// Malformed or unknown content is ignored rather than fatal: a bad override
/// should degrade to catalog behaviour, not brick the model.
pub fn apply_overrides(caps: &mut ProviderCapabilities, overrides: Option<&str>) {
    let Some(raw) = overrides else { return };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(raw) else {
        // The user hand-writes this in model settings. A stray comma saves
        // fine, shows fine, and does nothing at all — with no way to tell that
        // from an override that simply had no effect.
        tracing::warn!(
            raw_len = raw.len(),
            "capability_overrides is not a JSON object; ignoring it entirely"
        );
        return;
    };
    let as_bool = |v: &serde_json::Value| v.as_bool();
    for (key, value) in &map {
        match key.as_str() {
            "supports_tools" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_tools = v
                }
            }
            "supports_streaming_tools" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_streaming_tools = v
                }
            }
            "supports_thinking" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_thinking = v
                }
            }
            "supports_thinking_off" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_thinking_off = v
                }
            }
            "supports_images" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_images = v
                }
            }
            "supports_pdf" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_pdf = v
                }
            }
            "supports_temperature" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_temperature = v
                }
            }
            "supports_top_p" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_top_p = v
                }
            }
            "supports_fast" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_fast = v
                }
            }
            "supports_verbosity" => {
                if let Some(v) = as_bool(value) {
                    caps.supports_verbosity = v
                }
            }
            "thinking_style" => {
                if let Ok(style) = serde_json::from_value::<ThinkingStyle>(value.clone()) {
                    caps.thinking_style = style;
                }
            }
            "supported_efforts" => {
                if let Some(arr) = value.as_array() {
                    // Rebuild through the ladder so the stored order can't break
                    // the median coercion, and unknown tiers are dropped.
                    caps.supported_efforts = EFFORT_LADDER
                        .iter()
                        .filter(|tier| arr.iter().any(|v| v.as_str() == Some(**tier)))
                        .map(|tier| (*tier).to_string())
                        .collect();
                }
            }
            "server_tools" => {
                if let Some(arr) = value.as_array() {
                    caps.server_tools = arr.iter().filter_map(|v| v.as_str()).map(str::to_string).collect();
                }
            }
            "default_effort" => caps.default_effort = value.as_str().map(str::to_string),
            "default_verbosity" => caps.default_verbosity = value.as_str().map(str::to_string),
            "max_context_tokens" => caps.max_context_tokens = value.as_u64().map(|v| v as u32),
            "max_output_tokens" => caps.max_output_tokens = value.as_u64().map(|v| v as u32),
            "max_temperature" => caps.max_temperature = value.as_f64().map(|v| v as f32),
            _ => {}
        }
    }
    caps.supports_reasoning_effort = !caps.supported_efforts.is_empty();
}

/// Resolve the effective thinking triple from an assistant's stored defaults
/// plus an optional per-request tier. Shared by the chat command and the OneBot
/// agent so the two entry points cannot drift apart.
///
/// An unrecognised tier falls back to the assistant default rather than being
/// forwarded verbatim -- passing a tier no provider accepts is a 400.
pub fn resolve_thinking(
    assistant_enabled: bool,
    assistant_budget: Option<i32>,
    requested_level: Option<&str>,
) -> (bool, Option<i32>, Option<String>) {
    match requested_level {
        Some("off") => (false, None, None),
        Some(level) if EFFORT_LADDER.contains(&level) => (true, assistant_budget, Some(level.to_string())),
        _ => (assistant_enabled, assistant_budget, None),
    }
}

/// Coerce an effort tier onto what this model actually accepts. An unsupported
/// tier lands on the median of the whitelist rather than being dropped, so
/// switching models degrades the request instead of silently disabling
/// reasoning (mirrors Codex `session/turn_context.rs`).
pub fn nearest_supported_effort(current: &str, supported: &[String]) -> Option<String> {
    if supported.is_empty() {
        return None;
    }
    if supported.iter().any(|e| e == current) {
        return Some(current.to_string());
    }
    supported.get(supported.len().saturating_sub(1) / 2).cloned()
}

pub fn filter_params(params: &mut ChatParams, caps: &ProviderCapabilities) {
    params.thinking_style = caps.thinking_style;
    if !caps.supports_temperature {
        params.temperature = None;
    }
    if !caps.supports_top_p {
        params.top_p = None;
    }
    if !caps.supports_thinking {
        // The UI still shows a thinking switch. Turning it on and getting no
        // reasoning at all reads as a broken feature rather than as a model
        // that cannot do it.
        if params.thinking_enabled {
            tracing::info!(
                model = %params.model,
                "thinking was requested but this model has no reasoning support; dropped"
            );
        }
        params.thinking_enabled = false;
        params.thinking_budget = None;
        params.thinking_effort = None;
    } else if !caps.supports_thinking_off && !params.thinking_enabled {
        // Gemini 3.x and similar always-thinking models interpret omission as
        // the model default; there is no wire value that disables reasoning.
        params.thinking_enabled = true;
        params.thinking_budget = None;
        params.thinking_effort = None;
    }
    let requested_effort = params.thinking_effort.clone();
    params.thinking_effort = params
        .thinking_effort
        .as_deref()
        .and_then(|effort| nearest_supported_effort(effort, &caps.supported_efforts));
    if requested_effort != params.thinking_effort {
        // Picking "max" and silently getting "medium" is a user-visible state
        // change: the interface and the request disagree, and the complaint
        // arrives as "the highest tier does nothing".
        tracing::info!(
            model = %params.model,
            requested = requested_effort.as_deref().unwrap_or(""),
            effective = params.thinking_effort.as_deref().unwrap_or(""),
            "thinking effort coerced to a tier this model accepts"
        );
    }
    // budget_tokens is rejected outright by adaptive/always-on models, and is
    // meaningless where effort is the only knob.
    if matches!(
        caps.thinking_style,
        ThinkingStyle::Adaptive | ThinkingStyle::AlwaysOn | ThinkingStyle::EffortOnly
    ) {
        params.thinking_budget = None;
    }
    if !caps.supports_fast {
        if params.fast {
            tracing::info!(
                model = %params.model,
                "fast mode is not available on this model; dropped"
            );
        }
        params.fast = false;
    }
    if caps.supports_verbosity {
        if params.verbosity.is_none() {
            params.verbosity = caps.default_verbosity.clone();
        }
    } else {
        params.verbosity = None;
    }
    if let (Some(max_temp), Some(temp)) = (caps.max_temperature, params.temperature)
        && temp > max_temp as f64
    {
        params.temperature = Some(max_temp as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses() {
        assert!(!CATALOG.models.is_empty());
    }

    #[test]
    fn anthropic_claude_3_haiku_no_thinking() {
        let caps = resolve("anthropic", None, "claude-3-haiku-20240307");
        assert!(!caps.supports_thinking);
        assert!(caps.supports_images);
        assert!(!caps.supports_pdf);
        assert_eq!(caps.max_output_tokens, Some(4_096));
    }

    #[test]
    fn anthropic_claude_sonnet_4_has_thinking() {
        let caps = resolve("anthropic", None, "claude-sonnet-4-20250514");
        assert!(caps.supports_thinking);
        assert!(caps.supports_images);
        assert!(caps.supports_pdf);
        assert_eq!(caps.max_output_tokens, Some(64_000));
    }

    #[test]
    fn openai_o3_no_temperature() {
        let caps = resolve("openai", None, "o3-2025-04-16");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert!(!caps.supports_temperature);
        assert!(!caps.supports_top_p);
    }

    #[test]
    fn gemini_effort_matrix_and_always_on_thinking() {
        let flash_37 = resolve("google", Some("chat_completions"), "gemini-3.7-flash");
        assert_eq!(flash_37.supported_efforts, vec!["low", "medium", "high"]);
        assert_eq!(flash_37.default_effort.as_deref(), Some("medium"));
        assert!(!flash_37.supports_thinking_off);
        assert!(!flash_37.supports_temperature);
        assert!(!flash_37.supports_top_p);
        assert_eq!(flash_37.max_context_tokens, Some(1_048_576));
        assert_eq!(flash_37.max_output_tokens, Some(65_536));

        let lite = resolve("google", None, "gemini-3.5-flash-lite-preview");
        assert_eq!(lite.supported_efforts, vec!["minimal", "low", "medium", "high"]);
        assert_eq!(lite.default_effort.as_deref(), Some("minimal"));

        let pro = resolve("google", None, "gemini-3.1-pro-preview-customtools");
        assert_eq!(pro.supported_efforts, vec!["low", "medium", "high"]);
        assert_eq!(pro.default_effort.as_deref(), Some("high"));

        let original_pro = resolve("google", None, "gemini-3-pro-preview");
        assert_eq!(original_pro.supported_efforts, vec!["low", "high"]);
        assert_eq!(original_pro.default_effort.as_deref(), Some("high"));
    }

    #[test]
    fn gemini_off_becomes_provider_default_and_sampling_is_removed() {
        let caps = resolve("google", None, "gemini-3.7-flash");
        let mut params = ChatParams {
            model: "gemini-3.7-flash".into(),
            thinking_enabled: false,
            thinking_effort: None,
            temperature: Some(0.7),
            top_p: Some(0.9),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(params.thinking_enabled);
        assert_eq!(params.thinking_effort, None);
        assert_eq!(params.temperature, None);
        assert_eq!(params.top_p, None);
    }

    #[test]
    fn openai_gpt4o_has_vision() {
        let caps = resolve("openai", None, "gpt-4o-2024-11-20");
        assert!(caps.supports_images);
        assert!(!caps.supports_thinking);
        assert!(caps.supports_temperature);
    }

    #[test]
    fn deepseek_v4_pro_capabilities() {
        let caps = resolve("deepseek", None, "deepseek-v4-pro");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert!(!caps.supports_temperature);
        assert!(!caps.supports_top_p);
        assert_eq!(caps.max_context_tokens, Some(128_000));
    }

    #[test]
    fn deepseek_v4_flash_capabilities() {
        let caps = resolve("deepseek", None, "deepseek-v4-flash");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert!(!caps.supports_temperature);
    }

    #[test]
    fn deepseek_unknown_model_gets_default() {
        let caps = resolve("deepseek", None, "deepseek-future-model");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert!(!caps.supports_temperature);
    }

    #[test]
    fn grok_4_6_reasons_and_cannot_be_told_not_to() {
        let caps = resolve("xai", Some("chat_completions"), "grok-4.6");
        assert!(caps.supports_thinking);
        assert!(!caps.supports_thinking_off, "xAI: reasoning cannot be disabled");
        assert_eq!(caps.thinking_style, ThinkingStyle::EffortOnly);
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "xhigh"]);
        assert_eq!(caps.default_effort.as_deref(), Some("high"));
        assert_eq!(caps.max_context_tokens, Some(500_000));
        assert!(caps.supports_images);
        assert!(caps.supports_temperature, "measured: 0.7 is accepted");
        assert!(!caps.supports_fast, "xAI has no priority tier");
    }

    /// Turning thinking off has no wire value here, so the request must not
    /// simply omit the effort — `filter_params` turns it back on and lets the
    /// model default apply, the same as Gemini.
    #[test]
    fn asking_grok_not_to_think_yields_the_model_default() {
        let caps = resolve("xai", None, "grok-4.6");
        let mut params = ChatParams {
            model: "grok-4.6".into(),
            thinking_enabled: false,
            temperature: Some(0.7),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(params.thinking_enabled);
        assert_eq!(params.thinking_effort, None);
        assert_eq!(params.temperature, Some(0.7), "sampling is fine on Grok");
    }

    /// 4.5 accepts `xhigh` but treats it as `high`, so offering it would be a
    /// tier that silently does nothing. It has to land on the median instead.
    #[test]
    fn grok_4_5_coerces_xhigh_rather_than_offering_it() {
        let caps = resolve("xai", None, "grok-4.5");
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high"]);
        let mut params = ChatParams {
            model: "grok-4.5".into(),
            thinking_enabled: true,
            thinking_effort: Some("xhigh".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.thinking_effort, Some("medium".into()));
    }

    /// The aliases and the real id are the same model, and both are things a
    /// user can pick out of the model list.
    #[test]
    fn both_names_for_grok_code_fast_resolve_alike() {
        let by_alias = resolve("xai", None, "grok-code-fast-1");
        let by_id = resolve("xai", None, "grok-build-0.1");
        assert_eq!(by_alias.max_context_tokens, Some(256_000));
        assert_eq!(by_id.max_context_tokens, by_alias.max_context_tokens);
        assert_eq!(by_id.supported_efforts, by_alias.supported_efforts);
    }

    /// A Grok nobody has catalogued yet still reasons, and still gets a context
    /// limit small enough that the provider will accept the request.
    #[test]
    fn an_uncatalogued_grok_keeps_reasoning_and_the_smallest_window() {
        let caps = resolve("xai", None, "grok-5-something");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert_eq!(caps.max_context_tokens, Some(256_000));
    }

    /// Server-side tools exist only on the Responses API. Offering the switch on
    /// chat-completions would be offering a setting that turns every request
    /// into a 422 — measured: xAI answers "expected `function` or `live_search`".
    #[test]
    fn server_tools_are_a_responses_api_thing_only() {
        let responses = resolve("xai", Some("responses"), "grok-4.6");
        assert_eq!(responses.server_tools, vec!["web_search", "x_search", "code_execution"]);

        for format in [Some("chat_completions"), None] {
            assert!(
                resolve("xai", format, "grok-4.6").server_tools.is_empty(),
                "chat-completions has no such thing",
            );
        }
    }

    /// DeepSeek's compatibility table lists `function` and `web_search` as the
    /// supported tool types and says the rest are ignored.
    #[test]
    fn deepseek_offers_only_the_one_it_documents() {
        let caps = resolve("deepseek", Some("responses"), "deepseek-v4-flash");
        assert_eq!(caps.server_tools, vec!["web_search"]);
    }

    /// A provider nobody has measured gets none, rather than a guess. A wrong
    /// tool name is a 400 on every request the setting is on for.
    #[test]
    fn an_unmeasured_provider_is_offered_none() {
        assert!(resolve("openai", Some("responses"), "gpt-5.6").server_tools.is_empty());
        assert!(
            resolve("anthropic", Some("responses"), "claude-opus-4-8")
                .server_tools
                .is_empty()
        );
    }

    /// The escape hatch for a model whose support differs from its provider's
    /// default — including taking them all away.
    #[test]
    fn an_override_can_reshape_the_server_tool_list() {
        let mut caps = resolve("xai", Some("responses"), "grok-4.6");
        apply_overrides(&mut caps, Some(r#"{"server_tools":["web_search"]}"#));
        assert_eq!(caps.server_tools, vec!["web_search"]);

        apply_overrides(&mut caps, Some(r#"{"server_tools":[]}"#));
        assert!(caps.server_tools.is_empty());
    }

    #[test]
    fn unknown_model_gets_generic_defaults() {
        let caps = resolve("openai", None, "some-custom-model-v2");
        assert!(caps.supports_temperature);
        assert!(caps.supports_top_p);
        assert!(!caps.supports_images);
        assert!(!caps.supports_thinking);
    }

    #[test]
    fn filter_params_strips_temperature_for_reasoning() {
        let caps = resolve("openai", None, "o3-2025-04-16");
        let mut params = ChatParams {
            model: "o3-2025-04-16".into(),
            temperature: Some(0.7),
            top_p: Some(0.9),
            thinking_enabled: true,
            thinking_budget: Some(10000),
            thinking_effort: Some("high".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(params.temperature.is_none());
        assert!(params.top_p.is_none());
        assert!(params.thinking_enabled);
        assert_eq!(params.thinking_effort, Some("high".into()));
    }

    #[test]
    fn filter_params_strips_thinking_for_non_thinking_model() {
        let caps = resolve("openai", None, "gpt-4o");
        let mut params = ChatParams {
            model: "gpt-4o".into(),
            temperature: Some(0.7),
            thinking_enabled: true,
            thinking_budget: Some(10000),
            thinking_effort: Some("high".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.temperature, Some(0.7));
        assert!(!params.thinking_enabled);
        assert!(params.thinking_budget.is_none());
        assert!(params.thinking_effort.is_none());
    }

    #[test]
    fn filter_params_clamps_temperature() {
        let caps = resolve("anthropic", None, "claude-sonnet-4-20250514");
        let mut params = ChatParams {
            model: "claude-sonnet-4-20250514".into(),
            temperature: Some(1.5),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.temperature, Some(1.0));
    }

    #[test]
    fn longest_prefix_wins() {
        let caps_35_sonnet = resolve("anthropic", None, "claude-3-5-sonnet-20241022");
        assert!(!caps_35_sonnet.supports_thinking);
        assert!(caps_35_sonnet.supports_pdf);
        assert_eq!(caps_35_sonnet.max_output_tokens, Some(8_192));

        let caps_3_sonnet = resolve("anthropic", None, "claude-3-sonnet-20240229");
        assert!(!caps_3_sonnet.supports_thinking);
        assert!(!caps_3_sonnet.supports_pdf);
        assert_eq!(caps_3_sonnet.max_output_tokens, Some(4_096));
    }

    // --- new coverage ---

    #[test]
    fn gpt_5_6_sol_full_effort_ladder() {
        let caps = resolve("openai", Some("responses"), "gpt-5.6-sol");
        assert!(caps.supports_thinking);
        assert_eq!(caps.thinking_style, ThinkingStyle::EffortOnly);
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(caps.default_effort, Some("low".into()));
        assert!(caps.supports_fast);
        assert!(caps.supports_verbosity);
    }

    #[test]
    fn bare_gpt_5_6_alias_resolves_like_sol() {
        let caps = resolve("openai", Some("responses"), "gpt-5.6");
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(caps.default_effort, Some("low".into()));
    }

    #[test]
    fn gpt_5_2_has_no_max_tier_and_no_fast() {
        let caps = resolve("openai", Some("responses"), "gpt-5.2");
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "xhigh"]);
        assert!(!caps.supports_fast);
    }

    #[test]
    fn claude_opus_4_8_is_adaptive_and_rejects_sampling() {
        let caps = resolve("anthropic", None, "claude-opus-4-8");
        assert_eq!(caps.thinking_style, ThinkingStyle::Adaptive);
        assert!(!caps.supports_temperature);
        assert!(!caps.supports_top_p);
        assert!(caps.supports_fast);
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "xhigh", "max"]);
    }

    #[test]
    fn claude_opus_4_6_has_no_xhigh() {
        let caps = resolve("anthropic", None, "claude-opus-4-6");
        assert_eq!(caps.supported_efforts, vec!["low", "medium", "high", "max"]);
        assert!(caps.supports_temperature);
        assert!(!caps.supports_fast);
    }

    #[test]
    fn claude_fable_5_is_always_on() {
        let caps = resolve("anthropic", None, "claude-fable-5");
        assert_eq!(caps.thinking_style, ThinkingStyle::AlwaysOn);
        assert!(!caps.supports_temperature);
    }

    #[test]
    fn claude_haiku_4_5_has_no_effort() {
        let caps = resolve("anthropic", None, "claude-haiku-4-5");
        assert!(caps.supports_thinking);
        assert!(caps.supported_efforts.is_empty());
        assert!(!caps.supports_reasoning_effort);
    }

    #[test]
    fn adaptive_model_drops_thinking_budget() {
        let caps = resolve("anthropic", None, "claude-opus-4-8");
        let mut params = ChatParams {
            model: "claude-opus-4-8".into(),
            temperature: Some(0.7),
            thinking_enabled: true,
            thinking_budget: Some(10_000),
            thinking_effort: Some("xhigh".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(params.temperature.is_none(), "sampling params are a 400 on Opus 4.7+");
        assert!(
            params.thinking_budget.is_none(),
            "budget_tokens is a 400 on adaptive models"
        );
        assert_eq!(params.thinking_effort, Some("xhigh".into()));
    }

    #[test]
    fn budget_model_keeps_budget_tokens() {
        let caps = resolve("anthropic", None, "claude-sonnet-4-20250514");
        let mut params = ChatParams {
            model: "claude-sonnet-4-20250514".into(),
            thinking_enabled: true,
            thinking_budget: Some(10_000),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.thinking_budget, Some(10_000));
    }

    #[test]
    fn unsupported_effort_falls_back_to_median() {
        // gpt-5.2 tops out at xhigh; "max" must land on the median rather than
        // being dropped or passed through to a 400.
        let caps = resolve("openai", Some("responses"), "gpt-5.2");
        let mut params = ChatParams {
            model: "gpt-5.2".into(),
            thinking_enabled: true,
            thinking_effort: Some("max".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.thinking_effort, Some("medium".into()));
    }

    #[test]
    fn nearest_supported_effort_cases() {
        let full: Vec<String> = ["low", "medium", "high", "xhigh", "max"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(nearest_supported_effort("xhigh", &full), Some("xhigh".into()));
        assert_eq!(nearest_supported_effort("minimal", &full), Some("high".into()));
        assert_eq!(nearest_supported_effort("high", &[]), None);

        let three: Vec<String> = ["low", "medium", "high"].iter().map(|s| s.to_string()).collect();
        assert_eq!(nearest_supported_effort("max", &three), Some("medium".into()));
    }

    #[test]
    fn fast_is_stripped_when_unsupported() {
        let caps = resolve("openai", Some("responses"), "gpt-5.2");
        let mut params = ChatParams {
            model: "gpt-5.2".into(),
            fast: true,
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(!params.fast);
    }

    #[test]
    fn verbosity_defaults_from_catalog_and_is_stripped_when_unsupported() {
        let caps = resolve("openai", Some("responses"), "gpt-5.6-sol");
        let mut params = ChatParams {
            model: "gpt-5.6-sol".into(),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert_eq!(params.verbosity, Some("low".into()));

        let caps = resolve("anthropic", None, "claude-opus-4-8");
        let mut params = ChatParams {
            model: "claude-opus-4-8".into(),
            verbosity: Some("high".into()),
            ..Default::default()
        };
        filter_params(&mut params, &caps);
        assert!(params.verbosity.is_none(), "Anthropic has no verbosity parameter");
    }

    #[test]
    fn gemma_tool_does_not_inherit_openai_rules() {
        // A gemma_tool provider serving a model called "gpt-4o" is not GPT-4o.
        let caps = resolve("openai", Some("gemma_tool"), "gpt-4o");
        assert!(!caps.supports_images);
        assert!(!caps.supports_thinking);
        assert!(caps.supported_efforts.is_empty());
    }

    #[test]
    fn responses_format_gets_reasoning_defaults() {
        let caps = resolve("openai", Some("responses"), "some-unknown-reasoning-model");
        assert!(caps.supports_thinking);
        assert!(caps.supports_reasoning_effort);
        assert_eq!(caps.thinking_style, ThinkingStyle::EffortOnly);
    }

    #[test]
    fn overrides_patch_catalog() {
        let mut caps = resolve("anthropic", None, "claude-haiku-4-5");
        assert!(caps.supported_efforts.is_empty());
        apply_overrides(
            &mut caps,
            Some(r#"{"supported_efforts":["high","low"],"supports_fast":true}"#),
        );
        // Rebuilt through the ladder, so ascending order regardless of input order.
        assert_eq!(caps.supported_efforts, vec!["low", "high"]);
        assert!(caps.supports_reasoning_effort);
        assert!(caps.supports_fast);
    }

    #[test]
    fn malformed_overrides_are_ignored() {
        let mut caps = resolve("anthropic", None, "claude-opus-4-8");
        let before = caps.supported_efforts.clone();
        apply_overrides(&mut caps, Some("not json at all"));
        apply_overrides(&mut caps, Some("[1,2,3]"));
        apply_overrides(&mut caps, None);
        assert_eq!(caps.supported_efforts, before);
    }
}
