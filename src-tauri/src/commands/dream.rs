//! Auto-Dream background memory consolidation IPC commands.

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::agent::dream::{self, DreamConfig, DreamModelSelection};
use meridian_core::db::entity::dream_run::{self, DreamRunStatus, DreamTrigger};
use meridian_core::db::entity::memory::{GLOBAL_SCOPE_ID, MemoryScope};
use meridian_core::db::sea::ops::dream as dream_ops;
use meridian_core::decimal::Decimal;
use meridian_core::util::now_ms;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DreamModelSelectionRequest {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DreamModelSelectionInfoResponse {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DreamConfigInfoResponse {
    pub enabled: bool,
    pub model: Option<DreamModelSelectionInfoResponse>,
    pub cooldown_hours: u32,
    pub min_turns: u32,
    pub daily_budget_usd: Decimal,
}

impl From<DreamConfig> for DreamConfigInfoResponse {
    fn from(cfg: DreamConfig) -> Self {
        Self {
            enabled: cfg.enabled,
            model: cfg.model.map(|m| DreamModelSelectionInfoResponse {
                provider_id: m.provider_id,
                model_id: m.model_id,
            }),
            cooldown_hours: cfg.cooldown_hours,
            min_turns: cfg.min_turns,
            daily_budget_usd: cfg.daily_budget_usd,
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DreamConfigUpdateRequest {
    pub enabled: bool,
    pub model: RequiredNullable<DreamModelSelectionRequest>,
    pub cooldown_hours: u32,
    pub min_turns: u32,
    pub daily_budget_usd: Decimal,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DreamRunListRequest {
    pub scope: RequiredNullable<MemoryScope>,
    pub scope_id: RequiredNullable<String>,
    pub limit: RequiredNullable<u64>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DreamRunStartRequest {
    pub scope: MemoryScope,
    pub scope_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DreamRunRestoreRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DreamRunInfoResponse {
    pub id: String,
    pub scope_type: MemoryScope,
    pub scope_id: String,
    pub status: DreamRunStatus,
    pub trigger: DreamTrigger,
    pub model_id: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub turns_reviewed: i32,
    pub memories_created: i32,
    pub memories_updated: i32,
    pub memories_pruned: i32,
    pub proposals_created: i32,
    pub pruned_memory_ids: Vec<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
}

impl From<dream_run::Model> for DreamRunInfoResponse {
    fn from(row: dream_run::Model) -> Self {
        Self {
            id: row.id,
            scope_type: row.scope_type,
            scope_id: row.scope_id,
            status: row.status,
            trigger: row.trigger,
            model_id: row.model_id,
            started_at: row.started_at,
            finished_at: row.finished_at,
            turns_reviewed: row.turns_reviewed,
            memories_created: row.memories_created,
            memories_updated: row.memories_updated,
            memories_pruned: row.memories_pruned,
            proposals_created: row.proposals_created,
            pruned_memory_ids: row.pruned_memory_ids_json.map(|j| j.0).unwrap_or_default(),
            summary: row.summary,
            error: row.error,
        }
    }
}

pub type DreamRunListResponse = Vec<DreamRunInfoResponse>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DreamRunRestoreInfoResponse {
    pub run_id: String,
    pub restored_count: u64,
}

#[tauri::command]
pub async fn get_dream_config(app: tauri::AppHandle) -> Result<DreamConfigInfoResponse, String> {
    let cfg = dream::read_config(&app.services().db).await?;
    Ok(cfg.into())
}

#[tauri::command]
pub async fn set_dream_config(
    app: tauri::AppHandle,
    request: DreamConfigUpdateRequest,
) -> Result<DreamConfigInfoResponse, String> {
    let next = DreamConfig {
        enabled: request.enabled,
        model: request.model.0.map(|m| DreamModelSelection {
            provider_id: m.provider_id,
            model_id: m.model_id,
        }),
        cooldown_hours: request.cooldown_hours,
        min_turns: request.min_turns,
        daily_budget_usd: request.daily_budget_usd,
    };
    next.validate()?;
    let now = now_ms();
    app.services()
        .db
        .write({
            let cfg = next.clone();
            async move |tx| {
                dream::write_config(tx, &cfg, now)
                    .await
                    .map_err(meridian_core::db::sea::DbErr::Custom)
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(next.into())
}

#[tauri::command]
pub async fn list_dream_runs(
    app: tauri::AppHandle,
    request: DreamRunListRequest,
) -> Result<DreamRunListResponse, String> {
    let scope_filter = match (request.scope.0, request.scope_id.0) {
        (Some(scope), Some(scope_id)) => Some((scope, scope_id)),
        (Some(scope @ (MemoryScope::ClientGlobal | MemoryScope::ChannelGlobal)), None) => {
            Some((scope, GLOBAL_SCOPE_ID.to_string()))
        }
        (None, None) => None,
        (Some(_), None) => return Err("scope_id is required when filtering by project or external_subject".into()),
        (None, Some(_)) => return Err("scope is required when scope_id is provided".into()),
    };
    // domain-default: optional dream run history page size when omitted by the caller
    let limit = request.limit.0.unwrap_or(20).clamp(1, 200);
    let rows = dream_ops::list_runs(
        &app.services().db,
        scope_filter.as_ref().map(|(s, id)| (*s, id.as_str())),
        limit,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn start_dream_run(
    app: tauri::AppHandle,
    request: DreamRunStartRequest,
) -> Result<DreamRunInfoResponse, String> {
    let scope_id = match request.scope {
        MemoryScope::ClientGlobal | MemoryScope::ChannelGlobal => GLOBAL_SCOPE_ID.to_string(),
        MemoryScope::Project | MemoryScope::ExternalSubject => {
            let trimmed = request.scope_id.trim();
            if trimmed.is_empty() {
                return Err("scope_id must not be empty".to_string());
            }
            trimmed.to_string()
        }
    };
    let dream = app.services().dream.clone();
    let run = Box::pin(dream.run_scope(request.scope, &scope_id, DreamTrigger::Manual)).await?;
    Ok(run.into())
}

#[tauri::command]
pub async fn restore_dream_run(
    app: tauri::AppHandle,
    request: DreamRunRestoreRequest,
) -> Result<DreamRunRestoreInfoResponse, String> {
    let run_id = request.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("run_id must not be empty".to_string());
    }
    let now = now_ms();
    let restored_count = app
        .services()
        .db
        .write({
            let run_id = run_id.clone();
            async move |tx| dream_ops::undo_pruned_memories(tx, &run_id, now).await
        })
        .await
        .map_err(|e| e.to_string())??;
    Ok(DreamRunRestoreInfoResponse { run_id, restored_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dream_requests_enforce_strict_closed_fields() {
        let req: DreamConfigUpdateRequest = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "model": null,
            "cooldown_hours": 12,
            "min_turns": 5,
            "daily_budget_usd": "0.5",
        }))
        .unwrap();
        assert!(req.enabled);
        assert!(req.model.0.is_none());

        // Missing nullable field or extra field must fail.
        assert!(
            serde_json::from_value::<DreamConfigUpdateRequest>(serde_json::json!({
                "enabled": true,
                "cooldown_hours": 12,
                "min_turns": 5,
                "daily_budget_usd": "0.5",
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DreamRunStartRequest>(serde_json::json!({
                "scope": "project",
                "scope_id": "p1",
                "extra": 1,
            }))
            .is_err()
        );
    }
}
