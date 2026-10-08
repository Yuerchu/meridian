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
use meridian_core::db::entity::queued_prompt;
use meridian_core::db::models::queue::Delivery;
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::WriteTx;
use meridian_core::db::sea::ops::queue as ops;
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

/// An interjection is text: neither runner has anywhere mid-turn to put an
/// image or a file. `ops::set_delivery` refuses the same for the steer button,
/// which does not come through here.
fn refuse_attached_interjection(delivery: Delivery, content: &str) -> Result<(), String> {
    if delivery == Delivery::Interject && ops::carries_attachments(content).map_err(|e| e.to_string())? {
        return Err("attachments can only be queued as follow-up messages".into());
    }
    Ok(())
}

/// The barrier check and the write in the caller's one IMMEDIATE transaction:
/// checked outside it, a review submitted in between would be queued past.
async fn enqueue_unless_plan_barrier(
    tx: &WriteTx,
    id: &str,
    conversation_id: &str,
    content: &str,
    delivery: Delivery,
    context: &[meridian_core::workspace::reference::PreparedContextItem],
    now: i64,
) -> Result<Option<queued_prompt::Model>, DbErr> {
    if meridian_core::db::sea::ops::plan_review::has_conversation_barrier(tx, conversation_id).await? {
        return Ok(None);
    }
    ops::enqueue_with_context(tx, id, conversation_id, content, delivery, context, now)
        .await
        .map(Some)
}

async fn release_unless_plan_barrier(tx: &WriteTx, conversation_id: &str) -> Result<Option<u64>, DbErr> {
    if meridian_core::db::sea::ops::plan_review::has_conversation_barrier(tx, conversation_id).await? {
        return Ok(None);
    }
    ops::release_all(tx, conversation_id).await.map(Some)
}

/// Everything queued for a conversation, in the order it will be delivered.
///
/// Settled rows included: the front end draws one leaving, and dropping it here
/// would make an item vanish a beat before the message it became appears.
#[tauri::command]
pub async fn queue_list(app: tauri::AppHandle, conversation_id: String) -> Result<QueuedPromptListResponse, String> {
    let rows = ops::list(&app.services().sea, &conversation_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
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
    let id = uuid::Uuid::new_v4().to_string();
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
    refuse_attached_interjection(delivery, &content)?;
    // Whether a hosted agent can take them is a fact about its session, so it
    // is asked here, where the person who attached them is still looking, and
    // not left to turn up later as a held queue. A queued item usually means a
    // turn is running, so the session is live; a dormant one is asked again
    // at delivery, which is where it will be reopened anyway.
    // Desktop only, like `services.acp` itself: Android hosts no sessions.
    #[cfg(not(target_os = "android"))]
    if let Some(session) = services.acp.get(&conversation_id).filter(|session| session.is_alive()) {
        session.check_attachments(&services, &content).await?;
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
        let file_access = meridian_core::agent::build_file_access(&services.sea).await?;
        let context = meridian_core::tools::ToolContext {
            working_directory: Some(working_directory),
            shell: meridian_core::tools::ShellType::default_for_platform(),
            file_access,
            project_id: None,
            conversation_id: Some(conversation_id.clone()),
            turn_id: None,
            assistant_id: None,
            db_pool: Some(services.db.clone()),
            sea: Some(services.sea.clone()),
            #[cfg(not(target_os = "android"))]
            sandbox_policy: meridian_core::sandbox::CommandSandbox::UNCONFINED,
            #[cfg(not(target_os = "android"))]
            background: None,
            tool_secrets: Default::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            journal: None,
        };
        let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
        meridian_core::workspace::reference::prepare_references(&context, &references, &counter, None).await?
    };
    // Frozen at enqueue time beside the workspace snapshots — the thread may
    // move on before this message runs, and what the user saw when they
    // dragged it in is what the message should carry.
    let prepared = if conv_refs.is_empty() {
        prepared
    } else {
        let mut prepared = prepared;
        let spent: usize = prepared.iter().map(|item| item.token_count.max(0) as usize).sum();
        let budget_left = meridian_core::workspace::reference::turn_context_token_limit(None).saturating_sub(spent);
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

    let item = services
        .sea
        .write(async |tx| {
            enqueue_unless_plan_barrier(tx, &id, &conversation_id, &content, delivery, &prepared, now_ms()).await
        })
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "This conversation is waiting for plan review. Approve it or request changes before queueing another message."
                .to_string()
        })?;

    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(item.into())
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
    let removed = services
        .sea
        .write(async |tx| ops::remove(tx, &conversation_id, &id).await)
        .await
        .map_err(|e| e.to_string())?;

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
    services
        .sea
        .write(async |tx| ops::reorder(tx, &conversation_id, &ids).await)
        .await
        .map_err(|e| e.to_string())?;

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
    let changed = services
        .sea
        .write(async |tx| ops::set_delivery(tx, &conversation_id, &id, delivery).await)
        .await
        .map_err(|e| e.to_string())?;

    match changed {
        ops::DeliveryChange::Changed => {}
        ops::DeliveryChange::NotWaiting => return Err("this message has already been sent".into()),
        ops::DeliveryChange::CarriesAttachments => {
            return Err("a message with attachments can only be sent as a follow-up".into());
        }
        ops::DeliveryChange::CarriesContext => {
            return Err("a message with references can only be sent as a follow-up".into());
        }
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
    services
        .sea
        .write(async |tx| release_unless_plan_barrier(tx, &conversation_id).await)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            String::from(
                "This conversation is waiting for its plan-review continuation; its queue cannot be released yet.",
            )
        })?;

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

    async fn conversation(db: &meridian_core::db::sea::cap::Db) {
        db.write(async |tx| {
            meridian_core::db::sea::ops::conversation::create_conversation(tx, "c1", None, None, None, 1).await
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn enqueue_without_plan_barrier_accepts_both_delivery_modes_in_order() {
        let db = meridian_core::db::sea::sea_test_db().await;
        conversation(&db).await;

        for (position, delivery) in [Delivery::FollowUp, Delivery::Interject].into_iter().enumerate() {
            let id = format!("q{position}");
            let item = db
                .write(async |tx| enqueue_unless_plan_barrier(tx, &id, "c1", "continue", delivery, &[], 2).await)
                .await
                .unwrap()
                .expect("a conversation without a plan barrier accepts queued messages");
            assert_eq!(item.id, id);
            assert_eq!(item.delivery, delivery);
            assert_eq!(item.position, position as i32);
            assert_eq!(item.state(), meridian_core::db::models::queue::QueueState::Queued);
        }

        assert_eq!(ops::list(&db, "c1").await.unwrap().len(), 2);
        db.write(async |tx| ops::hold_all(tx, "c1", 3).await).await.unwrap();
        assert_eq!(
            db.write(async |tx| release_unless_plan_barrier(tx, "c1").await)
                .await
                .unwrap(),
            Some(2)
        );
        assert!(
            ops::list(&db, "c1")
                .await
                .unwrap()
                .iter()
                .all(|item| item.held_at.is_none())
        );
    }

    #[tokio::test]
    async fn enqueue_without_plan_barrier_commits_context_and_rolls_back_failed_snapshots() {
        use meridian_core::db::sea::ops::queued_prompt_context_item::list_prepared;
        use meridian_core::workspace::reference::{MessageContextKind, PreparedContextItem};

        let db = meridian_core::db::sea::sea_test_db().await;
        conversation(&db).await;
        let context = [PreparedContextItem {
            id: "ctx1".into(),
            kind: MessageContextKind::ProjectFile,
            content: "frozen bytes".into(),
            display_path: Some("src/lib.rs".into()),
            line_start: None,
            line_end: None,
            content_hash: "hash".into(),
            byte_count: 12,
            line_count: 1,
            token_count: 2,
            truncated: 0,
            metadata: None,
        }];

        db.write(async |tx| {
            enqueue_unless_plan_barrier(tx, "q1", "c1", "read @src/lib.rs", Delivery::FollowUp, &context, 2).await
        })
        .await
        .unwrap()
        .unwrap();
        let frozen = list_prepared(&db, "q1").await.unwrap();
        assert_eq!(frozen.len(), 1);
        assert_eq!(frozen[0].content, "frozen bytes");

        // The duplicate context id fails after the prompt row was inserted.
        let error = db
            .write(async |tx| {
                enqueue_unless_plan_barrier(tx, "q2", "c1", "another reference", Delivery::FollowUp, &context, 3).await
            })
            .await
            .unwrap_err();
        assert!(matches!(
            error.sql_err(),
            Some(meridian_core::db::sea::SqlErr::UniqueConstraintViolation(_))
        ));
        let rows = ops::list(&db, "c1").await.unwrap();
        assert_eq!(rows.len(), 1, "a failed snapshot must roll back its prompt");
        assert_eq!(rows[0].id, "q1");
        assert!(list_prepared(&db, "q2").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn enqueue_and_release_are_both_refused_by_the_durable_plan_barrier() {
        let dir = tempfile::tempdir().unwrap();
        let (pool, db) = meridian_core::db::sea::shared_test_db(dir.path()).await;
        conversation(&db).await;
        db.write(async |tx| {
            ops::enqueue(tx, "held-1", "c1", "existing held message", Delivery::FollowUp, 2).await?;
            ops::hold_all(tx, "c1", 3).await
        })
        .await
        .unwrap();
        seed_pending_plan_review(&mut pool.get().unwrap(), "c1");

        assert!(
            db.write(async |tx| {
                enqueue_unless_plan_barrier(tx, "new-1", "c1", "must not enqueue", Delivery::FollowUp, &[], 6).await
            })
            .await
            .unwrap()
            .is_none()
        );
        assert_eq!(
            db.write(async |tx| release_unless_plan_barrier(tx, "c1").await)
                .await
                .unwrap(),
            None
        );
        let rows = ops::list(&db, "c1").await.unwrap();
        assert_eq!(rows.len(), 1, "the refused enqueue writes no row");
        assert_eq!(
            rows[0].state(),
            meridian_core::db::models::queue::QueueState::Held,
            "the refused release leaves the queue held"
        );
    }

    /// Attachments queue as a follow-up and are refused as an interjection;
    /// text-only parts are text either way, and damaged parts are an error.
    #[test]
    fn an_interjection_may_not_carry_attachments() {
        let attached =
            r#"[{"type":"text","text":"and this"},{"type":"image_url","image_url":{"url":"file:///x.png"}}]"#;
        assert!(refuse_attached_interjection(Delivery::FollowUp, attached).is_ok());
        assert_eq!(
            refuse_attached_interjection(Delivery::Interject, attached),
            Err("attachments can only be queued as follow-up messages".into())
        );
        assert!(refuse_attached_interjection(Delivery::Interject, "plain words").is_ok());
        assert!(refuse_attached_interjection(Delivery::Interject, r#"[{"type":"text","text":"only words"}]"#).is_ok());
        assert!(refuse_attached_interjection(Delivery::Interject, r#"[{"type":"mystery"}]"#).is_err());
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
