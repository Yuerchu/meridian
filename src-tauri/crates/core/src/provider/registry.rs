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
/// Keyed on `provider_type`, `api_format` and `transport_profile`. Deliberately
/// *not* on the credential: how we authenticated says nothing about how the
/// request is shaped, and two ChatGPT logins reaching one endpoint must not
/// produce two adapters. The credential arrives as a value that already knows
/// which of those it is.
pub fn create_provider(
    provider_type: &str,
    base_url: &str,
    credential: &super::Credential,
    api_format: Option<&str>,
    transport_profile: Option<&str>,
) -> Box<dyn ChatProvider> {
    let api_key = credential.api_key();

    // Checked before `provider_type`, because it is the stronger statement: a
    // row reaching ChatGPT's Codex backend is that transport whatever family it
    // is filed under. It is also the only arm that needs a live session rather
    // than a key, so a mismatched credential is refused here instead of
    // producing an adapter that cannot authenticate.
    if transport_profile == Some("chatgpt_codex") {
        match credential {
            super::Credential::ChatGpt(auth) => {
                return Box::new(super::codex::CodexProvider::new(base_url, auth.clone()));
            }
            // Configuration this app should not be able to produce: the catalog
            // pairs this transport only with the two ChatGPT logins. Falling
            // through would send an API key to an endpoint that does not take
            // one, so the request fails with something that names the cause.
            super::Credential::ApiKey(_) => {
                return Box::new(super::Misconfigured::new(
                    "This provider is set to reach ChatGPT's Codex backend, which needs a ChatGPT \
                     login rather than an API key. Change the sign-in method in provider settings.",
                ));
            }
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Credential;
    use std::sync::Arc;

    fn chatgpt_credential() -> Credential {
        Credential::ChatGpt(crate::codex_auth::registry().get(crate::codex_auth::StoreId::CodexCli {
            home: std::path::PathBuf::from("/nonexistent"),
        }))
    }

    /// The transport decides, not the family. `openai` with this transport is
    /// the Codex adapter even though `openai` alone would fall through to the
    /// compatible path.
    #[test]
    fn the_transport_profile_selects_the_codex_adapter() {
        for provider_type in ["openai", "anything-else"] {
            let provider = create_provider(
                provider_type,
                "https://example.invalid",
                &chatgpt_credential(),
                Some("responses"),
                Some("chatgpt_codex"),
            );
            assert_eq!(provider.adapter_name(), "CodexProvider", "{provider_type}");
        }
    }

    /// **Both ChatGPT logins produce one adapter.** They yield the same token
    /// against the same endpoint, so the credential must not be an input to this
    /// choice — that is the whole reason `Credential` is shaped by how the
    /// secret is obtained rather than by which login the user picked.
    #[test]
    fn either_chatgpt_login_reaches_the_same_adapter() {
        let from_cli = crate::codex_auth::registry().get(crate::codex_auth::StoreId::CodexCli {
            home: std::path::PathBuf::from("/nonexistent"),
        });
        let app_owned = crate::codex_auth::registry().get(crate::codex_auth::StoreId::MeridianOwned {
            provider_id: "p1".into(),
            slot: "default".into(),
        });
        assert!(!Arc::ptr_eq(&from_cli, &app_owned), "two distinct stores");

        for manager in [from_cli, app_owned] {
            let provider = create_provider(
                "openai",
                "https://example.invalid",
                &Credential::ChatGpt(manager),
                Some("responses"),
                Some("chatgpt_codex"),
            );
            assert_eq!(provider.adapter_name(), "CodexProvider");
        }
    }

    /// An API key against this transport cannot work, and saying so beats a 401
    /// from an endpoint that never takes keys.
    #[test]
    fn an_api_key_against_the_codex_transport_explains_itself() {
        let provider = create_provider(
            "openai",
            "https://example.invalid",
            &Credential::ApiKey("sk-test".into()),
            Some("responses"),
            Some("chatgpt_codex"),
        );
        assert_eq!(provider.adapter_name(), "Misconfigured");
    }

    /// Everything that existed before still resolves the way it did — the new
    /// argument is additive, and `standard` is what every row holds.
    #[test]
    fn the_standard_transport_leaves_every_existing_choice_alone() {
        let key = Credential::ApiKey("k".into());
        let cases = [
            ("anthropic", None, "AnthropicProvider"),
            ("deepseek", Some("responses"), "OpenAIResponsesProvider"),
            ("deepseek", Some("chat_completions"), "DeepSeekProvider"),
            ("xai", Some("responses"), "OpenAIResponsesProvider"),
            ("xai", Some("chat_completions"), "OpenAICompatProvider"),
            (
                "google",
                Some("gemini_generate_content"),
                "GoogleGenerateContentProvider",
            ),
            ("openai", Some("responses"), "OpenAIResponsesProvider"),
            ("openai", Some("chat_completions"), "OpenAICompatProvider"),
            ("openai", Some("gemma_tool"), "GemmaToolProvider"),
        ];
        for (provider_type, api_format, expected) in cases {
            let provider = create_provider("x", "https://example.invalid", &key, api_format, Some("standard"));
            let _ = provider;
            let provider = create_provider(provider_type, "https://e.invalid", &key, api_format, Some("standard"));
            assert_eq!(provider.adapter_name(), expected, "{provider_type}/{api_format:?}");
        }
    }
}
