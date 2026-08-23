use super::{Permission, ResolvedTarget, Tool, ToolContext};
use async_trait::async_trait;

pub struct MoveFileTool;

#[async_trait]
impl Tool for MoveFileTool {
    fn name(&self) -> &str {
        "move_file"
    }

    fn description(&self) -> &str {
        "Move or rename a file or directory. The destination must not already exist. \
         Paths can be relative to project root or absolute."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "from": {
                    "type": "string",
                    "description": "Current path of the file or directory"
                },
                "to": {
                    "type": "string",
                    "description": "Destination path (including the new name)"
                },
                "description": super::description_property(),
            },
            "required": ["from", "to"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let from_str = args["from"].as_str().ok_or("missing 'from' argument")?;
        let to_str = args["to"].as_str().ok_or("missing 'to' argument")?;

        if context.is_access_root(from_str) {
            tracing::warn!(
                tool = "move_file",
                denied_path = %from_str,
                guard = "access_root",
                "refused a move of a protected path"
            );
            return Err(format!(
                "refusing to move '{from_str}': it is an authorized access root"
            ));
        }

        let from = context.resolve_and_validate(from_str)?;
        let to = context.resolve_and_validate(to_str)?;

        if let ResolvedTarget::Real(ref dst) = to
            && tokio::fs::symlink_metadata(dst).await.is_ok()
        {
            return Err(format!(
                "destination '{to_str}' already exists; delete it first or choose another name"
            ));
        }

        super::backend::rename(&from, &to).await?;

        Ok(format!("Moved {from_str} to {to_str}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{FileAccess, ShellType};

    fn ctx(wd: &std::path::Path) -> ToolContext {
        ToolContext {
            working_directory: Some(wd.to_string_lossy().to_string()),
            shell: ShellType::Bash,
            file_access: FileAccess::Unrestricted,
            project_id: None,
            conversation_id: None,
            turn_id: None,
            assistant_id: None,
            db_pool: None,
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: std::collections::HashMap::new(),
            cancel: tokio_util::sync::CancellationToken::new(),
        }
    }

    #[tokio::test]
    async fn renames_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();

        let result = MoveFileTool
            .execute(serde_json::json!({"from": "a.txt", "to": "b.txt"}), &ctx(dir.path()))
            .await;
        assert!(result.is_ok());
        assert!(!dir.path().join("a.txt").exists());
        assert!(dir.path().join("b.txt").exists());
    }

    #[tokio::test]
    async fn refuses_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        std::fs::write(dir.path().join("b.txt"), "y").unwrap();

        let result = MoveFileTool
            .execute(serde_json::json!({"from": "a.txt", "to": "b.txt"}), &ctx(dir.path()))
            .await;
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(dir.path().join("b.txt")).unwrap(), "y");
    }

    #[tokio::test]
    async fn refuses_outside_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();

        let result = MoveFileTool
            .execute(
                serde_json::json!({"from": "a.txt", "to": "../escaped.txt"}),
                &ctx(dir.path()),
            )
            .await;
        assert!(result.is_err());
        assert!(dir.path().join("a.txt").exists());
    }
}
