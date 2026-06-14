use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;
use std::time::Duration;
use tokio::process::Command;

use super::{Permission, Tool, ToolContext};

pub struct CustomToolExecutor {
    tool_name: String,
    tool_description: String,
    schema: Value,
    command: String,
    args_template: Option<String>,
    tool_working_directory: Option<String>,
    timeout: Duration,
    perm: Permission,
}

impl CustomToolExecutor {
    pub fn from_db(tool: &crate::db::models::custom_tool::CustomTool) -> Self {
        let schema: Value = serde_json::from_str(&tool.parameters_schema)
            .unwrap_or_else(|_| serde_json::json!({"type": "object", "properties": {}}));
        let perm = match tool.permission.as_str() {
            "always" => Permission::Always,
            "never" => Permission::Never,
            _ => Permission::Ask,
        };
        Self {
            tool_name: tool.name.clone(),
            tool_description: tool.description.clone(),
            schema,
            command: tool.command.clone(),
            args_template: tool.args_template.clone(),
            tool_working_directory: tool.working_directory.clone(),
            timeout: Duration::from_millis(tool.timeout_ms.unwrap_or(30000) as u64),
            perm,
        }
    }
}

#[async_trait]
impl Tool for CustomToolExecutor {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.tool_description
    }

    fn parameters_schema(&self) -> Value {
        self.schema.clone()
    }

    fn default_permission(&self) -> Permission {
        self.perm
    }

    async fn execute(&self, args: Value, context: &ToolContext) -> Result<String, String> {
        let args_obj = args.as_object().cloned().unwrap_or_default();

        let final_args = if let Some(ref template) = self.args_template {
            let re = Regex::new(r"\{\{(\w+)\}\}").unwrap();
            let resolved = re.replace_all(template, |caps: &regex::Captures| {
                let key = &caps[1];
                args_obj
                    .get(key)
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| {
                        args_obj
                            .get(key)
                            .map(|v| v.to_string())
                            .unwrap_or_default()
                    })
            });
            resolved.into_owned()
        } else {
            serde_json::to_string(&args).unwrap_or_default()
        };

        let wd = self
            .tool_working_directory
            .as_deref()
            .or(context.working_directory.as_deref());

        let shell_cmd = if final_args.is_empty() {
            self.command.clone()
        } else {
            format!("{} {}", self.command, final_args)
        };

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("bash");
            c.arg("-c").arg(&shell_cmd);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c").arg(&shell_cmd);
            c
        };

        if let Some(dir) = wd {
            cmd.current_dir(dir);
        }

        let result = tokio::time::timeout(self.timeout, cmd.output())
            .await
            .map_err(|_| format!("Command timed out after {}s", self.timeout.as_secs()))?
            .map_err(|e| format!("Failed to execute command: {e}"))?;

        let stdout = String::from_utf8_lossy(&result.stdout);
        let stderr = String::from_utf8_lossy(&result.stderr);

        if result.status.success() {
            Ok(if stdout.is_empty() {
                "(no output)".to_string()
            } else {
                stdout.into_owned()
            })
        } else {
            Err(format!(
                "Command exited with code {}.\nstdout: {}\nstderr: {}",
                result.status.code().unwrap_or(-1),
                stdout,
                stderr,
            ))
        }
    }
}
