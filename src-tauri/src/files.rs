use std::path::{Path, PathBuf};

pub fn files_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("files")
}

pub fn conversation_files_dir(app_data_dir: &Path, conversation_id: &str) -> PathBuf {
    files_dir(app_data_dir).join(conversation_id)
}

pub fn store_file(app_data_dir: &Path, conversation_id: &str, src_path: &Path) -> Result<String, String> {
    let dest_dir = conversation_files_dir(app_data_dir, conversation_id);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let ext = src_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let file_id = uuid::Uuid::new_v4().to_string();
    let dest_name = format!("{file_id}.{ext}");
    let dest_path = dest_dir.join(&dest_name);

    std::fs::copy(src_path, &dest_path).map_err(|e| e.to_string())?;

    let uri = format!("file:///{}", dest_path.to_string_lossy().replace('\\', "/"));
    Ok(uri)
}

pub fn resolve_file_uri(uri: &str) -> Option<PathBuf> {
    if let Some(path) = uri.strip_prefix("file:///") {
        Some(PathBuf::from(path))
    } else if let Some(path) = uri.strip_prefix("file://") {
        Some(PathBuf::from(path))
    } else {
        None
    }
}

pub fn file_to_base64_data_uri(path: &Path, mime_type: &str) -> Result<String, String> {
    use base64::Engine;
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{mime_type};base64,{b64}"))
}
