use std::time::Duration;
use async_trait::async_trait;
use super::{Permission, Tool, ToolContext, ShellType};
use crate::sandbox::ExecResult;

pub struct RunCommandTool;

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

        let shell_argv: Vec<String> = match context.shell {
            ShellType::Cmd => vec!["cmd".into(), "/C".into(), command.into()],
            ShellType::PowerShell => {
                vec![find_powershell().into(), "-NoProfile".into(), "-Command".into(), command.into()]
            }
            ShellType::Bash => {
                vec![find_bash().into(), "-c".into(), command.into()]
            }
        };

        let timeout = context.sandbox_policy.as_ref()
            .map(|p| p.timeout)
            .unwrap_or(COMMAND_TIMEOUT);

        let sandboxed = context.sandbox_policy.is_some();
        let started = std::time::Instant::now();
        let res = crate::sandbox::execute(
            &shell_argv,
            &cwd,
            context.sandbox_policy.as_ref(),
            timeout,
            &context.cancel,
        )
        .await
        .map_err(|e| {
            // The command string is never logged: it is model-generated and
            // routinely contains exported tokens and passwords.
            tracing::warn!(
                tool = "run_command",
                sandboxed,
                timeout_secs = timeout.as_secs(),
                error = %e,
                "run_command could not be executed"
            );
            e.to_string()
        })?;

        if is_sandbox_denied(&res) {
            // The user is about to get an "allow this without the sandbox?"
            // prompt. Without this line there is nothing recording what was
            // blocked or why they were asked.
            tracing::warn!(
                tool = "run_command",
                exit_code = res.exit_code,
                stdout_len = res.stdout.len(),
                stderr_len = res.stderr.len(),
                duration_ms = started.elapsed().as_millis() as u64,
                "command blocked by the sandbox; asking whether to retry without it"
            );
            return Err(super::encode_sandbox_denied(&format_output(&res)));
        }

        if res.timed_out {
            tracing::warn!(
                tool = "run_command",
                timeout_secs = timeout.as_secs(),
                sandboxed,
                "run_command timed out"
            );
        } else if res.exit_code != 0 {
            // Below info on purpose: a non-zero exit is an ordinary outcome the
            // model sees and handles, not something worth a line in the file.
            tracing::debug!(
                tool = "run_command",
                exit_code = res.exit_code,
                duration_ms = started.elapsed().as_millis() as u64,
                "run_command exited non-zero"
            );
        }

        Ok(format_output(&res))
    }
}

/// Heuristic ported from codex-rs/sandboxing/src/denial.rs, adjusted for
/// Windows: a non-zero exit alone is not a denial — the output must show an
/// access failure the restricted token would produce.
fn is_sandbox_denied(res: &ExecResult) -> bool {
    if !res.sandboxed || res.timed_out || res.exit_code == 0 {
        return false;
    }
    let hay = format!(
        "{}\n{}",
        String::from_utf8_lossy(&res.stdout),
        String::from_utf8_lossy(&res.stderr),
    )
    .to_lowercase();
    const NEEDLES: &[&str] = &[
        "access is denied",
        "拒绝访问",
        "permission denied",
        "unauthorizedaccess",
        "operation not permitted",
        "read-only file system",
        "(os error 5)",
        // MSYS2/Cygwin (Git Bash) can't create its shared-memory section under
        // a restricted token and dies with "CreateFileMapping ... Win32 error 5"
        // before running anything; escalation is the only way forward.
        "win32 error 5",
        "createfilemapping",
    ];
    NEEDLES.iter().any(|n| hay.contains(n))
}

fn format_output(res: &ExecResult) -> String {
    let stdout = String::from_utf8_lossy(&res.stdout);
    let stderr = String::from_utf8_lossy(&res.stderr);

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
    if res.exit_code != 0 && !res.timed_out {
        result.push_str(&format!("\n[exit code: {}]", res.exit_code));
    }
    if res.timed_out {
        result.push_str("\n[timed out; process tree killed]");
    }
    if res.truncated {
        result.push_str("\n[output truncated at 256KB]");
    }
    if result.is_empty() {
        result = "(no output)".to_string();
    }
    result
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

pub(crate) fn find_bash() -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn exec_res(exit_code: i32, stderr: &str, sandboxed: bool, timed_out: bool) -> ExecResult {
        ExecResult {
            exit_code,
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
            timed_out,
            truncated: false,
            sandboxed,
        }
    }

    #[test]
    fn denied_on_access_keywords() {
        assert!(is_sandbox_denied(&exec_res(1, "拒绝访问。", true, false)));
        assert!(is_sandbox_denied(&exec_res(1, "Access is denied.", true, false)));
        assert!(is_sandbox_denied(&exec_res(1, "mkdir: cannot create directory: Permission denied", true, false)));
        // Git Bash dying at startup under the restricted token
        assert!(is_sandbox_denied(&exec_res(
            256,
            "0 [main] bash (123) bash.exe: *** fatal error - CreateFileMapping S-1-5-21-x.1, Win32 error 5.  Terminating.",
            true,
            false,
        )));
    }

    #[test]
    fn not_denied_without_keywords_or_sandbox() {
        assert!(!is_sandbox_denied(&exec_res(127, "bash: foo: command not found", true, false)));
        assert!(!is_sandbox_denied(&exec_res(0, "", true, false)));
        assert!(!is_sandbox_denied(&exec_res(1, "Access is denied.", false, false)));
        assert!(!is_sandbox_denied(&exec_res(1, "Access is denied.", true, true)));
        assert!(!is_sandbox_denied(&exec_res(1, "some other failure", true, false)));
    }

    #[test]
    fn sandbox_denied_marker_roundtrip() {
        let encoded = crate::tools::encode_sandbox_denied("blocked output");
        assert_eq!(crate::tools::decode_sandbox_denied(&encoded), Some("blocked output"));
        assert_eq!(crate::tools::decode_sandbox_denied("plain error"), None);
    }
}
