use async_trait::async_trait;
use super::{Permission, Tool};

pub struct RunCommandTool;

#[async_trait]
impl Tool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Execute a shell command and return its output (stdout and stderr)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                }
            },
            "required": ["command"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let command = args["command"]
            .as_str()
            .ok_or("missing 'command' argument")?;

        let output = if cfg!(target_os = "windows") {
            tokio::process::Command::new("cmd")
                .args(["/C", command])
                .output()
                .await
        } else {
            tokio::process::Command::new("sh")
                .args(["-c", command])
                .output()
                .await
        };

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let exit_code = output.status.code().unwrap_or(-1);

                let mut result = String::new();
                if !stdout.is_empty() {
                    result.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !result.is_empty() {
                        result.push('\n');
                    }
                    result.push_str("[stderr] ");
                    result.push_str(&stderr);
                }
                if exit_code != 0 {
                    result.push_str(&format!("\n[exit code: {}]", exit_code));
                }
                if result.is_empty() {
                    result = "(no output)".to_string();
                }
                Ok(result)
            }
            Err(e) => Err(format!("failed to execute command: {e}")),
        }
    }
}
