use crate::ServicesExt;
use meridian_core::provider::local_model::{self, LocalModelSnapshot};
use meridian_core::provider::registry::LocalInferenceBackend;

pub use meridian_core::provider::local_model::{
    Backend as LocalModelBackend, Modality as LocalModelModality, ModelKind as LocalModelKind,
    NpuBrand as LocalModelNpuBrand, SamplerType as LocalModelSamplerType,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalModelModalityInfoResponse {
    pub modality: LocalModelModality,
    pub preferred_backends: Vec<LocalModelBackend>,
    pub npu_brand: Option<LocalModelNpuBrand>,
    pub soc_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalModelSamplerInfoResponse {
    pub sampler_type: LocalModelSamplerType,
    pub temperature: f64,
    pub top_k: i32,
    pub top_p: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalModelInfoResponse {
    pub runtime_version: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub revision: String,
    pub requested_backend: LocalInferenceBackend,
    pub resolved_backend: Option<LocalModelBackend>,
    pub kind: LocalModelKind,
    pub modalities: Vec<LocalModelModalityInfoResponse>,
    pub supports_thinking: bool,
    pub supports_function_calling: bool,
    pub supports_speculative_decoding: bool,
    pub sampler_defaults: Option<LocalModelSamplerInfoResponse>,
    pub max_context_tokens: Option<u32>,
    pub is_dynamic_context: bool,
    pub max_vision_token_budget: Option<i32>,
    pub vision_signature_lengths: Option<Vec<i32>>,
    pub embedding_signature_lengths: Option<Vec<i32>>,
    pub embedding_dimension: Option<i32>,
    pub min_runtime_version: Option<String>,
}

impl From<LocalModelSnapshot> for LocalModelInfoResponse {
    fn from(value: LocalModelSnapshot) -> Self {
        let info = value.info;
        Self {
            runtime_version: local_model::runtime_version().to_string(),
            file_name: value.file_name,
            file_size_bytes: value.file_size,
            revision: value.revision.to_string(),
            requested_backend: value.requested_backend,
            resolved_backend: value.selected_backend,
            kind: info.kind,
            modalities: info
                .modalities
                .into_iter()
                .map(|item| LocalModelModalityInfoResponse {
                    modality: item.modality,
                    preferred_backends: item.preferred_backends,
                    npu_brand: item.npu_brand,
                    soc_name: item.soc_name,
                })
                .collect(),
            supports_thinking: info.supports_thinking,
            supports_function_calling: info.supports_function_calling,
            supports_speculative_decoding: info.supports_speculative_decoding,
            sampler_defaults: info.sampler_defaults.map(|item| LocalModelSamplerInfoResponse {
                sampler_type: item.sampler_type,
                temperature: item.temperature,
                top_k: item.top_k,
                top_p: item.top_p,
            }),
            max_context_tokens: info.max_context_tokens,
            is_dynamic_context: info.is_dynamic_context,
            max_vision_token_budget: info.max_vision_token_budget,
            vision_signature_lengths: info.vision_signature_lengths,
            embedding_signature_lengths: info.embedding_signature_lengths,
            embedding_dimension: info.embedding_dimension,
            min_runtime_version: info.min_runtime_version,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalModelInspectRequest {
    pub model_path: String,
    pub backend: LocalInferenceBackend,
    pub force_refresh: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderLocalModelInfoReadRequest {
    pub provider_id: String,
    pub force_refresh: bool,
}

#[tauri::command]
pub async fn inspect_local_model(
    _app: tauri::AppHandle,
    request: LocalModelInspectRequest,
) -> Result<LocalModelInfoResponse, String> {
    local_model::inspect_async(request.model_path, request.backend, request.force_refresh)
        .await
        .map(Into::into)
}

#[tauri::command]
pub async fn get_provider_local_model_info(
    app: tauri::AppHandle,
    request: ProviderLocalModelInfoReadRequest,
) -> Result<LocalModelInfoResponse, String> {
    local_model::for_provider(&app.services().db, &request.provider_id, request.force_refresh)
        .await
        .map(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_requests_have_closed_targets_and_backend_values() {
        assert!(
            serde_json::from_value::<LocalModelInspectRequest>(serde_json::json!({
                "modelPath": "C:/model.litertlm", "backend": "gpu", "forceRefresh": true
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<LocalModelInspectRequest>(serde_json::json!({
                "modelPath": "C:/model.litertlm", "backend": "future", "forceRefresh": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ProviderLocalModelInfoReadRequest>(serde_json::json!({
                "providerId": "p1", "forceRefresh": true, "modelPath": "C:/other"
            }))
            .is_err()
        );
    }
}
