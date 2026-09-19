//! A named-pipe listener with the right ACL.
//!
//! The pipe has to be reachable from three kinds of client the user owns: a
//! normal process, a store application in an AppContainer, and a browser
//! renderer at low integrity. The security descriptor says exactly that and
//! nothing more: the owner, `ALL APPLICATION PACKAGES` and `ALL RESTRICTED
//! APPLICATION PACKAGES` get access (an AppContainer's access check must pass
//! both the user's SID and the package SID), and the object carries a low
//! mandatory label so a low-integrity client may connect. Everyone else is
//! refused. The prototype opened the pipe to `Everyone`, which is not a
//! boundary at all on a shared machine.
//!
//! The first instance is created with `FILE_FLAG_FIRST_PIPE_INSTANCE`, which
//! fails with access denied when another host already owns the name — that
//! is the single-instance guarantee, made by the kernel rather than a mutex.

use std::fs::File;
use std::os::windows::io::FromRawHandle;

use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL, LocalFree};
use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_core::{PCWSTR, PWSTR};

const BUFFER_BYTES: u32 = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum PipeServerError {
    #[error("another host already owns {0}")]
    AlreadyRunning(String),
    #[error("cannot read the current user's SID: {0}")]
    UserSid(String),
    #[error("cannot build the pipe's security descriptor: {0}")]
    Descriptor(String),
    #[error("cannot create the pipe: {0}")]
    Create(String),
    #[error("waiting for a client failed: {0}")]
    Connect(String),
}

/// Owns the pipe name and the security descriptor; `accept` makes instances.
pub struct PipeListener {
    name: Vec<u16>,
    name_str: String,
    descriptor: PSECURITY_DESCRIPTOR,
    first: bool,
    /// The instance `bind` created to probe the name, used by the first `accept`.
    pending: Option<HANDLE>,
}

// SAFETY: the descriptor is an opaque allocation only this struct frees.
unsafe impl Send for PipeListener {}

impl PipeListener {
    /// Builds the descriptor and creates the first instance eagerly, so the
    /// "already running" answer comes back before anything else starts.
    pub fn bind(name: &str) -> Result<Self, PipeServerError> {
        let sid = current_user_sid()?;
        let sddl = sddl_for(&sid);
        let descriptor = descriptor_from_sddl(&sddl)?;
        let mut listener = Self {
            name: name.encode_utf16().chain(std::iter::once(0)).collect(),
            name_str: name.to_string(),
            descriptor,
            first: true,
            pending: None,
        };
        // Probe the name now; keep the handle for the first accept.
        let handle = listener.create_instance()?;
        listener.pending = Some(handle);
        Ok(listener)
    }

    /// Blocks until a client connects and returns the connected instance as a
    /// `File` (duplex, byte mode).
    pub fn accept(&mut self) -> Result<File, PipeServerError> {
        let handle = match self.pending.take() {
            Some(h) => h,
            None => self.create_instance()?,
        };
        // SAFETY: `handle` is a pipe instance this listener created.
        let connected = unsafe { ConnectNamedPipe(handle, None) };
        if let Err(e) = connected
            && e.code() != ERROR_PIPE_CONNECTED.to_hresult()
        {
            // SAFETY: handle is ours and not yet handed out.
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(PipeServerError::Connect(e.to_string()));
        }
        // SAFETY: a valid duplex pipe handle; `File` takes ownership.
        Ok(unsafe { File::from_raw_handle(handle.0) })
    }

    fn create_instance(&mut self) -> Result<HANDLE, PipeServerError> {
        let mut open_mode = PIPE_ACCESS_DUPLEX;
        if self.first {
            open_mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.descriptor.0,
            bInheritHandle: false.into(),
        };
        // SAFETY: the name is NUL-terminated and the attributes point at a
        // descriptor that lives as long as `self`.
        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(self.name.as_ptr()),
                open_mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                BUFFER_BYTES,
                BUFFER_BYTES,
                0,
                Some(&sa),
            )
        };
        if handle.is_invalid() {
            let e = windows_core::Error::from_thread();
            if self.first && e.code() == ERROR_ACCESS_DENIED.to_hresult() {
                return Err(PipeServerError::AlreadyRunning(self.name_str.clone()));
            }
            return Err(PipeServerError::Create(e.to_string()));
        }
        self.first = false;
        Ok(handle)
    }
}

impl Drop for PipeListener {
    fn drop(&mut self) {
        if let Some(h) = self.pending.take() {
            // SAFETY: an instance nobody else holds.
            unsafe {
                let _ = CloseHandle(h);
            }
        }
        if !self.descriptor.0.is_null() {
            // SAFETY: allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.descriptor.0)));
            }
        }
    }
}

/// `O:<sid>G:<sid>D:(A;;GA;;;<sid>)(A;;GA;;;AC)(A;;GA;;;S-1-15-2-2)S:(ML;;NW;;;LW)`
pub fn sddl_for(user_sid: &str) -> String {
    format!("O:{user_sid}G:{user_sid}D:(A;;GA;;;{user_sid})(A;;GA;;;AC)(A;;GA;;;S-1-15-2-2)S:(ML;;NW;;;LW)")
}

fn current_user_sid() -> Result<String, PipeServerError> {
    // SAFETY: standard token query on our own process; buffers sized by a
    // first call, and the SID pointer we pass on points into that buffer.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| PipeServerError::UserSid(e.to_string()))?;
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), needed, &mut needed);
        let _ = CloseHandle(token);
        ok.map_err(|e| PipeServerError::UserSid(e.to_string()))?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut out = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut out).map_err(|e| PipeServerError::UserSid(e.to_string()))?;
        let s = out.to_string().map_err(|e| PipeServerError::UserSid(e.to_string()));
        let _ = LocalFree(Some(HLOCAL(out.0 as *mut _)));
        s
    }
}

fn descriptor_from_sddl(sddl: &str) -> Result<PSECURITY_DESCRIPTOR, PipeServerError> {
    let wide: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
    let mut out = PSECURITY_DESCRIPTOR::default();
    // SAFETY: NUL-terminated input; `out` receives a LocalAlloc'd descriptor
    // that `PipeListener::drop` frees.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(wide.as_ptr()), SDDL_REVISION_1, &mut out, None)
            .map_err(|e| PipeServerError::Descriptor(e.to_string()))?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sddl_names_the_three_principals_and_low_label() {
        let s = sddl_for("S-1-5-21-1-2-3-1001");
        assert!(s.starts_with("O:S-1-5-21-1-2-3-1001G:S-1-5-21-1-2-3-1001D:"));
        assert!(s.contains("(A;;GA;;;S-1-5-21-1-2-3-1001)"));
        assert!(s.contains("(A;;GA;;;AC)"));
        assert!(s.contains("(A;;GA;;;S-1-15-2-2)"));
        assert!(s.ends_with("S:(ML;;NW;;;LW)"));
        assert!(!s.contains("WD"), "Everyone is not on the list");
    }

    #[test]
    fn descriptor_parses_and_user_sid_resolves() {
        let sid = current_user_sid().unwrap();
        assert!(sid.starts_with("S-1-"));
        let d = descriptor_from_sddl(&sddl_for(&sid)).unwrap();
        assert!(!d.0.is_null());
        unsafe {
            let _ = LocalFree(Some(HLOCAL(d.0)));
        }
    }

    #[test]
    fn second_listener_on_the_same_name_is_refused() {
        let name = format!(r"\\.\pipe\meridian-ime-test-{}", std::process::id());
        let first = PipeListener::bind(&name).unwrap();
        let second = PipeListener::bind(&name);
        assert!(matches!(second, Err(PipeServerError::AlreadyRunning(_))));
        drop(first);
        let third = PipeListener::bind(&name);
        assert!(third.is_ok(), "after the first is gone the name is free");
    }
}
