use crate::ServicesExt;
use crate::commands::entity_response::{MemoryInfoResponse, MemoryListResponse, MemorySubjectListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::memory::{DeletedBy, GLOBAL_SCOPE_ID, MemoryScope, MemoryType, Origin, Visibility};
use meridian_core::util::now_ms;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryUpsertRequest {
    project_id: String,
    key: String,
    content: String,
    memory_type: RequiredNullable<MemoryType>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryScopedUpsertRequest {
    scope: MemoryScope,
    project_id: RequiredNullable<String>,
    subject_scope_id: RequiredNullable<String>,
    key: String,
    content: String,
    memory_type: RequiredNullable<MemoryType>,
    owner_only: RequiredNullable<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryUpdateRequest {
    id: String,
    content: Option<String>,
    memory_type: Option<MemoryType>,
    owner_only: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySubjectFlagsUpdateRequest {
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
pub async fn list_memories(app: tauri::AppHandle, project_id: String) -> Result<MemoryListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows =
            db::ops::memory::list_by_scope(&mut conn, MemoryScope::Project, &project_id).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_memory(app: tauri::AppHandle, request: MemoryUpsertRequest) -> Result<MemoryInfoResponse, String> {
    save_memory_scoped(
        app,
        MemoryScopedUpsertRequest {
            scope: MemoryScope::Project,
            project_id: RequiredNullable(Some(request.project_id)),
            subject_scope_id: RequiredNullable(None),
            key: request.key,
            content: request.content,
            memory_type: request.memory_type,
            owner_only: RequiredNullable(None),
        },
    )
    .await
}

/// Layered write from the desktop UI. `origin` is always `desktop` and
/// `visibility` is chosen by the operator — neither is ever taken from a model.
#[tauri::command]
pub async fn save_memory_scoped(
    app: tauri::AppHandle,
    request: MemoryScopedUpsertRequest,
) -> Result<MemoryInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let (scope, scope_id) = resolve_scope(
            request.scope,
            request.project_id.0.as_deref(),
            request.subject_scope_id.0.as_deref(),
        )?;
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::validate_memory(&mut conn, scope, &scope_id, &request.key, &request.content)?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let memory_type = request.memory_type.0.unwrap_or(MemoryType::General);
        let visibility = if request.owner_only.0.unwrap_or(false) {
            Visibility::OwnerOnly
        } else {
            Visibility::Normal
        };
        let subject = match scope {
            MemoryScope::OnebotUser => Some(scope_id.as_str()),
            _ => request.subject_scope_id.0.as_deref(),
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
        let row = db::ops::memory::upsert_memory(
            &mut conn,
            &db::models::memory::MemoryInsert {
                id: &id,
                scope_type: scope.as_str(),
                scope_id: &scope_id,
                key: &request.key,
                content: &request.content,
                memory_type: memory_type.as_str(),
                subject_scope_id: subject,
                origin: origin.as_str(),
                visibility: visibility.as_str(),
                source_session_id: None,
                created_at: now,
                updated_at: now,
            },
        )
        .map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_memory(app: tauri::AppHandle, request: MemoryUpdateRequest) -> Result<MemoryInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        if let Some(ref c) = request.content {
            let existing = db::ops::memory::get_memory(&mut conn, &request.id).map_err(|e| e.to_string())?;
            let scope = MemoryScope::parse(&existing.scope_type)?;
            db::ops::memory::validate_memory(&mut conn, scope, &existing.scope_id, &existing.key, c)?;
        }
        let memory_type = request.memory_type.map(|value| value.as_str().to_owned());
        let row = db::ops::memory::update_memory(
            &mut conn,
            &request.id,
            &db::models::memory::MemoryChangeset {
                content: request.content,
                memory_type,
                visibility: request.owner_only.map(|o| {
                    if o { Visibility::OwnerOnly } else { Visibility::Normal }
                        .as_str()
                        .to_string()
                }),
                updated_at: Some(now_ms()),
            },
        )
        .map_err(|e| e.to_string())?;
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_memory(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete_memories(app, vec![id]).await.map(|_| ())
}

/// Soft delete. Every delete path funnels here so the trash and undo see the
/// same rows regardless of who removed them.
#[tauri::command]
pub async fn delete_memories(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::soft_delete_memories(&mut conn, &ids, DeletedBy::Admin, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every live memory in one call. The browser needs all three scopes, and
/// per-project fan-out both cost one IPC round trip per project and could never
/// return the bot-wide or per-person layers at all.
#[tauri::command]
pub async fn list_all_memories(app: tauri::AppHandle) -> Result<MemoryListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::memory::list_all(&mut conn).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_memory_subjects(app: tauri::AppHandle) -> Result<MemorySubjectListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::memory::list_subjects(&mut conn).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn forget_memory_subject(app: tauri::AppHandle, subject_scope_id: String) -> Result<usize, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        // The operator can clear their own notes too; a person doing this to
        // themselves cannot (see the /memory optout path).
        db::ops::memory::forget_subject(&mut conn, &subject_scope_id, true, DeletedBy::Admin, now_ms())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_memory_subject_flags(
    app: tauri::AppHandle,
    request: MemorySubjectFlagsUpdateRequest,
) -> Result<(), String> {
    let MemorySubjectFlagsUpdateRequest {
        subject_scope_id,
        is_pinned,
        opted_out,
    } = request;
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::set_subject_flags(&mut conn, &subject_scope_id, is_pinned.0, opted_out.0).map_err(|_| {
            format!(
                "Cannot pin more than {} people",
                db::models::memory::MAX_PINNED_SUBJECTS
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_memory_trash(app: tauri::AppHandle, limit: Option<i64>) -> Result<MemoryListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::memory::list_trash(&mut conn, limit.unwrap_or(200)).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_memories(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::restore_memories(&mut conn, &ids, meridian_core::util::now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn purge_memories(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::purge_memories(&mut conn, &ids).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn memory_enums(_app: tauri::AppHandle) -> Result<MemoryEnumsResponse, String> {
    Ok(MemoryEnumsResponse {
        scopes: MemoryScope::all(),
        origins: Origin::all(),
        visibilities: Visibility::all(),
        memory_types: db::models::memory::MemoryType::all(),
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
                "memoryType": "preference"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<MemoryUpdateRequest>(json!({
                "id": "memory-1",
                "memoryType": "future"
            }))
            .is_err()
        );
    }

    #[test]
    fn memory_subject_flags_require_explicit_nullable_keys() {
        assert!(
            serde_json::from_value::<MemorySubjectFlagsUpdateRequest>(json!({
                "subjectScopeId": "onebot:42",
                "isPinned": true,
                "optedOut": null
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<MemorySubjectFlagsUpdateRequest>(json!({
                "subjectScopeId": "onebot:42",
                "isPinned": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<MemorySubjectFlagsUpdateRequest>(json!({
                "subjectScopeId": "onebot:42",
                "isPinned": true,
                "optedOut": null,
                "legacy": true
            }))
            .is_err()
        );
    }
}
