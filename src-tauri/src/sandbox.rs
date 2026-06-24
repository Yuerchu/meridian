use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct SandboxPolicy {
    pub allow_network: bool,
    pub allow_fs_write_outside_project: bool,
    pub timeout: Duration,
    pub project_dir: Option<PathBuf>,
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self {
            allow_network: true,
            allow_fs_write_outside_project: false,
            timeout: Duration::from_secs(120),
            project_dir: None,
        }
    }
}

#[cfg(target_os = "windows")]
pub async fn execute_sandboxed(
    command: &[String],
    cwd: &std::path::Path,
    policy: &SandboxPolicy,
) -> Result<std::process::Output, String> {
    use sandbox_windows::{acl, cap, process, token, winutil};
    use std::sync::{Arc, Mutex};

    if policy.allow_fs_write_outside_project {
        return execute_unsandboxed(command, cwd, policy).await;
    }

    let mut writable_roots = Vec::new();
    if let Some(ref dir) = policy.project_dir {
        writable_roots.push(dir.clone());
    }
    if let Some(tmp) = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")) {
        writable_roots.push(PathBuf::from(tmp));
    }

    if writable_roots.is_empty() {
        return execute_unsandboxed(command, cwd, policy).await;
    }

    let sandbox_home = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meridian")
        .join("sandbox");
    std::fs::create_dir_all(&sandbox_home).map_err(|e| format!("create sandbox home: {e}"))?;

    let command = command.to_vec();
    let cwd = cwd.to_path_buf();
    let timeout = policy.timeout;

    tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        let mut cap_sid_strings = Vec::new();
        for root in &writable_roots {
            let sid_str = cap::workspace_write_cap_sid_for_root(&sandbox_home, &cwd, root)
                .map_err(|e| format!("get capability SID: {e}"))?;
            cap_sid_strings.push(sid_str);
        }

        let cap_sid_objs: Vec<token::LocalSid> = cap_sid_strings.iter()
            .filter_map(|s| token::LocalSid::from_string(s).ok())
            .collect();
        let cap_sid_ptrs: Vec<*mut std::ffi::c_void> = cap_sid_objs.iter()
            .map(|s| s.as_ptr())
            .collect();

        let h_token = unsafe {
            let base = token::get_current_token_for_restriction()
                .map_err(|e| format!("get token: {e}"))?;
            token::create_workspace_write_token_with_caps_from(base, &cap_sid_ptrs)
                .map_err(|e| format!("create restricted token: {e}"))?
        };

        for (root, sid) in writable_roots.iter().zip(cap_sid_objs.iter()) {
            unsafe {
                acl::add_allow_ace(root, sid.as_ptr())
                    .map_err(|e| format!("set ACL on {}: {e}", root.display()))?;
            }
        }

        let env_map: std::collections::HashMap<String, String> = std::env::vars().collect();

        let spawned = process::spawn_process_with_pipes(
            h_token,
            &command,
            &cwd,
            &env_map,
            process::StdinMode::Closed,
            process::StderrMode::Separate,
            false,
            None,
        ).map_err(|e| format!("spawn sandboxed process: {e}"))?;

        let stdout_buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let stderr_buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

        let stdout_buf2 = stdout_buf.clone();
        let stdout_thread = process::read_handle_loop(spawned.stdout_read, move |chunk| {
            stdout_buf2.lock().unwrap().extend_from_slice(chunk);
        });

        let stderr_thread = spawned.stderr_read.map(|h| {
            let stderr_buf2 = stderr_buf.clone();
            process::read_handle_loop(h, move |chunk| {
                stderr_buf2.lock().unwrap().extend_from_slice(chunk);
            })
        });

        let pi = spawned.process;
        unsafe {
            use windows_sys::Win32::System::Threading::{
                WaitForSingleObject, GetExitCodeProcess, TerminateProcess,
            };
            use windows_sys::Win32::Foundation::CloseHandle;

            let wait_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
            let wait_result = WaitForSingleObject(pi.hProcess, wait_ms);
            if wait_result == 0x00000102 {
                TerminateProcess(pi.hProcess, 1);
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
                let _ = stdout_thread.join();
                if let Some(t) = stderr_thread { let _ = t.join(); }
                return Err(format!("command timed out after {}s", timeout.as_secs()));
            }

            let mut code: u32 = 0;
            GetExitCodeProcess(pi.hProcess, &mut code);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);

            let _ = stdout_thread.join();
            if let Some(t) = stderr_thread { let _ = t.join(); }

            let stdout = stdout_buf.lock().unwrap().clone();
            let stderr = stderr_buf.lock().unwrap().clone();

            use std::os::windows::process::ExitStatusExt;
            Ok(std::process::Output {
                status: std::process::ExitStatus::from_raw(code),
                stdout,
                stderr,
            })
        }
    }).await.map_err(|e| format!("join: {e}"))?
}

#[cfg(not(target_os = "windows"))]
pub async fn execute_sandboxed(
    command: &[String],
    cwd: &std::path::Path,
    policy: &SandboxPolicy,
) -> Result<std::process::Output, String> {
    execute_unsandboxed(command, cwd, policy).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_for(project_dir: &std::path::Path) -> SandboxPolicy {
        SandboxPolicy {
            allow_network: true,
            allow_fs_write_outside_project: false,
            timeout: Duration::from_secs(30),
            project_dir: Some(project_dir.to_path_buf()),
        }
    }

    fn cmd_argv(shell_cmd: &str) -> Vec<String> {
        if cfg!(target_os = "windows") {
            vec!["cmd".into(), "/C".into(), shell_cmd.into()]
        } else {
            vec!["/bin/sh".into(), "-c".into(), shell_cmd.into()]
        }
    }

    #[tokio::test]
    async fn unsandboxed_echo() {
        let dir = tempfile::tempdir().unwrap();
        let policy = SandboxPolicy {
            allow_fs_write_outside_project: true,
            ..policy_for(dir.path())
        };
        let output = execute_sandboxed(&cmd_argv("echo hello"), dir.path(), &policy)
            .await
            .unwrap();
        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("hello"), "stdout: {stdout}");
    }

    #[tokio::test]
    async fn unsandboxed_empty_command() {
        let dir = tempfile::tempdir().unwrap();
        let policy = SandboxPolicy {
            allow_fs_write_outside_project: true,
            ..policy_for(dir.path())
        };
        let result = execute_sandboxed(&[], dir.path(), &policy).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_echo_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let output = execute_sandboxed(
            &cmd_argv("echo SANDBOX-OK"),
            dir.path(),
            &policy,
        ).await.unwrap();
        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("SANDBOX-OK"), "stdout: {stdout}");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_mkdir_inside_project_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let test_dir = dir.path().join("subdir");
        let output = execute_sandboxed(
            &vec!["cmd".into(), "/C".into(), "mkdir".into(), test_dir.display().to_string()],
            dir.path(),
            &policy,
        ).await.unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(output.status.code(), Some(0), "stderr: {stderr}");
        assert!(test_dir.exists(), "subdir should have been created inside project dir");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_mkdir_outside_project_denied() {
        let project_dir = tempfile::tempdir().unwrap();
        let policy = policy_for(project_dir.path());
        // Use a path outside both project dir and TEMP to test denial
        let test_dir = PathBuf::from("C:\\meridian_sandbox_deny_test");
        let _ = std::fs::remove_dir(&test_dir);
        let output = execute_sandboxed(
            &vec!["cmd".into(), "/C".into(), "mkdir".into(), test_dir.display().to_string()],
            project_dir.path(),
            &policy,
        ).await.unwrap();
        assert_ne!(output.status.code(), Some(0), "mkdir outside project should fail");
        assert!(!test_dir.exists(), "dir should NOT exist outside project dir");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_read_outside_project_allowed() {
        let project_dir = tempfile::tempdir().unwrap();
        let policy = policy_for(project_dir.path());
        let output = execute_sandboxed(
            &cmd_argv("type C:\\Windows\\System32\\drivers\\etc\\hosts"),
            project_dir.path(),
            &policy,
        ).await.unwrap();
        assert_eq!(output.status.code(), Some(0), "read outside project should succeed");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(!stdout.is_empty(), "should have read hosts file content");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_mkdir_in_temp_allowed() {
        let project_dir = tempfile::tempdir().unwrap();
        let policy = policy_for(project_dir.path());
        let tmp = std::env::var("TEMP").unwrap_or_else(|_| std::env::var("TMP").unwrap());
        let unique = format!("meridian_sbx_{}", std::process::id());
        let test_dir = PathBuf::from(&tmp).join(unique);
        let _ = std::fs::remove_dir(&test_dir);
        let output = execute_sandboxed(
            &vec!["cmd".into(), "/C".into(), "mkdir".into(), test_dir.display().to_string()],
            project_dir.path(),
            &policy,
        ).await.unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(output.status.code(), Some(0), "mkdir in TEMP should succeed. stderr: {stderr}");
        let _ = std::fs::remove_dir(&test_dir);
    }
}

async fn execute_unsandboxed(
    command: &[String],
    cwd: &std::path::Path,
    policy: &SandboxPolicy,
) -> Result<std::process::Output, String> {
    if command.is_empty() {
        return Err("empty command".into());
    }
    let mut cmd = tokio::process::Command::new(&command[0]);
    cmd.args(&command[1..]);
    cmd.current_dir(cwd);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match tokio::time::timeout(policy.timeout, cmd.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("failed to execute: {e}")),
        Err(_) => Err(format!("command timed out after {}s", policy.timeout.as_secs())),
    }
}
