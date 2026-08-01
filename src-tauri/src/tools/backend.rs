//! Unified file I/O layer dispatching on ResolvedTarget.
//! Real paths use tokio::fs directly; SAF targets go through the Android
//! ContentResolver bridge (crate::android_bridge). Keeping the dispatch here
//! means individual tools never need to know about SAF.

use super::ResolvedTarget;

pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
}

#[cfg(not(target_os = "android"))]
fn saf_unsupported<T>() -> Result<T, String> {
    Err("SAF paths are only supported on Android".to_string())
}

pub async fn read_to_string(target: &ResolvedTarget) -> Result<String, String> {
    match target {
        ResolvedTarget::Real(path) => tokio::fs::read_to_string(path)
            .await
            .map_err(|e| format!("failed to read file '{}': {}", path.display(), e)),
        #[cfg(target_os = "android")]
        ResolvedTarget::Saf { tree_uri, rel, display } => {
            crate::android_bridge::saf_read(tree_uri, rel, -1)
                .await
                .map(|r| r.content)
                .map_err(|e| format!("'{display}': {e}"))
        }
        #[cfg(not(target_os = "android"))]
        ResolvedTarget::Saf { .. } => saf_unsupported(),
    }
}

pub struct CappedRead {
    pub content: String,
    pub truncated: bool,
    pub total_size: Option<u64>,
}

/// Read through a handle that has already been verified, without naming a path
/// again.
///
/// The path-based `read_capped` below resolves the name a second time, which is
/// fine for tools that always ask the user first. This one exists for the tools
/// that may skip the prompt: whatever the handle was confirmed to be is what
/// gets read.
pub async fn read_capped_opened(
    target: super::OpenedTarget,
    max_bytes: usize,
) -> Result<CappedRead, String> {
    match target {
        super::OpenedTarget::Real(vf) => {
            let (mut file, real) = vf.into_parts();
            tokio::task::spawn_blocking(move || {
                use std::io::Read;
                let total_size = file.metadata().ok().map(|m| m.len());
                let mut buf = Vec::new();
                let read = (&mut file)
                    .take(max_bytes as u64)
                    .read_to_end(&mut buf)
                    .map_err(|e| format!("failed to read '{}': {}", real.display(), e))?;
                let truncated = total_size.is_some_and(|s| s > read as u64);
                match String::from_utf8(buf) {
                    Ok(content) => Ok(CappedRead { content, truncated, total_size }),
                    // A cap can land mid-character; that is a truncation
                    // artefact, not a binary file.
                    Err(e) => {
                        let bytes = e.as_bytes();
                        match std::str::from_utf8(bytes) {
                            Ok(s) => Ok(CappedRead {
                                content: s.to_string(),
                                truncated,
                                total_size,
                            }),
                            Err(u) if truncated && u.error_len().is_none() && u.valid_up_to() > 0 => {
                                Ok(CappedRead {
                                    content: String::from_utf8_lossy(&bytes[..u.valid_up_to()])
                                        .into_owned(),
                                    truncated,
                                    total_size,
                                })
                            }
                            Err(_) => Err(format!(
                                "'{}' is not valid UTF-8 (binary file?)",
                                real.display()
                            )),
                        }
                    }
                }
            })
            .await
            .map_err(|e| format!("task failed: {e}"))?
        }
        #[cfg(target_os = "android")]
        super::OpenedTarget::Saf { tree_uri, rel, display } => {
            let r = crate::android_bridge::saf_read(&tree_uri, &rel, max_bytes as i64)
                .await
                .map_err(|e| format!("'{display}': {e}"))?;
            Ok(CappedRead { content: r.content, truncated: r.truncated, total_size: r.size })
        }
        #[cfg(not(target_os = "android"))]
        super::OpenedTarget::Saf { .. } => saf_unsupported(),
    }
}

/// Read a file through a verified handle, transform the contents, and write the
/// result back through that same handle.
///
/// Both halves on one handle is what makes an edit an edit: the bytes that were
/// matched against are the bytes that get replaced. Reading by path and writing
/// by path leaves a gap where the file can change, and the write would then
/// discard whatever arrived in it without noticing.
///
/// `transform` returning `Err` leaves the file untouched — nothing is truncated
/// until it has produced the replacement.
pub async fn edit_opened<F>(target: super::OpenedTarget, transform: F) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<String, String>,
{
    match target {
        super::OpenedTarget::Real(vf) => {
            use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
            let (std_file, real) = vf.into_parts();
            let mut f = tokio::fs::File::from_std(std_file);
            let mut content = String::new();
            f.read_to_string(&mut content)
                .await
                .map_err(|e| format!("failed to read '{}': {}", real.display(), e))?;

            let updated = transform(&content)?;

            f.set_len(0).await.map_err(|e| format!("failed to truncate '{}': {}", real.display(), e))?;
            f.seek(std::io::SeekFrom::Start(0))
                .await
                .map_err(|e| format!("failed to rewind '{}': {}", real.display(), e))?;
            f.write_all(updated.as_bytes())
                .await
                .map_err(|e| format!("failed to write '{}': {}", real.display(), e))?;
            f.flush().await.map_err(|e| format!("failed to flush '{}': {}", real.display(), e))
        }
        #[cfg(target_os = "android")]
        super::OpenedTarget::Saf { tree_uri, rel, display } => {
            let r = crate::android_bridge::saf_read(&tree_uri, &rel, -1)
                .await
                .map_err(|e| format!("'{display}': {e}"))?;
            let updated = transform(&r.content)?;
            crate::android_bridge::saf_write(&tree_uri, &rel, &updated)
                .await
                .map_err(|e| format!("'{display}': {e}"))
        }
        #[cfg(not(target_os = "android"))]
        super::OpenedTarget::Saf { .. } => saf_unsupported(),
    }
}

/// Write through an already-verified handle. Truncation happens here, after the
/// check, so a refused write leaves the previous contents alone.
pub async fn write_opened(target: super::OpenedTarget, content: &str) -> Result<(), String> {
    match target {
        super::OpenedTarget::Real(vf) => {
            let (mut file, real) = vf.into_parts();
            let content = content.to_string();
            tokio::task::spawn_blocking(move || {
                use std::io::{Seek, SeekFrom, Write};
                file.set_len(0).map_err(|e| format!("failed to truncate '{}': {}", real.display(), e))?;
                file.seek(SeekFrom::Start(0))
                    .map_err(|e| format!("failed to rewind '{}': {}", real.display(), e))?;
                file.write_all(content.as_bytes())
                    .map_err(|e| format!("failed to write '{}': {}", real.display(), e))?;
                file.flush().map_err(|e| format!("failed to flush '{}': {}", real.display(), e))
            })
            .await
            .map_err(|e| format!("task failed: {e}"))?
        }
        #[cfg(target_os = "android")]
        super::OpenedTarget::Saf { tree_uri, rel, display } => {
            crate::android_bridge::saf_write(&tree_uri, &rel, content)
                .await
                .map_err(|e| format!("'{display}': {e}"))
        }
        #[cfg(not(target_os = "android"))]
        super::OpenedTarget::Saf { .. } => saf_unsupported(),
    }
}

/// Write content, creating parent directories as needed.
pub async fn write_string(target: &ResolvedTarget, content: &str) -> Result<(), String> {
    match target {
        ResolvedTarget::Real(path) => {
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("failed to create directory: {e}"))?;
            }
            tokio::fs::write(path, content)
                .await
                .map_err(|e| format!("failed to write file '{}': {}", path.display(), e))
        }
        #[cfg(target_os = "android")]
        ResolvedTarget::Saf { tree_uri, rel, display } => {
            crate::android_bridge::saf_write(tree_uri, rel, content).await
                .map_err(|e| format!("'{}': {}", display, e))
        }
        #[cfg(not(target_os = "android"))]
        ResolvedTarget::Saf { .. } => saf_unsupported(),
    }
}

pub async fn list_dir(target: &ResolvedTarget) -> Result<Vec<DirEntry>, String> {
    match target {
        ResolvedTarget::Real(path) => {
            let path = path.clone();
            tokio::task::spawn_blocking(move || {
                let entries = std::fs::read_dir(&path)
                    .map_err(|e| format!("failed to read directory '{}': {}", path.display(), e))?;
                let mut result = Vec::new();
                for entry in entries {
                    let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
                    let metadata = entry
                        .metadata()
                        .map_err(|e| format!("failed to read metadata: {e}"))?;
                    result.push(DirEntry {
                        name: entry.file_name().to_string_lossy().to_string(),
                        is_dir: metadata.is_dir(),
                        is_symlink: metadata.is_symlink(),
                        size: metadata.is_file().then(|| metadata.len()),
                    });
                }
                Ok(result)
            })
            .await
            .map_err(|e| format!("task failed: {e}"))?
        }
        #[cfg(target_os = "android")]
        ResolvedTarget::Saf { tree_uri, rel, display } => {
            crate::android_bridge::saf_list(tree_uri, rel).await
                .map_err(|e| format!("'{}': {}", display, e))
        }
        #[cfg(not(target_os = "android"))]
        ResolvedTarget::Saf { .. } => saf_unsupported(),
    }
}

/// Delete a file or directory. Non-recursive directory deletion only succeeds
/// when the directory is empty.
pub async fn delete(target: &ResolvedTarget, recursive: bool) -> Result<(), String> {
    match target {
        ResolvedTarget::Real(path) => {
            let meta = tokio::fs::symlink_metadata(path)
                .await
                .map_err(|e| format!("cannot access '{}': {}", path.display(), e))?;
            if meta.is_dir() {
                if recursive {
                    tokio::fs::remove_dir_all(path)
                        .await
                        .map_err(|e| format!("failed to delete directory '{}': {}", path.display(), e))
                } else {
                    tokio::fs::remove_dir(path).await.map_err(|e| {
                        format!(
                            "failed to delete directory '{}' (not empty? pass recursive: true): {}",
                            path.display(),
                            e
                        )
                    })
                }
            } else {
                tokio::fs::remove_file(path)
                    .await
                    .map_err(|e| format!("failed to delete file '{}': {}", path.display(), e))
            }
        }
        #[cfg(target_os = "android")]
        ResolvedTarget::Saf { tree_uri, rel, display } => {
            crate::android_bridge::saf_delete(tree_uri, rel, recursive).await
                .map_err(|e| format!("'{}': {}", display, e))
        }
        #[cfg(not(target_os = "android"))]
        ResolvedTarget::Saf { .. } => saf_unsupported(),
    }
}

/// Move/rename. Real paths use rename with a copy+delete fallback for files
/// across filesystems. SAF targets must stay within the same tree.
pub async fn rename(from: &ResolvedTarget, to: &ResolvedTarget) -> Result<(), String> {
    match (from, to) {
        (ResolvedTarget::Real(src), ResolvedTarget::Real(dst)) => {
            if let Some(parent) = dst.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("failed to create directory: {e}"))?;
            }
            match tokio::fs::rename(src, dst).await {
                Ok(()) => Ok(()),
                Err(e) => {
                    let meta = tokio::fs::symlink_metadata(src)
                        .await
                        .map_err(|e| format!("cannot access '{}': {}", src.display(), e))?;
                    if meta.is_file() {
                        tokio::fs::copy(src, dst).await.map_err(|e| {
                            format!("failed to move '{}' to '{}': {}", src.display(), dst.display(), e)
                        })?;
                        tokio::fs::remove_file(src).await.map_err(|e| {
                            format!("moved but failed to remove source '{}': {}", src.display(), e)
                        })
                    } else {
                        Err(format!(
                            "failed to move '{}' to '{}': {}",
                            src.display(),
                            dst.display(),
                            e
                        ))
                    }
                }
            }
        }
        #[cfg(target_os = "android")]
        (
            ResolvedTarget::Saf { tree_uri: from_tree, rel: from_rel, display: from_display },
            ResolvedTarget::Saf { tree_uri: to_tree, rel: to_rel, display: _to_display },
        ) => {
            if from_tree != to_tree {
                return Err(
                    "moving between different SAF directories is not supported; \
                     enable 'All files access' in Settings for cross-directory moves"
                        .to_string(),
                );
            }
            crate::android_bridge::saf_rename(from_tree, from_rel, to_rel).await
                .map_err(|e| format!("'{}': {}", from_display, e))
        }
        #[cfg(target_os = "android")]
        _ => Err(
            "moving between a SAF directory and a regular path is not supported; \
             enable 'All files access' in Settings for cross-location moves"
                .to_string(),
        ),
        #[cfg(not(target_os = "android"))]
        _ => saf_unsupported(),
    }
}
