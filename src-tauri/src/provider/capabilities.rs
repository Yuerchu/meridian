use super::{ChatParams, ProviderCapabilities};

struct ModelRule {
    prefix: &'static str,
    patch: CapabilityPatch,
}

#[derive(Default)]
struct CapabilityPatch {
    supports_tools: Option<bool>,
    supports_streaming_tools: Option<bool>,
    supports_thinking: Option<bool>,
    supports_images: Option<bool>,
    supports_pdf: Option<bool>,
    supports_temperature: Option<bool>,
    supports_top_p: Option<bool>,
    supports_reasoning_effort: Option<bool>,
    max_context_tokens: Option<Option<u32>>,
    max_output_tokens: Option<Option<u32>>,
    max_temperature: Option<Option<f32>>,
}

const P: CapabilityPatch = CapabilityPatch {
    supports_tools: None,
    supports_streaming_tools: None,
    supports_thinking: None,
    supports_images: None,
    supports_pdf: None,
    supports_temperature: None,
    supports_top_p: None,
    supports_reasoning_effort: None,
    max_context_tokens: None,
    max_output_tokens: None,
    max_temperature: None,
};

fn apply(base: &mut ProviderCapabilities, patch: &CapabilityPatch) {
    if let Some(v) = patch.supports_tools { base.supports_tools = v; }
    if let Some(v) = patch.supports_streaming_tools { base.supports_streaming_tools = v; }
    if let Some(v) = patch.supports_thinking { base.supports_thinking = v; }
    if let Some(v) = patch.supports_images { base.supports_images = v; }
    if let Some(v) = patch.supports_pdf { base.supports_pdf = v; }
    if let Some(v) = patch.supports_temperature { base.supports_temperature = v; }
    if let Some(v) = patch.supports_top_p { base.supports_top_p = v; }
    if let Some(v) = patch.supports_reasoning_effort { base.supports_reasoning_effort = v; }
    if let Some(v) = patch.max_context_tokens { base.max_context_tokens = v; }
    if let Some(v) = patch.max_output_tokens { base.max_output_tokens = v; }
    if let Some(v) = patch.max_temperature { base.max_temperature = v; }
}

fn find_longest_prefix_match<'a>(rules: &'a [ModelRule], model: &str) -> Option<&'a CapabilityPatch> {
    let lower = model.to_ascii_lowercase();
    rules
        .iter()
        .filter(|r| lower.starts_with(r.prefix))
        .max_by_key(|r| r.prefix.len())
        .map(|r| &r.patch)
}

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

fn anthropic_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_images: true,
        supports_pdf: true,
        supports_temperature: true,
        supports_top_p: true,
        supports_reasoning_effort: false,
        max_context_tokens: Some(200_000),
        max_output_tokens: Some(64_000),
        max_temperature: Some(1.0),
    }
}

fn openai_responses_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_images: true,
        supports_pdf: false,
        supports_temperature: true,
        supports_top_p: true,
        supports_reasoning_effort: true,
        max_context_tokens: Some(200_000),
        max_output_tokens: Some(100_000),
        max_temperature: Some(2.0),
    }
}

fn deepseek_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: true,
        supports_images: false,
        supports_pdf: false,
        supports_temperature: false,
        supports_top_p: false,
        supports_reasoning_effort: true,
        max_context_tokens: Some(128_000),
        max_output_tokens: Some(16_000),
        max_temperature: Some(2.0),
    }
}

fn generic_default() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_tools: true,
        supports_streaming_tools: true,
        supports_thinking: false,
        supports_images: false,
        supports_pdf: false,
        supports_temperature: true,
        supports_top_p: true,
        supports_reasoning_effort: false,
        max_context_tokens: None,
        max_output_tokens: None,
        max_temperature: Some(2.0),
    }
}

// ---------------------------------------------------------------------------
// Model-specific rules (sorted by prefix length descending is NOT required;
// find_longest_prefix_match picks the longest match regardless of order)
// ---------------------------------------------------------------------------

static ANTHROPIC_RULES: &[ModelRule] = &[
    // Claude 4 family
    ModelRule { prefix: "claude-opus-4", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_images: Some(true), supports_pdf: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(64_000)),
        ..P
    }},
    ModelRule { prefix: "claude-sonnet-4", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_images: Some(true), supports_pdf: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(64_000)),
        ..P
    }},
    // Claude 3.7
    ModelRule { prefix: "claude-3-7-sonnet", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_images: Some(true), supports_pdf: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(64_000)),
        ..P
    }},
    // Claude 3.5
    ModelRule { prefix: "claude-3-5-sonnet", patch: CapabilityPatch {
        supports_thinking: Some(false), supports_images: Some(true), supports_pdf: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(8_192)),
        ..P
    }},
    ModelRule { prefix: "claude-3-5-haiku", patch: CapabilityPatch {
        supports_thinking: Some(false), supports_images: Some(true), supports_pdf: Some(false),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(8_192)),
        ..P
    }},
    // Claude 3
    ModelRule { prefix: "claude-3-opus", patch: CapabilityPatch {
        supports_thinking: Some(false), supports_images: Some(true), supports_pdf: Some(false),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
    ModelRule { prefix: "claude-3-sonnet", patch: CapabilityPatch {
        supports_thinking: Some(false), supports_images: Some(true), supports_pdf: Some(false),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
    ModelRule { prefix: "claude-3-haiku", patch: CapabilityPatch {
        supports_thinking: Some(false), supports_images: Some(true), supports_pdf: Some(false),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
];

static OPENAI_RULES: &[ModelRule] = &[
    // o-series reasoning models
    ModelRule { prefix: "o3", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_reasoning_effort: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        supports_images: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(100_000)),
        ..P
    }},
    ModelRule { prefix: "o4-mini", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_reasoning_effort: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        supports_images: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(100_000)),
        ..P
    }},
    ModelRule { prefix: "o1", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_reasoning_effort: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        supports_images: Some(true),
        max_context_tokens: Some(Some(200_000)), max_output_tokens: Some(Some(100_000)),
        ..P
    }},
    // GPT-4.1 family
    ModelRule { prefix: "gpt-4.1", patch: CapabilityPatch {
        supports_images: Some(true),
        max_context_tokens: Some(Some(1_047_576)), max_output_tokens: Some(Some(32_768)),
        ..P
    }},
    // GPT-4o family
    ModelRule { prefix: "gpt-4o", patch: CapabilityPatch {
        supports_images: Some(true),
        max_context_tokens: Some(Some(128_000)), max_output_tokens: Some(Some(16_384)),
        ..P
    }},
    // GPT-4 turbo
    ModelRule { prefix: "gpt-4-turbo", patch: CapabilityPatch {
        supports_images: Some(true),
        max_context_tokens: Some(Some(128_000)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
    // GPT-4 (base, no vision)
    ModelRule { prefix: "gpt-4", patch: CapabilityPatch {
        supports_images: Some(false),
        max_context_tokens: Some(Some(8_192)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
    // GPT-3.5
    ModelRule { prefix: "gpt-3.5", patch: CapabilityPatch {
        supports_images: Some(false),
        max_context_tokens: Some(Some(16_385)), max_output_tokens: Some(Some(4_096)),
        ..P
    }},
];

static DEEPSEEK_RULES: &[ModelRule] = &[
    // V4 family (thinking enabled by default, reasoning_effort supported)
    ModelRule { prefix: "deepseek-v4-pro", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_reasoning_effort: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        max_context_tokens: Some(Some(128_000)), max_output_tokens: Some(Some(16_000)),
        ..P
    }},
    ModelRule { prefix: "deepseek-v4-flash", patch: CapabilityPatch {
        supports_thinking: Some(true), supports_reasoning_effort: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        max_context_tokens: Some(Some(128_000)), max_output_tokens: Some(Some(16_000)),
        ..P
    }},
    // Legacy (deprecated 2026-07-24)
    ModelRule { prefix: "deepseek-reasoner", patch: CapabilityPatch {
        supports_thinking: Some(true),
        supports_temperature: Some(false), supports_top_p: Some(false),
        max_context_tokens: Some(Some(64_000)), max_output_tokens: Some(Some(16_000)),
        ..P
    }},
    ModelRule { prefix: "deepseek-chat", patch: CapabilityPatch {
        supports_thinking: Some(false),
        max_context_tokens: Some(Some(64_000)), max_output_tokens: Some(Some(16_000)),
        ..P
    }},
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn resolve(provider_type: &str, api_format: Option<&str>, model: &str) -> ProviderCapabilities {
    let (mut caps, rules): (ProviderCapabilities, &[ModelRule]) = match provider_type {
        "anthropic" => (anthropic_default(), ANTHROPIC_RULES),
        "deepseek" => (deepseek_default(), DEEPSEEK_RULES),
        _ => match api_format {
            Some("responses") => (openai_responses_default(), OPENAI_RULES),
            _ => (generic_default(), OPENAI_RULES),
        },
    };
    if let Some(patch) = find_longest_prefix_match(rules, model) {
        apply(&mut caps, patch);
    }
    caps
}

pub fn filter_params(params: &mut ChatParams, caps: &ProviderCapabilities) {
    if !caps.supports_temperature {
        params.temperature = None;
    }
    if !caps.supports_top_p {
        params.top_p = None;
    }
    if !caps.supports_thinking {
        params.thinking_enabled = false;
        params.thinking_budget = None;
        params.thinking_effort = None;
    }
    if !caps.supports_reasoning_effort {
        params.thinking_effort = None;
    }
    if let (Some(max_temp), Some(temp)) = (caps.max_temperature, params.temperature) {
        if temp > max_temp as f64 {
            params.temperature = Some(max_temp as f64);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
