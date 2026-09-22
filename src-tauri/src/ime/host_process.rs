//! Starting the host and registering the DLL from the settings page.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;

use tauri::Manager;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows_core::{PCWSTR, w};

use super::ImeBridge;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// Where the DLL and the host may be, most specific first: an installed
/// build's `resources/ime`, then the directory the app itself runs from (in
/// development both binaries land in the same cargo target directory).
pub fn artifact_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res.join("ime"));
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        dirs.push(dir.join("ime"));
        dirs.push(dir.to_path_buf());
    }
    dirs
}

/// Spawns the host detached, with Meridian's data directory. It stays alive
/// after this process exits.
pub fn start(bridge: &ImeBridge) -> Result<(), String> {
    let exe = bridge
        .host_exe
        .as_ref()
        .ok_or("host executable not found beside the app")?;
    std::process::Command::new(exe)
        .arg("--data-dir")
        .arg(&bridge.dirs.root)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot start {}: {e}", exe.display()))
}

/// Runs `regsvr32 /s <dll>` elevated (one UAC prompt per DLL) and waits for
/// the registration to appear. Blocking; call from `spawn_blocking`.
pub fn register(bridge: &ImeBridge) -> Result<(), String> {
    let dll = bridge.dll_x64.as_ref().ok_or("64-bit DLL not found beside the app")?;
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    run_as_admin(
        &system.join("System32").join("regsvr32.exe"),
        &format!("/s \"{}\"", dll.display()),
    )?;
    if let Some(dll32) = &bridge.dll_x86 {
        run_as_admin(
            &system.join("SysWOW64").join("regsvr32.exe"),
            &format!("/s \"{}\"", dll32.display()),
        )?;
    }
    // `ShellExecute` with `runas` returns as soon as the elevated process
    // starts; the registration lands a moment later.
    for _ in 0..40 {
        if super::registry::is_registered_x64() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Err("registration did not appear; the elevation prompt may have been declined".into())
}

fn run_as_admin(exe: &std::path::Path, args: &str) -> Result<(), String> {
    let exe_w: Vec<u16> = exe.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
    let args_w: Vec<u16> = args.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: NUL-terminated strings that outlive the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            PCWSTR(exe_w.as_ptr()),
            PCWSTR(args_w.as_ptr()),
            None,
            SW_HIDE,
        )
    };
    if (result.0 as usize) > 32 {
        Ok(())
    } else {
        Err(format!(
            "elevation refused or failed (ShellExecute code {})",
            result.0 as usize
        ))
    }
}
