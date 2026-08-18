// Bounded capture, timeout/cancellation and process-tree termination logic
// derived from Codex (Apache-2.0): codex-rs/core/src/exec.rs and
// codex-rs/windows-sandbox-rs/src/lib.rs.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct SandboxPolicy {
    /// Currently a no-op: the ported restricted-token sandbox has no network
    /// filtering (WFP was stripped).
    #[allow(dead_code)]
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

/// Default sandbox policy for a chat turn, honoring the `sandbox.enabled`
/// preference (missing = enabled). Only Windows has a sandbox implementation;
/// elsewhere this returns None so commands never hit the denied heuristic.
pub fn default_policy_if_enabled(enabled: bool, project_dir: Option<&str>) -> Option<SandboxPolicy> {
    #[cfg(target_os = "windows")]
    {
        enabled.then(|| SandboxPolicy {
            project_dir: project_dir.map(PathBuf::from),
            ..Default::default()
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (enabled, project_dir);
        None
    }
}

/// Largest amount of stdout/stderr retained per stream. Reads continue to EOF
/// past this cap (dropping data) so the child never blocks on a full pipe.
pub const MAX_CAPTURE_BYTES: usize = 256 * 1024;
/// How long to keep draining pipes after the root process exited. A grandchild
/// holding the inherited write end must not hang us forever.
const IO_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
/// Grace period between SIGTERM and SIGKILL on cancellation (Unix).
#[cfg(unix)]
const CANCEL_GRACE: Duration = Duration::from_millis(50);
/// Poll interval while waiting on a sandboxed process (Windows).
#[cfg(target_os = "windows")]
const WAIT_POLL_MS: u32 = 50;

#[derive(Debug)]
pub struct ExecResult {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// The command hit the timeout and its process tree was killed; partial
    /// output is retained.
    pub timed_out: bool,
    /// At least one stream exceeded `MAX_CAPTURE_BYTES` and was truncated.
    pub truncated: bool,
    /// The command actually ran under the Windows restricted-token sandbox.
    pub sandboxed: bool,
}

#[derive(Debug)]
pub enum ExecError {
    Cancelled,
    Spawn(String),
    Internal(String),
}

impl std::fmt::Display for ExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "command cancelled"),
            Self::Spawn(msg) | Self::Internal(msg) => write!(f, "{msg}"),
        }
    }
}

/// Append `chunk` to `dst` without exceeding `max` retained bytes.
/// Returns true if anything was dropped.
fn append_capped(dst: &mut Vec<u8>, chunk: &[u8], max: usize) -> bool {
    if dst.len() >= max {
        return true;
    }
    let remaining = max - dst.len();
    if chunk.len() > remaining {
        dst.extend_from_slice(&chunk[..remaining]);
        true
    } else {
        dst.extend_from_slice(chunk);
        false
    }
}

/// Unified command execution entry point. On Windows with a restricting policy
/// the command runs under the restricted-token sandbox; everywhere else it runs
/// unsandboxed — but always with a bounded capture, a timeout that kills the
/// whole process tree, and cancellation support.
pub async fn execute(
    command: &[String],
    cwd: &Path,
    policy: Option<&SandboxPolicy>,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<ExecResult, ExecError> {
    if command.is_empty() {
        return Err(ExecError::Spawn("empty command".into()));
    }
    #[cfg(target_os = "windows")]
    if let Some(policy) = policy
        && !policy.allow_fs_write_outside_project
    {
        return execute_windows_sandboxed(command, cwd, policy, timeout, cancel).await;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = policy;
    execute_unsandboxed(command, cwd, timeout, cancel).await
}

#[cfg(unix)]
fn kill_group(pid: Option<u32>, signal: i32) {
    let Some(pid) = pid else { return };
    unsafe {
        let pgid = libc::getpgid(pid as libc::pid_t);
        if pgid > 0 {
            libc::killpg(pgid, signal);
        } else {
            libc::kill(pid as libc::pid_t, signal);
        }
    }
}

async fn read_capped<R>(reader: Option<R>) -> (Vec<u8>, bool)
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let Some(mut reader) = reader else {
        return (Vec::new(), false);
    };
    let mut buf = Vec::new();
    let mut truncated = false;
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if append_capped(&mut buf, &chunk[..n], MAX_CAPTURE_BYTES) {
                    truncated = true;
                }
                // Keep reading to EOF so the child never blocks on a full pipe.
            }
        }
    }
    (buf, truncated)
}

async fn await_capped(mut task: tokio::task::JoinHandle<(Vec<u8>, bool)>) -> (Vec<u8>, bool) {
    match tokio::time::timeout(IO_DRAIN_TIMEOUT, &mut task).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => (Vec::new(), false),
        Err(_) => {
            // A grandchild still holds the write end; give up on the rest.
            task.abort();
            (Vec::new(), false)
        }
    }
}

async fn execute_unsandboxed(
    command: &[String],
    cwd: &Path,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<ExecResult, ExecError> {
    let mut cmd = tokio::process::Command::new(&command[0]);
    cmd.args(&command[1..]);
    cmd.current_dir(cwd);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = cmd
        .spawn()
        .map_err(|e| ExecError::Spawn(format!("failed to execute: {e}")))?;

    #[cfg(unix)]
    let child_pid = child.id();

    // Best-effort job assignment so the whole tree dies on timeout/cancel.
    // (The sandboxed path attaches the job atomically at creation instead.)
    #[cfg(target_os = "windows")]
    let job = {
        match sandbox_windows::job::JobObject::create() {
            Ok(job) => {
                if let Some(h) = child.raw_handle() {
                    let _ = job.assign_process(h as isize);
                }
                Some(job)
            }
            Err(_) => None,
        }
    };

    let stdout_task = tokio::spawn(read_capped(child.stdout.take()));
    let stderr_task = tokio::spawn(read_capped(child.stderr.take()));

    enum Outcome {
        Exited(std::process::ExitStatus),
        TimedOut,
        Cancelled,
    }

    let outcome = tokio::select! {
        status = child.wait() => {
            match status {
                Ok(s) => Outcome::Exited(s),
                Err(e) => return Err(ExecError::Internal(format!("wait failed: {e}"))),
            }
        }
        _ = tokio::time::sleep(timeout) => Outcome::TimedOut,
        _ = cancel.cancelled() => Outcome::Cancelled,
    };

    let kill_tree = |child: &mut tokio::process::Child| {
        #[cfg(unix)]
        kill_group(child_pid, libc::SIGKILL);
        #[cfg(target_os = "windows")]
        if let Some(ref job) = job {
            let _ = job.terminate(1);
        }
        let _ = child.start_kill();
    };

    let exit_status = match outcome {
        Outcome::Exited(status) => Some(status),
        Outcome::TimedOut => {
            kill_tree(&mut child);
            let _ = child.wait().await;
            None
        }
        Outcome::Cancelled => {
            // Give the tree a brief chance to shut down cleanly first.
            #[cfg(unix)]
            {
                kill_group(child_pid, libc::SIGTERM);
                let _ = tokio::time::timeout(CANCEL_GRACE, child.wait()).await;
            }
            kill_tree(&mut child);
            let _ = child.wait().await;
            return Err(ExecError::Cancelled);
        }
    };

    let (stdout, out_trunc) = await_capped(stdout_task).await;
    let (stderr, err_trunc) = await_capped(stderr_task).await;

    Ok(ExecResult {
        exit_code: exit_status.and_then(|s| s.code()).unwrap_or(-1),
        stdout,
        stderr,
        timed_out: exit_status.is_none(),
        truncated: out_trunc || err_trunc,
        sandboxed: false,
    })
}

#[cfg(target_os = "windows")]
async fn execute_windows_sandboxed(
    command: &[String],
    cwd: &Path,
    policy: &SandboxPolicy,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<ExecResult, ExecError> {
    use sandbox_windows::{acl, cap, process, token};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    let mut writable_roots = Vec::new();
    if let Some(ref dir) = policy.project_dir {
        writable_roots.push(dir.clone());
    }
    if let Some(tmp) = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")) {
        writable_roots.push(PathBuf::from(tmp));
    }

    if writable_roots.is_empty() {
        // The caller asked for a sandbox and is not getting one. `sandboxed`
        // comes back false, which also disables the escape detection downstream,
        // and nothing in the UI says so. OneBot turns land here by construction:
        // they carry no project_dir, leaving only TEMP.
        tracing::warn!(
            has_project_dir = policy.project_dir.is_some(),
            "sandbox requested but no writable root could be determined; running unsandboxed"
        );
        return execute_unsandboxed(command, cwd, timeout, cancel).await;
    }

    let sandbox_home = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meridian")
        .join("sandbox");
    std::fs::create_dir_all(&sandbox_home).map_err(|e| ExecError::Internal(format!("create sandbox home: {e}")))?;

    let command = command.to_vec();
    let cwd = cwd.to_path_buf();
    let cancel = cancel.clone();

    tokio::task::spawn_blocking(move || -> Result<ExecResult, ExecError> {
        let internal = |msg: String| ExecError::Internal(msg);

        let mut cap_sid_strings = Vec::new();
        for root in &writable_roots {
            let sid_str = cap::workspace_write_cap_sid_for_root(&sandbox_home, &cwd, root)
                .map_err(|e| internal(format!("get capability SID: {e}")))?;
            cap_sid_strings.push(sid_str);
        }

        // Not filter_map: dropping an entry here shifts the zip further down, so
        // a root would be paired with the *next* root's capability SID and the
        // ACL would be written to the wrong directory. A SID that will not parse
        // is a hard failure, not something to skip past.
        let mut cap_sid_objs: Vec<token::LocalSid> = Vec::with_capacity(cap_sid_strings.len());
        for sid_str in &cap_sid_strings {
            let sid =
                token::LocalSid::from_string(sid_str).map_err(|e| internal(format!("parse capability SID: {e}")))?;
            cap_sid_objs.push(sid);
        }
        let cap_sid_ptrs: Vec<*mut std::ffi::c_void> = cap_sid_objs.iter().map(|s| s.as_ptr()).collect();

        let h_token = unsafe {
            let base = token::get_current_token_for_restriction().map_err(|e| internal(format!("get token: {e}")))?;
            token::create_workspace_write_token_with_caps_from(base, &cap_sid_ptrs)
                .map_err(|e| internal(format!("create restricted token: {e}")))?
        };

        for (root, sid) in writable_roots.iter().zip(cap_sid_objs.iter()) {
            unsafe {
                acl::add_allow_ace(root, sid.as_ptr())
                    .map_err(|e| internal(format!("set ACL on {}: {e}", root.display())))?;
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
        )
        .map_err(|e| ExecError::Spawn(format!("spawn sandboxed process: {e}")))?;

        let stdout_buf = Arc::new(Mutex::new(Vec::new()));
        let stderr_buf = Arc::new(Mutex::new(Vec::new()));
        let truncated = Arc::new(AtomicBool::new(false));

        let stdout_thread = {
            let buf = stdout_buf.clone();
            let trunc = truncated.clone();
            process::read_handle_loop(spawned.stdout_read, move |chunk| {
                if append_capped(&mut buf.lock().unwrap(), chunk, MAX_CAPTURE_BYTES) {
                    trunc.store(true, Ordering::Relaxed);
                }
            })
        };

        let stderr_thread = spawned.stderr_read.map(|h| {
            let buf = stderr_buf.clone();
            let trunc = truncated.clone();
            process::read_handle_loop(h, move |chunk| {
                if append_capped(&mut buf.lock().unwrap(), chunk, MAX_CAPTURE_BYTES) {
                    trunc.store(true, Ordering::Relaxed);
                }
            })
        });

        #[derive(Clone, Copy, PartialEq)]
        enum WaitOutcome {
            Exited,
            TimedOut,
            Cancelled,
        }

        let pi = spawned.process;
        let job = spawned.job.clone();

        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{GetExitCodeProcess, TerminateProcess, WaitForSingleObject};

            // Poll so cancellation is observed promptly (ported from codex
            // windows-sandbox-rs wait_for_process).
            let deadline = std::time::Instant::now() + timeout;
            let outcome = loop {
                let wait = WaitForSingleObject(pi.hProcess, WAIT_POLL_MS);
                if wait == 0 {
                    break WaitOutcome::Exited;
                }
                if cancel.is_cancelled() {
                    break WaitOutcome::Cancelled;
                }
                if std::time::Instant::now() >= deadline {
                    break WaitOutcome::TimedOut;
                }
            };

            match outcome {
                WaitOutcome::Exited => {
                    // Let intentionally backgrounded descendants keep running.
                    let _ = job.preserve_descendants();
                }
                WaitOutcome::TimedOut | WaitOutcome::Cancelled => {
                    if job.terminate(1).is_err() {
                        TerminateProcess(pi.hProcess, 1);
                    }
                }
            }

            let mut code: u32 = 0;
            GetExitCodeProcess(pi.hProcess, &mut code);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);

            // Bounded drain: after preserve_descendants a grandchild may still
            // hold the pipe's write end, so never join unconditionally.
            let drain_deadline = std::time::Instant::now() + IO_DRAIN_TIMEOUT;
            let threads: Vec<std::thread::JoinHandle<()>> =
                std::iter::once(stdout_thread).chain(stderr_thread).collect();
            for t in threads {
                while !t.is_finished() && std::time::Instant::now() < drain_deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
                if t.is_finished() {
                    let _ = t.join();
                }
            }

            let stdout = stdout_buf.lock().unwrap().clone();
            let stderr = stderr_buf.lock().unwrap().clone();

            match outcome {
                WaitOutcome::Cancelled => Err(ExecError::Cancelled),
                WaitOutcome::TimedOut => Ok(ExecResult {
                    exit_code: -1,
                    stdout,
                    stderr,
                    timed_out: true,
                    truncated: truncated.load(Ordering::Relaxed),
                    sandboxed: true,
                }),
                WaitOutcome::Exited => Ok(ExecResult {
                    exit_code: code as i32,
                    stdout,
                    stderr,
                    timed_out: false,
                    truncated: truncated.load(Ordering::Relaxed),
                    sandboxed: true,
                }),
            }
        }
    })
    .await
    .map_err(|e| ExecError::Internal(format!("join: {e}")))?
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

    fn stdout_str(res: &ExecResult) -> String {
        String::from_utf8_lossy(&res.stdout).into_owned()
    }

    fn no_cancel() -> CancellationToken {
        CancellationToken::new()
    }

    #[tokio::test]
    async fn unsandboxed_echo() {
        let dir = tempfile::tempdir().unwrap();
        let res = execute(
            &cmd_argv("echo hello"),
            dir.path(),
            None,
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        assert_eq!(res.exit_code, 0);
        assert!(!res.sandboxed);
        assert!(stdout_str(&res).contains("hello"));
    }

    #[tokio::test]
    async fn unsandboxed_empty_command() {
        let dir = tempfile::tempdir().unwrap();
        let result = execute(&[], dir.path(), None, Duration::from_secs(5), &no_cancel()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn timeout_kills_process_tree() {
        let dir = tempfile::tempdir().unwrap();
        // The inner command spawns a grandchild that would outlive a naive kill.
        let argv = if cfg!(target_os = "windows") {
            vec![
                "cmd".into(),
                "/C".into(),
                "start /B ping -n 60 127.0.0.1 >NUL & ping -n 60 127.0.0.1 >NUL".into(),
            ]
        } else {
            vec!["/bin/sh".into(), "-c".into(), "sleep 60 & sleep 60".into()]
        };
        let started = std::time::Instant::now();
        let res = execute(&argv, dir.path(), None, Duration::from_secs(2), &no_cancel())
            .await
            .unwrap();
        assert!(res.timed_out);
        assert!(
            started.elapsed() < Duration::from_secs(7),
            "kill + drain took {:?}, grandchild likely kept the pipe open",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn output_is_capped_without_deadlock() {
        let dir = tempfile::tempdir().unwrap();
        // Produce well over MAX_CAPTURE_BYTES; must terminate and cap.
        let argv = if cfg!(target_os = "windows") {
            vec![
                "cmd".into(),
                "/C".into(),
                "for /L %i in (1,1,60000) do @echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".into(),
            ]
        } else {
            vec![
                "/bin/sh".into(),
                "-c".into(),
                "i=0; while [ $i -lt 60000 ]; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done".into(),
            ]
        };
        let res = execute(&argv, dir.path(), None, Duration::from_secs(60), &no_cancel())
            .await
            .unwrap();
        assert!(res.truncated);
        assert_eq!(res.stdout.len(), MAX_CAPTURE_BYTES);
        assert!(!res.timed_out);
    }

    #[tokio::test]
    async fn cancellation_kills_promptly() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = CancellationToken::new();
        let cancel2 = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancel2.cancel();
        });
        let argv = if cfg!(target_os = "windows") {
            vec!["cmd".into(), "/C".into(), "ping -n 60 127.0.0.1 >NUL".into()]
        } else {
            vec!["/bin/sh".into(), "-c".into(), "sleep 60".into()]
        };
        let started = std::time::Instant::now();
        let result = execute(&argv, dir.path(), None, Duration::from_secs(60), &cancel).await;
        assert!(matches!(result, Err(ExecError::Cancelled)));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_echo_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let res = execute(
            &cmd_argv("echo SANDBOX-OK"),
            dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        assert_eq!(res.exit_code, 0);
        assert!(res.sandboxed);
        assert!(stdout_str(&res).contains("SANDBOX-OK"));
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_git_bash_fails_as_denied() {
        // Known limitation: MSYS2's runtime cannot create its shared-memory
        // section under a restricted token ("CreateFileMapping ... Win32 error
        // 5") and dies before running anything. This pins the behavior our
        // escalation path depends on: the failure must classify as a sandbox
        // denial so the user is offered a retry without sandbox.
        let bash = "C:\\Program Files\\Git\\bin\\bash.exe";
        if !std::path::Path::new(bash).exists() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let res = execute(
            &[bash.into(), "-c".into(), "echo one | tr a-z A-Z".into()],
            dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        if res.exit_code == 0 {
            // If a future Git Bash version works under the restricted token,
            // this documents that the limitation is gone.
            assert!(stdout_str(&res).contains("ONE"));
            return;
        }
        let stderr = String::from_utf8_lossy(&res.stderr).to_lowercase();
        assert!(
            stderr.contains("win32 error 5") || stderr.contains("createfilemapping"),
            "bash failed for an unexpected reason: {stderr}"
        );
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_powershell_succeeds() {
        // PowerShell is the recommended shell while the sandbox is on (Git
        // Bash can't start under a restricted token), so it must work.
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let res = execute(
            &[
                "powershell".into(),
                "-NoProfile".into(),
                "-Command".into(),
                "Write-Output PS-OK".into(),
            ],
            dir.path(),
            Some(&policy),
            Duration::from_secs(60),
            &no_cancel(),
        )
        .await
        .unwrap();
        let stderr = String::from_utf8_lossy(&res.stderr).into_owned();
        assert_eq!(res.exit_code, 0, "stderr: {stderr}");
        assert!(stdout_str(&res).contains("PS-OK"));
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_mkdir_inside_project_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy_for(dir.path());
        let test_dir = dir.path().join("subdir");
        let res = execute(
            &[
                "cmd".into(),
                "/C".into(),
                "mkdir".into(),
                test_dir.display().to_string(),
            ],
            dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        let stderr = String::from_utf8_lossy(&res.stderr).into_owned();
        assert_eq!(res.exit_code, 0, "stderr: {stderr}");
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
        let res = execute(
            &[
                "cmd".into(),
                "/C".into(),
                "mkdir".into(),
                test_dir.display().to_string(),
            ],
            project_dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        assert_ne!(res.exit_code, 0, "mkdir outside project should fail");
        assert!(!test_dir.exists(), "dir should NOT exist outside project dir");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    async fn sandboxed_read_outside_project_allowed() {
        let project_dir = tempfile::tempdir().unwrap();
        let policy = policy_for(project_dir.path());
        let res = execute(
            &cmd_argv("type C:\\Windows\\System32\\drivers\\etc\\hosts"),
            project_dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        assert_eq!(res.exit_code, 0, "read outside project should succeed");
        assert!(!res.stdout.is_empty(), "should have read hosts file content");
    }

    #[tokio::test]
    #[cfg(target_os = "windows")]
    #[ignore = "requires unrestricted TEMP write; fails inside CI / nested sandboxes"]
    async fn sandboxed_mkdir_in_temp_allowed() {
        let project_dir = tempfile::tempdir().unwrap();
        let policy = policy_for(project_dir.path());
        let tmp = std::env::var("TEMP").unwrap_or_else(|_| std::env::var("TMP").unwrap());
        let unique = format!("meridian_sbx_{}", std::process::id());
        let test_dir = PathBuf::from(&tmp).join(unique);
        let _ = std::fs::remove_dir(&test_dir);
        let res = execute(
            &[
                "cmd".into(),
                "/C".into(),
                "mkdir".into(),
                test_dir.display().to_string(),
            ],
            project_dir.path(),
            Some(&policy),
            Duration::from_secs(30),
            &no_cancel(),
        )
        .await
        .unwrap();
        let stderr = String::from_utf8_lossy(&res.stderr).into_owned();
        assert_eq!(res.exit_code, 0, "mkdir in TEMP should succeed. stderr: {stderr}");
        let _ = std::fs::remove_dir(&test_dir);
    }

    #[test]
    fn append_capped_respects_limit() {
        let mut buf = Vec::new();
        assert!(!append_capped(&mut buf, &[1u8; 100], 150));
        assert!(append_capped(&mut buf, &[2u8; 100], 150));
        assert_eq!(buf.len(), 150);
        assert!(append_capped(&mut buf, &[3u8; 1], 150));
        assert_eq!(buf.len(), 150);
    }
}
