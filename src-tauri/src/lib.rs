mod client;
mod db;
mod keyring;
mod provider;
mod secrets;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use db::DbPool;
use db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use db::models::conversation::Conversation;
use db::models::message::{Message, NewMessage};
use provider::{ChatMessage, ChatParams, ChatProvider};
use secrets::{SecretName, SecretScope, SecretsManager};
use tauri::{Emitter, Manager};

struct AppSecrets(Arc<SecretsManager>);
struct AppDb(DbPool);

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
        msgs.push(ChatMessage {
            role: "system".into(),
            content: system_prompt.into(),
        });
    }
    for m in history {
        if m.role == "user" || m.role == "assistant" {
            msgs.push(ChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            });
        }
    }
    msgs.push(ChatMessage {
        role: "user".into(),
        content: user_message.into(),
    });
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

fn resolve_provider_config(
    secrets: &SecretsManager,
    assistant: Option<&Assistant>,
) -> Result<(String, String, String, String), String> {
    let get_secret = |key: &str| -> Option<String> {
        secrets
            .get(&SecretScope::Global, &SecretName::new(key).unwrap())
            .ok()
            .flatten()
    };

    let provider_type = assistant
        .and_then(|a| a.provider_id.as_deref())
        .map(|_| get_secret("PROVIDER_TYPE").unwrap_or_else(|| "openai".into()))
        .unwrap_or_else(|| get_secret("PROVIDER_TYPE").unwrap_or_else(|| "openai".into()));

    let base_url = get_secret("API_BASE")
        .or_else(|| std::env::var("MERIDIAN_API_BASE").ok())
        .unwrap_or_else(|| "https://api.openai.com/v1".into());
    let base_url = base_url.trim_end_matches('/').to_string();

    let api_key = get_secret("API_KEY")
        .or_else(|| std::env::var("MERIDIAN_API_KEY").ok())
        .ok_or("API Key not configured. Go to Settings to set it.")?;

    let model = assistant
        .and_then(|a| a.model_id.clone())
        .or_else(|| get_secret("MODEL"))
        .or_else(|| std::env::var("MERIDIAN_MODEL").ok())
        .unwrap_or_else(|| "gpt-4.1-mini".into());

    Ok((provider_type, base_url, api_key, model))
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
async fn create_conversation(app: tauri::AppHandle, title: Option<String>) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let default_assistant = db::ops::assistant::get_default_assistant(&mut conn)
            .map_err(|e| e.to_string())?;
        let assistant_id = default_assistant.as_ref().map(|a| a.id.as_str());
        db::ops::conversation::create_conversation(&mut conn, &id, title.as_deref(), assistant_id, now_ms())
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

// --- Chat command (with history + provider + title generation) ---

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let pool = app.state::<AppDb>().0.clone();

    // Load conversation + assistant + history
    let (assistant, history, conv_title) = {
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
            Ok::<_, String>((assistant, history, conv.title))
        }).await.map_err(|e| e.to_string())??
    };

    // Resolve provider config
    let (provider_type, base_url, api_key, model) =
        resolve_provider_config(&secrets.0, assistant.as_ref())?;

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

    // Stream from provider
    let mut stream = provider.stream_chat(chat_messages, params.clone())
        .await.map_err(|e| e.to_string())?;

    let mut full_content = String::new();

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

    app.emit("chat-stream", serde_json::json!({
        "content": "", "done": true, "message_id": &assistant_msg_id,
    })).map_err(|e| e.to_string())?;

    // Auto-generate title if first message
    if conv_title.is_none() {
        let title_messages = vec![ChatMessage {
            role: "user".into(),
            content: format!(
                "Generate a short title (max 6 words, no quotes, no punctuation) for this conversation:\nUser: {}\nAssistant: {}",
                &message,
                &full_content[..full_content.len().min(300)]
            ),
        }];
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

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
            let mgr = SecretsManager::new(data_dir.clone());
            app.manage(AppSecrets(Arc::new(mgr)));

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

            app.manage(AppDb(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat,
            set_secret, get_secret, delete_secret,
            list_conversations, create_conversation,
            update_conversation_title, toggle_pin_conversation, delete_conversation,
            load_messages, delete_message,
            list_assistants, create_assistant, update_assistant, delete_assistant,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
