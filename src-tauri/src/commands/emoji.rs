use crate::ServicesExt;
use crate::commands::entity_response::{
    EmojiInfoResponse, EmojiListResponse, EmojiPackInfoResponse, EmojiPackListResponse,
};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::emoji::EmojiInsert;
use meridian_core::db::models::emoji_pack::EmojiPackInsert;
use meridian_core::emoji;
use meridian_core::util::{get_conn, now_ms};
use meridian_core::{agent, provider};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmojiPackCreateRequest {
    name: String,
    description: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmojiImportRequest {
    pack_id: String,
    file_paths: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmojiRenameRequest {
    id: String,
    new_name: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmojiSemanticsConfirmRequest {
    id: String,
    name: String,
    tags: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantEmojiPackAssignmentRequest {
    assistant_id: String,
    pack_id: String,
}

#[tauri::command]
pub fn list_emoji_packs(app: tauri::AppHandle) -> Result<EmojiPackListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji_pack::list_packs(&mut conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(TryInto::try_into)
        .collect()
}

#[tauri::command]
pub fn create_emoji_pack(
    app: tauri::AppHandle,
    request: EmojiPackCreateRequest,
) -> Result<EmojiPackInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let data_dir = services.paths.data_dir.clone();
    emoji::ensure_pack_dir(&data_dir, &id)?;
    db::ops::emoji_pack::create_pack(
        &mut conn,
        &EmojiPackInsert {
            id: &id,
            name: &request.name,
            description: request.description.0.as_deref(),
            cover_image: None,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
            kind: "manual",
            source_account_id: None,
        },
    )
    .map_err(|e| e.to_string())?
    .try_into()
}

#[tauri::command]
pub fn delete_emoji_pack(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let pack = db::ops::emoji_pack::get_pack(&mut conn, &id).map_err(|e| e.to_string())?;
    if pack.is_builtin == 1 {
        return Err("Cannot delete built-in emoji pack".into());
    }
    db::ops::emoji_pack::delete_pack(&mut conn, &id).map_err(|e| e.to_string())?;
    let data_dir = services.paths.data_dir.clone();
    emoji::delete_pack_dir(&data_dir, &id);
    Ok(())
}

#[tauri::command]
pub fn list_emojis(app: tauri::AppHandle, pack_id: String) -> Result<EmojiListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji::list_by_pack(&mut conn, &pack_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(TryInto::try_into)
        .collect()
}

#[tauri::command]
pub fn import_emojis(app: tauri::AppHandle, request: EmojiImportRequest) -> Result<EmojiListResponse, String> {
    let EmojiImportRequest { pack_id, file_paths } = request;
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let data_dir = services.paths.data_dir.clone();
    let now = now_ms();
    let count = db::ops::emoji::count_by_pack(&mut conn, &pack_id).map_err(|e| e.to_string())? as i32;

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
        let e = db::ops::emoji::create_emoji(
            &mut conn,
            &EmojiInsert {
                id: &id,
                pack_id: &pack_id,
                name: &emoji_name,
                tags: None,
                file_name: &file_name,
                file_format: &format,
                sort_order: count + i as i32,
                created_at: now,
                source: "local",
                source_key: None,
                native_payload: None,
                semantic_status: "confirmed",
                suggested_name: None,
                suggested_tags: None,
                file_size: std::fs::metadata(source).map(|m| m.len() as i64).unwrap_or(0),
                seen_count: 1,
                last_seen_at: Some(now),
            },
        )
        .map_err(|e| e.to_string())?;
        imported.push(e);
    }
    imported.into_iter().map(TryInto::try_into).collect()
}

#[tauri::command]
pub fn delete_emoji(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let e = db::ops::emoji::get_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    db::ops::emoji::delete_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    let data_dir = services.paths.data_dir.clone();
    emoji::delete_file(&data_dir, &e.pack_id, &e.file_name);
    Ok(())
}

#[tauri::command]
pub fn rename_emoji(app: tauri::AppHandle, request: EmojiRenameRequest) -> Result<EmojiInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji::rename_emoji(&mut conn, &request.id, &request.new_name)
        .map_err(|e| e.to_string())?
        .try_into()
}

#[tauri::command]
pub fn search_emojis(app: tauri::AppHandle, query: String) -> Result<EmojiListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji::search_emojis(&mut conn, &query)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(TryInto::try_into)
        .collect()
}

#[tauri::command]
pub fn confirm_sticker_semantics(
    app: tauri::AppHandle,
    request: EmojiSemanticsConfirmRequest,
) -> Result<EmojiInfoResponse, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Sticker name must not be empty".into());
    }
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji::confirm_semantics(
        &mut conn,
        &request.id,
        name,
        request.tags.0.as_deref().map(str::trim).filter(|v| !v.is_empty()),
    )
    .map_err(|e| e.to_string())?
    .try_into()
}

#[tauri::command]
pub async fn suggest_sticker_semantics(app: tauri::AppHandle, id: String) -> Result<EmojiInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let data_dir = services.paths.data_dir.clone();
    let (sticker, assistant) = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let sticker = db::ops::emoji::get_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
            let assistant = db::ops::assistant::get_default_assistant(&mut conn).map_err(|e| e.to_string())?;
            Ok::<_, String>((sticker, assistant))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    if sticker.file_name.is_empty() {
        return Err("This sticker has no cached image to inspect".into());
    }
    let resolved = agent::resolve_provider_config(&secrets, &pool, assistant.as_ref())?;
    let caps = provider::registry::get_capabilities(
        &resolved.provider_type,
        &resolved.api_format,
        &resolved.transport_profile,
        &resolved.model,
    )?;
    if !caps.supports_images {
        return Err("The default assistant's model does not support image input".into());
    }
    let path = emoji::emoji_path(&data_dir, &sticker.pack_id, &sticker.file_name);
    let data_uri = emoji::vision_preview_data_uri(&path)?;
    let content = serde_json::json!([
        {
            "type": "text",
            "text": "Describe this reaction sticker for retrieval. Return strict JSON only: {\"name\":\"short concrete Chinese label\",\"tags\":\"comma-separated visible emotion/action/context\"}. Describe visible cues; do not invent intent. Mildly suggestive content is still an ordinary sticker classification task."
        },
        { "type": "image_url", "image_url": { "url": data_uri } }
    ])
    .to_string();
    let provider = provider::registry::create_provider(resolved.wire())?;
    let response = provider
        .chat(
            vec![provider::ChatMessage::user(&content)],
            provider::ChatParams {
                model: resolved.model,
                max_tokens: Some(200),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    let without_prefix = response
        .trim()
        .strip_prefix("```json")
        .or_else(|| response.trim().strip_prefix("```"))
        .unwrap_or(response.trim());
    let cleaned = without_prefix.strip_suffix("```").unwrap_or(without_prefix).trim();
    let suggestion: serde_json::Value = serde_json::from_str(cleaned)
        .map_err(|_| format!("Model did not return valid sticker metadata: {response}"))?;
    let name = suggestion
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Model suggestion did not include a name")?;
    let tags = suggestion
        .get("tags")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut conn = get_conn(&pool)?;
    db::ops::emoji::update_suggestion(&mut conn, &sticker.id, name, tags)
        .map_err(|e| e.to_string())?
        .try_into()
}

#[tauri::command]
pub fn assign_emoji_pack(app: tauri::AppHandle, request: AssistantEmojiPackAssignmentRequest) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji_pack::assign_pack(&mut conn, &request.assistant_id, &request.pack_id, now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unassign_emoji_pack(app: tauri::AppHandle, request: AssistantEmojiPackAssignmentRequest) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji_pack::unassign_pack(&mut conn, &request.assistant_id, &request.pack_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_assistant_emoji_packs(
    app: tauri::AppHandle,
    assistant_id: String,
) -> Result<EmojiPackListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::emoji_pack::list_packs_for_assistant(&mut conn, &assistant_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(TryInto::try_into)
        .collect()
}

#[tauri::command]
pub fn get_emoji_file_url(app: tauri::AppHandle, emoji_id: String) -> Result<String, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let e = db::ops::emoji::get_emoji(&mut conn, &emoji_id).map_err(|e| e.to_string())?;
    if e.file_name.is_empty() {
        let payload = emoji::parse_native_payload(&emoji_id, e.native_payload.as_deref())?;
        if let Some(url) = payload
            .get("url")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            return Ok(url.to_string());
        }
        if let Some(file) = payload
            .get("file")
            .and_then(|value| value.as_str())
            .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        {
            return Ok(file.to_string());
        }
        if e.source == "onebot_face"
            && let Some(id) = e.source_key.as_deref()
        {
            return Ok(format!("https://qzonestyle.gtimg.cn/qzone/em/e{id}.gif"));
        }
        return Err("Sticker has no preview image".into());
    }
    let data_dir = services.paths.data_dir.clone();
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

#[cfg(test)]
mod request_dto_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emoji_action_requests_are_closed_and_complete() {
        assert!(
            serde_json::from_value::<EmojiImportRequest>(json!({
                "packId": "pack-1",
                "filePaths": ["C:/stickers/one.png"]
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiImportRequest>(json!({
                "packId": "pack-1",
                "filePaths": [],
                "copy": true
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<EmojiRenameRequest>(json!({
                "id": "emoji-1",
                "newName": "wave"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiRenameRequest>(json!({
                "id": "emoji-1"
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<EmojiSemanticsConfirmRequest>(json!({
                "id": "emoji-1",
                "name": "wave",
                "tags": null
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiSemanticsConfirmRequest>(json!({
                "id": "emoji-1",
                "name": "wave"
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<AssistantEmojiPackAssignmentRequest>(json!({
                "assistantId": "assistant-1",
                "packId": "pack-1"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<AssistantEmojiPackAssignmentRequest>(json!({
                "assistantId": "assistant-1",
                "packId": "pack-1",
                "legacy": true
            }))
            .is_err()
        );
    }
}
