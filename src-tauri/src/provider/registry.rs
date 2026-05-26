use super::ChatProvider;
use super::anthropic::AnthropicProvider;
use super::openai_compat::OpenAICompatProvider;

pub fn create_provider(
    provider_type: &str,
    base_url: &str,
    api_key: &str,
) -> Box<dyn ChatProvider> {
    match provider_type {
        "anthropic" => Box::new(AnthropicProvider::new(base_url, api_key)),
        _ => Box::new(OpenAICompatProvider::new(base_url, api_key)),
    }
}
