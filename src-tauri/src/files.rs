use std::path::{Path, PathBuf};

pub fn files_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("files")
}

pub fn conversation_files_dir(app_data_dir: &Path, conversation_id: &str) -> PathBuf {
    files_dir(app_data_dir).join(conversation_id)
}

pub fn alloc_dest(app_data_dir: &Path, conversation_id: &str, ext: &str) -> Result<(PathBuf, String), String> {
    let dest_dir = conversation_files_dir(app_data_dir, conversation_id);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let file_id = uuid::Uuid::new_v4().to_string();
    let dest_name = format!("{file_id}.{ext}");
    let dest_path = dest_dir.join(&dest_name);
    let uri = format!("file:///{}", dest_path.to_string_lossy().replace('\\', "/"));
    Ok((dest_path, uri))
}

pub fn store_file(app_data_dir: &Path, conversation_id: &str, src_path: &Path) -> Result<String, String> {
    let ext = src_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let (dest_path, uri) = alloc_dest(app_data_dir, conversation_id, ext)?;

    std::fs::copy(src_path, &dest_path).map_err(|e| e.to_string())?;

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

/// Largest attachment that may be inlined (base64) into a provider request.
pub const MAX_INLINE_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;

/// Resolve a `file://` URI for inlining into a provider request. Only regular
/// files inside the app-managed attachment root are accepted (canonical
/// containment), capped at `MAX_INLINE_ATTACHMENT_BYTES` — message content is
/// model-influenced, so an unrestricted URI here would let a response exfiltrate
/// arbitrary local files on the next request.
pub fn resolve_attachment_uri(uri: &str, files_root: &Path) -> Option<PathBuf> {
    let path = resolve_file_uri(uri)?;
    let canonical = std::fs::canonicalize(&path).ok()?;
    let root = std::fs::canonicalize(files_root).ok()?;
    if !canonical.starts_with(&root) {
        return None;
    }
    let meta = std::fs::metadata(&canonical).ok()?;
    if !meta.is_file() || meta.len() > MAX_INLINE_ATTACHMENT_BYTES {
        return None;
    }
    Some(canonical)
}

pub fn file_to_base64_data_uri(path: &Path, mime_type: &str) -> Result<String, String> {
    use base64::Engine;
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{mime_type};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_uri(path: &Path) -> String {
        format!("file:///{}", path.to_string_lossy().replace('\\', "/"))
    }

    #[test]
    fn attachment_uri_requires_containment() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("files");
        std::fs::create_dir_all(root.join("conv1")).unwrap();
        let inside = root.join("conv1").join("a.txt");
        std::fs::write(&inside, b"hello").unwrap();
        let outside = dir.path().join("secret.txt");
        std::fs::write(&outside, b"secret").unwrap();

        assert!(resolve_attachment_uri(&to_uri(&inside), &root).is_some());
        assert!(resolve_attachment_uri(&to_uri(&outside), &root).is_none());
        assert!(resolve_attachment_uri("file:///definitely/not/here.bin", &root).is_none());
        assert!(resolve_attachment_uri("https://example.com/a.txt", &root).is_none());
    }
}
