use async_trait::async_trait;
use super::{Permission, Tool};

pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the file to write"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            },
            "required": ["path", "content"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let path = args["path"]
            .as_str()
            .ok_or("missing 'path' argument")?;
        let content = args["content"]
            .as_str()
            .ok_or("missing 'content' argument")?;

        if let Some(parent) = std::path::Path::new(path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("failed to create directory: {e}"))?;
        }

        tokio::fs::write(path, content)
            .await
            .map_err(|e| format!("failed to write file '{}': {}", path, e))?;

        Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
    }
}
