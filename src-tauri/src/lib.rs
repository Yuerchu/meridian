mod client;
mod db;
mod keyring;
mod provider;
mod secrets;

use std::sync::Arc;

use db::DbPool;
use provider::openai_compat;
use secrets::{SecretName, SecretScope, SecretsManager};
use tauri::{Emitter, Manager};

struct AppSecrets(Arc<SecretsManager>);
struct AppDb(DbPool);

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

#[tauri::command]
async fn chat(app: tauri::AppHandle, message: String) -> Result<(), String> {
    let mgr = app.state::<AppSecrets>();

    let base_url = mgr
        .0
        .get(
            &SecretScope::Global,
            &SecretName::new("API_BASE").unwrap(),
        )
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_API_BASE").ok())
        .unwrap_or_else(|| "https://api.openai.com/v1".into());

    let api_key = mgr
        .0
        .get(
            &SecretScope::Global,
            &SecretName::new("API_KEY").unwrap(),
        )
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_API_KEY").ok())
        .ok_or("API Key not configured. Go to Settings to set it.")?;

    let model = mgr
        .0
        .get(
            &SecretScope::Global,
            &SecretName::new("MODEL").unwrap(),
        )
        .ok()
        .flatten()
        .or_else(|| std::env::var("MERIDIAN_MODEL").ok())
        .unwrap_or_else(|| "gpt-4.1-mini".into());

    let mut stream = openai_compat::stream_chat(&base_url, &api_key, &model, &message)
        .await
        .map_err(|e| e.to_string())?;

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(content) => {
                app.emit(
                    "chat-stream",
                    serde_json::json!({"content": content, "done": false}),
                )
                .map_err(|e| e.to_string())?;
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    app.emit(
        "chat-stream",
        serde_json::json!({"content": "", "done": true}),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
