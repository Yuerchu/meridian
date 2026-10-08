use crate::ServicesExt;
use crate::commands::entity_response::{
    EmojiInfoResponse, EmojiListResponse, EmojiPackInfoResponse, EmojiPackListResponse,
};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::entity::emoji::{EmojiSemanticStatus, EmojiSource};
use meridian_core::db::entity::emoji_pack::EmojiPackKind;
use meridian_core::db::entity::{emoji as emoji_model, emoji_pack};
use meridian_core::db::sea::ops::{emoji as emoji_ops, emoji_pack as pack_ops};
use meridian_core::db::types::SqlBool;
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
pub async fn list_emoji_packs(app: tauri::AppHandle) -> Result<EmojiPackListResponse, String> {
    let services = app.services();
    pack_ops::list_packs(&services.sea)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_emoji_pack(
    app: tauri::AppHandle,
    request: EmojiPackCreateRequest,
) -> Result<EmojiPackInfoResponse, String> {
    let services = app.services();
    let now = now_ms();
    let row = emoji_pack::Model {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        description: request.description.0,
        cover_image: None,
        is_builtin: SqlBool::FALSE,
        sort_order: 0,
        created_at: now,
        updated_at: now,
        kind: EmojiPackKind::Manual,
        source_account_id: None,
    };
    emoji::ensure_pack_dir(&services.paths.data_dir, &row.id)?;
    services
        .sea
        .write(async |tx| pack_ops::create_pack(tx, row).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_emoji_pack(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    // The built-in check and the delete share one write lock.
    let refused = services
        .sea
        .write(async |tx| match pack_ops::get_pack(tx, &id).await? {
            None => Ok(Some(format!("emoji pack `{id}` not found"))),
            Some(pack) if pack.is_builtin.get() => Ok(Some("Cannot delete built-in emoji pack".to_owned())),
            Some(_) => pack_ops::delete_pack(tx, &id).await.map(|_| None),
        })
        .await
        .map_err(|e| e.to_string())?;
    if let Some(refused) = refused {
        return Err(refused);
    }
    emoji::delete_pack_dir(&services.paths.data_dir, &id);
    Ok(())
}

#[tauri::command]
pub async fn list_emojis(app: tauri::AppHandle, pack_id: String) -> Result<EmojiListResponse, String> {
    let services = app.services();
    emoji_ops::list_by_pack(&services.sea, &pack_id)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_emojis(app: tauri::AppHandle, request: EmojiImportRequest) -> Result<EmojiListResponse, String> {
    let EmojiImportRequest { pack_id, file_paths } = request;
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    let now = now_ms();
    let mut imported = Vec::new();
    for path_str in &file_paths {
        let source = std::path::Path::new(path_str);
        // Read before the copy, so a failure leaves nothing behind. A size that
        // could not be read is an error, not a 0-byte file: the column is
        // NOT NULL and the row would say 0 for ever.
        let file_size = std::fs::metadata(source)
            .map(|m| m.len() as i64)
            .map_err(|error| format!("could not read the size of {path_str}: {error}"))?;
        let (file_name, format) = emoji::import_file(&data_dir, &pack_id, source)?;
        let emoji_name = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("emoji")
            .to_string();
        let row = emoji_model::Model {
            id: uuid::Uuid::new_v4().to_string(),
            pack_id: pack_id.clone(),
            name: emoji_name,
            tags: None,
            file_name,
            file_format: format,
            // Set under the write lock below: the pack's size when this row
            // goes in, so concurrent imports cannot take the same position.
            sort_order: 0,
            created_at: now,
            source: EmojiSource::Local,
            source_key: None,
            native_payload: None,
            semantic_status: EmojiSemanticStatus::Confirmed,
            suggested_name: None,
            suggested_tags: None,
            file_size,
            seen_count: 1,
            last_seen_at: Some(now),
        };
        let created = services
            .sea
            .write(async |tx| {
                let mut row = row;
                row.sort_order = i32::try_from(emoji_ops::count_by_pack(tx, &row.pack_id).await?).unwrap_or(i32::MAX);
                emoji_ops::create_emoji(tx, row).await
            })
            .await
            .map_err(|e| e.to_string())?;
        imported.push(created.into());
    }
    Ok(imported)
}

#[tauri::command]
pub async fn delete_emoji(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let gone = services
        .sea
        .write(async |tx| {
            let Some(sticker) = emoji_ops::get_emoji(tx, &id).await? else {
                return Ok(None);
            };
            emoji_ops::delete_emoji(tx, &id).await.map(|_| Some(sticker))
        })
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("sticker `{id}` not found"))?;
    emoji::delete_file(&services.paths.data_dir, &gone.pack_id, &gone.file_name);
    Ok(())
}

#[tauri::command]
pub async fn rename_emoji(app: tauri::AppHandle, request: EmojiRenameRequest) -> Result<EmojiInfoResponse, String> {
    let services = app.services();
    services
        .sea
        .write(async |tx| emoji_ops::rename_emoji(tx, &request.id, &request.new_name).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_emojis(app: tauri::AppHandle, query: String) -> Result<EmojiListResponse, String> {
    let services = app.services();
    emoji_ops::search_emojis(&services.sea, &query)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn confirm_sticker_semantics(
    app: tauri::AppHandle,
    request: EmojiSemanticsConfirmRequest,
) -> Result<EmojiInfoResponse, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Sticker name must not be empty".into());
    }
    let tags = request.tags.0.as_deref().map(str::trim).filter(|v| !v.is_empty());
    let services = app.services();
    services
        .sea
        .write(async |tx| emoji_ops::confirm_semantics(tx, &request.id, name, tags).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn suggest_sticker_semantics(app: tauri::AppHandle, id: String) -> Result<EmojiInfoResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let secrets = services.secrets.clone();
    let data_dir = services.paths.data_dir.clone();
    // pool-read-before-write: a model call sits between the read and the write,
    // which must not hold the write lock; the write only fills the suggestion
    // fields and leaves what a person confirmed alone.
    let sticker = emoji_ops::get_emoji(&services.sea, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("sticker `{id}` not found"))?;
    let assistant = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::assistant::get_default_assistant(&mut conn).map_err(|e| e.to_string())
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
    services
        .sea
        .write(async |tx| emoji_ops::update_suggestion(tx, &sticker.id, name, tags).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assign_emoji_pack(
    app: tauri::AppHandle,
    request: AssistantEmojiPackAssignmentRequest,
) -> Result<(), String> {
    let services = app.services();
    services
        .sea
        .write(async |tx| pack_ops::assign_pack(tx, &request.assistant_id, &request.pack_id, now_ms()).await)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unassign_emoji_pack(
    app: tauri::AppHandle,
    request: AssistantEmojiPackAssignmentRequest,
) -> Result<(), String> {
    let services = app.services();
    services
        .sea
        .write(async |tx| pack_ops::unassign_pack(tx, &request.assistant_id, &request.pack_id).await)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_assistant_emoji_packs(
    app: tauri::AppHandle,
    assistant_id: String,
) -> Result<EmojiPackListResponse, String> {
    let services = app.services();
    pack_ops::list_packs_for_assistant(&services.sea, &assistant_id)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_emoji_file_url(app: tauri::AppHandle, emoji_id: String) -> Result<String, String> {
    let services = app.services();
    let e = emoji_ops::get_emoji(&services.sea, &emoji_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("sticker `{emoji_id}` not found"))?;
    if e.file_name.is_empty() {
        let payload = e.native_payload();
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
        if e.source == EmojiSource::OnebotFace
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
