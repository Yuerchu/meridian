use super::ChatProvider;
use super::ProviderCapabilities;
use super::anthropic::AnthropicProvider;
use super::deepseek::DeepSeekProvider;
use super::gemma_tool::GemmaToolProvider;
use super::google_generate_content::GoogleGenerateContentProvider;
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
