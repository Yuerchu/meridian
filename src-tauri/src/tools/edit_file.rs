use async_trait::async_trait;
use super::{Permission, Tool, ToolContext};

pub struct EditFileTool;

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn description(&self) -> &str {
        "Make a targeted edit to a file by replacing an exact string with a new string. Much safer than write_file for modifying existing code. The old_string must match exactly (including whitespace and indentation)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to the file to edit (relative to project root or absolute)"
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact string to find and replace"
                },
                "new_string": {
                    "type": "string",
                    "description": "The replacement string"
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "If true, replace all occurrences. Default: false (replace first only)."
                }
            },
            "required": ["file_path", "old_string", "new_string"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let file_path = args["file_path"]
            .as_str()
            .ok_or("missing 'file_path' argument")?;
        let old_string = args["old_string"]
            .as_str()
            .ok_or("missing 'old_string' argument")?;
        let new_string = args["new_string"]
            .as_str()
            .ok_or("missing 'new_string' argument")?;
        let replace_all = args["replace_all"].as_bool().unwrap_or(false);

        if old_string.is_empty() {
            return Err("old_string cannot be empty".to_string());
        }
        if old_string == new_string {
            return Err("old_string and new_string are identical".to_string());
        }

        let target = context.resolve_and_validate(file_path)?;

        let content = super::backend::read_to_string(&target).await?;

        let count = content.matches(old_string).count();
        if count == 0 {
            return Err(format!(
                "old_string not found in '{}'. File has {} bytes.",
                file_path,
                content.len()
            ));
        }

        let new_content = if replace_all {
            content.replace(old_string, new_string)
        } else {
            content.replacen(old_string, new_string, 1)
        };

        let replaced = if replace_all { count } else { 1 };

        if let Some(ref session) = context.edit_session {
            let resolved_path = match &target {
                super::ResolvedTarget::Real(p) => p.clone(),
                super::ResolvedTarget::Saf { .. } => {
                    super::backend::write_string(&target, &new_content).await?;
                    return Ok(format!("Replaced {} occurrence(s) in {}", replaced, file_path));
                }
            };
            let mut session = session.lock().await;
            session.stage_write(resolved_path.clone(), Some(content), new_content, "edit_file");
            let diff = session.get(&resolved_path).unwrap().diff.clone();
            Ok(format!("Staged edit of {} occurrence(s) in {file_path} (pending approval).\n\n{diff}", replaced))
        } else {
            super::backend::write_string(&target, &new_content).await?;
            Ok(format!("Replaced {} occurrence(s) in {}", replaced, file_path))
        }
    }
}
