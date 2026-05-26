use async_trait::async_trait;
use super::{Permission, Tool};

pub struct ListDirectoryTool;

#[async_trait]
impl Tool for ListDirectoryTool {
    fn name(&self) -> &str {
        "list_directory"
    }

    fn description(&self) -> &str {
        "List the contents of a directory, showing file names, types, and sizes."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the directory to list"
                }
            },
            "required": ["path"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Always
    }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let path = args["path"]
            .as_str()
            .ok_or("missing 'path' argument")?;

        let path = std::path::PathBuf::from(path);
        tokio::task::spawn_blocking(move || list_dir(&path))
            .await
            .map_err(|e| format!("task failed: {e}"))?
    }
}

fn list_dir(path: &std::path::Path) -> Result<String, String> {
    let entries = std::fs::read_dir(path)
        .map_err(|e| format!("failed to read directory '{}': {}", path.display(), e))?;

    let mut lines = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        let metadata = entry.metadata().map_err(|e| format!("failed to read metadata: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();

        let kind = if metadata.is_dir() {
            "dir "
        } else if metadata.is_symlink() {
            "link"
        } else {
            "file"
        };

        let size = if metadata.is_file() {
            format_size(metadata.len())
        } else {
            "-".to_string()
        };

        lines.push(format!("{kind}  {size:>8}  {name}"));
    }

    lines.sort();

    if lines.is_empty() {
        return Ok("(empty directory)".to_string());
    }

    Ok(lines.join("\n"))
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}
