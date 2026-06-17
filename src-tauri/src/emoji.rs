use std::path::{Path, PathBuf};

const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024; // 5MB

pub fn packs_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("emoji_packs")
}

pub fn pack_dir(app_data_dir: &Path, pack_id: &str) -> PathBuf {
    packs_dir(app_data_dir).join(pack_id)
}

pub fn emoji_path(app_data_dir: &Path, pack_id: &str, file_name: &str) -> PathBuf {
    pack_dir(app_data_dir, pack_id).join(file_name)
}

pub fn ensure_pack_dir(app_data_dir: &Path, pack_id: &str) -> Result<PathBuf, String> {
    let dir = pack_dir(app_data_dir, pack_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create pack directory: {e}"))?;
    Ok(dir)
}

pub fn import_file(
    app_data_dir: &Path,
    pack_id: &str,
    source_path: &Path,
) -> Result<(String, String), String> {
    let meta = std::fs::metadata(source_path)
        .map_err(|e| format!("Cannot read file: {e}"))?;

    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum is 5 MB.",
            meta.len() as f64 / 1024.0 / 1024.0,
        ));
    }

    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid file name")?
        .to_string();

    let format = detect_format(&file_name)?;
    let dir = ensure_pack_dir(app_data_dir, pack_id)?;
    let dest = dir.join(&file_name);
    std::fs::copy(source_path, &dest)
        .map_err(|e| format!("Failed to copy file: {e}"))?;

    Ok((file_name, format))
}

pub fn delete_file(app_data_dir: &Path, pack_id: &str, file_name: &str) {
    let path = emoji_path(app_data_dir, pack_id, file_name);
    let _ = std::fs::remove_file(path);
}

pub fn delete_pack_dir(app_data_dir: &Path, pack_id: &str) {
    let dir = pack_dir(app_data_dir, pack_id);
    let _ = std::fs::remove_dir_all(dir);
}

fn detect_format(file_name: &str) -> Result<String, String> {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "gif" => Ok("gif".into()),
        "apng" => Ok("apng".into()),
        "png" => Ok("png".into()),
        "webp" => Ok("webp".into()),
        "jpg" | "jpeg" => Ok("jpg".into()),
        "bmp" => Ok("bmp".into()),
        "json" => Ok("lottie".into()),
        _ => Err(format!("Unsupported format: .{ext}. Supported: gif, apng, png, webp, jpg, bmp, json (Lottie).")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_format() {
        assert_eq!(detect_format("wave.gif").unwrap(), "gif");
        assert_eq!(detect_format("smile.apng").unwrap(), "apng");
        assert_eq!(detect_format("star.png").unwrap(), "png");
        assert_eq!(detect_format("anim.webp").unwrap(), "webp");
        assert_eq!(detect_format("photo.jpg").unwrap(), "jpg");
        assert_eq!(detect_format("photo.jpeg").unwrap(), "jpg");
        assert_eq!(detect_format("icon.bmp").unwrap(), "bmp");
        assert_eq!(detect_format("fancy.json").unwrap(), "lottie");
        assert!(detect_format("video.mp4").is_err());
    }

    #[test]
    fn test_paths() {
        let data = Path::new("/app/data");
        assert_eq!(pack_dir(data, "p1"), PathBuf::from("/app/data/emoji_packs/p1"));
        assert_eq!(
            emoji_path(data, "p1", "wave.gif"),
            PathBuf::from("/app/data/emoji_packs/p1/wave.gif"),
        );
    }
}
