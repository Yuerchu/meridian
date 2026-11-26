//! Tauri IPC commands for multi-domain image & video generation (`Studio` and
//! gallery operations).
//!
//! All commands accept a single strict `#[serde(deny_unknown_fields)]` request
//! object and route every asset export through `meridian-core`'s
//! [`ExportWatermarkPolicy`] / `MediaCompliancePort`.

use base64::Engine;
use meridian_core::db::entity::media_generation::{MediaGenerationDomain, MediaGenerationSource};
use meridian_core::media::{
    ExportWatermarkMode, ExportWatermarkPolicy, MediaGenerationJobSpec, MediaGenerationParams, MediaGenerationRecord,
    MediaReference, MediaReferenceRole, StoredMediaAsset,
};
use serde::{Deserialize, Serialize};

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaReferenceImageRequest {
    pub mime_type: String,
    pub base64_data: RequiredNullable<String>,
    pub existing_generation_id: RequiredNullable<String>,
    pub existing_asset_index: RequiredNullable<u32>,
    pub role: MediaReferenceRole,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationCreateRequest {
    pub capability_domain: MediaGenerationDomain,
    pub logical_model_id: RequiredNullable<String>,
    pub prompt: String,
    pub reference_images: Vec<MediaReferenceImageRequest>,
    pub aspect_ratio: RequiredNullable<String>,
    pub size: RequiredNullable<String>,
    pub quality: RequiredNullable<String>,
    pub count: RequiredNullable<u32>,
    pub resolution: RequiredNullable<String>,
    pub duration_seconds: RequiredNullable<u32>,
    pub seed: RequiredNullable<i64>,
    pub generate_audio: RequiredNullable<bool>,
    pub conversation_id: RequiredNullable<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationListRequest {
    pub capability_domain: RequiredNullable<MediaGenerationDomain>,
    pub limit: RequiredNullable<u64>,
    pub offset: RequiredNullable<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationReadRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationCancelRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationDeleteRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaGenerationExportRequest {
    pub id: String,
    pub asset_index: u32,
    pub destination_path: RequiredNullable<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaAssetInfoResponse {
    pub file_uri: String,
    pub relative_path: String,
    pub mime_type: String,
    pub bytes_len: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub revised_prompt: Option<String>,
    pub produce_id: String,
    pub is_ai_generated: bool,
    pub watermark_snapshot: Option<String>,
}

impl From<StoredMediaAsset> for MediaAssetInfoResponse {
    fn from(asset: StoredMediaAsset) -> Self {
        Self {
            file_uri: asset.file_uri,
            relative_path: asset.relative_path,
            mime_type: asset.mime_type,
            bytes_len: asset.bytes_len,
            width: asset.width,
            height: asset.height,
            duration_seconds: asset.duration_seconds,
            revised_prompt: asset.revised_prompt,
            produce_id: asset.produce_id,
            is_ai_generated: asset.is_ai_generated,
            watermark_snapshot: asset.watermark_snapshot,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaGenerationInfoResponse {
    pub id: String,
    pub capability_domain: String,
    pub logical_model_id: Option<String>,
    pub deployment_id: Option<String>,
    pub provider_id: Option<String>,
    pub remote_model_id: Option<String>,
    pub protocol_id: Option<String>,
    pub prompt: String,
    pub params_json: String,
    pub status: String,
    pub progress_pct: Option<i32>,
    pub upstream_job_id: Option<String>,
    pub assets: Vec<MediaAssetInfoResponse>,
    pub error_message: Option<String>,
    pub conversation_id: Option<String>,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}

pub type MediaGenerationListResponse = Vec<MediaGenerationInfoResponse>;

impl From<MediaGenerationRecord> for MediaGenerationInfoResponse {
    fn from(record: MediaGenerationRecord) -> Self {
        Self {
            id: record.id,
            capability_domain: record.capability_domain,
            logical_model_id: record.logical_model_id,
            deployment_id: record.deployment_id,
            provider_id: record.provider_id,
            remote_model_id: record.remote_model_id,
            protocol_id: record.protocol_id,
            prompt: record.prompt,
            params_json: record.params_json,
            status: record.status,
            progress_pct: record.progress_pct,
            upstream_job_id: record.upstream_job_id,
            assets: record.assets.into_iter().map(Into::into).collect(),
            error_message: record.error_message,
            conversation_id: record.conversation_id,
            source: record.source,
            created_at: record.created_at,
            updated_at: record.updated_at,
            completed_at: record.completed_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaGenerationExportResponse {
    pub generation_id: String,
    pub asset_index: u32,
    pub mime_type: String,
    pub bytes_len: u64,
    pub produce_id: String,
    pub written_path: Option<String>,
    pub base64_data: Option<String>,
}

#[tauri::command]
pub async fn create_media_generation(
    app: tauri::AppHandle,
    request: MediaGenerationCreateRequest,
) -> Result<MediaGenerationInfoResponse, String> {
    let runner = &app.services().media_runner;

    let mut reference_images = Vec::with_capacity(request.reference_images.len());
    for item in request.reference_images {
        if let Some(gen_id) = item.existing_generation_id.0 {
            let idx = item.existing_asset_index.0.unwrap_or(0) as usize;
            let existing = runner
                .get(&gen_id)
                .await?
                .ok_or_else(|| format!("referenced generation `{gen_id}` not found"))?;
            let asset = existing
                .assets
                .get(idx)
                .ok_or_else(|| format!("referenced asset index {idx} out of range for `{gen_id}`"))?;
            let abs_path = runner.store().resolve_relative(&asset.relative_path)?;
            let bytes = tokio::fs::read(&abs_path)
                .await
                .map_err(|err| format!("failed to read referenced clean original: {err}"))?;
            reference_images.push(MediaReference {
                mime_type: asset.mime_type.clone(),
                bytes,
                role: item.role,
            });
        } else if let Some(b64) = item.base64_data.0 {
            let raw = b64.split_once(",").map(|(_, data)| data).unwrap_or(b64.as_str()).trim();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(raw)
                .map_err(|err| format!("invalid base64 reference image: {err}"))?;
            reference_images.push(MediaReference {
                mime_type: item.mime_type,
                bytes,
                role: item.role,
            });
        } else {
            return Err("reference image must specify either base64_data or existing_generation_id".into());
        }
    }

    let spec = MediaGenerationJobSpec {
        domain: request.capability_domain,
        logical_model_id: request.logical_model_id.0,
        prompt: request.prompt,
        reference_images,
        params: MediaGenerationParams {
            aspect_ratio: request.aspect_ratio.0,
            size: request.size.0,
            quality: request.quality.0,
            count: request.count.0,
            resolution: request.resolution.0,
            duration_seconds: request.duration_seconds.0,
            seed: request.seed.0,
            generate_audio: request.generate_audio.0,
        },
        source: MediaGenerationSource::Studio,
        conversation_id: request.conversation_id.0,
    };

    let record = runner.submit_background(spec).await?;
    Ok(record.into())
}

#[tauri::command]
pub async fn list_media_generations(
    app: tauri::AppHandle,
    request: MediaGenerationListRequest,
) -> Result<MediaGenerationListResponse, String> {
    // domain-default: Studio gallery pagination size when caller omits explicit page size.
    let limit = request.limit.0.unwrap_or(50).min(200);
    let offset = request.offset.0.unwrap_or(0);
    let rows = app
        .services()
        .media_runner
        .list(request.capability_domain.0, limit, offset)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn get_media_generation(
    app: tauri::AppHandle,
    request: MediaGenerationReadRequest,
) -> Result<Option<MediaGenerationInfoResponse>, String> {
    let row = app.services().media_runner.get(&request.id).await?;
    Ok(row.map(Into::into))
}

#[tauri::command]
pub async fn cancel_media_generation(
    app: tauri::AppHandle,
    request: MediaGenerationCancelRequest,
) -> Result<bool, String> {
    app.services().media_runner.cancel(&request.id).await
}

#[tauri::command]
pub async fn delete_media_generation(
    app: tauri::AppHandle,
    request: MediaGenerationDeleteRequest,
) -> Result<bool, String> {
    app.services().media_runner.delete(&request.id).await
}

#[tauri::command]
pub async fn export_media_generation(
    app: tauri::AppHandle,
    request: MediaGenerationExportRequest,
) -> Result<MediaGenerationExportResponse, String> {
    let (bytes, asset) = app
        .services()
        .media_runner
        .export_asset(
            &request.id,
            request.asset_index as usize,
            ExportWatermarkPolicy {
                mode: ExportWatermarkMode::CleanOriginal,
            },
        )
        .await?;

    let bytes_len = bytes.len() as u64;
    if let Some(dest) = request.destination_path.0.filter(|p| !p.trim().is_empty()) {
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|err| format!("failed to write exported media to `{dest}`: {err}"))?;
        Ok(MediaGenerationExportResponse {
            generation_id: request.id,
            asset_index: request.asset_index,
            mime_type: asset.mime_type,
            bytes_len,
            produce_id: asset.produce_id,
            written_path: Some(dest),
            base64_data: None,
        })
    } else {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(MediaGenerationExportResponse {
            generation_id: request.id,
            asset_index: request.asset_index,
            mime_type: asset.mime_type,
            bytes_len,
            produce_id: asset.produce_id,
            written_path: None,
            base64_data: Some(encoded),
        })
    }
}
