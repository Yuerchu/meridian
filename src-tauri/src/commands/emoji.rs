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
use meridian_core::util::now_ms;
use meridian_core::{agent, provider};

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiPackListRequest {
    assistant_id: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiPackCreateRequest {
    name: String,
    description: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiPackDeleteRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiPackAssignmentUpdateRequest {
    assistant_id: String,
    pack_id: String,
    assigned: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EmojiListFilter {
    Pack { pack_id: String },
    Search { query: String },
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiListRequest {
    filter: EmojiListFilter,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiImportRequest {
    pack_id: String,
    file_paths: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiDeleteRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EmojiUpdateAction {
    Rename {
        name: String,
    },
    ConfirmSemantics {
        name: String,
        tags: RequiredNullable<String>,
    },
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiUpdateRequest {
    id: String,
    action: EmojiUpdateAction,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiSemanticsSuggestRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmojiFileUrlReadRequest {
    emoji_id: String,
}

#[tauri::command]
pub async fn list_emoji_packs(
    app: tauri::AppHandle,
    request: EmojiPackListRequest,
) -> Result<EmojiPackListResponse, String> {
    let services = app.services();
    let rows = match request.assistant_id.0.as_deref() {
        Some(assistant_id) => pack_ops::list_packs_for_assistant(&services.db, assistant_id).await,
        None => pack_ops::list_packs(&services.db).await,
    }
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
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
        .db
        .write(async |tx| pack_ops::create_pack(tx, row).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_emoji_pack(app: tauri::AppHandle, request: EmojiPackDeleteRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    // The built-in check and the delete share one write lock.
    let refused = services
        .db
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
pub async fn list_emojis(app: tauri::AppHandle, request: EmojiListRequest) -> Result<EmojiListResponse, String> {
    let services = app.services();
    let rows = match request.filter {
        EmojiListFilter::Pack { pack_id } => emoji_ops::list_by_pack(&services.db, &pack_id).await,
        EmojiListFilter::Search { query } => emoji_ops::search_emojis(&services.db, &query).await,
    }
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
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
            .db
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
pub async fn delete_emoji(app: tauri::AppHandle, request: EmojiDeleteRequest) -> Result<(), String> {
    let id = request.id;
    let services = app.services();
    let gone = services
        .db
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
pub async fn update_emoji(app: tauri::AppHandle, request: EmojiUpdateRequest) -> Result<EmojiInfoResponse, String> {
    let services = app.services();
    match request.action {
        EmojiUpdateAction::Rename { name } => services
            .db
            .write(async |tx| emoji_ops::rename_emoji(tx, &request.id, &name).await)
            .await
            .map(Into::into)
            .map_err(|e| e.to_string()),
        EmojiUpdateAction::ConfirmSemantics { name, tags } => {
            let name = name.trim();
            if name.is_empty() {
                return Err("Sticker name must not be empty".into());
            }
            let tags = tags.0.as_deref().map(str::trim).filter(|v| !v.is_empty());
            services
                .db
                .write(async |tx| emoji_ops::confirm_semantics(tx, &request.id, name, tags).await)
                .await
                .map(Into::into)
                .map_err(|e| e.to_string())
        }
    }
}

/// The model that looks at a sticker for `suggest_sticker_semantics`.
///
/// A stored pair is used as-is; missing is the default assistant, which is
/// what this command did before the preference existed. Set but unusable is
/// an error, never a quiet return to the default assistant.
async fn resolve_suggest_model(
    secrets: &std::sync::Arc<meridian_core::secrets::SecretsManager>,
    db: &meridian_core::db::sea::cap::Db,
) -> Result<agent::ResolvedProvider, String> {
    let raw = db::sea::ops::preference::get_preference(db, emoji::SUGGEST_MODEL_PREFERENCE)
        .await
        .map_err(|e| e.to_string())?;
    match emoji::parse_suggest_model(raw)? {
        Some((provider_id, model_id)) => {
            agent::resolve_with_overrides(secrets, db, None, Some(model_id.clone()), Some(provider_id.as_str()))
                .await
                .map_err(|error| {
                    format!("the sticker suggestion model `{provider_id}:{model_id}` cannot be used: {error}")
                })
        }
        None => {
            let assistant = db::sea::ops::assistant::get_default_assistant(db)
                .await
                .map_err(|e| e.to_string())?;
            agent::resolve_provider_config(secrets, db, assistant.as_ref()).await
        }
    }
}

#[tauri::command]
pub async fn invoke_emoji_semantics_suggestion(
    app: tauri::AppHandle,
    request: EmojiSemanticsSuggestRequest,
) -> Result<EmojiInfoResponse, String> {
    let id = request.id;
    let services = app.services();
    let secrets = services.secrets.clone();
    let data_dir = services.paths.data_dir.clone();
    // pool-read-before-write: a model call sits between the read and the write,
    // which must not hold the write lock; the write only fills the suggestion
    // fields and leaves what a person confirmed alone.
    let sticker = emoji_ops::get_emoji(&services.db, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("sticker `{id}` not found"))?;
    // pool-read-before-write: as above, the model call sits between this read and the write.
    if sticker.file_name.is_empty() {
        return Err("This sticker has no cached image to inspect".into());
    }
    let resolved = resolve_suggest_model(&secrets, &services.db).await?;
    let caps = provider::registry::get_capabilities(
        &resolved.provider_type,
        &resolved.api_format,
        &resolved.transport_profile,
        &resolved.model,
    )?;
    if !caps.reads_any_image() {
        return Err(format!(
            "The sticker suggestion model `{}` does not support image input",
            resolved.model
        ));
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
        .db
        .write(async |tx| emoji_ops::update_suggestion(tx, &sticker.id, name, tags).await)
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_emoji_pack_assignment(
    app: tauri::AppHandle,
    request: EmojiPackAssignmentUpdateRequest,
) -> Result<(), String> {
    let services = app.services();
    if request.assigned {
        services
            .db
            .write(async |tx| pack_ops::assign_pack(tx, &request.assistant_id, &request.pack_id, now_ms()).await)
            .await
            .map_err(|e| e.to_string())
    } else {
        services
            .db
            .write(async |tx| pack_ops::unassign_pack(tx, &request.assistant_id, &request.pack_id).await)
            .await
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn get_emoji_file_url(app: tauri::AppHandle, request: EmojiFileUrlReadRequest) -> Result<String, String> {
    let emoji_id = request.emoji_id;
    let services = app.services();
    let e = emoji_ops::get_emoji(&services.db, &emoji_id)
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
                "pack_id": "pack-1",
                "file_paths": ["C:/stickers/one.png"]
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiImportRequest>(json!({
                "pack_id": "pack-1",
                "file_paths": [],
                "copy": true
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<EmojiUpdateRequest>(json!({
                "id": "emoji-1",
                "action": { "kind": "rename", "name": "wave" }
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiUpdateRequest>(json!({
                "id": "emoji-1",
                "action": { "kind": "rename" }
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<EmojiUpdateRequest>(json!({
                "id": "emoji-1",
                "action": { "kind": "confirm_semantics", "name": "wave", "tags": null }
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiUpdateRequest>(json!({
                "id": "emoji-1",
                "action": { "kind": "confirm_semantics", "name": "wave" }
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<EmojiPackAssignmentUpdateRequest>(json!({
                "assistant_id": "assistant-1",
                "pack_id": "pack-1",
                "assigned": true
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<EmojiPackAssignmentUpdateRequest>(json!({
                "assistant_id": "assistant-1",
                "pack_id": "pack-1",
                "assigned": true,
                "legacy": true
            }))
            .is_err()
        );
    }
}
