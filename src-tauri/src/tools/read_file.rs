use async_trait::async_trait;
use super::{Permission, Tool, ToolContext};

pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read the contents of a file at the given path. Returns the file content as text."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the file to read"
                }
            },
            "required": ["path"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let path_str = args["path"]
            .as_str()
            .ok_or("missing 'path' argument")?;
        let path = context.resolve_path(path_str);

        tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("failed to read file '{}': {}", path.display(), e))
    }
}
