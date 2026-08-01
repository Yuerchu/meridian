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

    fn reach(&self, args: &serde_json::Value, context: &ToolContext) -> super::reach::Reach {
        match args["path"].as_str() {
            Some(p) => super::reach::locate(context, p, true),
            None => super::reach::Reach::Outside,
        }
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let path_str = args["path"]
            .as_str()
            .ok_or("missing 'path' argument")?;
        let content = args["content"]
            .as_str()
            .ok_or("missing 'content' argument")?;

        if let Some(ref session) = context.edit_session {
            // Staging resolves rather than opens: `open_write` creates the file
            // if it is missing, and a staged write that is never approved would
            // leave that empty file behind. Staging always waits for a person
            // anyway, which is what makes the path form acceptable here.
            let target = context.resolve_and_validate(path_str)?;
            let resolved_path = match &target {
                super::ResolvedTarget::Real(p) => p.clone(),
                super::ResolvedTarget::Saf { .. } => {
                    super::backend::write_string(&target, content).await?;
                    return Ok(format!("Successfully wrote {} bytes to {}", content.len(), path_str));
                }
            };
            // A file that exists but cannot be read must not be staged as if it
            // were new: the diff would say "+800 lines, new file" for what is
            // actually an overwrite, and the user would approve that. Only a
            // genuinely absent file gets `None`.
            let original = match super::backend::read_to_string(&target).await {
                Ok(existing) => Some(existing),
                Err(e) if resolved_path.exists() => {
                    tracing::warn!(
                        tool = "write_file",
                        error = %e,
                        "refusing to stage a write over a file whose current contents cannot be read"
                    );
                    return Err(format!(
                        "'{path_str}' exists but could not be read, so the diff shown for approval \
                         would be wrong. Resolve that first."
                    ));
                }
                Err(_) => None,
            };
            let mut session = session.lock().await;
            session.stage_write(resolved_path.clone(), original, content.to_string(), "write_file");
            let diff = session.get(&resolved_path).unwrap().diff.clone();
            Ok(format!("Staged write to {path_str} (pending approval).\n\n{diff}"))
        } else {
            // The direct path may run without a prompt, so it writes through
            // the handle it verified rather than resolving the name again.
            let target = context.open_write(path_str)?;
            super::backend::write_opened(target, content).await?;
            Ok(format!("Successfully wrote {} bytes to {}", content.len(), path_str))
        }
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
            assistant_id: None,
            db_pool: None,
            edit_session: None,
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: std::collections::HashMap::new(),
            cancel: tokio_util::sync::CancellationToken::new(),
        }
    }

    #[tokio::test]
    async fn writes_a_new_file_and_creates_its_parents() {
        let dir = tempfile::tempdir().unwrap();
        let out = WriteFileTool
            .execute(
                serde_json::json!({"path": "nested/deep/note.txt", "content": "hello"}),
                &ctx(dir.path()),
            )
            .await
            .unwrap();
        assert!(out.contains("Successfully wrote"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("nested/deep/note.txt")).unwrap(),
            "hello"
        );
    }

    /// Overwriting has to leave the file at the new length, not the new content
    /// padded with whatever the old one was — the handle is reused, so the
    /// truncate is ours to get right.
    #[tokio::test]
    async fn overwriting_a_longer_file_leaves_no_tail() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "aaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();

        WriteFileTool
            .execute(serde_json::json!({"path": "a.txt", "content": "bb"}), &ctx(dir.path()))
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "bb");
    }

    #[tokio::test]
    async fn refuses_to_write_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("important.txt");
        std::fs::write(&victim, "must survive").unwrap();

        let err = WriteFileTool
            .execute(
                serde_json::json!({"path": victim.to_string_lossy(), "content": "clobbered"}),
                &ctx(dir.path()),
            )
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got {err}");
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "must survive");
    }

    /// The escape a lexical check gets wrong: nothing exists to canonicalize,
    /// so the `..` survives into the comparison and the write lands outside.
    #[tokio::test]
    async fn refuses_a_traversal_through_a_directory_that_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let err = WriteFileTool
            .execute(
                serde_json::json!({
                    "path": "ghost/../../../escaped.txt",
                    "content": "x"
                }),
                &ctx(dir.path()),
            )
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got {err}");
    }
}
