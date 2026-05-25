mod client;
mod db;
mod keyring;
mod provider;
mod secrets;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use db::DbPool;
use db::models::conversation::Conversation;
use db::models::message::{Message, NewMessage};
use provider::openai_compat;
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

// --- Secret commands ---

#[tauri::command]
async fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0
        .set(&SecretScope::Global, &name, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0
        .get(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let mgr = app.state::<AppSecrets>();
    let name = SecretName::new(&key).map_err(|e| e.to_string())?;
    mgr.0
        .delete(&SecretScope::Global, &name)
        .map_err(|e| e.to_string())
}

// --- Conversation commands ---

#[tauri::command]
async fn list_conversations(
    app: tauri::AppHandle,
    archived: bool,
) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations(&mut conn, archived).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_conversation(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        db::ops::conversation::create_conversation(
            &mut conn,
            &id,
            title.as_deref(),
            None,
            now_ms(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_conversation_title(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_title(&mut conn, &id, &title, now_ms())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn toggle_pin_conversation(
    app: tauri::AppHandle,
    id: String,
) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::toggle_pin(&mut conn, &id, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::delete_conversation(&mut conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Message commands ---

#[tauri::command]
async fn load_messages(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::list_messages(&mut conn, &conversation_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_message(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_message(&mut conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Chat command (with persistence) ---

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();

    let base_url = secrets
        .0
        .get(&SecretScope::Global, &SecretName::new("API_BASE").unwrap())
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_API_BASE").ok())
        .unwrap_or_else(|| "https://api.openai.com/v1".into());
    let base_url = base_url.trim_end_matches('/').to_string();

    let api_key = secrets
        .0
        .get(&SecretScope::Global, &SecretName::new("API_KEY").unwrap())
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_API_KEY").ok())
        .ok_or("API Key not configured. Go to Settings to set it.")?;

    let model = secrets
        .0
        .get(&SecretScope::Global, &SecretName::new("MODEL").unwrap())
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_MODEL").ok())
        .unwrap_or_else(|| "gpt-4.1-mini".into());

    let pool = app.state::<AppDb>().0.clone();
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();

    // Persist user message
    {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg = message.clone();
        let msg_id = user_msg_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let new_msg = NewMessage {
                id: &msg_id,
                conversation_id: &conv_id,
                role: "user",
                content: &msg,
                provider_id: None,
                model_id: None,
                input_tokens: None,
                output_tokens: None,
                tool_calls: None,
                tool_call_id: None,
                sort_order: 0,
                created_at: now,
            };
            db::ops::message::insert_message(&mut conn, &new_msg).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    // Create placeholder assistant message
    {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let msg_id = assistant_msg_id.clone();
        let model_clone = model.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let new_msg = NewMessage {
                id: &msg_id,
                conversation_id: &conv_id,
                role: "assistant",
                content: "",
                provider_id: None,
                model_id: Some(&model_clone),
                input_tokens: None,
                output_tokens: None,
                tool_calls: None,
                tool_call_id: None,
                sort_order: 0,
                created_at: now,
            };
            db::ops::message::insert_message(&mut conn, &new_msg).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    // Stream from LLM
    let mut stream = openai_compat::stream_chat(&base_url, &api_key, &model, &message)
        .await
        .map_err(|e| e.to_string())?;

    let mut full_content = String::new();

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(content) => {
                full_content.push_str(&content);
                app.emit(
                    "chat-stream",
                    serde_json::json!({
                        "content": content,
                        "done": false,
                        "message_id": &assistant_msg_id,
                    }),
                )
                .map_err(|e| e.to_string())?;
            }
            Err(e) => {
                // Still save partial content on error
                let pool = pool.clone();
                let msg_id = assistant_msg_id.clone();
                let content = full_content.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::message::update_content(&mut conn, &msg_id, &content);
                    }
                })
                .await;
                return Err(e.to_string());
            }
        }
    }

    // Persist final assistant content
    {
        let pool = pool.clone();
        let msg_id = assistant_msg_id.clone();
        let content = full_content;
        tokio::task::spawn_blocking(move || {
            if let Ok(mut conn) = pool.get() {
                let _ = db::ops::message::update_content(&mut conn, &msg_id, &content);
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    app.emit(
        "chat-stream",
        serde_json::json!({
            "content": "",
            "done": true,
            "message_id": &assistant_msg_id,
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
            let mgr = SecretsManager::new(data_dir.clone());
            app.manage(AppSecrets(Arc::new(mgr)));

            let db_path = data_dir.join("meridian.db");
            let pool = db::init_db(db_path.to_str().expect("invalid db path"));
            app.manage(AppDb(pool));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat,
            set_secret,
            get_secret,
            delete_secret,
            list_conversations,
            create_conversation,
            update_conversation_title,
            toggle_pin_conversation,
            delete_conversation,
            load_messages,
            delete_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
