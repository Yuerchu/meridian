use crate::ServicesExt;
use meridian_core::db;
use meridian_core::util::now_ms;

#[tauri::command]
pub async fn get_preference(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::get_preference(&mut conn, &key).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_preference(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::preference::set_preference(&mut conn, &key, &value, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
