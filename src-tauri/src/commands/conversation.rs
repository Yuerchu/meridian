use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::db;
use crate::db::models::conversation::Conversation;
use crate::provider;
use crate::state::{AppDb, AppSecrets, CompactBreakers};
use crate::util::now_ms;
use crate::agent::{do_compact, resolve_provider_config, build_messages, estimate_tokens, CompactCircuitBreaker, TokenBudget};

#[tauri::command]
pub async fn compact(
    app: tauri::AppHandle,
    conversation_id: String,
    custom_instructions: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>();

    let (assistant, keep_recent) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = crate::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
            Ok::<_, String>((assistant, keep_recent))
        }).await.map_err(|e| e.to_string())??
    };

    app.emit("compact-start", serde_json::json!({
        "conversation_id": &conversation_id,
    })).map_err(|e| e.to_string())?;

    let result = do_compact(&pool, &secrets.0, &conversation_id, assistant.as_ref(), keep_recent, custom_instructions.as_deref()).await;

    app.emit("compact-done", serde_json::json!({
        "conversation_id": &conversation_id,
    })).map_err(|e| e.to_string())?;

    result?;
    Ok(())
}

#[tauri::command]
pub async fn get_conversation(app: tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::get_conversation(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_conversations(app: tauri::AppHandle, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations(&mut conn, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_conversation(app: tauri::AppHandle, title: Option<String>, project_id: Option<String>) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let default_assistant = db::ops::assistant::get_default_assistant(&mut conn)
            .map_err(|e| e.to_string())?;
        let assistant_id = default_assistant.as_ref().map(|a| a.id.as_str());
        db::ops::conversation::create_conversation(&mut conn, &id, title.as_deref(), assistant_id, project_id.as_deref(), now_ms())
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_conversation_title(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_title(&mut conn, &id, &title, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_pin_conversation(app: tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::toggle_pin(&mut conn, &id, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::delete_conversation(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct ContextInfo {
    pub estimated_tokens: usize,
    pub context_limit: usize,
    pub compact_threshold: usize,
    pub auto_compact_enabled: bool,
    pub circuit_breaker_state: String,
    pub message_count: usize,
}

#[tauri::command]
pub async fn get_context_info(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<ContextInfo, String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>();

    let (assistant, history, compact_cursor) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = crate::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>((assistant, history, conv.compact_cursor))
        }).await.map_err(|e| e.to_string())??
    };

    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128_000);
    let auto_compact_enabled = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    let (provider_type, _, _, model, api_format) =
        resolve_provider_config(&secrets.0, &pool, assistant.as_ref())
            .unwrap_or_else(|_| ("openai".into(), String::new(), String::new(), "gpt-4.1-mini".into(), "chat".into()));

    let caps = provider::capabilities::resolve(&provider_type, Some(&api_format), &model);
    let max_output = caps.max_output_tokens.map(|t| t as usize).unwrap_or(16_384);
    let budget = TokenBudget::new(&provider_type, &model, context_limit, max_output, None);

    let msgs = build_messages("", &history, "", compact_cursor);
    let active_messages: Vec<_> = if let Some(cursor) = compact_cursor {
        history.iter().filter(|m| m.sort_order >= cursor || m.is_compact_summary == 1).collect()
    } else {
        history.iter().collect()
    };
    let estimated_tokens = budget.counter.count_messages(&msgs);

    let cb_state = {
        let breakers = app.state::<CompactBreakers>();
        let map = breakers.0.lock().await;
        map.get(&conversation_id)
            .map(|cb| cb.state_label().to_string())
            .unwrap_or_else(|| "closed".to_string())
    };

    Ok(ContextInfo {
        estimated_tokens,
        context_limit,
        compact_threshold: budget.compact_threshold,
        auto_compact_enabled,
        circuit_breaker_state: cb_state,
        message_count: active_messages.len(),
    })
}

#[tauri::command]
pub async fn list_conversations_by_project(app: tauri::AppHandle, project_id: String, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations_by_project(&mut conn, &project_id, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
