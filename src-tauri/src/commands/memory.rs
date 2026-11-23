use crate::ServicesExt;
use crate::commands::entity_response::{MemoryInfoResponse, MemoryListResponse, MemorySubjectListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::entity::memory;
use meridian_core::db::entity::memory::{
    DeletedBy, GLOBAL_SCOPE_ID, MAX_PINNED_SUBJECTS, MemoryChangeset, MemoryScope, MemoryType, Origin, Visibility,
};
use meridian_core::db::sea::ops::memory as mem_ops;
use meridian_core::util::now_ms;

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MemoryListFilter {
    All,
    Project { project_id: String },
    Trash { limit: RequiredNullable<i64> },
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryListRequest {
    filter: MemoryListFilter,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryCreateRequest {
    scope: MemoryScope,
    project_id: RequiredNullable<String>,
    subject_scope_id: RequiredNullable<String>,
    key: String,
    content: String,
    memory_type: RequiredNullable<MemoryType>,
    owner_only: RequiredNullable<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryUpdateRequest {
    id: String,
    content: Option<String>,
    memory_type: Option<MemoryType>,
    owner_only: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryDeleteRequest {
    ids: Vec<String>,
    permanent: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryRestoreRequest {
    ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemorySubjectDeleteRequest {
    subject_scope_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemorySubjectUpdateRequest {
    subject_scope_id: String,
    is_pinned: RequiredNullable<bool>,
    opted_out: RequiredNullable<bool>,
}

/// Resolve the (scope, scope_id) pair the desktop UI is addressing. The UI names
/// a layer plus an optional anchor; everything else is derived here so the
/// front end never invents a scope string.
fn resolve_scope(
    scope: MemoryScope,
    project_id: Option<&str>,
    subject_scope_id: Option<&str>,
) -> Result<(MemoryScope, String), String> {
    let id = match scope {
        MemoryScope::Project => project_id
            .ok_or("A project must be selected for project-scoped memories")?
            .to_string(),
        MemoryScope::ClientGlobal | MemoryScope::OnebotGlobal => GLOBAL_SCOPE_ID.to_string(),
        MemoryScope::OnebotUser => subject_scope_id
            .ok_or("A person must be selected for per-person memories")?
            .to_string(),
    };
    Ok((scope, id))
}

#[tauri::command]
pub async fn list_memories(app: tauri::AppHandle, request: MemoryListRequest) -> Result<MemoryListResponse, String> {
    let rows = match request.filter {
        MemoryListFilter::All => mem_ops::list_all(&app.services().db).await.map_err(|e| e.to_string())?,
        MemoryListFilter::Project { project_id } => {
            mem_ops::list_by_scope(&app.services().db, MemoryScope::Project, &project_id)
                .await
                .map_err(|e| e.to_string())?
        }
        MemoryListFilter::Trash { limit } => {
            // domain-default: a page size the caller did not ask about, not a fact about a model
            let limit =
                u64::try_from(limit.0.unwrap_or(200)).map_err(|_| "the trash page size must not be negative")?;
            mem_ops::list_trash(&app.services().db, limit)
                .await
                .map_err(|e| e.to_string())?
        }
    };
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Layered write from the desktop UI. `origin` is always `desktop` and
/// `visibility` is chosen by the operator — neither is ever taken from a model.
#[tauri::command]
pub async fn create_memory(app: tauri::AppHandle, request: MemoryCreateRequest) -> Result<MemoryInfoResponse, String> {
    let row = scoped_memory(request, now_ms())?;
    app.services()
        .db
        .write(async |tx| mem_ops::remember(tx, row).await)
        .await
        .map_err(|e| e.to_string())?
        .map(Into::into)
}

/// The row a scoped save writes, before the quota has had its say.
fn scoped_memory(request: MemoryCreateRequest, now: i64) -> Result<memory::Model, String> {
    let (scope, scope_id) = resolve_scope(
        request.scope,
        request.project_id.0.as_deref(),
        request.subject_scope_id.0.as_deref(),
    )?;
    let visibility = if request.owner_only.0.unwrap_or(false) {
        Visibility::OwnerOnly
    } else {
        Visibility::Normal
    };
    let subject = match scope {
        MemoryScope::OnebotUser => Some(scope_id.clone()),
        _ => request.subject_scope_id.0,
    };
    // `Desktop` is not in `Origin::group_visible()`, so a row written here
    // with that origin would be filtered out of every group turn — the
    // operator would see it saved and active while it never reached a
    // conversation. Anything aimed at the OneBot layers is the operator
    // teaching the bot, which is what `Admin` means.
    // The client layers are injected without an origin filter, so `Desktop`
    // reaches the conversations they belong to.
    let origin = match scope {
        MemoryScope::Project | MemoryScope::ClientGlobal => Origin::Desktop,
        MemoryScope::OnebotGlobal | MemoryScope::OnebotUser => Origin::Admin,
    };
    Ok(memory::Model {
        id: uuid::Uuid::new_v4().to_string(),
        scope_type: scope,
        scope_id,
        key: request.key,
        content: request.content,
        memory_type: request.memory_type.0.unwrap_or(MemoryType::General),
        subject_scope_id: subject,
        origin,
        visibility,
        source_session_id: None,
        deleted_at: None,
        deleted_by: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn update_memory(app: tauri::AppHandle, request: MemoryUpdateRequest) -> Result<MemoryInfoResponse, String> {
    let MemoryUpdateRequest {
        id,
        content,
        memory_type,
        owner_only,
    } = request;
    let changeset = MemoryChangeset {
        content,
        memory_type,
        visibility: owner_only.map(|o| if o { Visibility::OwnerOnly } else { Visibility::Normal }),
        updated_at: Some(now_ms()),
    };
    app.services()
        .db
        .write(async |tx| {
            // The length check reads the row it guards in the same write.
            if let Some(content) = &changeset.content {
                let Some(existing) = mem_ops::get_memory(tx, &id).await? else {
                    return Ok(Err(format!("memory `{id}` not found")));
                };
                let checked =
                    mem_ops::validate_memory(tx, existing.scope_type, &existing.scope_id, &existing.key, content)
                        .await?;
                if let Err(refused) = checked {
                    return Ok(Err(refused));
                }
            }
            mem_ops::update_memory(tx, &id, changeset).await.map(Ok)
        })
        .await
        .map_err(|e| e.to_string())?
        .map(Into::into)
}

/// Soft-delete (default) or permanently purge memories.
#[tauri::command]
pub async fn delete_memories(app: tauri::AppHandle, request: MemoryDeleteRequest) -> Result<usize, String> {
    let MemoryDeleteRequest { ids, permanent } = request;
    if permanent {
        app.services()
            .db
            .write(async |tx| mem_ops::purge_memories(tx, &ids).await)
            .await
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    } else {
        app.services()
            .db
            .write(async |tx| mem_ops::soft_delete_memories(tx, &ids, DeletedBy::Admin, now_ms()).await)
            .await
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn list_memory_subjects(app: tauri::AppHandle) -> Result<MemorySubjectListResponse, String> {
    let rows = mem_ops::list_subjects(&app.services().db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn delete_memory_subject(
    app: tauri::AppHandle,
    request: MemorySubjectDeleteRequest,
) -> Result<usize, String> {
    // The operator can clear their own notes too; a person doing this to
    // themselves cannot (see the /memory optout path).
    app.services()
        .db
        .write(async |tx| {
            mem_ops::forget_subject(tx, &request.subject_scope_id, true, DeletedBy::Admin, now_ms()).await
        })
        .await
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_memory_subject(app: tauri::AppHandle, request: MemorySubjectUpdateRequest) -> Result<(), String> {
    let MemorySubjectUpdateRequest {
        subject_scope_id,
        is_pinned,
        opted_out,
    } = request;
    app.services()
        .db
        .write(async |tx| mem_ops::set_subject_flags(tx, &subject_scope_id, is_pinned.0, opted_out.0).await)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| format!("Cannot pin more than {MAX_PINNED_SUBJECTS} people"))
}

#[tauri::command]
pub async fn restore_memories(app: tauri::AppHandle, request: MemoryRestoreRequest) -> Result<usize, String> {
    app.services()
        .db
        .write(async |tx| mem_ops::restore_memories(tx, &request.ids, now_ms()).await)
        .await
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
}

/// Enum values live in Rust and reach the front end through here, so the UI
/// never keeps its own copy that can drift out of sync.
#[derive(serde::Serialize)]
pub struct MemoryEnumsResponse {
    pub scopes: Vec<&'static str>,
    pub origins: Vec<&'static str>,
    pub visibilities: Vec<&'static str>,
    pub memory_types: Vec<&'static str>,
}

#[tauri::command]
pub async fn get_memory_enums(_app: tauri::AppHandle) -> Result<MemoryEnumsResponse, String> {
    Ok(MemoryEnumsResponse {
        scopes: MemoryScope::all(),
        origins: Origin::all(),
        visibilities: Visibility::all(),
        memory_types: MemoryType::all(),
    })
}

#[cfg(test)]
mod request_dto_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn memory_update_uses_a_closed_memory_type() {
        assert!(
            serde_json::from_value::<MemoryUpdateRequest>(json!({
                "id": "memory-1",
                "memory_type": "preference"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<MemoryUpdateRequest>(json!({
                "id": "memory-1",
                "memory_type": "future"
            }))
            .is_err()
        );
    }

    #[test]
    fn memory_subject_flags_require_explicit_nullable_keys() {
        assert!(
            serde_json::from_value::<MemorySubjectUpdateRequest>(json!({
                "subject_scope_id": "onebot:42",
                "is_pinned": true,
                "opted_out": null
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<MemorySubjectUpdateRequest>(json!({
                "subject_scope_id": "onebot:42",
                "is_pinned": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<MemorySubjectUpdateRequest>(json!({
                "subject_scope_id": "onebot:42",
                "is_pinned": true,
                "opted_out": null,
                "legacy": true
            }))
            .is_err()
        );
    }
}
