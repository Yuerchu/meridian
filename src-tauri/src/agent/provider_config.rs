use crate::db::{self, DbPool};
use crate::db::models::assistant::Assistant;
use crate::db::models::model_config::ModelConfig;
use crate::provider::{self, ChatParams, ProviderCapabilities};
use crate::secrets::{SecretName, SecretScope, SecretsManager};
use crate::util::get_conn;

pub(crate) fn provider_secret_name(provider_id: &str) -> String {
    format!("PROVIDER_{}_KEY", provider_id.replace('-', "_").to_uppercase())
}

pub(crate) fn get_provider_api_key(secrets: &SecretsManager, provider_id: &str) -> Option<String> {
    let key = provider_secret_name(provider_id);
    match secrets.get(&SecretScope::Global, &SecretName::new(&key).unwrap()) {
        Ok(value) => value,
        Err(e) => {
            // Callers turn a None into "API Key not set", which sends a user who
            // definitely set one to enter it again — and re-entering rewrites the
            // store under a fresh passphrase, taking the other providers' keys
            // with it. The distinction between "absent" and "unreadable" only
            // exists here.
            tracing::error!(
                provider_id = %provider_id,
                secret_name = %key,
                error = %e,
                "stored API key could not be read; it will look as though none was set"
            );
            None
        }
    }
}

/// Secrets exposed to tool executors (web_search provider selection + service
/// API keys). Shared by the desktop chat loop and the OneBot headless agent.
pub(crate) fn build_tool_secrets(
    secrets: &SecretsManager,
    pool: &DbPool,
) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if let Ok(mut conn) = pool.get() {
        if let Ok(Some(sp)) = db::ops::preference::get_preference(&mut conn, "search_provider") {
            map.insert("SEARCH_PROVIDER".to_string(), sp);
        }
    }
    for key in ["SERVICE_TAVILY_KEY", "SERVICE_ZHIPU_SEARCH_KEY"] {
        if let Ok(name) = SecretName::new(key) {
            if let Ok(Some(val)) = secrets.get(&SecretScope::Global, &name) {
                map.insert(key.to_string(), val);
            }
        }
    }
    map
}

pub(crate) fn resolve_provider_config(
    secrets: &SecretsManager,
    pool: &DbPool,
    assistant: Option<&Assistant>,
) -> Result<(String, String, String, String, String), String> {
    if let Some(provider_id) = assistant.and_then(|a| a.provider_id.as_deref()) {
        let mut conn = get_conn(pool)?;
        let provider = db::ops::provider::get_provider(&mut conn, provider_id)
            .map_err(|e| format!("Provider not found: {e}"))?;
        let api_key = get_provider_api_key(secrets, provider_id)
            .ok_or_else(|| format!("API Key not set for provider '{}'", provider.name))?;
        let model = assistant
            .and_then(|a| a.model_id.clone())
            .ok_or("No model configured. Go to Settings → Assistant to set a model.")?;
        let base_url = provider.base_url.trim_end_matches('/').to_string();
        return Ok((provider.provider_type, base_url, api_key, model, provider.api_format));
    }

    // Fallback: first enabled provider
    let mut conn = get_conn(pool)?;
    if let Ok(providers) = db::ops::provider::list_providers(&mut conn) {
        if let Some(p) = providers.into_iter().find(|p| p.is_enabled != 0) {
            if let Some(api_key) = get_provider_api_key(secrets, &p.id) {
                let model = assistant
                    .and_then(|a| a.model_id.clone())
                    .ok_or("No model configured. Go to Settings → Assistant to set a model.")?;
                let base_url = p.base_url.trim_end_matches('/').to_string();
                return Ok((p.provider_type, base_url, api_key, model, p.api_format));
            }
        }
    }

    Err("No provider configured. Go to Settings → Provider to add one.".into())
}

/// For the passes that only read a conversation and write prose about it —
/// summarisation, extraction. Thinking comes off so an inherited budget cannot
/// meet or exceed max_tokens (Anthropic 400s when budget_tokens >= max_tokens),
/// and so a throwaway pass is not paid for in reasoning tokens. Everything else
/// stays as the turn resolver left it.
pub(crate) fn without_thinking(params: ChatParams) -> ChatParams {
    ChatParams {
        thinking_enabled: false,
        thinking_budget: None,
        thinking_effort: None,
        ..params
    }
}

/// Everything a request needs beyond the messages: the wire parameters plus the
/// limits the token budget is derived from. Assistant settings, the per-model
/// config row and the catalog are layered here once, so no call site invents a
/// value of its own — a summarisation request is filtered against the same
/// capabilities as the turn it summarises.
#[derive(Debug)]
pub(crate) struct TurnParams {
    pub params: ChatParams,
    pub caps: ProviderCapabilities,
    pub context_limit: usize,
    pub max_output: usize,
    /// `None` leaves the budget free to derive its own threshold.
    pub compact_threshold: Option<usize>,
    /// Handed back so callers that also need pricing don't query it twice.
    pub model_config: Option<ModelConfig>,
}

pub(crate) struct TurnParamsInput<'a> {
    pub assistant: Option<&'a Assistant>,
    /// The provider actually used this turn, which a per-request override may
    /// have moved away from the assistant's own.
    pub provider_id: Option<&'a str>,
    pub provider_type: &'a str,
    pub api_format: &'a str,
    pub model: &'a str,
    pub thinking_level: Option<&'a str>,
    pub fast: bool,
}

pub(crate) fn resolve_turn_params(
    pool: &DbPool,
    input: TurnParamsInput<'_>,
) -> Result<TurnParams, String> {
    let TurnParamsInput {
        assistant, provider_id, provider_type, api_format, model, thinking_level, fast,
    } = input;

    // Not a silent fallback. A pool timeout here used to be indistinguishable
    // from "this model has no config row": the turn would drop through to the
    // catalog defaults and run with a different context limit, output ceiling
    // and capability set than the user configured. Failing visibly beats
    // quietly changing the parameters of the request.
    let model_config = match provider_id {
        Some(pid) => {
            let mut conn = get_conn(pool)?;
            db::ops::model_config::get_by_provider_and_model(&mut conn, pid, model)
                .map_err(|e| format!("could not read the stored config for '{model}': {e}"))?
        }
        None => None,
    };

    let mut caps = provider::capabilities::resolve(provider_type, Some(api_format), model);
    provider::capabilities::apply_overrides(
        &mut caps,
        model_config.as_ref().and_then(|mc| mc.capability_overrides.as_deref()),
    );

    let context_limit = assistant
        .filter(|a| a.context_limit > 0)
        .map(|a| a.context_limit as usize)
        .or_else(|| model_config.as_ref().map(|mc| mc.context_window as usize))
        .or_else(|| caps.max_context_tokens.map(|t| t as usize))
        .ok_or_else(|| format!(
            "No context window known for '{model}'. Go to Settings → Provider → Model to set one."
        ))?;
    let max_output = model_config.as_ref()
        .and_then(|mc| mc.max_output_tokens.map(|t| t as usize))
        .or_else(|| caps.max_output_tokens.map(|t| t as usize))
        .ok_or_else(|| format!(
            "No max output tokens known for '{model}'. Go to Settings → Provider → Model to set one."
        ))?;

    let (thinking_enabled, thinking_budget, thinking_effort) = provider::capabilities::resolve_thinking(
        assistant.map(|a| a.thinking_enabled != 0).unwrap_or(false),
        assistant.and_then(|a| a.thinking_budget),
        thinking_level,
    );

    let mut params = ChatParams {
        model: model.to_string(),
        temperature: assistant.and_then(|a| a.temperature.map(|t| t as f64)),
        top_p: assistant.and_then(|a| a.top_p.map(|t| t as f64)),
        max_tokens: assistant.and_then(|a| a.max_tokens).or(Some(max_output as i32)),
        thinking_enabled,
        thinking_budget,
        thinking_effort,
        fast,
        // thinking_style and verbosity are derived from the catalog by
        // filter_params below, not supplied by the caller.
        ..Default::default()
    };
    provider::capabilities::filter_params(&mut params, &caps);

    Ok(TurnParams {
        params,
        caps,
        context_limit,
        max_output,
        compact_threshold: model_config.as_ref().map(|mc| mc.compact_threshold as usize),
        model_config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_secret_name() {
        assert_eq!(
            provider_secret_name("my-provider-1"),
            "PROVIDER_MY_PROVIDER_1_KEY"
        );
    }

    fn assistant_with(temperature: Option<f32>) -> Assistant {
        Assistant {
            id: "a1".into(),
            name: "A".into(),
            description: None,
            avatar: None,
            system_prompt: String::new(),
            provider_id: None,
            model_id: None,
            temperature,
            top_p: None,
            max_tokens: None,
            is_default: 0,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            context_limit: 0,
            compact_keep_recent: 10,
            enabled_tools: None,
            thinking_enabled: 1,
            thinking_budget: Some(4096),
            tool_preset_id: None,
            auto_compact_enabled: 1,
        }
    }

    fn resolve_for(pool: &DbPool, model: &str, assistant: &Assistant) -> TurnParams {
        resolve_turn_params(pool, TurnParamsInput {
            assistant: Some(assistant),
            provider_id: None,
            provider_type: "openai",
            api_format: "responses",
            model,
            thinking_level: None,
            fast: false,
        }).unwrap()
    }

    #[test]
    fn a_model_that_rejects_temperature_never_sees_one() {
        let pool = crate::db::test_db();
        let assistant = assistant_with(Some(0.7));

        let turn = resolve_for(&pool, "o3", &assistant);

        assert_eq!(turn.params.temperature, None);
    }

    #[test]
    fn dropping_thinking_leaves_the_rest_of_the_turn_alone() {
        let pool = crate::db::test_db();
        let assistant = assistant_with(Some(0.7));

        let turn = resolve_for(&pool, "gpt-4o", &assistant);
        let summarising = without_thinking(turn.params.clone());

        assert_eq!(summarising.temperature, turn.params.temperature);
        assert_eq!(summarising.max_tokens, turn.params.max_tokens);
        assert_eq!(summarising.model, turn.params.model);
        assert!(!summarising.thinking_enabled);
        assert_eq!(summarising.thinking_budget, None);
        assert_eq!(summarising.thinking_effort, None);
    }

    #[test]
    fn an_unknown_model_asks_the_user_to_configure_it() {
        let pool = crate::db::test_db();
        let assistant = assistant_with(None);

        let err = resolve_turn_params(&pool, TurnParamsInput {
            assistant: Some(&assistant),
            provider_id: None,
            provider_type: "openai",
            api_format: "chat",
            model: "some-model-nobody-catalogued",
            thinking_level: None,
            fast: false,
        }).unwrap_err();

        assert!(err.contains("Settings"), "{err}");
    }
}
