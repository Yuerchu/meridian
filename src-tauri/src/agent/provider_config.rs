use crate::db::{self, DbPool};
use crate::db::models::assistant::Assistant;
use crate::secrets::{SecretName, SecretScope, SecretsManager};
use crate::util::get_conn;

pub(crate) fn provider_secret_name(provider_id: &str) -> String {
    format!("PROVIDER_{}_KEY", provider_id.replace('-', "_").to_uppercase())
}

pub(crate) fn get_provider_api_key(secrets: &SecretsManager, provider_id: &str) -> Option<String> {
    let key = provider_secret_name(provider_id);
    secrets.get(&SecretScope::Global, &SecretName::new(&key).unwrap()).ok().flatten()
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
}
