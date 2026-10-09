use crate::ServicesExt;
use crate::commands::entity_response::{AssistantInfoResponse, AssistantListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::entity::assistant;
use meridian_core::db::entity::assistant::AssistantChangeset;
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::{Db, WriteTx};
use meridian_core::db::sea::ops::{
    assistant as assistant_ops, conversation as conversation_ops, plan_review as plan_review_ops,
};
use meridian_core::db::types::{Json, SqlBool};
use meridian_core::util::{double_option, now_ms};

const PLAN_REVIEW_ASSISTANT_BARRIER: &str = "This assistant is frozen into a plan review or its continuation. Finish that review before changing or deleting the assistant.";

#[derive(Debug)]
enum GuardedAssistantMutation<T> {
    Applied(T),
    PlanReviewBarrier,
    ConversationsChanged,
}

/// What stops an assistant mutation before it writes anything: the
/// conversation set having changed since the caller took its leases, or a
/// plan review whose blocked continuation depends on this assistant. Run first
/// in the mutation's own write, so the answer still holds when the write lands.
async fn assistant_barrier<T>(
    tx: &WriteTx,
    assistant_id: &str,
    expected_conversation_ids: &[String],
) -> Result<Option<GuardedAssistantMutation<T>>, DbErr> {
    let mut current = conversation_ops::all_ids(tx).await?;
    current.sort();
    if current != expected_conversation_ids {
        return Ok(Some(GuardedAssistantMutation::ConversationsChanged));
    }
    if !plan_review_ops::barrier_conversations_for_assistant(tx, assistant_id)
        .await?
        .is_empty()
    {
        return Ok(Some(GuardedAssistantMutation::PlanReviewBarrier));
    }
    Ok(None)
}

async fn update_assistant_unless_plan_barrier(
    tx: &WriteTx,
    assistant_id: &str,
    expected_conversation_ids: &[String],
    changeset: AssistantChangeset,
) -> Result<GuardedAssistantMutation<assistant::Model>, DbErr> {
    if let Some(refused) = assistant_barrier(tx, assistant_id, expected_conversation_ids).await? {
        return Ok(refused);
    }
    assistant_ops::update_assistant(tx, assistant_id, changeset)
        .await
        .map(GuardedAssistantMutation::Applied)
}

async fn delete_assistant_unless_plan_barrier(
    tx: &WriteTx,
    assistant_id: &str,
    expected_conversation_ids: &[String],
) -> Result<GuardedAssistantMutation<()>, DbErr> {
    if let Some(refused) = assistant_barrier(tx, assistant_id, expected_conversation_ids).await? {
        return Ok(refused);
    }
    assistant_ops::delete_assistant(tx, assistant_id)
        .await
        .map(|_| GuardedAssistantMutation::Applied(()))
}

fn finish_guarded_assistant_mutation<T>(result: GuardedAssistantMutation<T>) -> Result<T, String> {
    match result {
        GuardedAssistantMutation::Applied(value) => Ok(value),
        GuardedAssistantMutation::PlanReviewBarrier => Err(PLAN_REVIEW_ASSISTANT_BARRIER.into()),
        GuardedAssistantMutation::ConversationsChanged => {
            Err("The conversation set changed while the assistant mutation was being prepared. Try again.".into())
        }
    }
}

/// Every conversation's id, sorted: which turn leases an assistant mutation
/// takes before it opens its write.
async fn sorted_conversation_ids(db: &Db) -> Result<Vec<String>, String> {
    let mut ids = conversation_ops::all_ids(db).await.map_err(|e| e.to_string())?;
    ids.sort();
    Ok(ids)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantCreateRequest {
    name: String,
    system_prompt: String,
    model_id: RequiredNullable<String>,
    temperature: RequiredNullable<f32>,
    top_p: RequiredNullable<f32>,
    max_tokens: RequiredNullable<i32>,
}

#[tauri::command]
pub async fn list_assistants(app: tauri::AppHandle) -> Result<AssistantListResponse, String> {
    let rows = assistant_ops::list_assistants(&app.services().db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn create_assistant(
    app: tauri::AppHandle,
    request: AssistantCreateRequest,
) -> Result<AssistantInfoResponse, String> {
    let now = now_ms();
    let row = assistant::Model {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        description: None,
        avatar: None,
        system_prompt: request.system_prompt,
        provider_id: None,
        model_id: request.model_id.0,
        temperature: request.temperature.0,
        top_p: request.top_p.0,
        max_tokens: request.max_tokens.0,
        is_default: SqlBool::FALSE,
        sort_order: 0,
        created_at: now,
        updated_at: now,
        // No override: `resolve_turn_params` reads 0 as "the model's own
        // window". A number here would outrank the window the model is
        // configured with, and nobody chose it.
        context_limit: 0,
        compact_keep_recent: 10,
        enabled_tools: None,
        thinking_enabled: SqlBool::FALSE,
        thinking_budget: None,
        tool_preset_id: None,
        auto_compact_enabled: SqlBool::FALSE,
    };
    app.services()
        .db
        .write(async |tx| assistant_ops::create_assistant(tx, row).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantUpdateRequest {
    id: String,
    name: Option<String>,
    system_prompt: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    provider_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    model_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    temperature: Option<Option<f32>>,
    context_limit: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    enabled_tools: Option<Option<Vec<String>>>,
    thinking_enabled: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    thinking_budget: Option<Option<i32>>,
    #[serde(default, deserialize_with = "double_option")]
    tool_preset_id: Option<Option<String>>,
    auto_compact_enabled: Option<bool>,
}

#[tauri::command]
pub async fn update_assistant(
    app: tauri::AppHandle,
    request: AssistantUpdateRequest,
) -> Result<AssistantInfoResponse, String> {
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the mutation on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "an assistant update")
        .map_err(|busy| busy.to_string())?;
    let changeset = AssistantChangeset {
        name: request.name,
        system_prompt: request.system_prompt,
        provider_id: request.provider_id,
        model_id: request.model_id,
        temperature: request.temperature,
        context_limit: request.context_limit,
        enabled_tools: request.enabled_tools.map(|tools| tools.map(Json)),
        thinking_enabled: request.thinking_enabled.map(SqlBool::from),
        thinking_budget: request.thinking_budget,
        tool_preset_id: request.tool_preset_id,
        auto_compact_enabled: request.auto_compact_enabled.map(SqlBool::from),
        updated_at: Some(now_ms()),
        ..Default::default()
    };
    let guarded = services
        .db
        .write(async |tx| update_assistant_unless_plan_barrier(tx, &request.id, &conversation_ids, changeset).await)
        .await
        .map_err(|e| e.to_string())?;
    finish_guarded_assistant_mutation(guarded).map(Into::into)
}

#[tauri::command]
pub async fn delete_assistant(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    // pool-read-before-write: these ids only pick which turn leases to take; the
    // write re-reads them and refuses the mutation on any difference.
    let conversation_ids = sorted_conversation_ids(&services.db).await?;
    let _leases = services
        .turns
        .clone()
        .try_acquire_mutations(&conversation_ids, "an assistant delete")
        .map_err(|busy| busy.to_string())?;
    let guarded = services
        .db
        .write(async |tx| delete_assistant_unless_plan_barrier(tx, &id, &conversation_ids).await)
        .await
        .map_err(|e| e.to_string())?;
    finish_guarded_assistant_mutation(guarded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db;

    #[test]
    fn assistant_boolean_updates_reject_integer_encodings() {
        let request = serde_json::from_value::<AssistantUpdateRequest>(serde_json::json!({
            "id": "assistant-1",
            "thinkingEnabled": true,
            "autoCompactEnabled": false
        }))
        .unwrap();
        assert_eq!(request.thinking_enabled, Some(true));
        assert_eq!(request.auto_compact_enabled, Some(false));

        assert!(
            serde_json::from_value::<AssistantUpdateRequest>(serde_json::json!({
                "id": "assistant-1",
                "thinkingEnabled": 1
            }))
            .is_err()
        );
    }

    fn assistant_row(id: &str) -> assistant::Model {
        assistant::Model {
            id: id.into(),
            name: "Nova".into(),
            description: None,
            avatar: None,
            system_prompt: "old prompt".into(),
            provider_id: None,
            model_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            is_default: SqlBool::FALSE,
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
            context_limit: 0,
            compact_keep_recent: 10,
            enabled_tools: None,
            thinking_enabled: SqlBool::FALSE,
            thinking_budget: None,
            tool_preset_id: None,
            auto_compact_enabled: SqlBool::FALSE,
        }
    }

    #[tokio::test]
    async fn assistant_update_and_delete_are_blocked_by_its_active_review_runtime() {
        let sea = db::sea::sea_test_db().await;
        sea.write(async |tx| {
            assistant_ops::create_assistant(tx, assistant_row("assistant-1")).await?;
            db::sea::ops::conversation::create_conversation(tx, "conversation-1", None, None, None, 1).await?;
            let runtime = db::models::plan_review::NativePlanReviewRuntimeConfig {
                assistant_id: Some("assistant-1".into()),
                ..db::sea::ops::plan_review::test_runtime("provider-1", "model-1", None)
            };
            db::sea::ops::plan_review::seed_pending_native_review(tx, "conversation-1", &runtime)
                .await
                .map_err(|e| db::sea::DbErr::Custom(e.to_string()))?;
            Ok::<_, db::sea::DbErr>(())
        })
        .await
        .unwrap();
        let conversations = vec!["conversation-1".to_string()];

        let updated = sea
            .write(async |tx| {
                update_assistant_unless_plan_barrier(
                    tx,
                    "assistant-1",
                    &conversations,
                    AssistantChangeset {
                        system_prompt: Some("new prompt".into()),
                        ..Default::default()
                    },
                )
                .await
            })
            .await
            .unwrap();
        assert!(matches!(updated, GuardedAssistantMutation::PlanReviewBarrier));
        let stored = assistant_ops::get_assistant(&sea, "assistant-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.system_prompt, "old prompt");

        let deleted = sea
            .write(async |tx| delete_assistant_unless_plan_barrier(tx, "assistant-1", &conversations).await)
            .await
            .unwrap();
        assert!(matches!(deleted, GuardedAssistantMutation::PlanReviewBarrier));
        assert!(
            assistant_ops::get_assistant(&sea, "assistant-1")
                .await
                .unwrap()
                .is_some()
        );

        let stale = sea
            .write(async |tx| delete_assistant_unless_plan_barrier(tx, "assistant-1", &[]).await)
            .await
            .unwrap();
        assert!(matches!(stale, GuardedAssistantMutation::ConversationsChanged));
    }

    /// With nothing in the way the guarded update applies, clearing what it
    /// was asked to clear.
    #[tokio::test]
    async fn an_unblocked_assistant_update_applies() {
        let db = db::sea::sea_test_db().await;
        let mut row = assistant_row("assistant-1");
        row.enabled_tools = Some(Json(vec!["read_file".into()]));
        db.write(async |tx| assistant_ops::create_assistant(tx, row).await)
            .await
            .unwrap();
        let updated = db
            .write(async |tx| {
                update_assistant_unless_plan_barrier(
                    tx,
                    "assistant-1",
                    &[],
                    AssistantChangeset {
                        enabled_tools: Some(None),
                        thinking_enabled: Some(SqlBool::TRUE),
                        ..Default::default()
                    },
                )
                .await
            })
            .await
            .unwrap();
        let GuardedAssistantMutation::Applied(row) = updated else {
            panic!("nothing blocks this assistant: {updated:?}");
        };
        let response = AssistantInfoResponse::from(row);
        assert_eq!((response.enabled_tools, response.thinking_enabled), (None, true));
    }
}
