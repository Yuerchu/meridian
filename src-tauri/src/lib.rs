mod client;
mod db;
mod keyring;
mod provider;
mod secrets;
mod tools;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use db::DbPool;
use db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use db::models::conversation::Conversation;
use db::models::message::{Message, NewMessage};
use db::models::provider::{NewProvider, Provider, ProviderUpdate};
use provider::models::ModelInfo;
use provider::{ChatMessage, ChatParams, ChatProvider, ToolCall};
use secrets::{SecretName, SecretScope, SecretsManager};
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

struct AppSecrets(Arc<SecretsManager>);
struct AppDb(DbPool);
struct AppTools(tools::ToolRegistry);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ApprovalDecision {
    Approved,
    Denied,
    Response(String),
}

struct ApprovalWaiters(Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>);

pub fn take_bytes_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = 0;
    for (i, ch) in s.char_indices() {
        let next = i + ch.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    &s[..end]
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn get_conn(pool: &DbPool) -> Result<db::PooledConn, String> {
    pool.get().map_err(|e| format!("db connection error: {e}"))
}

fn build_messages(
    system_prompt: &str,
    history: &[Message],
    user_message: &str,
) -> Vec<ChatMessage> {
    let mut msgs = Vec::new();
    if !system_prompt.is_empty() {
        msgs.push(ChatMessage { role: "system".into(), content: system_prompt.into(), reasoning_content: None, tool_calls: None, tool_call_id: None });
    }
    for m in history {
        if m.role == "user" || m.role == "assistant" {
            msgs.push(ChatMessage { role: m.role.clone(), content: m.content.clone(), reasoning_content: None, tool_calls: None, tool_call_id: None });
        }
    }
    msgs.push(ChatMessage::user(user_message));
    msgs
}

fn trim_to_context_limit(messages: &mut Vec<ChatMessage>, context_limit: usize, keep_recent: usize) {
    let total_tokens: usize = messages.iter().map(|m| m.content.len() / 4 + 4).sum();
    if total_tokens <= context_limit {
        return;
    }
    let has_system = messages.first().is_some_and(|m| m.role == "system");
    let system_offset = if has_system { 1 } else { 0 };
    let keep = (keep_recent * 2).min(messages.len().saturating_sub(system_offset));
    let start = messages.len() - keep;
    let mut trimmed = Vec::new();
    if has_system {
        trimmed.push(messages[0].clone());
    }
    trimmed.extend_from_slice(&messages[start..]);
    *messages = trimmed;
}

fn provider_secret_name(provider_id: &str) -> String {
    format!("PROVIDER_{}_KEY", provider_id.replace('-', "_").to_uppercase())
}

fn get_provider_api_key(secrets: &SecretsManager, provider_id: &str) -> Option<String> {
    let key = provider_secret_name(provider_id);
    secrets.get(&SecretScope::Global, &SecretName::new(&key).unwrap()).ok().flatten()
}

fn resolve_provider_config(
    secrets: &SecretsManager,
    pool: &DbPool,
    assistant: Option<&Assistant>,
) -> Result<(String, String, String, String), String> {
    if let Some(provider_id) = assistant.and_then(|a| a.provider_id.as_deref()) {
        let mut conn = get_conn(pool)?;
        let provider = db::ops::provider::get_provider(&mut conn, provider_id)
            .map_err(|e| format!("Provider not found: {e}"))?;
        let api_key = get_provider_api_key(secrets, provider_id)
            .ok_or_else(|| format!("API Key not set for provider '{}'", provider.name))?;
        let model = assistant
            .and_then(|a| a.model_id.clone())
            .unwrap_or_else(|| "gpt-4.1-mini".into());
        let base_url = provider.base_url.trim_end_matches('/').to_string();
        return Ok((provider.provider_type, base_url, api_key, model));
    }

    // Fallback: first enabled provider
    let mut conn = get_conn(pool)?;
    if let Ok(providers) = db::ops::provider::list_providers(&mut conn) {
        if let Some(p) = providers.into_iter().find(|p| p.is_enabled != 0) {
            if let Some(api_key) = get_provider_api_key(secrets, &p.id) {
                let model = assistant
                    .and_then(|a| a.model_id.clone())
                    .unwrap_or_else(|| "gpt-4.1-mini".into());
                let base_url = p.base_url.trim_end_matches('/').to_string();
                return Ok((p.provider_type, base_url, api_key, model));
            }
        }
    }

    Err("No provider configured. Go to Settings → Provider to add one.".into())
}

// --- Secret commands ---

#[tauri::command]
async fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0.set(&SecretScope::Global, &name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0.get(&SecretScope::Global, &name).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0.delete(&SecretScope::Global, &name).map_err(|e| e.to_string())
}

// --- Conversation commands ---

#[tauri::command]
async fn list_conversations(app: tauri::AppHandle, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations(&mut conn, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_conversation(app: tauri::AppHandle, title: Option<String>, project_id: Option<String>) -> Result<Conversation, String> {
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
async fn update_conversation_title(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_title(&mut conn, &id, &title, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn toggle_pin_conversation(app: tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::toggle_pin(&mut conn, &id, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::delete_conversation(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// --- Message commands ---

#[tauri::command]
async fn load_messages(app: tauri::AppHandle, conversation_id: String) -> Result<Vec<Message>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::list_messages(&mut conn, &conversation_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_message(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_message(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// --- Assistant commands ---

#[tauri::command]
async fn list_assistants(app: tauri::AppHandle) -> Result<Vec<Assistant>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::assistant::list_assistants(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_assistant(
    app: tauri::AppHandle,
    name: String,
    system_prompt: String,
    model_id: Option<String>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<Assistant, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let new = NewAssistant {
            id: &id,
            name: &name,
            description: None,
            avatar: None,
            system_prompt: &system_prompt,
            provider_id: None,
            model_id: model_id.as_deref(),
            temperature,
            top_p,
            max_tokens,
            is_default: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            context_limit: 128000,
            compact_keep_recent: 10,
        };
        db::ops::assistant::create_assistant(&mut conn, &new).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_assistant(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    system_prompt: Option<String>,
    model_id: Option<Option<String>>,
    temperature: Option<Option<f32>>,
) -> Result<Assistant, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = AssistantUpdate {
            name,
            system_prompt,
            model_id,
            temperature,
            updated_at: Some(now_ms()),
            ..Default::default()
        };
        db::ops::assistant::update_assistant(&mut conn, &id, &changeset).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_assistant(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::assistant::delete_assistant(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// --- Provider commands ---

#[tauri::command]
async fn list_providers(app: tauri::AppHandle) -> Result<Vec<Provider>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::list_providers(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_provider(
    app: tauri::AppHandle,
    name: String,
    provider_type: String,
    base_url: String,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        db::ops::provider::create_provider(&mut conn, &NewProvider {
            id: &id,
            name: &name,
            provider_type: &provider_type,
            base_url: &base_url,
            is_enabled: 1,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_provider(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    provider_type: Option<String>,
    base_url: Option<String>,
    is_enabled: Option<i32>,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = ProviderUpdate {
            name,
            provider_type,
            base_url,
            is_enabled,
            updated_at: Some(now_ms()),
            ..Default::default()
        };
        db::ops::provider::update_provider(&mut conn, &id, &changeset).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_provider(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::provider::delete_provider(&mut conn, &id).map_err(|e| e.to_string())?;
        let key_name = provider_secret_name(&id);
        let _ = secrets.delete(&SecretScope::Global, &SecretName::new(&key_name).unwrap());
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_provider_key(
    app: tauri::AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let key_name = provider_secret_name(&provider_id);
    secrets.0.set(&SecretScope::Global, &SecretName::new(&key_name).unwrap(), &api_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_provider_key_exists(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<bool, String> {
    let secrets = app.state::<AppSecrets>();
    let key_name = provider_secret_name(&provider_id);
    let exists = secrets.0.get(&SecretScope::Global, &SecretName::new(&key_name).unwrap())
        .ok().flatten().is_some();
    Ok(exists)
}

#[tauri::command]
async fn fetch_provider_models(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Vec<ModelInfo>, String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>().0.clone();

    let (provider_type, base_url) = {
        let pool = pool.clone();
        let pid = provider_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let p = db::ops::provider::get_provider(&mut conn, &pid).map_err(|e| e.to_string())?;
            Ok::<_, String>((p.provider_type, p.base_url))
        }).await.map_err(|e| e.to_string())??
    };

    let api_key = get_provider_api_key(&secrets, &provider_id)
        .ok_or("API Key not set for this provider")?;

    provider::models::fetch_models(&provider_type, &base_url, &api_key)
        .await
        .map_err(|e| e.to_string())
}

// --- Tool approval commands ---

#[tauri::command]
async fn approve_tool_call(app: tauri::AppHandle, call_id: String) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Approved);
    }
    Ok(())
}

#[tauri::command]
async fn deny_tool_call(app: tauri::AppHandle, call_id: String) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Denied);
    }
    Ok(())
}

#[tauri::command]
async fn respond_to_ask(app: tauri::AppHandle, call_id: String, response: String) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Response(response));
    }
    Ok(())
}

// --- Project commands ---

#[tauri::command]
async fn list_projects(app: tauri::AppHandle) -> Result<Vec<db::models::project::Project>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::list_projects(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_project(app: tauri::AppHandle, name: String, path: String) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        db::ops::project::create_project(&mut conn, &db::models::project::NewProject {
            id: &id, name: &name, path: &path, created_at: now, updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_project(app: tauri::AppHandle, id: String, name: Option<String>, path: Option<String>) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::update_project(&mut conn, &id, &db::models::project::ProjectUpdate {
            name, path, updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::delete_project(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_conversations_by_project(app: tauri::AppHandle, project_id: String, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations_by_project(&mut conn, &project_id, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// --- Preference commands ---

#[tauri::command]
async fn get_preference(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::get_preference(&mut conn, &key).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_preference(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::set_preference(&mut conn, &key, &value, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// --- Chat command (with agent loop + tools + approval) ---

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
    model_override: Option<String>,
    provider_override: Option<String>,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let pool = app.state::<AppDb>().0.clone();

    // Load conversation + assistant + history + project path
    let (assistant, history, conv_title, project_path) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let project_path = conv.project_id.as_deref()
                .and_then(|pid| db::ops::project::get_project(&mut conn, pid).ok())
                .map(|p| p.path);
            Ok::<_, String>((assistant, history, conv.title, project_path))
        }).await.map_err(|e| e.to_string())??
    };

    // Resolve provider config (with optional overrides)
    let (mut provider_type, mut base_url, mut api_key, model) =
        resolve_provider_config(&secrets.0, &pool, assistant.as_ref())?;

    let model = model_override.unwrap_or(model);

    if let Some(ref pid) = provider_override {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        let secrets2 = secrets.0.clone();
        let (pt, bu, ak) = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let p = db::ops::provider::get_provider(&mut conn, &pid2).map_err(|e| e.to_string())?;
            let ak = get_provider_api_key(&secrets2, &pid2)
                .ok_or_else(|| format!("API Key not set for provider '{}'", p.name))?;
            Ok::<_, String>((p.provider_type, p.base_url.trim_end_matches('/').to_string(), ak))
        }).await.map_err(|e| e.to_string())??;
        provider_type = pt;
        base_url = bu;
        api_key = ak;
    }

    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key);

    // Build messages with history
    let system_prompt = assistant.as_ref().map(|a| a.system_prompt.as_str()).unwrap_or("");
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);

    let mut chat_messages = build_messages(system_prompt, &history, &message);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let params = ChatParams {
        model: model.clone(),
        temperature: assistant.as_ref().and_then(|a| a.temperature.map(|t| t as f64)),
        top_p: assistant.as_ref().and_then(|a| a.top_p.map(|t| t as f64)),
        max_tokens: assistant.as_ref().and_then(|a| a.max_tokens),
    };

    // Persist user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();

    {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg = message.clone();
        let msg_id = user_msg_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user", content: &msg,
                provider_id: None, model_id: None, input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None, sort_order: 0, created_at: now,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Persist placeholder assistant message
    {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg_id = assistant_msg_id.clone();
        let model_clone = model.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "assistant", content: "",
                provider_id: None, model_id: Some(&model_clone), input_tokens: None,
                output_tokens: None, tool_calls: None, tool_call_id: None, sort_order: 0,
                created_at: now,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Get tool definitions + shell preference
    let tool_registry = app.state::<AppTools>();
    let tool_defs = tool_registry.0.definitions();
    let has_tools = !tool_defs.is_empty();
    let max_iterations = 10;
    let shell_type = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            db::ops::preference::get_preference(&mut conn, "shell").ok()?
        }).await.ok().flatten()
    };
    let tool_context = tools::ToolContext {
        working_directory: project_path,
        shell: shell_type.map(|s| tools::ShellType::from_str(&s)).unwrap_or_else(tools::ShellType::default_for_platform),
    };

    let mut full_content = String::new();

    if has_tools {
        // Agent loop: non-streaming with tool calls

        for _iteration in 0..max_iterations {
            let response = provider.chat_with_tools(
                chat_messages.clone(), tool_defs.clone(), params.clone()
            ).await.map_err(|e| e.to_string())?;

            if !response.text.is_empty() {
                full_content.push_str(&response.text);
                app.emit("chat-stream", serde_json::json!({
                    "content": &response.text, "done": false, "message_id": &assistant_msg_id,
                })).map_err(|e| e.to_string())?;
            }

            if response.tool_calls.is_empty() {
                break;
            }

            // Add assistant message with tool_calls to context
            chat_messages.push(ChatMessage::assistant_with_tools(
                &response.text, response.reasoning_content.clone(), response.tool_calls.clone()
            ));

            // Process each tool call
            for tc in &response.tool_calls {
                app.emit("chat-stream", serde_json::json!({
                    "type": "tool_call",
                    "call_id": tc.id,
                    "tool_name": tc.name,
                    "arguments": tc.arguments,
                    "message_id": &assistant_msg_id,
                })).map_err(|e| e.to_string())?;

                let tool = tool_registry.0.get(&tc.name);
                let result = if tc.name == "ask_user" {
                    // ask_user: send question to frontend, wait for text response
                    let (tx, rx) = oneshot::channel();
                    {
                        let waiters = app.state::<ApprovalWaiters>();
                        let mut map = waiters.0.lock().await;
                        map.insert(tc.id.clone(), tx);
                    }
                    app.emit("chat-stream", serde_json::json!({
                        "type": "tool_approval_req",
                        "call_id": tc.id,
                        "tool_name": tc.name,
                        "arguments": tc.arguments,
                        "message_id": &assistant_msg_id,
                    })).map_err(|e| e.to_string())?;

                    match rx.await {
                        Ok(ApprovalDecision::Response(text)) => text,
                        _ => "User did not respond.".to_string(),
                    }
                } else if let Some(tool) = tool {
                    let permission = tool.default_permission();
                    let approved = match permission {
                        tools::Permission::Always => true,
                        tools::Permission::Never => false,
                        tools::Permission::Ask => {
                            let (tx, rx) = oneshot::channel();
                            {
                                let waiters = app.state::<ApprovalWaiters>();
                                let mut map = waiters.0.lock().await;
                                map.insert(tc.id.clone(), tx);
                            }
                            app.emit("chat-stream", serde_json::json!({
                                "type": "tool_approval_req",
                                "call_id": tc.id,
                                "tool_name": tc.name,
                                "arguments": tc.arguments,
                                "message_id": &assistant_msg_id,
                            })).map_err(|e| e.to_string())?;

                            match rx.await {
                                Ok(ApprovalDecision::Approved) => true,
                                _ => false,
                            }
                        }
                    };

                    if approved {
                        let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                            .unwrap_or_default();
                        match tool.execute(args, &tool_context).await {
                            Ok(output) => output,
                            Err(e) => format!("Error: {e}"),
                        }
                    } else {
                        "Tool call denied by user.".to_string()
                    }
                } else {
                    format!("Unknown tool: {}", tc.name)
                };

                app.emit("chat-stream", serde_json::json!({
                    "type": "tool_result",
                    "call_id": tc.id,
                    "result": &result,
                    "message_id": &assistant_msg_id,
                })).map_err(|e| e.to_string())?;

                chat_messages.push(ChatMessage::tool_result(&tc.id, &result));
            }
        }

        // Persist final content
        {
            let pool = pool.clone();
            let msg_id = assistant_msg_id.clone();
            let content = full_content.clone();
            tokio::task::spawn_blocking(move || {
                if let Ok(mut conn) = pool.get() {
                    let _ = db::ops::message::update_content(&mut conn, &msg_id, &content);
                }
            }).await.map_err(|e| e.to_string())?;
        }
    } else {
        // Simple streaming (no tools)
        let mut stream = provider.stream_chat(chat_messages, params.clone())
            .await.map_err(|e| e.to_string())?;

        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(content) => {
                    full_content.push_str(&content);
                    app.emit("chat-stream", serde_json::json!({
                        "content": content, "done": false, "message_id": &assistant_msg_id,
                    })).map_err(|e| e.to_string())?;
                }
                Err(e) => {
                    let pool = pool.clone();
                    let msg_id = assistant_msg_id.clone();
                    let content = full_content.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        if let Ok(mut conn) = pool.get() {
                            let _ = db::ops::message::update_content(&mut conn, &msg_id, &content);
                        }
                    }).await;
                    return Err(e.to_string());
                }
            }
        }

        // Persist final content
        {
            let pool = pool.clone();
            let msg_id = assistant_msg_id.clone();
            let content = full_content.clone();
            tokio::task::spawn_blocking(move || {
                if let Ok(mut conn) = pool.get() {
                    let _ = db::ops::message::update_content(&mut conn, &msg_id, &content);
                }
            }).await.map_err(|e| e.to_string())?;
        }
    }

    app.emit("chat-stream", serde_json::json!({
        "content": "", "done": true, "message_id": &assistant_msg_id,
    })).map_err(|e| e.to_string())?;

    // Auto-generate title if first message
    if conv_title.is_none() {
        let title_messages = vec![ChatMessage::user(&format!(
            "Generate a short title (max 6 words, no quotes, no punctuation) for this conversation:\nUser: {}\nAssistant: {}",
            &message,
            take_bytes_at_char_boundary(&full_content, 300)
        ))];
        let title_params = ChatParams {
            model: params.model,
            temperature: Some(0.3),
            ..Default::default()
        };
        if let Ok(title) = provider.chat(title_messages, title_params).await {
            let title = title.trim().trim_matches('"').trim_matches('\'').to_string();
            if !title.is_empty() {
                let pool = pool.clone();
                let conv_id = conversation_id.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::conversation::update_title(&mut conn, &conv_id, &title, now_ms());
                    }
                }).await;
                app.emit("conversation-updated", serde_json::json!({
                    "id": conversation_id,
                })).ok();
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    #[cfg(target_os = "android")]
    android_keyring::set_android_keyring_credential_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
            let mgr = Arc::new(SecretsManager::new(data_dir.clone()));
            app.manage(AppSecrets(mgr.clone()));

            let db_path = data_dir.join("meridian.db");
            let pool = db::init_db(db_path.to_str().expect("invalid db path"));

            // Create default assistant on first run
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::assistant::get_default_assistant(&mut conn)
                    .ok().flatten().is_none()
                {
                    let id = uuid::Uuid::new_v4().to_string();
                    let now = now_ms();
                    let _ = db::ops::assistant::create_assistant(&mut conn, &NewAssistant {
                        id: &id,
                        name: "Default",
                        description: None,
                        avatar: None,
                        system_prompt: "You are a helpful assistant.",
                        provider_id: None,
                        model_id: None,
                        temperature: None,
                        top_p: None,
                        max_tokens: None,
                        is_default: 1,
                        sort_order: 0,
                        created_at: now,
                        updated_at: now,
                        context_limit: 128000,
                        compact_keep_recent: 10,
                    });
                }
            }

            // Migrate legacy secrets-based provider to DB
            {
                let mut conn = pool.get().expect("db connection");
                let count = db::ops::provider::count_providers(&mut conn).unwrap_or(0);
                if count == 0 {
                    if let Some(api_key) = mgr
                        .get(&SecretScope::Global, &SecretName::new("API_KEY").unwrap())
                        .ok()
                        .flatten()
                    {
                        let provider_type = mgr
                            .get(&SecretScope::Global, &SecretName::new("PROVIDER_TYPE").unwrap())
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "openai".into());
                        let base_url = mgr
                            .get(&SecretScope::Global, &SecretName::new("API_BASE").unwrap())
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "https://api.openai.com/v1".into());
                        let model = mgr
                            .get(&SecretScope::Global, &SecretName::new("MODEL").unwrap())
                            .ok()
                            .flatten();

                        let pid = uuid::Uuid::new_v4().to_string();
                        let now = now_ms();
                        if let Ok(provider) = db::ops::provider::create_provider(
                            &mut conn,
                            &NewProvider {
                                id: &pid,
                                name: "Default",
                                provider_type: &provider_type,
                                base_url: &base_url,
                                is_enabled: 1,
                                sort_order: 0,
                                created_at: now,
                                updated_at: now,
                            },
                        ) {
                            let key_name = provider_secret_name(&provider.id);
                            let _ = mgr.set(
                                &SecretScope::Global,
                                &SecretName::new(&key_name).unwrap(),
                                &api_key,
                            );
                            // Link default assistant to this provider
                            if let Ok(Some(default_assistant)) =
                                db::ops::assistant::get_default_assistant(&mut conn)
                            {
                                let changeset = AssistantUpdate {
                                    provider_id: Some(Some(provider.id.clone())),
                                    model_id: model.map(Some),
                                    updated_at: Some(now),
                                    ..Default::default()
                                };
                                let _ = db::ops::assistant::update_assistant(
                                    &mut conn,
                                    &default_assistant.id,
                                    &changeset,
                                );
                            }
                        }
                    }
                }
            }

            app.manage(AppDb(pool));
            app.manage(AppTools(tools::ToolRegistry::new()));
            app.manage(ApprovalWaiters(Mutex::new(HashMap::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat,
            set_secret, get_secret, delete_secret,
            list_conversations, create_conversation,
            update_conversation_title, toggle_pin_conversation, delete_conversation,
            load_messages, delete_message,
            list_assistants, create_assistant, update_assistant, delete_assistant,
            list_providers, create_provider, update_provider, delete_provider,
            set_provider_key, get_provider_key_exists, fetch_provider_models,
            list_projects, create_project, update_project, delete_project,
            list_conversations_by_project,
            get_preference, set_preference,
            approve_tool_call, deny_tool_call, respond_to_ask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, role: &str, content: &str) -> Message {
        Message {
            id: id.into(),
            conversation_id: "c".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 0,
        }
    }

    #[test]
    fn test_take_bytes_ascii() {
        assert_eq!(take_bytes_at_char_boundary("hello world", 5), "hello");
    }

    #[test]
    fn test_take_bytes_short_string() {
        assert_eq!(take_bytes_at_char_boundary("hi", 10), "hi");
    }

    #[test]
    fn test_take_bytes_multibyte() {
        let s = "hello世界";
        assert_eq!(take_bytes_at_char_boundary(s, 5), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 6), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 7), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 8), "hello世");
        assert_eq!(take_bytes_at_char_boundary(s, 11), "hello世界");
    }

    #[test]
    fn test_take_bytes_zero() {
        assert_eq!(take_bytes_at_char_boundary("hello", 0), "");
    }

    #[test]
    fn test_build_messages_with_system() {
        let history = vec![msg("1", "user", "hi")];
        let msgs = build_messages("You are a helper", &history, "new question");
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[0].content, "You are a helper");
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content, "hi");
        assert_eq!(msgs[2].role, "user");
        assert_eq!(msgs[2].content, "new question");
    }

    #[test]
    fn test_build_messages_empty_system() {
        let msgs = build_messages("", &[], "hello");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
    }

    #[test]
    fn test_build_messages_filters_roles() {
        let history = vec![
            msg("1", "user", "q"),
            msg("2", "tool", "result"),
            msg("3", "assistant", "a"),
        ];
        let msgs = build_messages("sys", &history, "new");
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content, "q");
        assert_eq!(msgs[2].role, "assistant");
        assert_eq!(msgs[2].content, "a");
        assert_eq!(msgs[3].role, "user");
        assert_eq!(msgs[3].content, "new");
    }

    fn chat_msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    #[test]
    fn test_trim_no_trim_needed() {
        let mut msgs = vec![chat_msg("system", "sys"), chat_msg("user", "hi")];
        trim_to_context_limit(&mut msgs, 100_000, 5);
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn test_trim_preserves_system() {
        let mut msgs = vec![chat_msg("system", &"s".repeat(1000))];
        for i in 0..20 {
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            msgs.push(chat_msg(role, &"x".repeat(200)));
        }
        trim_to_context_limit(&mut msgs, 500, 2);
        assert_eq!(msgs[0].role, "system");
        assert!(msgs.len() < 21);
    }

    #[test]
    fn test_trim_keeps_recent() {
        let mut msgs = Vec::new();
        for i in 0..10 {
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            msgs.push(chat_msg(role, &format!("msg-{i}")));
        }
        trim_to_context_limit(&mut msgs, 10, 2);
        let last = msgs.last().unwrap();
        assert_eq!(last.content, "msg-9");
    }

    #[test]
    fn test_provider_secret_name() {
        assert_eq!(
            provider_secret_name("my-provider-1"),
            "PROVIDER_MY_PROVIDER_1_KEY"
        );
    }
}
