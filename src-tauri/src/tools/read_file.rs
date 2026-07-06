use async_trait::async_trait;
use super::{Permission, Tool, ToolContext};

pub struct ReadFileTool;

const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read the contents of a file. Path can be relative to project root or absolute. Output truncated at 256KB for large files."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read"
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
        let target = context.resolve_and_validate(path_str)?;

        let capped = super::backend::read_capped(&target, MAX_OUTPUT_BYTES).await?;

        if capped.truncated {
            let size_info = capped.total_size
                .map(|s| format!(", total {} bytes", s))
                .unwrap_or_default();
            return Ok(format!(
                "{}...\n\n(file truncated at 256KB{})",
                capped.content,
                size_info
            ));
        }

        Ok(capped.content)
    }
}
