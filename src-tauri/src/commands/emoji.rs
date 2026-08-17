use tauri::Manager;

use crate::db;
use crate::db::models::emoji::{Emoji, NewEmoji};
use crate::db::models::emoji_pack::{EmojiPack, NewEmojiPack};
use crate::emoji;
use crate::state::AppDb;
use crate::util::{get_conn, now_ms};

#[tauri::command]
pub fn list_emoji_packs(app: tauri::AppHandle) -> Result<Vec<EmojiPack>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::list_packs(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_emoji_pack(
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
    db::ops::emoji_pack::create_pack(
        &mut conn,
        &NewEmojiPack {
            id: &id,
            name: &name,
            description: description.as_deref(),
            cover_image: None,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_emoji_pack(app: tauri::AppHandle, id: String) -> Result<(), String> {
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
pub fn list_emojis(app: tauri::AppHandle, pack_id: String) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::list_by_pack(&mut conn, &pack_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_emojis(app: tauri::AppHandle, pack_id: String, file_paths: Vec<String>) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
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
            &NewEmoji {
                id: &id,
                pack_id: &pack_id,
                name: &emoji_name,
                tags: None,
                file_name: &file_name,
                file_format: &format,
                sort_order: count + i as i32,
                created_at: now,
            },
        )
        .map_err(|e| e.to_string())?;
        imported.push(e);
    }
    Ok(imported)
}

#[tauri::command]
pub fn delete_emoji(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let e = db::ops::emoji::get_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    db::ops::emoji::delete_emoji(&mut conn, &id).map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    emoji::delete_file(&data_dir, &e.pack_id, &e.file_name);
    Ok(())
}

#[tauri::command]
pub fn rename_emoji(app: tauri::AppHandle, id: String, new_name: String) -> Result<Emoji, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::rename_emoji(&mut conn, &id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_emojis(app: tauri::AppHandle, query: String) -> Result<Vec<Emoji>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji::search_emojis(&mut conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assign_emoji_pack(app: tauri::AppHandle, assistant_id: String, pack_id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::assign_pack(&mut conn, &assistant_id, &pack_id, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unassign_emoji_pack(app: tauri::AppHandle, assistant_id: String, pack_id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::unassign_pack(&mut conn, &assistant_id, &pack_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_assistant_emoji_packs(app: tauri::AppHandle, assistant_id: String) -> Result<Vec<EmojiPack>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::emoji_pack::list_packs_for_assistant(&mut conn, &assistant_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_emoji_file_url(app: tauri::AppHandle, emoji_id: String) -> Result<String, String> {
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
