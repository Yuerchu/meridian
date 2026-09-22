//! Logging from inside somebody else's process.
//!
//! No tracing subscriber: the host application may have one of its own and a
//! second global would fight it. Lines go to `OutputDebugStringW`, which
//! DebugView reads, and — best effort — to a file under the local application
//! data directory, which a store application in an AppContainer cannot write
//! and which then silently gets nothing. Nothing here may panic.

use std::io::Write;

use windows::Win32::System::Diagnostics::Debug::OutputDebugStringW;

const PREFIX: &str = "[meridian-ime-tsf] ";

pub fn debug(msg: &str) {
    emit("DEBUG", msg, false);
}

pub fn info(msg: &str) {
    emit("INFO", msg, true);
}

pub fn warn(msg: &str) {
    emit("WARN", msg, true);
}

fn emit(level: &str, msg: &str, to_file: bool) {
    let line = format!("{PREFIX}{level} {msg}");
    let wide: Vec<u16> = line.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
    unsafe { OutputDebugStringW(windows_core::PCWSTR(wide.as_ptr())) };
    if to_file {
        append_to_file(&line);
    }
}

fn append_to_file(line: &str) {
    let Some(dir) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir)
        .join("cn.yuxiaoqiu.meridian")
        .join("ime-logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("tsf-{}.log", std::process::id()));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}
