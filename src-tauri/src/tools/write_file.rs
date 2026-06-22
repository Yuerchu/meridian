use async_trait::async_trait;
use super::{Permission, Tool, ToolContext};

pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does. Path can be relative to project root or absolute."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to write"
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

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let path_str = args["path"]
            .as_str()
            .ok_or("missing 'path' argument")?;
        let content = args["content"]
            .as_str()
            .ok_or("missing 'content' argument")?;

        let target = context.resolve_and_validate(path_str)?;

        if let Some(ref session) = context.edit_session {
            let resolved_path = match &target {
                super::ResolvedTarget::Real(p) => p.clone(),
                super::ResolvedTarget::Saf { .. } => {
                    super::backend::write_string(&target, content).await?;
                    return Ok(format!("Successfully wrote {} bytes to {}", content.len(), path_str));
                }
            };
            let original = super::backend::read_to_string(&target).await.ok();
            let mut session = session.lock().await;
            session.stage_write(resolved_path.clone(), original, content.to_string(), "write_file");
            let diff = session.get(&resolved_path).unwrap().diff.clone();
            Ok(format!("Staged write to {path_str} (pending approval).\n\n{diff}"))
        } else {
            super::backend::write_string(&target, content).await?;
            Ok(format!("Successfully wrote {} bytes to {}", content.len(), path_str))
        }
    }
}
