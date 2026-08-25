use super::ChatProvider;
use super::ProviderCapabilities;
use super::anthropic::AnthropicProvider;
use super::deepseek::DeepSeekProvider;
use super::gemma_tool::GemmaToolProvider;
use super::google_generate_content::GoogleGenerateContentProvider;
use super::openai_compat::OpenAICompatProvider;
use super::openai_responses::OpenAIResponsesProvider;

/// Pick the adapter for a provider row.
///
/// Keyed on `provider_type` and `api_format` — and, once the Codex transport
/// lands, on `transport_profile` as the third input. Deliberately *not* on the
/// credential: how we authenticated says nothing about how the request is
/// shaped, and two ChatGPT logins reaching one endpoint must not produce two
/// adapters.
pub fn create_provider(
    provider_type: &str,
    base_url: &str,
    credential: &super::Credential,
    api_format: Option<&str>,
) -> Box<dyn ChatProvider> {
    let api_key = credential.api_key();
    match provider_type {
        "anthropic" => Box::new(AnthropicProvider::new(base_url, api_key)),
        // Both of these speak two dialects, and the choice is not cosmetic: the
        // server-side tools (Grok's own web search, DeepSeek's) exist only on
        // the Responses API. xAI's chat-completions endpoint rejects
        // `{"type":"web_search"}` outright — measured, it answers 422 with
        // "expected `function` or `live_search`".
        "deepseek" => match api_format {
            Some("responses") => Box::new(OpenAIResponsesProvider::new(base_url, api_key)),
            _ => Box::new(DeepSeekProvider::new(base_url, api_key)),
        },
        // Chat-completions here is ordinary chat-completions plus one header;
        // see `OpenAICompatFlavor` for why that is a flavor rather than an
        // adapter of its own.
        "xai" => match api_format {
            Some("responses") => Box::new(OpenAIResponsesProvider::new(base_url, api_key)),
            _ => Box::new(OpenAICompatProvider::new_xai(base_url, api_key)),
        },
        "google" => match api_format {
            Some("gemini_generate_content") => Box::new(GoogleGenerateContentProvider::new(base_url, api_key)),
            _ => Box::new(OpenAICompatProvider::new_google(base_url, api_key)),
        },
        _ => match api_format {
            Some("responses") => Box::new(OpenAIResponsesProvider::new(base_url, api_key)),
            Some("gemma_tool") => Box::new(GemmaToolProvider::new(base_url, api_key)),
            _ => Box::new(OpenAICompatProvider::new(base_url, api_key)),
        },
    }
}

pub fn get_capabilities(provider_type: &str, api_format: Option<&str>, model: &str) -> ProviderCapabilities {
    super::capabilities::resolve(provider_type, api_format, model)
}
