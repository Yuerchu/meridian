//! Starting the host when it is not running.
//!
//! The DLL sits in every process that takes text, so on a machine where the
//! host has died dozens of processes will notice at once; the launch is
//! guarded by a cross-process mutex so only one of them starts it, and by a
//! cooldown so a host that keeps failing is not restarted on every key.
//! Only a process at medium integrity launches: an AppContainer or a
//! low-integrity renderer cannot see the file, and the login screen and an
//! elevated prompt must not start a user-level process from inside their
//! own desktop.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TokenIntegrityLevel};

/// `SECURITY_MANDATORY_MEDIUM_RID` from `winnt.h`.
const SECURITY_MANDATORY_MEDIUM_RID: u32 = 0x2000;
use windows::Win32::Security::{GetSidSubAuthority, GetSidSubAuthorityCount};
use windows::Win32::System::Threading::{CreateMutexW, GetCurrentProcess, OpenProcessToken, ReleaseMutex};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows_core::{PCWSTR, w};

use crate::com::log;

const COOLDOWN: Duration = Duration::from_secs(5);
const HOST_EXE: &str = meridian_ime_proto::ids::HOST_EXE_NAME;

pub struct Launcher {
    last: Option<Instant>,
}

impl Launcher {
    pub fn new() -> Self {
        Self { last: None }
    }

    /// Starts the host if this process may and has not just tried.
    pub fn try_launch(&mut self) {
        if let Some(t) = self.last
            && t.elapsed() < COOLDOWN
        {
            return;
        }
        self.last = Some(Instant::now());
        if !is_medium_integrity() {
            log::debug("not launching the host from a non-medium-integrity process");
            return;
        }
        let Some(exe) = crate::com::module_dir().map(|d| d.join(HOST_EXE)) else {
            log::warn("cannot locate the host beside the DLL");
            return;
        };
        if !exe.exists() {
            log::warn(&format!("host not found at {}", exe.display()));
            return;
        }
        let Some(_guard) = LaunchMutex::acquire() else {
            log::debug("another process is launching the host");
            return;
        };
        launch(&exe);
    }
}

impl Default for Launcher {
    fn default() -> Self {
        Self::new()
    }
}

fn launch(exe: &std::path::Path) {
    let wide: Vec<u16> = exe.as_os_str().encode_wide_lossy();
    // SAFETY: NUL-terminated strings that outlive the call.
    let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_HIDE) };
    if (result.0 as usize) > 32 {
        log::info(&format!("launched {}", exe.display()));
    } else {
        log::warn(&format!(
            "ShellExecute failed for {} ({})",
            exe.display(),
            result.0 as usize
        ));
    }
}

trait EncodeWide {
    fn encode_wide_lossy(&self) -> Vec<u16>;
}

impl EncodeWide for std::ffi::OsStr {
    fn encode_wide_lossy(&self) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        self.encode_wide().chain(std::iter::once(0)).collect()
    }
}

struct LaunchMutex(HANDLE);

impl LaunchMutex {
    fn acquire() -> Option<Self> {
        // SAFETY: creating a named mutex; ownership is requested atomically.
        unsafe {
            let handle = CreateMutexW(None, true, w!("Local\\MeridianIme.Launch")).ok()?;
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(handle);
                return None;
            }
            Some(Self(handle))
        }
    }
}

impl Drop for LaunchMutex {
    fn drop(&mut self) {
        // SAFETY: we own the mutex and the handle.
        unsafe {
            let _ = ReleaseMutex(self.0);
            let _ = CloseHandle(self.0);
        }
    }
}

/// The process's integrity level is exactly medium.
fn is_medium_integrity() -> bool {
    // SAFETY: token query on our own process with sized buffers.
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut needed);
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buf.as_mut_ptr() as *mut _),
            needed,
            &mut needed,
        );
        let _ = CloseHandle(token);
        if ok.is_err() {
            return false;
        }
        let label = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 {
            return false;
        }
        let rid = *GetSidSubAuthority(sid, (count - 1) as u32);
        rid == SECURITY_MANDATORY_MEDIUM_RID
    }
}

/// The application's executable name, for the host's private-app list.
pub fn current_exe_name() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|p: PathBuf| p.file_name().map(|n| n.to_string_lossy().into_owned()))
}
