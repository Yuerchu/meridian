use crate::ServicesExt;
use crate::commands::entity_response::{ProjectInfoResponse, ProjectListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::project::{ProjectChangeset, ProjectInsert, ProjectSource};
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

fn update_project_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    project_id: &str,
    expected_conversation_ids: &[String],
    changeset: &ProjectChangeset,
) -> diesel::QueryResult<GuardedProjectMutation<db::models::project::ProjectRow>> {
    conn.immediate_transaction(|conn| {
        let current = db::ops::conversation::ids_by_project(conn, project_id)?;
        if current != expected_conversation_ids {
            return Ok(GuardedProjectMutation::ReferencesChanged);
        }
        for conversation_id in &current {
            if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
                .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            {
                return Ok(GuardedProjectMutation::PlanReviewBarrier);
            }
        }
        db::ops::project::update_project(conn, project_id, changeset).map(GuardedProjectMutation::Applied)
    })
}

fn delete_project_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    project_id: &str,
    expected_conversation_ids: &[String],
) -> diesel::QueryResult<GuardedProjectMutation<()>> {
    conn.immediate_transaction(|conn| {
        let current = db::ops::conversation::ids_by_project(conn, project_id)?;
        if current != expected_conversation_ids {
            return Ok(GuardedProjectMutation::ReferencesChanged);
        }
        for conversation_id in &current {
            if db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
                .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?
            {
                return Ok(GuardedProjectMutation::PlanReviewBarrier);
            }
        }
        db::ops::project::delete_project(conn, project_id).map(GuardedProjectMutation::Applied)
    })
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
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let rows = db::ops::project::list_projects(&mut conn).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    request: ProjectCreateRequest,
) -> Result<ProjectInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let row = db::ops::project::create_project(
            &mut conn,
            &ProjectInsert {
                id: &id,
                name: &request.name,
                path: request.path.0.as_deref(),
                source_type: request.source_type.as_str(),
                source_id: request.source_id.0.as_deref(),
                assistant_id: request.assistant_id.0.as_deref(),
                description: request.description.0.as_deref(),
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
pub async fn update_project(
    app: tauri::AppHandle,
    request: ProjectUpdateRequest,
) -> Result<ProjectInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let project_id = request.id.clone();
    let requested_path = request.path.clone();
    let (path_changed, referenced) = {
        let pool = pool.clone();
        let project_id = project_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let current = db::ops::project::get_project(&mut conn, &project_id).map_err(|e| e.to_string())?;
            let changed = requested_path
                .as_deref()
                .is_some_and(|path| current.path.as_deref() != Some(path));
            let referenced = if changed {
                db::ops::conversation::ids_by_project(&mut conn, &project_id).map_err(|e| e.to_string())?
            } else {
                Vec::new()
            };
            Ok::<_, String>((changed, referenced))
        })
        .await
        .map_err(|e| e.to_string())??
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
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = ProjectChangeset {
            name: request.name,
            path: request.path.map(Some),
            assistant_id: request.assistant_id.map(Some),
            description: request.description.map(Some),
            updated_at: Some(now_ms()),
        };
        let row = if path_changed {
            finish_guarded_project_mutation(
                update_project_unless_plan_barrier(&mut conn, &request.id, &referenced, &changeset)
                    .map_err(|e| e.to_string())?,
            )?
        } else {
            db::ops::project::update_project(&mut conn, &request.id, &changeset).map_err(|e| e.to_string())?
        };
        row.try_into()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let referenced = {
        let pool = pool.clone();
        let id = id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            db::ops::conversation::ids_by_project(&mut conn, &id).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&referenced, "a project delete")
        .map_err(|busy| busy.to_string())?;
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        finish_guarded_project_mutation(
            delete_project_unless_plan_barrier(&mut conn, &id, &referenced).map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_pending_review(conn: &mut diesel::sqlite::SqliteConnection) {
        let document = db::ops::plan_review::create_or_resume_document(conn, "conversation-1", 2).unwrap();
        let appended = db::ops::plan_review::append_assistant_revision(
            conn,
            &db::ops::plan_review::PlanRevisionAppend {
                document_id: &document.id,
                expected_generation: 0,
                expected_head_sha256: None,
                content_markdown: "# Plan\n",
                patch: "first patch",
                source_message_id: Some("m1"),
                source_call_id: Some("update-1"),
                responding_to_suggestion_revision_id: None,
                now: 3,
            },
        )
        .unwrap();
        db::ops::plan_review::mark_materialization_applied(conn, &appended.materialization.id, 4).unwrap();
        db::ops::plan_review::submit_native_head_for_review(
            conn,
            &db::ops::plan_review::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: appended.document.working_generation,
                expected_head_sha256: &appended.revision.content_sha256,
                turn_id: None,
                assistant_message_id: Some("m1"),
                provider_call_id: Some("exit-1"),
                provider_kind: db::models::plan_review::PlanReviewProviderKind::Native,
                now: 5,
            },
            &db::models::plan_review::NativePlanReviewRuntimeConfig {
                provider_id: "provider-test".into(),
                model: "model-test".into(),
                assistant_id: None,
                thinking_level: None,
                fast: false,
                project_id: Some("project-1".into()),
                project_path: Some("A".into()),
                accept_edits: false,
            },
        )
        .unwrap();
    }

    #[test]
    fn project_path_update_and_delete_are_blocked_by_a_referenced_plan_review() {
        let pool = db::test_db();
        let mut conn = pool.get().unwrap();
        db::ops::project::create_project(
            &mut conn,
            &ProjectInsert {
                id: "project-1",
                name: "Project",
                path: Some("A"),
                source_type: "local",
                source_id: None,
                assistant_id: None,
                description: None,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        db::ops::conversation::create_conversation(&mut conn, "conversation-1", None, None, Some("project-1"), 1)
            .unwrap();
        seed_pending_review(&mut conn);
        let expected = vec!["conversation-1".to_string()];

        let updated = update_project_unless_plan_barrier(
            &mut conn,
            "project-1",
            &expected,
            &ProjectChangeset {
                path: Some(Some("B".into())),
                updated_at: Some(6),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(matches!(updated, GuardedProjectMutation::PlanReviewBarrier));
        assert_eq!(
            db::ops::project::get_project(&mut conn, "project-1")
                .unwrap()
                .path
                .as_deref(),
            Some("A")
        );

        let deleted = delete_project_unless_plan_barrier(&mut conn, "project-1", &expected).unwrap();
        assert!(matches!(deleted, GuardedProjectMutation::PlanReviewBarrier));
        assert!(db::ops::project::get_project(&mut conn, "project-1").is_ok());
    }
}
