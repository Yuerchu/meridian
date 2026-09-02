//! The prompt queue, from the window.
//!
//! Thin, like `acp.rs` next door: the rules live in `meridian_core` because a
//! queue has to be drivable by something without a window before it is one
//! frontend's feature. What is here is the shape of each call and the one
//! decision the shell owns — which of them may move the queue along.

use crate::ServicesExt;
use crate::commands::entity_response::{QueuedPromptInfoResponse, QueuedPromptListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::agent::queue as runner;
use meridian_core::db::models::queue::Delivery;
use meridian_core::db::ops::queue as ops;
use meridian_core::util::{get_conn, now_ms};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedPromptCreateRequest {
    conversation_id: String,
    content: String,
    delivery: Delivery,
    context_refs: RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>,
    /// Conversations dragged into the composer, frozen at enqueue time like
    /// the workspace references above.
    conversation_refs: RequiredNullable<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedPromptDeliveryUpdateRequest {
    conversation_id: String,
    id: String,
    delivery: Delivery,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedPromptRemoveRequest {
    conversation_id: String,
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedPromptReorderRequest {
    conversation_id: String,
    ids: Vec<String>,
}

fn plan_review_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
) -> diesel::QueryResult<bool> {
    meridian_core::db::ops::plan_review::has_conversation_barrier(conn, conversation_id)
        .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))
}

fn enqueue_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    id: &str,
    conversation_id: &str,
    content: &str,
    delivery: Delivery,
    context: &[meridian_core::workspace::reference::PreparedContextItem],
    now: i64,
) -> diesel::QueryResult<Option<meridian_core::db::models::queue::QueuedPromptRow>> {
    conn.immediate_transaction(|conn| {
        if plan_review_barrier(conn, conversation_id)? {
            return Ok(None);
        }
        ops::enqueue_with_context(conn, id, conversation_id, content, delivery, context, now).map(Some)
    })
}

fn release_unless_plan_barrier(
    conn: &mut diesel::sqlite::SqliteConnection,
    conversation_id: &str,
) -> diesel::QueryResult<Option<usize>> {
    conn.immediate_transaction(|conn| {
        if plan_review_barrier(conn, conversation_id)? {
            return Ok(None);
        }
        ops::release_all(conn, conversation_id).map(Some)
    })
}

/// Everything queued for a conversation, in the order it will be delivered.
///
/// Settled rows included: the front end draws one leaving, and dropping it here
/// would make an item vanish a beat before the message it became appears.
#[tauri::command]
pub async fn queue_list(app: tauri::AppHandle, conversation_id: String) -> Result<QueuedPromptListResponse, String> {
    let pool = app.services().db.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        let rows = ops::list(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        rows.into_iter().map(TryInto::try_into).collect()
    })
    .await
}

/// Add one to the back, and see whether it can go straight away.
///
/// The pump is the point: an item added while a turn runs is a steer, and one
/// added with nothing running is a turn. Both are somebody typing, which is the
/// only circumstance in which this queue is allowed to move — see the header of
/// `agent::queue`.
#[tauri::command]
pub async fn queue_enqueue(
    app: tauri::AppHandle,
    request: QueuedPromptCreateRequest,
) -> Result<QueuedPromptInfoResponse, String> {
    let QueuedPromptCreateRequest {
        conversation_id,
        content,
        delivery,
        context_refs: RequiredNullable(context_refs),
        conversation_refs: RequiredNullable(conversation_refs),
    } = request;
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("a queued message needs something in it".into());
    }
    let services = app.services();
    let pool = services.db.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let conversation = conversation_id.clone();
    let parsed = meridian_core::workspace::reference::parse_message_references(&content);
    let references =
        meridian_core::workspace::reference::reconcile_references(context_refs.unwrap_or_default(), parsed)?;
    if !references.is_empty() && delivery == Delivery::Interject {
        return Err("workspace references can only be queued as follow-up messages".into());
    }
    let conv_refs = conversation_refs.unwrap_or_default();
    // The same boundary for the same reason: an interjection lands inside a
    // running turn, which is not a turn boundary a frozen reference can attach
    // to.
    if !conv_refs.is_empty() && delivery == Delivery::Interject {
        return Err("conversation references can only be queued as follow-up messages".into());
    }
    let prepared = if references.is_empty() {
        Vec::new()
    } else {
        let pool_for_root = services.db.clone();
        let conversation_for_root = conversation_id.clone();
        let working_directory = blocking(move || {
            let mut conn = get_conn(&pool_for_root)?;
            meridian_core::workspace::resolve_workspace_dir(&mut conn, &conversation_for_root)?
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| "workspace unavailable".to_string())
        })
        .await?;
        let file_access = meridian_core::agent::build_file_access(&services.db).await?;
        let context = meridian_core::tools::ToolContext {
            working_directory: Some(working_directory),
            shell: meridian_core::tools::ShellType::default_for_platform(),
            file_access,
            project_id: None,
            conversation_id: Some(conversation_id.clone()),
            turn_id: None,
            assistant_id: None,
            db_pool: Some(services.db.clone()),
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: Default::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            journal: None,
        };
        let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
        meridian_core::workspace::reference::prepare_references(&context, &references, &counter, 128_000).await?
    };
    // Frozen at enqueue time beside the workspace snapshots — the thread may
    // move on before this message runs, and what the user saw when they
    // dragged it in is what the message should carry.
    let prepared = if conv_refs.is_empty() {
        prepared
    } else {
        let mut prepared = prepared;
        let spent: usize = prepared.iter().map(|item| item.token_count.max(0) as usize).sum();
        let budget_left = meridian_core::workspace::reference::turn_context_token_limit(128_000).saturating_sub(spent);
        let pool_for_refs = services.db.clone();
        let current = conversation_id.clone();
        let frozen = blocking(move || {
            let mut conn = get_conn(&pool_for_refs)?;
            meridian_core::agent::conversation_excerpt::freeze_conversation_refs(
                &mut conn,
                &current,
                &conv_refs,
                budget_left,
            )
        })
        .await?;
        prepared.extend(frozen);
        prepared
    };

    let item = blocking(move || {
        let mut conn = get_conn(&pool)?;
        let item = enqueue_unless_plan_barrier(
            &mut conn,
            &id,
            &conversation,
            &content,
            delivery,
            &prepared,
            now_ms(),
        )
            .map_err(|error| error.to_string())?;
        item.ok_or_else(|| {
            "This conversation is waiting for plan review. Approve it or request changes before queueing another message."
                .into()
        })
    })
    .await?;

    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    item.try_into()
}

/// Drop one that has not gone anywhere.
///
/// A settled or in-doubt row refuses, and says so rather than reporting a
/// success that did nothing: the second is the record that the agent may be
/// acting on it, and it is the only reason anyone would ever find out.
#[tauri::command]
pub async fn queue_remove(app: tauri::AppHandle, request: QueuedPromptRemoveRequest) -> Result<(), String> {
    let QueuedPromptRemoveRequest { conversation_id, id } = request;
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    let removed = blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::remove(&mut conn, &conversation, &id).map_err(|e| e.to_string())
    })
    .await?;

    if removed == 0 {
        return Err("this message has already been sent".into());
    }
    runner::announce(&services, &conversation_id);
    Ok(())
}

/// Rewrite the order, wholesale. The list is what the user dragged into place.
#[tauri::command]
pub async fn queue_reorder(app: tauri::AppHandle, request: QueuedPromptReorderRequest) -> Result<(), String> {
    let QueuedPromptReorderRequest { conversation_id, ids } = request;
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::reorder(&mut conn, &conversation, &ids).map_err(|e| e.to_string())
    })
    .await?;

    runner::announce(&services, &conversation_id);
    Ok(())
}

/// Change one item's mode while it is still waiting.
///
/// Pumps afterwards, and that is not incidental: switching a row to `interject`
/// *means* "go now", and without it nothing would happen until the running turn
/// ended — at which point the row would go as an ordinary turn and the change
/// would have made no difference at all. Same rule as everywhere else in this
/// file: the queue moves because somebody is here.
#[tauri::command]
pub async fn queue_set_delivery(
    app: tauri::AppHandle,
    request: QueuedPromptDeliveryUpdateRequest,
) -> Result<(), String> {
    let QueuedPromptDeliveryUpdateRequest {
        conversation_id,
        id,
        delivery,
    } = request;
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    let changed = blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::set_delivery(&mut conn, &conversation, &id, delivery).map_err(|e| e.to_string())
    })
    .await?;

    if changed == 0 {
        return Err("this message has already been sent".into());
    }
    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(())
}

/// Let a held queue go again.
///
/// The queue stops itself whenever a turn fails or is stopped, because what
/// comes after a failed step usually assumed it worked. Starting again is a
/// person's decision, and this is them making it — so it pumps.
#[tauri::command]
pub async fn queue_release(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        let released = release_unless_plan_barrier(&mut conn, &conversation).map_err(|error| error.to_string())?;
        released.ok_or_else(|| {
            String::from(
                "This conversation is waiting for its plan-review continuation; its queue cannot be released yet.",
            )
        })?;
        Ok(())
    })
    .await?;

    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(())
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_plan_runtime() -> meridian_core::db::models::plan_review::NativePlanReviewRuntimeConfig {
        meridian_core::db::models::plan_review::NativePlanReviewRuntimeConfig {
            provider_id: "provider-test".into(),
            model: "model-test".into(),
            assistant_id: None,
            thinking_level: None,
            fast: false,
            project_id: None,
            project_path: None,
            accept_edits: false,
        }
    }

    fn seed_pending_plan_review(conn: &mut diesel::sqlite::SqliteConnection, conversation_id: &str) {
        let document =
            meridian_core::db::ops::plan_review::create_or_resume_document(conn, conversation_id, 2).unwrap();
        let appended = meridian_core::db::ops::plan_review::append_assistant_revision(
            conn,
            &meridian_core::db::ops::plan_review::PlanRevisionAppend {
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
        meridian_core::db::ops::plan_review::mark_materialization_applied(conn, &appended.materialization.id, 4)
            .unwrap();
        meridian_core::db::ops::plan_review::submit_native_head_for_review(
            conn,
            &meridian_core::db::ops::plan_review::PlanReviewSubmit {
                document_id: &document.id,
                expected_generation: appended.document.working_generation,
                expected_head_sha256: &appended.revision.content_sha256,
                turn_id: None,
                assistant_message_id: Some("m1"),
                provider_call_id: Some("exit-1"),
                provider_kind: meridian_core::db::models::plan_review::PlanReviewProviderKind::Native,
                now: 5,
            },
            &native_plan_runtime(),
        )
        .unwrap();
    }

    #[test]
    fn enqueue_and_release_are_both_refused_by_the_durable_plan_barrier() {
        let pool = meridian_core::db::test_db();
        let mut conn = pool.get().unwrap();
        meridian_core::db::ops::conversation::create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        meridian_core::db::ops::queue::enqueue(
            &mut conn,
            "held-1",
            "c1",
            "existing held message",
            Delivery::FollowUp,
            2,
        )
        .unwrap();
        meridian_core::db::ops::queue::hold_all(&mut conn, "c1", 3).unwrap();
        seed_pending_plan_review(&mut conn, "c1");

        assert!(
            enqueue_unless_plan_barrier(&mut conn, "new-1", "c1", "must not enqueue", Delivery::FollowUp, &[], 6,)
                .unwrap()
                .is_none()
        );
        assert_eq!(release_unless_plan_barrier(&mut conn, "c1").unwrap(), None);
        let rows = meridian_core::db::ops::queue::list(&mut conn, "c1").unwrap();
        assert_eq!(rows.len(), 1, "the refused enqueue writes no row");
        assert_eq!(
            rows[0].state(),
            meridian_core::db::models::queue::QueueState::Held,
            "the refused release leaves the queue held"
        );
    }

    #[test]
    fn queued_prompt_create_request_uses_the_closed_delivery_vocabulary() {
        let request: QueuedPromptCreateRequest = serde_json::from_value(serde_json::json!({
            "conversationId": "conversation-1",
            "content": "continue",
            "delivery": "follow_up",
            "contextRefs": null,
            "conversationRefs": null,
        }))
        .expect("valid request");

        assert_eq!(request.delivery, Delivery::FollowUp);
        assert!(
            serde_json::from_value::<QueuedPromptCreateRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "content": "continue",
                "delivery": "follow_up",
                "conversationRefs": null,
            }))
            .is_err(),
            "nullable contextRefs must still be present",
        );
        assert!(
            serde_json::from_value::<QueuedPromptCreateRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "content": "continue",
                "delivery": "follow_up",
                "contextRefs": null,
            }))
            .is_err(),
            "nullable conversationRefs must still be present",
        );
        assert!(
            serde_json::from_value::<QueuedPromptCreateRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "content": "continue",
                "delivery": "later",
                "contextRefs": null,
                "conversationRefs": null,
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<QueuedPromptCreateRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "content": "inspect @src/main.rs",
                "delivery": "follow_up",
                "contextRefs": [{
                    "path": "src/main.rs",
                    "lineStart": null
                }],
                "conversationRefs": null,
            }))
            .is_err(),
            "nested reference range keys must be complete"
        );
    }

    #[test]
    fn queued_prompt_delivery_update_request_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<QueuedPromptDeliveryUpdateRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "id": "prompt-1",
                "delivery": "interject",
                "futureMode": true,
            }))
            .is_err()
        );
    }

    #[test]
    fn queue_mutation_requests_are_named_and_strict() {
        let remove: QueuedPromptRemoveRequest = serde_json::from_value(serde_json::json!({
            "conversationId": "conversation-1",
            "id": "prompt-1",
        }))
        .expect("valid remove request");
        assert_eq!(remove.id, "prompt-1");

        let reorder: QueuedPromptReorderRequest = serde_json::from_value(serde_json::json!({
            "conversationId": "conversation-1",
            "ids": ["prompt-2", "prompt-1"],
        }))
        .expect("valid reorder request");
        assert_eq!(reorder.ids, ["prompt-2", "prompt-1"]);

        assert!(
            serde_json::from_value::<QueuedPromptRemoveRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "id": "prompt-1",
                "alreadySent": false,
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<QueuedPromptReorderRequest>(serde_json::json!({
                "conversationId": "conversation-1",
                "ids": ["prompt-1"],
                "appendMissing": true,
            }))
            .is_err()
        );
    }
}
