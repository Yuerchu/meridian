use super::{ChatProvider, ProviderCapabilities};
use super::anthropic::AnthropicProvider;
use super::deepseek::DeepSeekProvider;
use super::openai_compat::OpenAICompatProvider;
use super::openai_responses::OpenAIResponsesProvider;

pub fn create_provider(
    provider_type: &str,
    base_url: &str,
    api_key: &str,
    api_format: Option<&str>,
) -> Box<dyn ChatProvider> {
    match provider_type {
        "anthropic" => Box::new(AnthropicProvider::new(base_url, api_key)),
        "deepseek" => Box::new(DeepSeekProvider::new(base_url, api_key)),
        _ => match api_format {
            Some("responses") => Box::new(OpenAIResponsesProvider::new(base_url, api_key)),
            _ => Box::new(OpenAICompatProvider::new(base_url, api_key)),
        },
    }
}

pub fn get_capabilities(provider_type: &str, api_format: Option<&str>, model: &str) -> ProviderCapabilities {
    match provider_type {
        "anthropic" => AnthropicProvider::new("", "").capabilities(model),
        "deepseek" => DeepSeekProvider::new("", "").capabilities(model),
        _ => match api_format {
            Some("responses") => OpenAIResponsesProvider::new("", "").capabilities(model),
            _ => OpenAICompatProvider::new("", "").capabilities(model),
        },
    }
}
