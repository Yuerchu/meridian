use crate::ServicesExt;
use crate::commands::entity_response::{ProjectInfoResponse, ProjectListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::entity::project;
use meridian_core::db::entity::project::{ProjectChangeset, ProjectSource};
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::WriteTx;
use meridian_core::db::sea::ops::{
    conversation as conversation_ops, plan_review as plan_review_ops, project as project_ops,
};
use meridian_core::util::now_ms;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectCreateRequest {
    name: String,
    path: RequiredNullable<String>,
    source_type: ProjectSource,
    source_id: RequiredNullable<String>,
    assistant_id: RequiredNullable<String>,
    description: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectUpdateRequest {
    id: String,
    name: Option<String>,
    path: Option<String>,
    assistant_id: Option<String>,
    description: Option<String>,
}

const PLAN_REVIEW_PROJECT_MUTATION_BARRIER: &str = "A conversation in this project is waiting for plan review or its continuation. Finish it before changing or deleting the project workspace.";

#[derive(Debug)]
enum GuardedProjectMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ReferencesChanged,
}

/// What stops a project workspace mutation before it writes anything: the
/// project's conversations having changed since the caller took their
/// leases, or one of them waiting on a plan review or its continuation. Run
/// first in the mutation's own write, so the answer still holds when the
/// write lands.
async fn project_barrier<T>(
    tx: &WriteTx,
    project_id: &str,
    expected_conversation_ids: &[String],
) -> Result<Option<GuardedProjectMutation<T>>, DbErr> {
    let current = conversation_ops::ids_by_project(tx, project_id).await?;
    if current != expected_conversation_ids {
        return Ok(Some(GuardedProjectMutation::ReferencesChanged));
    }
    for conversation_id in &current {
        if plan_review_ops::has_conversation_barrier(tx, conversation_id).await? {
            return Ok(Some(GuardedProjectMutation::PlanReviewBarrier));
        }
    }
    Ok(None)
}

/// Only a path change moves the conversations' working directory, so only a
/// path change takes their leases and runs the barrier. Whether the path
/// changes is decided again here, on the row as it stands under the write
/// lock: the caller decided it on an earlier read, and a path that moved in
/// between would otherwise be written back unguarded.
async fn update_project_unless_plan_barrier(
    tx: &WriteTx,
    project_id: &str,
    expected_path_change: bool,
    expected_conversation_ids: &[String],
    changeset: ProjectChangeset,
) -> Result<GuardedProjectMutation<project::Model>, DbErr> {
    let current = project_ops::get_project(tx, project_id)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("project `{project_id}`")))?;
    if path_changes(&current, &changeset) != expected_path_change {
        return Ok(GuardedProjectMutation::ReferencesChanged);
    }
    if expected_path_change && let Some(refused) = project_barrier(tx, project_id, expected_conversation_ids).await? {
        return Ok(refused);
    }
    project_ops::update_project(tx, project_id, changeset)
        .await
        .map(GuardedProjectMutation::Applied)
}

fn path_changes(current: &project::Model, changeset: &ProjectChangeset) -> bool {
    changeset
        .path
        .as_ref()
        .is_some_and(|path| current.path.as_deref() != path.as_deref())
}

async fn delete_project_unless_plan_barrier(
    tx: &WriteTx,
    project_id: &str,
    expected_conversation_ids: &[String],
) -> Result<GuardedProjectMutation<()>, DbErr> {
    if let Some(refused) = project_barrier(tx, project_id, expected_conversation_ids).await? {
        return Ok(refused);
    }
    project_ops::delete_project(tx, project_id)
        .await
        .map(|_| GuardedProjectMutation::Applied(()))
}

fn finish_guarded_project_mutation<T>(result: GuardedProjectMutation<T>) -> Result<T, String> {
    match result {
        GuardedProjectMutation::Applied(value) => Ok(value),
        GuardedProjectMutation::PlanReviewBarrier => Err(PLAN_REVIEW_PROJECT_MUTATION_BARRIER.into()),
        GuardedProjectMutation::ReferencesChanged => Err(
            "The conversations using this project changed while the workspace mutation was being prepared. Try again."
                .into(),
        ),
    }
}

#[tauri::command]
pub async fn list_projects(app: tauri::AppHandle) -> Result<ProjectListResponse, String> {
    let rows = project_ops::list_projects(&app.services().sea)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    request: ProjectCreateRequest,
) -> Result<ProjectInfoResponse, String> {
    let now = now_ms();
    let row = project::Model {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        path: request.path.0,
        source_type: request.source_type,
        source_id: request.source_id.0,
        assistant_id: request.assistant_id.0,
        description: request.description.0,
        created_at: now,
        updated_at: now,
    };
    app.services()
        .sea
        .write(async |tx| project_ops::create_project(tx, row).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_project(
    app: tauri::AppHandle,
    request: ProjectUpdateRequest,
) -> Result<ProjectInfoResponse, String> {
    let services = app.services();
    let changeset = ProjectChangeset {
        name: request.name,
        path: request.path.map(Some),
        assistant_id: request.assistant_id.map(Some),
        description: request.description.map(Some),
        updated_at: Some(now_ms()),
    };
    // pool-read-before-write: decides only whether to take leases; the write
    // decides again on the row it locks and refuses on any difference.
    let current = project_ops::get_project(&services.sea, &request.id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project `{}` was not found", request.id))?;
    let path_changed = path_changes(&current, &changeset);
    let referenced = if path_changed {
        // pool-read-before-write: these ids only pick which turn leases to
        // take; the write re-reads them and refuses on any difference.
        conversation_ops::ids_by_project(&services.sea, &request.id)
            .await
            .map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let _leases = if path_changed {
        services
            .turns
            .clone()
            .try_acquire_mutations(&referenced, "a project path change")
            .map_err(|busy| busy.to_string())?
    } else {
        Vec::new()
    };
    let guarded = services
        .sea
        .write(async |tx| {
            update_project_unless_plan_barrier(tx, &request.id, path_changed, &referenced, changeset).await
        })
        .await
        .map_err(|e| e.to_string())?;
    finish_guarded_project_mutation(guarded).map(Into::into)
}

#[tauri::command]
pub async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the delete on any difference.
    let referenced = conversation_ops::ids_by_project(&services.sea, &id)
        .await
        .map_err(|e| e.to_string())?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&referenced, "a project delete")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .sea
        .write(async |tx| delete_project_unless_plan_barrier(tx, &id, &referenced).await)
        .await
        .map_err(|e| e.to_string())?;
    finish_guarded_project_mutation(guarded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db;

    fn project_row() -> project::Model {
        project::Model {
            id: "project-1".into(),
            name: "Project".into(),
            path: Some("A".into()),
            source_type: ProjectSource::Local,
            source_id: None,
            assistant_id: None,
            description: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn move_to(path: &str) -> ProjectChangeset {
        ProjectChangeset {
            path: Some(Some(path.into())),
            updated_at: Some(6),
            ..Default::default()
        }
    }

    async fn stored_path(sea: &db::sea::cap::Db) -> Option<String> {
        project_ops::get_project(sea, "project-1").await.unwrap().unwrap().path
    }

    #[tokio::test]
    async fn project_path_update_and_delete_are_blocked_by_a_referenced_plan_review() {
        let sea = db::sea::sea_test_db().await;
        sea.write(async |tx| {
            project_ops::create_project(tx, project_row()).await?;
            db::sea::ops::conversation::create_conversation(tx, "conversation-1", None, None, Some("project-1"), 1)
                .await?;
            db::sea::ops::plan_review::seed_pending_native_review(tx, "conversation-1", Some(("project-1", "A")))
                .await
                .map_err(|e| db::sea::DbErr::Custom(e.to_string()))?;
            Ok::<_, db::sea::DbErr>(())
        })
        .await
        .unwrap();
        let expected = vec!["conversation-1".to_string()];

        let updated = sea
            .write(async |tx| update_project_unless_plan_barrier(tx, "project-1", true, &expected, move_to("B")).await)
            .await
            .unwrap();
        assert!(matches!(updated, GuardedProjectMutation::PlanReviewBarrier));
        assert_eq!(stored_path(&sea).await.as_deref(), Some("A"));

        let deleted = sea
            .write(async |tx| delete_project_unless_plan_barrier(tx, "project-1", &expected).await)
            .await
            .unwrap();
        assert!(matches!(deleted, GuardedProjectMutation::PlanReviewBarrier));
        assert!(project_ops::get_project(&sea, "project-1").await.unwrap().is_some());

        let stale = sea
            .write(async |tx| delete_project_unless_plan_barrier(tx, "project-1", &[]).await)
            .await
            .unwrap();
        assert!(matches!(stale, GuardedProjectMutation::ReferencesChanged));

        // A rename moves no working directory, so the review does not stop it.
        let renamed = sea
            .write(async |tx| {
                let rename = ProjectChangeset {
                    name: Some("Renamed".into()),
                    path: Some(Some("A".into())),
                    ..Default::default()
                };
                update_project_unless_plan_barrier(tx, "project-1", false, &[], rename).await
            })
            .await
            .unwrap();
        assert!(matches!(renamed, GuardedProjectMutation::Applied(ref row) if row.name == "Renamed"));
    }

    /// The caller judged the path unchanged and took no leases, but the path
    /// moved before its write: writing it back would change the working
    /// directory of every conversation in the project with nothing guarding
    /// them. The write decides again and refuses.
    #[tokio::test]
    async fn a_path_that_moved_after_the_caller_looked_is_not_written_back_unguarded() {
        let sea = db::sea::sea_test_db().await;
        sea.write(async |tx| project_ops::create_project(tx, project_row()).await)
            .await
            .unwrap();
        // The caller read "A" and asked for "A"; someone has since moved it.
        sea.write(async |tx| project_ops::update_project(tx, "project-1", move_to("B")).await)
            .await
            .unwrap();

        let stale = sea
            .write(async |tx| update_project_unless_plan_barrier(tx, "project-1", false, &[], move_to("A")).await)
            .await
            .unwrap();
        assert!(matches!(stale, GuardedProjectMutation::ReferencesChanged));
        assert_eq!(stored_path(&sea).await.as_deref(), Some("B"));
    }
}
