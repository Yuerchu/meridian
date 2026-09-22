//! The Windows login session this process belongs to, which names the pipe.

use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;

/// `ProcessIdToSessionId` of this process; 0 if the call fails, which only
/// happens on a system where sessions do not exist.
pub fn current() -> u32 {
    let mut id = 0u32;
    // SAFETY: `id` is a valid out-pointer for the call.
    let _ = unsafe { ProcessIdToSessionId(std::process::id(), &mut id) };
    id
}
