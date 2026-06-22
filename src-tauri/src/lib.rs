#[cfg(target_os = "android")]
mod android_bridge;
mod client;
mod db;
mod emoji;
mod files;
mod keyring;
mod mcp;
#[cfg(not(target_os = "android"))]
mod onebot;
mod platform;
mod provider;
mod secrets;
mod template;
mod tools;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use db::DbPool;
use db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use db::models::conversation::Conversation;
use db::models::mcp_server::{McpServer, McpServerUpdate, NewMcpServer};
use db::models::message::{Message, NewMessage};
use db::models::custom_tool::{CustomTool, CustomToolUpdate, NewCustomTool};
use db::models::emoji::{Emoji, NewEmoji};
use db::models::emoji_pack::{EmojiPack, NewEmojiPack};
use db::models::tool_category::{NewToolCategory, ToolCategory};
use db::models::tool_preset::{NewToolPreset, ToolPreset, ToolPresetUpdate};
use db::models::prompt_template::{NewPromptTemplate, PromptTemplate, PromptTemplateUpdate};
use db::models::provider::{NewProvider, Provider, ProviderUpdate};
use provider::models::ModelInfo;
use provider::{ChatMessage, ChatParams};
use secrets::{SecretName, SecretScope, SecretsManager};
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

pub(crate) struct AppSecrets(pub(crate) Arc<SecretsManager>);
pub(crate) struct AppDb(pub(crate) DbPool);
pub(crate) struct AppTools(pub(crate) Arc<tools::ToolRegistry>);
pub(crate) struct AppMcp(pub(crate) Arc<Mutex<mcp::McpManager>>);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ApprovalDecision {
    Approved,
    Denied(Option<String>),
    Response(String),
}

struct ApprovalWaiters(Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>);
struct ActiveChats(Mutex<HashMap<String, CancellationToken>>);

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

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub(crate) fn get_conn(pool: &DbPool) -> Result<db::PooledConn, String> {
    pool.get().map_err(|e| format!("db connection error: {e}"))
}

/// Build the file access policy for tool execution.
/// Desktop: unrestricted (legacy working_directory validation only).
/// Android: whitelist of authorized roots from preferences + system grants.
async fn build_file_access(pool: &DbPool) -> tools::FileAccess {
    #[cfg(target_os = "android")]
    {
        let pool = pool.clone();
        let prefs = tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().ok()?;
            let manage = db::ops::preference::get_preference(&mut conn, "android.manage_storage_enabled")
                .ok()
                .flatten();
            let saf = db::ops::preference::get_preference(&mut conn, "android.saf_roots")
                .ok()
                .flatten();
            Some((manage, saf))
        })
        .await
        .ok()
        .flatten();
        let (manage_pref, saf_pref) = prefs.unwrap_or((None, None));

        let mut roots = Vec::new();
        if manage_pref.as_deref() == Some("true")
            && android_bridge::is_manage_storage_granted().unwrap_or(false)
        {
            let shared = std::path::PathBuf::from("/storage/emulated/0");
            roots.push(tools::AccessRoot {
                virtual_prefix: "/storage/emulated/0".to_string(),
                kind: tools::RootKind::RealPath(shared.clone()),
            });
            roots.push(tools::AccessRoot {
                virtual_prefix: "/sdcard".to_string(),
                kind: tools::RootKind::RealPath(shared),
            });
        }
        if let Some(json) = saf_pref {
            if let Ok(entries) = serde_json::from_str::<Vec<platform::SafRootEntry>>(&json) {
                for e in entries {
                    roots.push(tools::AccessRoot {
                        virtual_prefix: e.virtual_prefix,
                        kind: tools::RootKind::SafTree { tree_uri: e.uri },
                    });
                }
            }
        }
        tools::FileAccess::Roots(roots)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = pool;
        tools::FileAccess::default()
    }
}

/// Describe accessible file roots for the system prompt so the model knows
/// what paths it may use. Empty string when not in roots mode.
fn file_access_prompt(file_access: &tools::FileAccess) -> String {
    let tools::FileAccess::Roots(roots) = file_access else {
        return String::new();
    };
    if roots.is_empty() {
        return "\n\n# File access\nNo file locations are currently authorized on this device. \
                If the user asks for file operations, tell them to grant access in \
                Settings (an authorized directory or 'All files access')."
            .to_string();
    }
    let mut out = String::from(
        "\n\n# File access\nYou can access files under these locations (use absolute paths):\n",
    );
    for root in roots {
        match &root.kind {
            tools::RootKind::RealPath(_) => {
                out.push_str(&format!("- {} (direct access)\n", root.virtual_prefix));
            }
            tools::RootKind::SafTree { .. } => {
                out.push_str(&format!(
                    "- {} (user-authorized directory; recursive search/glob unavailable)\n",
                    root.virtual_prefix
                ));
            }
        }
    }
    out
}

pub(crate) fn build_messages(
    system_prompt: &str,
    history: &[Message],
    user_message: &str,
) -> Vec<ChatMessage> {
    let mut msgs = Vec::new();
    if !system_prompt.is_empty() {
        msgs.push(ChatMessage { role: "system".into(), content: system_prompt.into(), reasoning_content: None, tool_calls: None, tool_call_id: None });
    }
    for m in history {
        match m.role.as_str() {
            "user" => msgs.push(ChatMessage::user(&m.content)),
            "assistant" => {
                let tool_calls = if m.schema_version >= 2 {
                    parse_openai_tool_calls(m.tool_calls.as_deref())
                } else {
                    m.tool_calls.as_deref()
                        .map(|tc| extract_tool_calls_from_blocks(tc))
                        .unwrap_or_default()
                };
                let reasoning = m.reasoning_content.clone();
                if !tool_calls.is_empty() {
                    msgs.push(ChatMessage::assistant_with_tools(&m.content, reasoning, tool_calls));
                } else {
                    msgs.push(ChatMessage { role: "assistant".into(), content: m.content.clone(), reasoning_content: reasoning, tool_calls: None, tool_call_id: None });
                }
            }
            "tool" => {
                if let Some(ref call_id) = m.tool_call_id {
                    msgs.push(ChatMessage::tool_result(call_id, &m.content));
                }
            }
            _ => {}
        }
    }
    msgs.push(ChatMessage::user(user_message));
    msgs
}

pub(crate) fn extract_tool_calls_from_blocks(blocks_json: &str) -> Vec<provider::ToolCall> {
    let blocks: Vec<serde_json::Value> = match serde_json::from_str(blocks_json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    blocks.iter().filter_map(|b| {
        if b.get("type")?.as_str()? != "tool_call" { return None; }
        let data = b.get("data")?;
        Some(provider::ToolCall {
            id: data.get("call_id")?.as_str()?.to_string(),
            name: data.get("tool_name")?.as_str()?.to_string(),
            arguments: data.get("arguments")?.as_str()?.to_string(),
        })
    }).collect()
}

pub(crate) fn parse_openai_tool_calls(json: Option<&str>) -> Vec<provider::ToolCall> {
    let Some(json) = json else { return vec![] };
    let arr: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    arr.iter().filter_map(|tc| {
        let func = tc.get("function")?;
        Some(provider::ToolCall {
            id: tc.get("id")?.as_str()?.to_string(),
            name: func.get("name")?.as_str()?.to_string(),
            arguments: func.get("arguments")?.as_str()?.to_string(),
        })
    }).collect()
}

pub(crate) fn serialize_tool_calls_openai(tool_calls: &[provider::ToolCall]) -> String {
    serde_json::to_string(
        &tool_calls.iter().map(|tc| serde_json::json!({
            "id": tc.id,
            "type": "function",
            "function": { "name": tc.name, "arguments": tc.arguments }
        })).collect::<Vec<_>>()
    ).unwrap_or_default()
}

pub(crate) fn resolve_file_uris_in_messages(messages: &mut [ChatMessage]) {
    for msg in messages.iter_mut() {
        if !msg.content.starts_with('[') { continue; }
        let Ok(mut parts) = serde_json::from_str::<Vec<serde_json::Value>>(&msg.content) else { continue };
        let mut changed = false;
        for part in parts.iter_mut() {
            let url = part.pointer("/image_url/url")
                .or_else(|| part.pointer("/file/url"))
                .and_then(|u| u.as_str())
                .map(String::from);
            if let Some(ref uri) = url {
                if let Some(path) = files::resolve_file_uri(uri) {
                    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
                    if let Ok(data_uri) = files::file_to_base64_data_uri(&path, &mime) {
                        if let Some(img_url) = part.pointer_mut("/image_url/url") {
                            *img_url = serde_json::Value::String(data_uri);
                            changed = true;
                        } else if let Some(file_url) = part.pointer_mut("/file/url") {
                            *file_url = serde_json::Value::String(data_uri);
                            changed = true;
                        }
                    }
                }
            }
        }
        if changed {
            if let Ok(json) = serde_json::to_string(&parts) {
                msg.content = json;
            }
        }
    }
}

fn estimate_tokens(content: &str) -> usize {
    content.chars().count() + 4
}

pub(crate) const MAX_STREAM_RETRIES: u32 = 5;
pub(crate) const STREAM_RETRY_BASE: std::time::Duration = std::time::Duration::from_millis(200);

pub(crate) fn is_context_window_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("context_length_exceeded") || e.contains("context window")
        || e.contains("maximum context length") || e.contains("too many tokens")
        || e.contains("exceeds the model")
}

pub(crate) fn is_retryable_stream_error(err: &str) -> bool {
    if is_context_window_error(err) { return false; }
    let e = err.to_lowercase();
    e.contains("timeout") || e.contains("network") || e.contains("connection")
        || e.contains("status: 429") || e.contains("status: 5")
        || e.contains("idle timeout")
}

pub(crate) fn trim_to_context_limit(messages: &mut Vec<ChatMessage>, context_limit: usize, keep_recent: usize) {
    let total_tokens: usize = messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    let safe_limit = context_limit * 4 / 5;
    if total_tokens <= safe_limit {
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

pub(crate) fn provider_secret_name(provider_id: &str) -> String {
    format!("PROVIDER_{}_KEY", provider_id.replace('-', "_").to_uppercase())
}

pub(crate) fn get_provider_api_key(secrets: &SecretsManager, provider_id: &str) -> Option<String> {
    let key = provider_secret_name(provider_id);
    secrets.get(&SecretScope::Global, &SecretName::new(&key).unwrap()).ok().flatten()
}

pub(crate) fn resolve_provider_config(
    secrets: &SecretsManager,
    pool: &DbPool,
    assistant: Option<&Assistant>,
) -> Result<(String, String, String, String, String), String> {
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
        return Ok((provider.provider_type, base_url, api_key, model, provider.api_format));
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
                return Ok((p.provider_type, base_url, api_key, model, p.api_format));
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
async fn update_message_content(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_content(&mut conn, &id, &content).map_err(|e| e.to_string())
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

#[tauri::command]
async fn delete_messages_from(app: tauri::AppHandle, conversation_id: String, from_sort_order: i32) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_messages_from(&mut conn, &conversation_id, from_sort_order)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rate_message(app: tauri::AppHandle, id: String, rating: Option<i32>) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_rating(&mut conn, &id, rating).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_conversation(app: tauri::AppHandle, conversation_id: String, format: String, output_path: Option<String>) -> Result<String, String> {
    let pool = app.state::<AppDb>().0.clone();
    let result: String = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let conv = db::ops::conversation::get_conversation(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        let messages = db::ops::message::list_messages(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        let system_prompt = conv.assistant_id.as_deref()
            .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok())
            .map(|a| a.system_prompt)
            .unwrap_or_default();

        fn msg_to_openai(m: &Message, all_msgs: &[Message]) -> serde_json::Value {
            let mut obj = serde_json::json!({ "role": m.role });
            match m.role.as_str() {
                "assistant" => {
                    if !m.content.is_empty() {
                        obj["content"] = serde_json::json!(m.content);
                    } else {
                        obj["content"] = serde_json::Value::Null;
                    }
                    if let Some(ref rc) = m.reasoning_content {
                        if !rc.is_empty() {
                            obj["reasoning_content"] = serde_json::json!(rc);
                        }
                    }
                    if let Some(ref tc_json) = m.tool_calls {
                        if m.schema_version >= 2 {
                            if let Ok(tcs) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json) {
                                if !tcs.is_empty() { obj["tool_calls"] = serde_json::json!(tcs); }
                            }
                        } else {
                            let tool_calls = extract_tool_calls_from_blocks(tc_json);
                            if !tool_calls.is_empty() {
                                obj["tool_calls"] = serde_json::json!(
                                    tool_calls.iter().map(|tc| serde_json::json!({
                                        "id": tc.id, "type": "function",
                                        "function": { "name": tc.name, "arguments": tc.arguments }
                                    })).collect::<Vec<_>>()
                                );
                            }
                            // Extract reasoning from v1 blocks
                            if m.reasoning_content.is_none() {
                                if let Ok(blocks) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json) {
                                    let thinking: String = blocks.iter()
                                        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("thinking"))
                                        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                                        .collect::<Vec<_>>().join("\n");
                                    if !thinking.is_empty() {
                                        obj["reasoning_content"] = serde_json::json!(thinking);
                                    }
                                }
                            }
                        }
                    }
                }
                "tool" => {
                    obj["content"] = serde_json::json!(m.content);
                    if let Some(ref cid) = m.tool_call_id {
                        obj["tool_call_id"] = serde_json::json!(cid);
                    }
                }
                _ => {
                    obj["content"] = serde_json::json!(m.content);
                }
            }
            obj
        }

        match format.as_str() {
            "sft" => {
                let mut openai_msgs: Vec<serde_json::Value> = Vec::new();
                if !system_prompt.is_empty() {
                    openai_msgs.push(serde_json::json!({"role": "system", "content": system_prompt}));
                }
                for m in &messages {
                    openai_msgs.push(msg_to_openai(m, &messages));
                }
                serde_json::to_string(&serde_json::json!({"messages": openai_msgs}))
                    .map_err(|e| e.to_string())
            }
            "dpo" => {
                let mut lines = Vec::new();
                // Build context prefix (system + user messages up to each rated assistant msg)
                for (i, m) in messages.iter().enumerate() {
                    if m.role != "assistant" || m.rating.is_none() { continue; }
                    // Find the user message that prompted this response
                    let prompt_msgs: Vec<serde_json::Value> = {
                        let mut p = Vec::new();
                        if !system_prompt.is_empty() {
                            p.push(serde_json::json!({"role": "system", "content": system_prompt}));
                        }
                        // Walk backwards from this assistant message to find the preceding user message
                        let user_idx = messages[..i].iter().rposition(|m| m.role == "user");
                        if let Some(ui) = user_idx {
                            p.push(serde_json::json!({"role": "user", "content": messages[ui].content}));
                        }
                        p
                    };
                    let response = msg_to_openai(m, &messages);
                    let rating = m.rating.unwrap_or(0);
                    lines.push(serde_json::json!({
                        "prompt": prompt_msgs,
                        "response": [response],
                        "rating": rating,
                    }));
                }
                let result: Vec<String> = lines.iter()
                    .map(|l| serde_json::to_string(l).unwrap_or_default())
                    .collect();
                Ok(result.join("\n"))
            }
            _ => Err(format!("Unknown export format: {format}")),
        }
    }).await.map_err(|e| e.to_string())??;

    if let Some(ref path) = output_path {
        std::fs::write(path, &result).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
async fn upload_file(app: tauri::AppHandle, conversation_id: String, file_path: String) -> Result<serde_json::Value, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let src = std::path::Path::new(&file_path);
    let uri = files::store_file(&app_data_dir, &conversation_id, src)?;

    let mime = mime_guess::from_path(src).first_or_octet_stream().to_string();
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();

    let content_part = if mime.starts_with("image/") {
        serde_json::json!({
            "type": "image_url",
            "image_url": { "url": uri }
        })
    } else {
        serde_json::json!({
            "type": "file",
            "file": { "url": uri, "mime_type": mime, "name": name }
        })
    };

    Ok(content_part)
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
            enabled_tools: None,
            thinking_enabled: 0,
            thinking_budget: None,
            tool_preset_id: None,
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
    provider_id: Option<Option<String>>,
    model_id: Option<Option<String>>,
    temperature: Option<Option<f32>>,
    context_limit: Option<i32>,
    enabled_tools: Option<Option<String>>,
    thinking_enabled: Option<i32>,
    thinking_budget: Option<Option<i32>>,
    tool_preset_id: Option<Option<String>>,
) -> Result<Assistant, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = AssistantUpdate {
            name,
            system_prompt,
            provider_id,
            model_id,
            temperature,
            context_limit,
            enabled_tools,
            thinking_enabled,
            thinking_budget,
            tool_preset_id,
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
    api_format: Option<String>,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let format = api_format.as_deref().unwrap_or("chat_completions");
        db::ops::provider::create_provider(&mut conn, &NewProvider {
            id: &id,
            name: &name,
            provider_type: &provider_type,
            base_url: &base_url,
            is_enabled: 1,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            api_format: format,
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
    api_format: Option<String>,
) -> Result<Provider, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let changeset = ProviderUpdate {
            name,
            provider_type,
            base_url,
            is_enabled,
            api_format,
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
async fn deny_tool_call(app: tauri::AppHandle, call_id: String, reason: Option<String>) -> Result<(), String> {
    let waiters = app.state::<ApprovalWaiters>();
    let mut map = waiters.0.lock().await;
    if let Some(tx) = map.remove(&call_id) {
        let _ = tx.send(ApprovalDecision::Denied(reason));
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
async fn create_project(
    app: tauri::AppHandle,
    name: String,
    path: Option<String>,
    source_type: Option<String>,
    source_id: Option<String>,
    assistant_id: Option<String>,
    description: Option<String>,
) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let st = source_type.as_deref().unwrap_or("local");
        db::ops::project::create_project(&mut conn, &db::models::project::NewProject {
            id: &id,
            name: &name,
            path: path.as_deref(),
            source_type: st,
            source_id: source_id.as_deref(),
            assistant_id: assistant_id.as_deref(),
            description: description.as_deref(),
            created_at: now,
            updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_project(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    path: Option<String>,
    assistant_id: Option<String>,
    description: Option<String>,
) -> Result<db::models::project::Project, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::project::update_project(&mut conn, &id, &db::models::project::ProjectUpdate {
            name,
            path: path.map(Some),
            assistant_id: assistant_id.map(Some),
            description: description.map(Some),
            updated_at: Some(now_ms()),
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

// --- Memory commands ---

#[tauri::command]
async fn list_memories(app: tauri::AppHandle, project_id: String) -> Result<Vec<db::models::memory::Memory>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::list_memories(&mut conn, &project_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_memory(
    app: tauri::AppHandle,
    project_id: String,
    key: String,
    content: String,
    memory_type: Option<String>,
) -> Result<db::models::memory::Memory, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let mt = memory_type.as_deref().unwrap_or("general");
        db::ops::memory::upsert_memory(&mut conn, &db::models::memory::NewMemory {
            id: &id,
            project_id: &project_id,
            key: &key,
            content: &content,
            memory_type: mt,
            created_at: now,
            updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_memory(
    app: tauri::AppHandle,
    id: String,
    content: Option<String>,
    memory_type: Option<String>,
) -> Result<db::models::memory::Memory, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::update_memory(&mut conn, &id, &db::models::memory::MemoryUpdate {
            content,
            memory_type,
            updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_memory(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::memory::delete_memory(&mut conn, &id).map_err(|e| e.to_string())
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

// --- MCP commands ---

#[tauri::command]
async fn list_mcp_servers(app: tauri::AppHandle) -> Result<Vec<McpServer>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::list_mcp_servers(&mut conn).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_mcp_server(
    app: tauri::AppHandle,
    name: String,
    transport_type: String,
    command: Option<String>,
    args: Option<String>,
    env: Option<String>,
    url: Option<String>,
    headers: Option<String>,
) -> Result<McpServer, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        db::ops::mcp_server::create_mcp_server(&mut conn, &NewMcpServer {
            id: &id, name: &name, transport_type: &transport_type,
            command: command.as_deref(), args: args.as_deref(),
            env: env.as_deref(), url: url.as_deref(),
            headers: headers.as_deref(),
            is_enabled: 1, sort_order: 0, created_at: now, updated_at: now,
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_mcp_server(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    transport_type: Option<String>,
    command: Option<Option<String>>,
    args: Option<Option<String>>,
    env: Option<Option<String>>,
    url: Option<Option<String>>,
    headers: Option<Option<String>>,
    is_enabled: Option<i32>,
) -> Result<McpServer, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::update_mcp_server(&mut conn, &id, &McpServerUpdate {
            name, transport_type, command, args, env, url, headers, is_enabled,
            updated_at: Some(now_ms()),
        }).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    {
        let mcp = app.state::<AppMcp>();
        mcp.0.lock().await.disconnect_server(&id).await;
    }
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::delete_mcp_server(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn connect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let server = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::mcp_server::get_mcp_server(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;

    let mcp = app.state::<AppMcp>();
    mcp.0.lock().await.connect_server(&server).await
}

#[tauri::command]
async fn disconnect_mcp_server(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mcp = app.state::<AppMcp>();
    mcp.0.lock().await.disconnect_server(&id).await;
    Ok(())
}

#[tauri::command]
async fn list_mcp_tools(app: tauri::AppHandle, server_id: Option<String>) -> Result<Vec<mcp::McpToolDef>, String> {
    let mcp = app.state::<AppMcp>();
    let mgr = mcp.0.lock().await;
    if let Some(sid) = server_id {
        Ok(mgr.tool_defs_for_server(&sid).into_iter().cloned().collect())
    } else {
        Ok(mgr.tools.iter().cloned().collect::<Vec<_>>())
    }
}

#[tauri::command]
async fn list_all_tool_names(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let tool_registry = app.state::<AppTools>();
    let mcp = app.state::<AppMcp>();
    let mgr = mcp.0.lock().await;

    let mut result: Vec<serde_json::Value> = tool_registry.0.definitions().iter().map(|t| {
        serde_json::json!({"name": t.name, "description": t.description, "source": "builtin"})
    }).collect();

    for t in &mgr.tools {
        result.push(serde_json::json!({
            "name": t.qualified_name, "description": t.description,
            "source": "mcp", "server_name": t.server_name
        }));
    }

    Ok(result)
}

// --- Stop chat command ---

#[tauri::command]
async fn stop_chat(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let chats = app.state::<ActiveChats>();
    if let Some(token) = chats.0.lock().await.get(&conversation_id) {
        token.cancel();
    }
    Ok(())
}

// --- OneBot commands ---

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn get_onebot_status(app: tauri::AppHandle) -> Result<onebot::OneBotStatus, String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    Ok(server.status())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn get_onebot_config(app: tauri::AppHandle) -> Result<onebot::OneBotConfig, String> {
    let pool = app.state::<AppDb>().0.clone();
    Ok(onebot::load_config(&pool))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn save_onebot_config(app: tauri::AppHandle, config: onebot::OneBotConfig) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    onebot::save_config(&pool, &config)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn start_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let config = onebot::load_config(&pool);

    let ob = app.state::<onebot::AppOneBot>();
    let mut server_guard = ob.0.lock().await;

    // Recreate server with fresh config
    let new_server = onebot::OneBotServer::new(
        pool,
        app.state::<AppSecrets>().0.clone(),
        app.state::<AppTools>().0.clone(),
        app.state::<AppMcp>().0.clone(),
        config,
    );
    new_server.start()?;
    *server_guard = new_server;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn stop_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    server.stop();
    Ok(())
}

// --- Stream consumption helper ---

pub(crate) struct StreamResult {
    pub(crate) text: String,
    pub(crate) reasoning: String,
    pub(crate) tool_calls: Vec<provider::ToolCall>,
    pub(crate) usage: Option<provider::TokenUsage>,
    pub(crate) finish_reason: Option<String>,
}

const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

async fn consume_stream(
    mut stream: provider::ChatStream,
    app: &tauri::AppHandle,
    cancel: &tokio_util::sync::CancellationToken,
    message_id: &str,
) -> Result<StreamResult, String> {
    use futures::StreamExt;

    let mut text = String::new();
    let mut reasoning = String::new();
    let mut tool_acc: Vec<(String, String, String)> = Vec::new();
    let mut usage = None;
    let mut finish_reason = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => { break; }
            chunk = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()) => {
                match chunk {
                    Err(_) => {
                        return Err("Stream idle timeout".to_string());
                    }
                    Ok(Some(Ok(provider::StreamEvent::Text(s)))) => {
                        text.push_str(&s);
                        app.emit("chat-stream", serde_json::json!({
                            "content": s, "done": false, "message_id": message_id,
                        })).map_err(|e| e.to_string())?;
                    }
                    Ok(Some(Ok(provider::StreamEvent::Reasoning(s)))) => {
                        reasoning.push_str(&s);
                        app.emit("chat-stream", serde_json::json!({
                            "type": "reasoning", "content": s,
                            "done": false, "message_id": message_id,
                        })).map_err(|e| e.to_string())?;
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallStart { index, id, name }))) => {
                        while tool_acc.len() <= index {
                            tool_acc.push((String::new(), String::new(), String::new()));
                        }
                        tool_acc[index] = (id, name, String::new());
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallDelta { index, arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2.push_str(&arguments);
                        }
                    }
                    Ok(Some(Ok(provider::StreamEvent::ToolCallDelta { index, arguments }))) => {
                        if let Some(entry) = tool_acc.get_mut(index) {
                            entry.2 = arguments;
                        }
                    }
                    Ok(Some(Ok(provider::StreamEvent::Done { usage: u, finish_reason: fr }))) => {
                        usage = u;
                        finish_reason = fr;
                    }
                    Ok(Some(Err(e))) => {
                        return Err(e.to_string());
                    }
                    Ok(None) => { break; }
                }
            }
        }
    }

    let tool_calls: Vec<provider::ToolCall> = if cancel.is_cancelled() {
        vec![]
    } else {
        tool_acc.into_iter()
            .filter(|(id, _, _)| !id.is_empty())
            .map(|(id, name, args)| provider::ToolCall { id, name, arguments: args })
            .collect()
    };

    Ok(StreamResult { text, reasoning, tool_calls, usage, finish_reason })
}

// --- Prompt Templates ---

#[tauri::command]
fn list_prompt_templates(app: tauri::AppHandle) -> Result<Vec<PromptTemplate>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::prompt_template::list_templates(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_prompt_template(
    app: tauri::AppHandle,
    name: String,
    category: String,
    template_text: String,
    description: Option<String>,
) -> Result<PromptTemplate, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    db::ops::prompt_template::create_template(&mut conn, &NewPromptTemplate {
        id: &id,
        name: &name,
        description: description.as_deref(),
        category: &category,
        template_text: &template_text,
        is_builtin: 0,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_prompt_template(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    category: Option<String>,
    template_text: Option<String>,
) -> Result<PromptTemplate, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::prompt_template::update_template(&mut conn, &id, &PromptTemplateUpdate {
        name,
        description,
        category,
        template_text,
        updated_at: Some(now_ms()),
        ..Default::default()
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_prompt_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::prompt_template::delete_template(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_template_variables() -> Result<serde_json::Value, String> {
    let vars: Vec<serde_json::Value> = template::available_variables()
        .into_iter()
        .map(|v| serde_json::json!({
            "name": v.name,
            "description_en": v.description_en,
            "description_zh": v.description_zh,
        }))
        .collect();
    Ok(serde_json::json!(vars))
}

// --- Emoji Packs ---

#[tauri::command]
fn list_emoji_packs(app: tauri::AppHandle) -> Result<Vec<EmojiPack>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::list_packs(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_emoji_pack(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
) -> Result<EmojiPack, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    emoji::ensure_pack_dir(&data_dir, &id)?;
    db::ops::emoji_pack::create_pack(&mut conn, &NewEmojiPack {
        id: &id,
        name: &name,
        description: description.as_deref(),
        cover_image: None,
        is_builtin: 0,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_emoji_pack(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let pack = db::ops::emoji_pack::get_pack(&mut conn, &id).map_err(|e| e.to_string())?;
    if pack.is_builtin == 1 {
        return Err("Cannot delete built-in emoji pack".into());
    }
    db::ops::emoji_pack::delete_pack(&mut conn, &id).map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    emoji::delete_pack_dir(&data_dir, &id);
    Ok(())
}

#[tauri::command]
fn list_emojis(app: tauri::AppHandle, pack_id: String) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::list_by_pack(&mut conn, &pack_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_emojis(
    app: tauri::AppHandle,
    pack_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let now = now_ms();
    let count = db::ops::emoji::count_by_pack(&mut conn, &pack_id)
        .map_err(|e| e.to_string())? as i32;

    let mut imported = Vec::new();
    for (i, path_str) in file_paths.iter().enumerate() {
        let source = std::path::Path::new(path_str);
        let (file_name, format) = emoji::import_file(&data_dir, &pack_id, source)?;
        let emoji_name = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("emoji")
            .to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let e = db::ops::emoji::create_emoji(&mut conn, &NewEmoji {
            id: &id,
            pack_id: &pack_id,
            name: &emoji_name,
            tags: None,
            file_name: &file_name,
            file_format: &format,
            sort_order: count + i as i32,
            created_at: now,
        }).map_err(|e| e.to_string())?;
        imported.push(e);
    }
    Ok(imported)
}

#[tauri::command]
fn delete_emoji(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let e = db::ops::emoji::get_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    db::ops::emoji::delete_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    emoji::delete_file(&data_dir, &e.pack_id, &e.file_name);
    Ok(())
}

#[tauri::command]
fn rename_emoji(app: tauri::AppHandle, id: String, new_name: String) -> Result<Emoji, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::rename_emoji(&mut conn, &id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_emojis(app: tauri::AppHandle, query: String) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::search_emojis(&mut conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn assign_emoji_pack(
    app: tauri::AppHandle,
    assistant_id: String,
    pack_id: String,
) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::assign_pack(&mut conn, &assistant_id, &pack_id, now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn unassign_emoji_pack(
    app: tauri::AppHandle,
    assistant_id: String,
    pack_id: String,
) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::unassign_pack(&mut conn, &assistant_id, &pack_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_assistant_emoji_packs(
    app: tauri::AppHandle,
    assistant_id: String,
) -> Result<Vec<EmojiPack>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::list_packs_for_assistant(&mut conn, &assistant_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_emoji_file_url(app: tauri::AppHandle, emoji_id: String) -> Result<String, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let e = db::ops::emoji::get_emoji(&mut conn, &emoji_id).map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = emoji::emoji_path(&data_dir, &e.pack_id, &e.file_name);
    let bytes = std::fs::read(&path).map_err(|err| format!("Cannot read emoji file: {err}"))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let mime = match e.file_format.as_str() {
        "gif" => "image/gif",
        "apng" | "png" => "image/png",
        "webp" => "image/webp",
        "jpg" => "image/jpeg",
        "bmp" => "image/bmp",
        "lottie" => "application/json",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{b64}"))
}

// --- Tool System (categories, custom tools, presets) ---

#[tauri::command]
fn list_tool_categories(app: tauri::AppHandle) -> Result<Vec<ToolCategory>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_category::list_categories(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_custom_tools(app: tauri::AppHandle) -> Result<Vec<CustomTool>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::custom_tool::list_tools(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_custom_tool(
    app: tauri::AppHandle,
    name: String,
    description: String,
    command: String,
    category_id: Option<String>,
    parameters_schema: Option<String>,
    args_template: Option<String>,
    working_directory: Option<String>,
    timeout_ms: Option<i32>,
    permission: Option<String>,
) -> Result<CustomTool, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let schema = parameters_schema.as_deref().unwrap_or(r#"{"type":"object","properties":{}}"#);
    let perm = permission.as_deref().unwrap_or("ask");
    db::ops::custom_tool::create_tool(&mut conn, &NewCustomTool {
        id: &id,
        name: &name,
        description: &description,
        category_id: category_id.as_deref(),
        parameters_schema: schema,
        command: &command,
        args_template: args_template.as_deref(),
        working_directory: working_directory.as_deref(),
        timeout_ms,
        permission: perm,
        is_enabled: 1,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_custom_tool(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    description: Option<String>,
    command: Option<String>,
    category_id: Option<Option<String>>,
    parameters_schema: Option<String>,
    args_template: Option<Option<String>>,
    working_directory: Option<Option<String>>,
    timeout_ms: Option<Option<i32>>,
    permission: Option<String>,
    is_enabled: Option<i32>,
) -> Result<CustomTool, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::custom_tool::update_tool(&mut conn, &id, &CustomToolUpdate {
        name,
        description,
        command,
        category_id,
        parameters_schema,
        args_template,
        working_directory,
        timeout_ms,
        permission,
        is_enabled,
        updated_at: Some(now_ms()),
        ..Default::default()
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_custom_tool(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::custom_tool::delete_tool(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_tool_presets(app: tauri::AppHandle) -> Result<Vec<ToolPreset>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::list_presets(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_tool_preset(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
    tool_names: String,
) -> Result<ToolPreset, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    db::ops::tool_preset::create_preset(&mut conn, &NewToolPreset {
        id: &id,
        name: &name,
        description: description.as_deref(),
        icon: None,
        tool_names: &tool_names,
        is_builtin: 0,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_tool_preset(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    tool_names: Option<String>,
) -> Result<ToolPreset, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::update_preset(&mut conn, &id, &ToolPresetUpdate {
        name,
        description,
        tool_names,
        updated_at: Some(now_ms()),
        ..Default::default()
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_tool_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::delete_preset(&mut conn, &id).map_err(|e| e.to_string())
}

// --- Chat command (with agent loop + tools + approval) ---

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    conversation_id: String,
    message: String,
    model_override: Option<String>,
    provider_override: Option<String>,
    thinking_level: Option<String>,
    assistant_id: Option<String>,
) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let pool = app.state::<AppDb>().0.clone();

    let cancel = CancellationToken::new();
    {
        let chats = app.state::<ActiveChats>();
        chats.0.lock().await.insert(conversation_id.clone(), cancel.clone());
    }

    // Load conversation + assistant + history + project path
    let (assistant, history, conv_title, project_path, project_id) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        let aid_override = assistant_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let effective_aid = aid_override.as_deref()
                .or(conv.assistant_id.as_deref());
            let assistant = effective_aid
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let project = conv.project_id.as_deref()
                .and_then(|pid| db::ops::project::get_project(&mut conn, pid).ok());
            let project_path = project.as_ref().and_then(|p| p.path.clone());
            let project_id = project.as_ref().map(|p| p.id.clone());
            Ok::<_, String>((assistant, history, conv.title, project_path, project_id))
        }).await.map_err(|e| e.to_string())??
    };

    // Resolve provider config (with optional overrides)
    let (mut provider_type, mut base_url, mut api_key, model, mut api_format) =
        resolve_provider_config(&secrets.0, &pool, assistant.as_ref())?;

    let model = model_override.unwrap_or(model);

    if let Some(ref pid) = provider_override {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        let secrets2 = secrets.0.clone();
        let (pt, bu, ak, af) = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2)?;
            let p = db::ops::provider::get_provider(&mut conn, &pid2).map_err(|e| e.to_string())?;
            let ak = get_provider_api_key(&secrets2, &pid2)
                .ok_or_else(|| format!("API Key not set for provider '{}'", p.name))?;
            Ok::<_, String>((p.provider_type, p.base_url.trim_end_matches('/').to_string(), ak, p.api_format))
        }).await.map_err(|e| e.to_string())??;
        provider_type = pt;
        base_url = bu;
        api_key = ak;
        api_format = af;
    }

    let provider = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    // Build messages with history (resolve template variables in system prompt)
    let file_access = build_file_access(&pool).await;
    let raw_prompt = assistant.as_ref().map(|a| a.system_prompt.as_str()).unwrap_or("");
    let user_name = {
        let pool2 = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            db::ops::preference::get_preference(&mut conn, "user_name").ok().flatten()
        }).await.ok().flatten()
    };
    let mut tmpl_ctx = template::build_context(
        assistant.as_ref().map(|a| a.name.as_str()),
        user_name.as_deref(),
    );
    if let Some(ref a) = assistant {
        let pool2 = pool.clone();
        let aid = a.id.clone();
        let emoji_names: Option<String> = tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            let pack_ids = db::ops::emoji_pack::list_assigned_pack_ids(&mut conn, &aid).ok()?;
            if pack_ids.is_empty() { return None; }
            let emojis = db::ops::emoji::list_emojis_for_packs(&mut conn, &pack_ids).ok()?;
            if emojis.is_empty() { return None; }
            let list: Vec<String> = emojis.iter().take(100).map(|e| {
                format!("[emoji:{}]", e.name)
            }).collect();
            Some(format!(
                "You can use stickers in your responses. Copy the EXACT syntax below (do NOT rename or translate):\n{}",
                list.join("\n")
            ))
        }).await.ok().flatten();
        if let Some(names) = emoji_names {
            tmpl_ctx.set("emoji_list", &names);
        }
    }
    let system_prompt_resolved = template::resolve(raw_prompt, &tmpl_ctx);
    let memory_block = if let Some(ref pid) = project_id {
        let pool2 = pool.clone();
        let pid2 = pid.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            let memories = db::ops::memory::list_memories(&mut conn, &pid2).ok()?;
            db::ops::memory::format_memory_block(&memories)
        }).await.ok().flatten()
    } else {
        None
    };
    let system_prompt = match memory_block {
        Some(ref mem) => format!("{}{}{}", system_prompt_resolved, file_access_prompt(&file_access), mem),
        None => format!("{}{}", system_prompt_resolved, file_access_prompt(&file_access)),
    };
    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000);
    let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);

    let mut chat_messages = build_messages(system_prompt.trim(), &history, &message);
    resolve_file_uris_in_messages(&mut chat_messages);
    trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);

    let (thinking_enabled, thinking_budget, thinking_effort) = {
        let a_enabled = assistant.as_ref().map(|a| a.thinking_enabled != 0).unwrap_or(false);
        let a_budget = assistant.as_ref().and_then(|a| a.thinking_budget);
        match thinking_level.as_deref() {
            Some("off") => (false, None, None),
            Some(level @ ("low" | "medium" | "high" | "max")) => (
                true, a_budget, Some(level.to_string()),
            ),
            _ => (a_enabled, a_budget, None),
        }
    };

    let params = ChatParams {
        model: model.clone(),
        temperature: assistant.as_ref().and_then(|a| a.temperature.map(|t| t as f64)),
        top_p: assistant.as_ref().and_then(|a| a.top_p.map(|t| t as f64)),
        max_tokens: assistant.as_ref().and_then(|a| a.max_tokens),
        thinking_enabled,
        thinking_budget,
        thinking_effort,
    };

    // Persist user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let mut assistant_msg_id = String::new();
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
                reasoning_content: None, rating: None, schema_version: 2,
            }).map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    // Get tool definitions (builtin + MCP) + per-assistant filtering + shell preference
    let tool_registry = app.state::<AppTools>();
    let mut all_tool_defs = tool_registry.0.definitions();
    {
        let mcp = app.state::<AppMcp>();
        let mgr = mcp.0.lock().await;
        all_tool_defs.extend(mgr.all_tool_definitions());
    }
    // Resolve tool filtering: preset > enabled_tools > all
    let enabled_tools: Option<Vec<String>> = if let Some(ref preset_id) = assistant.as_ref().and_then(|a| a.tool_preset_id.as_ref()) {
        let pool2 = pool.clone();
        let pid = preset_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool2).ok()?;
            let preset = db::ops::tool_preset::get_preset(&mut conn, &pid).ok()?;
            serde_json::from_str(&preset.tool_names).ok()
        }).await.ok().flatten()
    } else {
        assistant.as_ref()
            .and_then(|a| a.enabled_tools.as_ref())
            .and_then(|json| serde_json::from_str(json).ok())
    };
    let tool_defs: Vec<_> = if let Some(ref enabled) = enabled_tools {
        all_tool_defs.into_iter().filter(|t| enabled.contains(&t.name)).collect()
    } else {
        all_tool_defs
    };
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
        file_access,
        project_id,
        db_pool: Some(pool.clone()),
    };

    let mut total_input_tokens = 0i32;
    let mut total_output_tokens = 0i32;
    let mut last_assistant_text = String::new();

    // Unified streaming agent loop: each iteration creates a new assistant message
    loop {
        if cancel.is_cancelled() { break; }

        // Create a new assistant message for this iteration
        assistant_msg_id = uuid::Uuid::new_v4().to_string();
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
                    created_at: now, reasoning_content: None, rating: None, schema_version: 2,
                }).map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }).await.map_err(|e| e.to_string())??;
        }

        app.emit("chat-stream", serde_json::json!({
            "type": "turn_start", "message_id": &assistant_msg_id, "conversation_id": &conversation_id,
        })).map_err(|e| e.to_string())?;

        let result = {
            let mut _last_err = String::new();
            let mut attempt = 0u32;
            loop {
                if attempt > 0 {
                    tokio::time::sleep(crate::client::backoff(STREAM_RETRY_BASE, attempt as u64)).await;
                }
                let stream_result = provider.stream_chat_with_tools(
                    chat_messages.clone(), tool_defs.clone(), params.clone()
                ).await;
                let try_result = match stream_result {
                    Ok(stream) => consume_stream(stream, &app, &cancel, &assistant_msg_id).await,
                    Err(e) => Err(e.to_string()),
                };
                match try_result {
                    Ok(r) => break r,
                    Err(e) if is_context_window_error(&e) => {
                        let aggressive_keep = (keep_recent / 2).max(2);
                        trim_to_context_limit(&mut chat_messages, context_limit / 2, aggressive_keep);
                        let stream = provider.stream_chat_with_tools(
                            chat_messages.clone(), tool_defs.clone(), params.clone()
                        ).await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                        break consume_stream(stream, &app, &cancel, &assistant_msg_id)
                            .await.map_err(|e| format!("Context overflow recovery failed: {e}"))?;
                    }
                    Err(e) if is_retryable_stream_error(&e) && attempt < MAX_STREAM_RETRIES => {
                        _last_err = e;
                        attempt += 1;
                        continue;
                    }
                    Err(e) => return Err(e),
                }
            }
        };

        if let Some(ref u) = result.usage {
            total_input_tokens += u.prompt_tokens.unwrap_or(0);
            total_output_tokens += u.completion_tokens.unwrap_or(0);
        }

        let has_tool_calls = !result.tool_calls.is_empty()
            && !matches!(result.finish_reason.as_deref(), Some("length") | Some("max_tokens"));

        // Persist this iteration's assistant message in OpenAI format
        let tool_calls_json = if has_tool_calls {
            Some(serialize_tool_calls_openai(&result.tool_calls))
        } else {
            None
        };
        {
            let pool = pool.clone();
            let msg_id = assistant_msg_id.clone();
            let content = result.text.clone();
            let reasoning = if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) };
            let tc_json = tool_calls_json.clone();
            let inp = result.usage.as_ref().and_then(|u| u.prompt_tokens);
            let out = result.usage.as_ref().and_then(|u| u.completion_tokens);
            tokio::task::spawn_blocking(move || {
                if let Ok(mut conn) = pool.get() {
                    let _ = db::ops::message::update_assistant_message(
                        &mut conn, &msg_id, &content,
                        reasoning.as_deref(), tc_json.as_deref(), inp, out,
                    );
                }
            }).await.map_err(|e| e.to_string())?;
        }

        last_assistant_text = result.text.clone();

        if !has_tool_calls { break; }

        chat_messages.push(ChatMessage::assistant_with_tools(
            &result.text, if result.reasoning.is_empty() { None } else { Some(result.reasoning.clone()) }, result.tool_calls.clone()
        ));

        for tc in &result.tool_calls {
            if cancel.is_cancelled() { break; }

            app.emit("chat-stream", serde_json::json!({
                "type": "tool_call",
                "call_id": tc.id,
                "tool_name": tc.name,
                "arguments": tc.arguments,
                "message_id": &assistant_msg_id,
            })).map_err(|e| e.to_string())?;

            let tool_allowed = enabled_tools.as_ref()
                .map(|e| e.contains(&tc.name))
                .unwrap_or(true);
            let is_mcp = tc.name.starts_with("mcp__");
            let tool = if tool_allowed && !is_mcp { tool_registry.0.get(&tc.name) } else { None };
            let result = if !tool_allowed {
                "Tool not available for this assistant.".to_string()
            } else if is_mcp {
                let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let mcp = app.state::<AppMcp>();
                let mut mgr = mcp.0.lock().await;
                match mgr.call_tool(&tc.name, args).await {
                    Ok(output) => output,
                    Err(e) => format!("MCP error: {e}"),
                }
            } else if tc.name == "ask_user" {
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
                let (approved, deny_reason): (bool, Option<String>) = match permission {
                    tools::Permission::Always => (true, None),
                    tools::Permission::Never => (false, None),
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
                            Ok(ApprovalDecision::Approved) => (true, None),
                            Ok(ApprovalDecision::Denied(reason)) => (false, reason),
                            _ => (false, None),
                        }
                    }
                };
                if approved {
                    let args: serde_json::Value = serde_json::from_str(&tc.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    match tool.execute(args, &tool_context).await {
                        Ok(output) => output,
                        Err(e) => format!("Error: {e}"),
                    }
                } else if let Some(reason) = deny_reason {
                    format!("Tool call denied by user. Reason: {reason}")
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

            {
                let pool = pool.clone();
                let conv_id = conversation_id.clone();
                let tool_msg_id = uuid::Uuid::new_v4().to_string();
                let call_id = tc.id.clone();
                let tool_result = result.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut conn) = pool.get() {
                        let _ = db::ops::message::insert_message(&mut conn, &NewMessage {
                            id: &tool_msg_id, conversation_id: &conv_id, role: "tool",
                            content: &tool_result, provider_id: None, model_id: None,
                            input_tokens: None, output_tokens: None,
                            tool_calls: None, tool_call_id: Some(&call_id),
                            sort_order: 0, created_at: now,
                            reasoning_content: None, rating: None, schema_version: 2,
                        });
                    }
                }).await;
            }

            chat_messages.push(ChatMessage::tool_result(&tc.id, &result));
        }

        if cancel.is_cancelled() { break; }
        trim_to_context_limit(&mut chat_messages, context_limit, keep_recent);
    }

    // Clean up cancel token
    {
        let chats = app.state::<ActiveChats>();
        chats.0.lock().await.remove(&conversation_id);
    }

    app.emit("chat-stream", serde_json::json!({
        "content": "", "done": true, "message_id": &assistant_msg_id,
        "input_tokens": total_input_tokens, "output_tokens": total_output_tokens,
    })).map_err(|e| e.to_string())?;

    // Auto-generate title if first message
    if conv_title.is_none() {
        let title_messages = vec![ChatMessage::user(&format!(
            "Generate a short title (max 6 words, no quotes, no punctuation) for this conversation:\nUser: {}\nAssistant: {}",
            &message,
            take_bytes_at_char_boundary(&last_assistant_text, 300)
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
                        enabled_tools: None,
                        thinking_enabled: 0,
                        thinking_budget: None,
                        tool_preset_id: None,
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
                                api_format: "chat_completions",
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

            // Seed built-in prompt templates on first run
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::prompt_template::count_templates(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let templates = [
                        ("casual_friend", "Casual Friend", "随意朋友", "character", "You are {{assistant_name}}, a casual and friendly chat partner. Talk naturally, use slang, emoji, and informal language. Be playful and genuine. The current time is {{current_time}} on {{current_date}} ({{day_of_week}}).\n\n{{chat_style_hint}}\n\nExample of segmented response:\nwhat\n---\nno way lol\n---\n[emoji:shocked]"),
                        ("professional", "Professional Assistant", "专业助手", "character", "You are {{assistant_name}}, a professional and knowledgeable assistant. Respond in a structured, clear, and formal manner. Provide thorough and accurate answers. Current date: {{current_date}}."),
                        ("code_expert", "Code Expert", "代码专家", "coding", "You are {{assistant_name}}, an expert software engineer. Write clean, efficient, and well-documented code. Explain technical concepts clearly. Use code blocks with language tags. Current date: {{current_date}}."),
                        ("creative_writer", "Creative Writer", "创意写手", "character", "You are {{assistant_name}}, a creative and expressive writer. Use vivid language, metaphors, and storytelling techniques. Be imaginative and emotionally engaging."),
                        ("study_buddy", "Study Buddy", "学习伙伴", "character", "You are {{assistant_name}}, a patient and encouraging study partner for {{user_name}}. Break down complex topics into simple explanations. Use analogies and examples. Ask follow-up questions to check understanding. Current date: {{current_date}}."),
                    ];
                    for (i, (id_suffix, name, desc, category, text)) in templates.iter().enumerate() {
                        let id = format!("builtin_{id_suffix}");
                        let _ = db::ops::prompt_template::create_template(&mut conn, &NewPromptTemplate {
                            id: &id,
                            name,
                            description: Some(desc),
                            category,
                            template_text: text,
                            is_builtin: 1,
                            sort_order: i as i32,
                            created_at: now,
                            updated_at: now,
                        });
                    }
                }
            }

            // Seed built-in tool categories and presets
            {
                let mut conn = pool.get().expect("db connection");
                if db::ops::tool_category::count_categories(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let cats = [
                        ("cat_interaction", "Interaction", "User interaction tools", 0),
                        ("cat_filesystem", "Filesystem", "File and directory operations", 1),
                        ("cat_system", "System", "System and shell commands", 2),
                        ("cat_coding", "Coding", "Code analysis and editing", 3),
                    ];
                    for (id, name, desc, order) in &cats {
                        let _ = db::ops::tool_category::create_category(&mut conn, &NewToolCategory {
                            id, name, description: Some(desc), icon: None, sort_order: *order, created_at: now,
                        });
                    }
                }
                if db::ops::tool_preset::count_presets(&mut conn).unwrap_or(0) == 0 {
                    let now = now_ms();
                    let presets = [
                        ("preset_coding", "Coding Agent", "All tools for coding tasks", r#"["ask_user","read_file","write_file","edit_file","apply_patch","run_command","list_directory","search_files","glob_files"]"#, 0),
                        ("preset_research", "Research", "Minimal tools for research and reading", r#"["ask_user","read_file","list_directory","search_files","glob_files"]"#, 1),
                        ("preset_writing", "Writing", "Tools for writing and editing files", r#"["ask_user","read_file","write_file","edit_file"]"#, 2),
                    ];
                    for (id, name, desc, tools_json, order) in &presets {
                        let _ = db::ops::tool_preset::create_preset(&mut conn, &NewToolPreset {
                            id, name, description: Some(desc), icon: None,
                            tool_names: tools_json, is_builtin: 1, sort_order: *order,
                            created_at: now, updated_at: now,
                        });
                    }
                }
            }

            // Load custom tools from DB into tool registry
            let mut registry = tools::ToolRegistry::new();
            {
                let mut conn = pool.get().expect("db connection");
                if let Ok(custom_tools) = db::ops::custom_tool::list_enabled_tools(&mut conn) {
                    for ct in &custom_tools {
                        registry.register(Box::new(tools::custom::CustomToolExecutor::from_db(ct)));
                    }
                }
            }

            app.manage(AppDb(pool));
            app.manage(AppTools(Arc::new(registry)));
            app.manage(ApprovalWaiters(Mutex::new(HashMap::new())));
            app.manage(ActiveChats(Mutex::new(HashMap::new())));
            app.manage(AppMcp(Arc::new(Mutex::new(mcp::McpManager::new()))));

            #[cfg(not(target_os = "android"))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    onebot::maybe_start(handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat, stop_chat,
            set_secret, get_secret, delete_secret,
            list_conversations, create_conversation,
            update_conversation_title, toggle_pin_conversation, delete_conversation,
            load_messages, update_message_content, delete_message, delete_messages_from, rate_message, export_conversation, upload_file,
            list_assistants, create_assistant, update_assistant, delete_assistant,
            list_providers, create_provider, update_provider, delete_provider,
            set_provider_key, get_provider_key_exists, fetch_provider_models,
            list_projects, create_project, update_project, delete_project,
            list_conversations_by_project,
            list_memories, save_memory, update_memory, delete_memory,
            get_preference, set_preference,
            list_mcp_servers, create_mcp_server, update_mcp_server, delete_mcp_server,
            connect_mcp_server, disconnect_mcp_server, list_mcp_tools, list_all_tool_names,
            approve_tool_call, deny_tool_call, respond_to_ask,
            platform::get_platform, platform::get_manage_storage_status, platform::request_manage_storage,
            platform::pick_saf_directory, platform::list_saf_roots, platform::remove_saf_root,
            #[cfg(not(target_os = "android"))]
            get_onebot_status,
            #[cfg(not(target_os = "android"))]
            get_onebot_config,
            #[cfg(not(target_os = "android"))]
            save_onebot_config,
            #[cfg(not(target_os = "android"))]
            start_onebot,
            #[cfg(not(target_os = "android"))]
            stop_onebot,
            list_prompt_templates, create_prompt_template, update_prompt_template,
            delete_prompt_template, list_template_variables,
            list_emoji_packs, create_emoji_pack, delete_emoji_pack,
            list_emojis, import_emojis, delete_emoji, rename_emoji, search_emojis,
            assign_emoji_pack, unassign_emoji_pack, list_assistant_emoji_packs,
            get_emoji_file_url,
            list_tool_categories,
            list_custom_tools, create_custom_tool, update_custom_tool, delete_custom_tool,
            list_tool_presets, create_tool_preset, update_tool_preset, delete_tool_preset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Called from MainActivity.onCreate to initialize ndk-context and
/// android-keyring before any Rust code touches the Android keystore.
/// Tauri itself does NOT initialize ndk-context; this JNI entry is required.
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_initNdkContext(
    env: jni::JNIEnv,
    _class: jni::objects::JObject,
    context: jni::objects::JObject,
) {
    use std::ffi::c_void;
    use std::sync::OnceLock;
    use jni::objects::GlobalRef;

    static REF: OnceLock<Option<GlobalRef>> = OnceLock::new();
    REF.get_or_init(|| match env.new_global_ref(&context) {
        Ok(ref_) => {
            let vm = env.get_java_vm().unwrap();
            let vm = vm.get_java_vm_pointer() as *mut c_void;
            unsafe {
                ndk_context::initialize_android_context(vm, ref_.as_obj().as_raw() as _);
            }
            android_keyring::set_android_keyring_credential_builder();
            Some(ref_)
        }
        Err(_) => None,
    });
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
            reasoning_content: None,
            rating: None,
            schema_version: 2,
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
