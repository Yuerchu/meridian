use tauri::Manager;

use crate::db;
use crate::db::models::message::Message;
use crate::state::AppDb;
use crate::agent::extract_tool_calls_from_blocks;

#[tauri::command]
pub async fn load_messages(app: tauri::AppHandle, conversation_id: String) -> Result<Vec<Message>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::list_messages(&mut conn, &conversation_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_message_content(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_content(&mut conn, &id, &content).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_message(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_message(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_messages_from(app: tauri::AppHandle, conversation_id: String, from_sort_order: i32) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_messages_from(&mut conn, &conversation_id, from_sort_order)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rate_message(app: tauri::AppHandle, id: String, rating: Option<i32>) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_rating(&mut conn, &id, rating).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_conversation(app: tauri::AppHandle, conversation_id: String, format: String, output_path: Option<String>) -> Result<String, String> {
    let pool = app.state::<AppDb>().0.clone();
    let result: String = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let conv = db::ops::conversation::get_conversation(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        let messages = db::ops::message::list_messages(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        // Internal bookkeeping (compact summaries) must not leak into training data.
        let messages: Vec<Message> = messages.into_iter()
            .filter(|m| m.is_compact_summary == 0)
            .collect();
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
                    // Hidden reasoning is intentionally excluded: exports must
                    // only contain the final visible answer.
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
pub async fn upload_file(app: tauri::AppHandle, conversation_id: String, file_path: String) -> Result<serde_json::Value, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Android: handle content:// URIs from SAF file picker
    #[cfg(target_os = "android")]
    if file_path.starts_with("content://") {
        let stat = crate::android_bridge::content_stat(&file_path).await?;
        let original_name = stat.name.unwrap_or_else(|| "file".to_string());
        let ext = original_name.rsplit('.').next()
            .filter(|e| e.len() <= 10 && !e.contains('/'))
            .unwrap_or("bin");
        let (dest_path, uri) = crate::files::alloc_dest(&app_data_dir, &conversation_id, ext)?;
        crate::android_bridge::content_copy(&file_path, dest_path.to_str().ok_or("invalid path")?).await?;
        let mime = stat.mime.unwrap_or_else(|| {
            mime_guess::from_path(&original_name).first_or_octet_stream().to_string()
        });
        let content_part = if mime.starts_with("image/") {
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": uri }
            })
        } else {
            serde_json::json!({
                "type": "file",
                "file": { "url": uri, "mime_type": mime, "name": original_name }
            })
        };
        return Ok(content_part);
    }

    let src = std::path::Path::new(&file_path);
    let uri = crate::files::store_file(&app_data_dir, &conversation_id, src)?;

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
