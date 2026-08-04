use serde::{Deserialize, Serialize};

use crate::client::{HttpTransport, ReqwestTransport, Request};
use super::ProviderError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

pub async fn fetch_models(
    provider_type: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, ProviderError> {
    match provider_type {
        "anthropic" => fetch_anthropic_models(base_url, api_key).await,
        _ => fetch_openai_models(base_url, api_key).await,
    }
}

#[derive(Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Deserialize)]
struct OpenAIModel {
    id: String,
}

async fn fetch_openai_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let base_url = base_url.trim_end_matches('/');
    let transport = ReqwestTransport::shared();

    let mut req = Request::new(http::Method::GET, format!("{base_url}/models"));
    req.headers.insert(
        http::header::AUTHORIZATION,
        super::auth_header_value(&format!("Bearer {api_key}")),
    );

    // The HTTP failure itself is recorded by the transport; what that cannot say
    // is that this was the model list — the first button pressed after adding a
    // provider, and where a wrong base URL or key usually shows up.
    let resp = transport.execute(req).await.inspect_err(|e| {
        tracing::error!(api = "openai", error = %e, "could not fetch the model list");
    })?;
    let parsed: OpenAIModelsResponse = serde_json::from_slice(&resp.body).map_err(|e| {
        // Relays often answer /models with a non-standard shape, and the user
        // just sees an empty dropdown with no error at all.
        tracing::warn!(
            api = "openai",
            body_len = resp.body.len(),
            error = %e,
            "the model list response was not in the expected shape"
        );
        ProviderError::Parse(e.to_string())
    })?;

    let mut models: Vec<ModelInfo> = parsed
        .data
        .into_iter()
        .map(|m| ModelInfo {
            name: m.id.clone(),
            id: m.id,
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[derive(Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModel>,
}

#[derive(Deserialize)]
struct AnthropicModel {
    id: String,
    display_name: Option<String>,
}

async fn fetch_anthropic_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let base_url = base_url.trim_end_matches('/');
    let transport = ReqwestTransport::shared();

    let mut req = Request::new(http::Method::GET, format!("{base_url}/v1/models"));
    req.headers.insert("x-api-key", super::auth_header_value(api_key));
    req.headers.insert("anthropic-version", "2023-06-01".parse().unwrap());

    let resp = transport.execute(req).await.inspect_err(|e| {
        tracing::error!(api = "anthropic", error = %e, "could not fetch the model list");
    })?;
    let parsed: AnthropicModelsResponse = serde_json::from_slice(&resp.body).map_err(|e| {
        tracing::warn!(
            api = "anthropic",
            body_len = resp.body.len(),
            error = %e,
            "the model list response was not in the expected shape"
        );
        ProviderError::Parse(e.to_string())
    })?;

    let mut models: Vec<ModelInfo> = parsed
        .data
        .into_iter()
        .map(|m| ModelInfo {
            name: m.display_name.unwrap_or_else(|| m.id.clone()),
            id: m.id,
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}
