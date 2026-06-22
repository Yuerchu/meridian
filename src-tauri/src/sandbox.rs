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

pub fn apply_sandbox(
    cmd: &mut tokio::process::Command,
    policy: &SandboxPolicy,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        apply_windows_sandbox(cmd, policy)
    }
    #[cfg(target_os = "macos")]
    {
        apply_macos_sandbox(cmd, policy)
    }
    #[cfg(target_os = "linux")]
    {
        apply_linux_sandbox(cmd, policy)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (cmd, policy);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_sandbox(
    cmd: &mut tokio::process::Command,
    policy: &SandboxPolicy,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    // Job object: limit child processes and prevent escape from the job.
    // CREATE_BREAKAWAY_FROM_JOB = 0x01000000 is NOT set, so children inherit.
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE kills all children when the handle drops.
    // For now we rely on the existing CREATE_NO_WINDOW flag (set in run_command.rs)
    // and just restrict the working directory.
    if !policy.allow_fs_write_outside_project {
        if let Some(ref dir) = policy.project_dir {
            cmd.current_dir(dir);
        }
    }

    // TODO: Windows Restricted Token via CreateRestrictedToken + CreateProcessAsUser
    // This requires the `windows-sys` crate and careful privilege management.
    // For the initial implementation, we rely on directory-level restriction only.

    let _ = cmd;
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_macos_sandbox(
    _cmd: &mut tokio::process::Command,
    _policy: &SandboxPolicy,
) -> Result<(), String> {
    // TODO: Seatbelt (sandbox-exec) integration
    // Generate a .sb profile that allows read everywhere,
    // write only to project_dir + /tmp, and conditionally allows network.
    Ok(())
}

#[cfg(target_os = "linux")]
fn apply_linux_sandbox(
    _cmd: &mut tokio::process::Command,
    _policy: &SandboxPolicy,
) -> Result<(), String> {
    // TODO: Landlock (kernel 5.13+) filesystem restriction
    // + seccomp for syscall filtering
    Ok(())
}
