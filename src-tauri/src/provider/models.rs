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
    let transport = ReqwestTransport::new(reqwest::Client::new());

    let mut req = Request::new(http::Method::GET, format!("{base_url}/models"));
    req.headers.insert(
        http::header::AUTHORIZATION,
        format!("Bearer {api_key}").parse().unwrap(),
    );

    let resp = transport.execute(req).await?;
    let parsed: OpenAIModelsResponse = serde_json::from_slice(&resp.body)
        .map_err(|e| ProviderError::Parse(e.to_string()))?;

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
    let transport = ReqwestTransport::new(reqwest::Client::new());

    let mut req = Request::new(http::Method::GET, format!("{base_url}/v1/models"));
    req.headers.insert("x-api-key", api_key.parse().unwrap());
    req.headers.insert("anthropic-version", "2023-06-01".parse().unwrap());

    let resp = transport.execute(req).await?;
    let parsed: AnthropicModelsResponse = serde_json::from_slice(&resp.body)
        .map_err(|e| ProviderError::Parse(e.to_string()))?;

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
