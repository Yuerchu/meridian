//! The host log: one file under the data directory, rotated by size at start.

use std::path::Path;

use tracing_subscriber::EnvFilter;

const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Installs the global subscriber writing to `path`. When the file is over
/// [`MAX_BYTES`] it is moved aside as `.1` first. Falls back to stderr if the
/// file cannot be opened.
pub fn init(path: &Path, debug: bool) {
    if let Ok(meta) = std::fs::metadata(path)
        && meta.len() > MAX_BYTES
    {
        let rotated = path.with_extension("log.1");
        let _ = std::fs::remove_file(&rotated);
        let _ = std::fs::rename(path, &rotated);
    }
    let level = if debug { "debug" } else { "info" };
    let filter = EnvFilter::try_from_env("MERIDIAN_IME_LOG").unwrap_or_else(|_| EnvFilter::new(level));
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path);
    match file {
        Ok(file) => {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_ansi(false)
                .with_writer(file)
                .init();
        }
        Err(_) => {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_ansi(false)
                .with_writer(std::io::stderr)
                .init();
        }
    }
}
