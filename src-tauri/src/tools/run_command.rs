use std::time::Duration;
use async_trait::async_trait;
use super::{Permission, Tool, ToolContext, ShellType};

pub struct RunCommandTool;

const MAX_OUTPUT_BYTES: usize = 256 * 1024; // 256 KB
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

#[async_trait]
impl Tool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Execute a shell command and return its output (stdout and stderr). The command runs in the project's working directory. Output is truncated at 256KB. Timeout: 120 seconds."
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

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let command = args["command"]
            .as_str()
            .ok_or("missing 'command' argument")?;

        let cwd = context.working_dir_or_current();

        let mut cmd = match context.shell {
            ShellType::Cmd => {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/C", command]);
                c
            }
            ShellType::PowerShell => {
                let ps = find_powershell();
                let mut c = tokio::process::Command::new(ps);
                c.args(["-NoProfile", "-Command", command]);
                c
            }
            ShellType::Bash => {
                let bash = find_bash();
                let mut c = tokio::process::Command::new(bash);
                c.args(["-c", command]);
                c
            }
        };
        cmd.current_dir(&cwd);

        if let Some(ref policy) = context.sandbox_policy {
            crate::sandbox::apply_sandbox(&mut cmd, policy)
                .map_err(|e| format!("sandbox setup failed: {e}"))?;
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let timeout = context.sandbox_policy
            .as_ref()
            .map(|p| p.timeout)
            .unwrap_or(COMMAND_TIMEOUT);

        let output = match tokio::time::timeout(timeout, cmd.output()).await {
            Ok(result) => result,
            Err(_) => return Err(format!("command timed out after {}s", COMMAND_TIMEOUT.as_secs())),
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

                if result.len() > MAX_OUTPUT_BYTES {
                    let truncated = crate::take_bytes_at_char_boundary(&result, MAX_OUTPUT_BYTES);
                    return Ok(format!(
                        "{}...\n\n(output truncated at 256KB, total {} bytes)",
                        truncated,
                        result.len()
                    ));
                }

                Ok(result)
            }
            Err(e) => Err(format!("failed to execute command: {e}")),
        }
    }
}

fn find_powershell() -> &'static str {
    if cfg!(target_os = "windows") {
        if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        } else {
            "powershell"
        }
    } else {
        "pwsh"
    }
}

fn find_bash() -> &'static str {
    if cfg!(target_os = "windows") {
        let git_bash = "C:\\Program Files\\Git\\bin\\bash.exe";
        if std::path::Path::new(git_bash).exists() {
            return git_bash;
        }
        let git_bash_x86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
        if std::path::Path::new(git_bash_x86).exists() {
            return git_bash_x86;
        }
        "bash"
    } else {
        "/bin/bash"
    }
}
