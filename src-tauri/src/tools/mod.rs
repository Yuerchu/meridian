pub mod apply_patch;
pub mod ask_user;
pub mod backend;
pub mod custom;
pub mod delete_file;
pub mod edit_file;
pub mod glob_files;
pub mod list_directory;
pub mod move_file;
pub mod read_file;
#[cfg(not(target_os = "android"))]
pub mod run_command;
pub mod search_files;
pub mod write_file;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Permission {
    Always,
    Ask,
    Never,
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    pub working_directory: Option<String>,
    pub shell: ShellType,
    pub file_access: FileAccess,
}

/// Controls which parts of the filesystem tools may touch.
#[derive(Debug, Clone, Default)]
pub enum FileAccess {
    /// Desktop default: legacy behavior, paths validated against working_directory only.
    #[default]
    Unrestricted,
    /// Android: only paths under one of these roots are allowed.
    Roots(Vec<AccessRoot>),
}

#[derive(Debug, Clone)]
pub struct AccessRoot {
    /// Path prefix as seen by the model, e.g. "/storage/emulated/0" or "/saf/Download".
    pub virtual_prefix: String,
    pub kind: RootKind,
}

#[derive(Debug, Clone)]
pub enum RootKind {
    /// Directly accessible filesystem path (MANAGE_EXTERNAL_STORAGE mode).
    RealPath(PathBuf),
    /// SAF persisted tree URI; operations go through the Android ContentResolver bridge.
    SafTree { tree_uri: String },
}

/// A validated, resolved file target ready for I/O dispatch.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedTarget {
    Real(PathBuf),
    Saf { tree_uri: String, rel: String },
}

/// Lexically normalize a slash-separated path into segments, resolving "." and "..".
/// Returns None if ".." escapes above the root.
fn normalize_segments(path: &str) -> Option<Vec<String>> {
    let mut segs: Vec<String> = Vec::new();
    for seg in path.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => {
                segs.pop()?;
            }
            s => segs.push(s.to_string()),
        }
    }
    Some(segs)
}

fn prefix_segments(prefix: &str) -> Vec<&str> {
    prefix.split('/').filter(|s| !s.is_empty()).collect()
}

/// Canonicalize a path that may not exist yet: canonicalize the deepest
/// existing ancestor and re-append the remaining segments. This keeps
/// comparisons consistent on Windows where canonicalize adds a \\?\ prefix.
fn canonicalize_lenient(path: &Path) -> PathBuf {
    if let Ok(p) = std::fs::canonicalize(path) {
        return p;
    }
    let mut rest = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        let Some(name) = cur.file_name().map(|n| n.to_os_string()) else {
            return path.to_path_buf();
        };
        rest.push(name);
        let Some(parent) = cur.parent().map(Path::to_path_buf) else {
            return path.to_path_buf();
        };
        if let Ok(canonical) = std::fs::canonicalize(&parent) {
            let mut out = canonical;
            for seg in rest.iter().rev() {
                out.push(seg);
            }
            return out;
        }
        cur = parent;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellType {
    Cmd,
    PowerShell,
    Bash,
}

impl ShellType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "powershell" => Self::PowerShell,
            "bash" => Self::Bash,
            _ => Self::default_for_platform(),
        }
    }

    pub fn default_for_platform() -> Self {
        if cfg!(target_os = "windows") {
            Self::Bash
        } else {
            Self::Bash
        }
    }
}

impl ToolContext {
    pub fn resolve_path(&self, path: &str) -> PathBuf {
        let p = Path::new(path);
        if p.is_absolute() {
            p.to_path_buf()
        } else if let Some(ref wd) = self.working_directory {
            PathBuf::from(wd).join(path)
        } else {
            p.to_path_buf()
        }
    }

    pub fn validate_path(&self, resolved: &Path) -> Result<(), String> {
        if let Some(ref wd) = self.working_directory {
            let wd_canonical = canonicalize_lenient(Path::new(wd));
            let target = canonicalize_lenient(resolved);
            if !target.starts_with(&wd_canonical) {
                return Err(format!(
                    "Access denied: path '{}' is outside the project directory",
                    resolved.display()
                ));
            }
        }
        Ok(())
    }

    pub fn working_dir_or_current(&self) -> PathBuf {
        self.working_directory
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    }

    /// Resolve a model-supplied path and enforce file access policy.
    /// All file tools must go through this instead of resolve_path/validate_path.
    pub fn resolve_and_validate(&self, path: &str) -> Result<ResolvedTarget, String> {
        match &self.file_access {
            FileAccess::Unrestricted => {
                let resolved = self.resolve_path(path);
                self.validate_path(&resolved)?;
                Ok(ResolvedTarget::Real(resolved))
            }
            FileAccess::Roots(roots) => {
                if !(path.starts_with('/') || path.starts_with('\\')) {
                    return Err(self.roots_denied_message(path, roots));
                }
                let segs = normalize_segments(path).ok_or_else(|| {
                    format!("Access denied: path '{path}' escapes the filesystem root")
                })?;
                for root in roots {
                    let prefix = prefix_segments(&root.virtual_prefix);
                    if segs.len() >= prefix.len()
                        && segs.iter().map(String::as_str).take(prefix.len()).eq(prefix.iter().copied())
                    {
                        let rest = &segs[prefix.len()..];
                        return Ok(match &root.kind {
                            RootKind::RealPath(base) => {
                                let mut p = base.clone();
                                for s in rest {
                                    p.push(s);
                                }
                                ResolvedTarget::Real(p)
                            }
                            RootKind::SafTree { tree_uri } => ResolvedTarget::Saf {
                                tree_uri: tree_uri.clone(),
                                rel: rest.join("/"),
                            },
                        });
                    }
                }
                Err(self.roots_denied_message(path, roots))
            }
        }
    }

    /// True if the path refers to an access root itself (used to protect roots from deletion/move).
    pub fn is_access_root(&self, path: &str) -> bool {
        if let FileAccess::Roots(roots) = &self.file_access {
            if let Some(segs) = normalize_segments(path) {
                return roots.iter().any(|r| {
                    let prefix = prefix_segments(&r.virtual_prefix);
                    segs.len() == prefix.len()
                        && segs.iter().map(String::as_str).eq(prefix.iter().copied())
                });
            }
        }
        false
    }

    fn roots_denied_message(&self, path: &str, roots: &[AccessRoot]) -> String {
        if roots.is_empty() {
            return format!(
                "Access denied: '{path}'. No file locations have been authorized. \
                 Ask the user to grant file access in Settings (SAF directory or 'All files access')."
            );
        }
        let list: Vec<&str> = roots.iter().map(|r| r.virtual_prefix.as_str()).collect();
        format!(
            "Access denied: '{path}' is outside the authorized locations. \
             Accessible roots: {}",
            list.join(", ")
        )
    }
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    fn default_permission(&self) -> Permission;
    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String>;
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        #[allow(unused_mut)]
        let mut tools: Vec<Box<dyn Tool>> = vec![
            Box::new(ask_user::AskUserTool),
            Box::new(read_file::ReadFileTool),
            Box::new(write_file::WriteFileTool),
            Box::new(list_directory::ListDirectoryTool),
            Box::new(search_files::SearchFilesTool),
            Box::new(apply_patch::ApplyPatchTool),
            Box::new(edit_file::EditFileTool),
            Box::new(glob_files::GlobFilesTool),
            Box::new(delete_file::DeleteFileTool),
            Box::new(move_file::MoveFileTool),
        ];
        #[cfg(not(target_os = "android"))]
        tools.push(Box::new(run_command::RunCommandTool));
        Self { tools }
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    pub fn definitions(&self) -> Vec<crate::provider::ToolDefinition> {
        self.tools
            .iter()
            .map(|t| crate::provider::ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                parameters: t.parameters_schema(),
            })
            .collect()
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_roots(roots: Vec<AccessRoot>) -> ToolContext {
        ToolContext {
            working_directory: None,
            shell: ShellType::Bash,
            file_access: FileAccess::Roots(roots),
        }
    }

    fn real_root(prefix: &str, base: &str) -> AccessRoot {
        AccessRoot {
            virtual_prefix: prefix.to_string(),
            kind: RootKind::RealPath(PathBuf::from(base)),
        }
    }

    fn saf_root(prefix: &str, uri: &str) -> AccessRoot {
        AccessRoot {
            virtual_prefix: prefix.to_string(),
            kind: RootKind::SafTree { tree_uri: uri.to_string() },
        }
    }

    #[test]
    fn unrestricted_outside_working_dir_denied() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext {
            working_directory: Some(dir.path().to_string_lossy().to_string()),
            shell: ShellType::Bash,
            file_access: FileAccess::Unrestricted,
        };
        assert!(ctx.resolve_and_validate("inside.txt").is_ok());
        assert!(ctx.resolve_and_validate("../outside.txt").is_err());
    }

    #[test]
    fn roots_real_path_maps_and_validates() {
        let ctx = ctx_roots(vec![real_root("/storage/emulated/0", "/storage/emulated/0")]);

        let t = ctx.resolve_and_validate("/storage/emulated/0/Download/a.txt").unwrap();
        assert_eq!(
            t,
            ResolvedTarget::Real(PathBuf::from("/storage/emulated/0").join("Download").join("a.txt"))
        );

        // .. escaping the root prefix is rejected
        assert!(ctx.resolve_and_validate("/storage/emulated/0/../../etc/passwd").is_err());
        // .. escaping the filesystem root entirely is rejected
        assert!(ctx.resolve_and_validate("/../etc/passwd").is_err());
        // relative paths are rejected in roots mode
        assert!(ctx.resolve_and_validate("Download/a.txt").is_err());
        // sibling prefix must not match (segment-wise comparison)
        let ctx2 = ctx_roots(vec![real_root("/sdcard", "/storage/emulated/0")]);
        assert!(ctx2.resolve_and_validate("/sdcard-evil/a.txt").is_err());
        assert!(ctx2.resolve_and_validate("/sdcard/a.txt").is_ok());
    }

    #[test]
    fn roots_inner_dotdot_stays_within_root() {
        let ctx = ctx_roots(vec![real_root("/sdcard", "/storage/emulated/0")]);
        let t = ctx.resolve_and_validate("/sdcard/Download/../Pictures/b.jpg").unwrap();
        assert_eq!(
            t,
            ResolvedTarget::Real(PathBuf::from("/storage/emulated/0").join("Pictures").join("b.jpg"))
        );
    }

    #[test]
    fn roots_saf_tree_extracts_rel() {
        let ctx = ctx_roots(vec![saf_root("/saf/Download", "content://tree/primary%3ADownload")]);
        let t = ctx.resolve_and_validate("/saf/Download/sub/a.txt").unwrap();
        assert_eq!(
            t,
            ResolvedTarget::Saf {
                tree_uri: "content://tree/primary%3ADownload".to_string(),
                rel: "sub/a.txt".to_string(),
            }
        );
        assert!(ctx.resolve_and_validate("/saf/Other/a.txt").is_err());
    }

    #[test]
    fn roots_empty_denies_everything() {
        let ctx = ctx_roots(vec![]);
        assert!(ctx.resolve_and_validate("/anything").is_err());
    }

    #[test]
    fn is_access_root_detects_roots_only() {
        let ctx = ctx_roots(vec![real_root("/sdcard", "/storage/emulated/0")]);
        assert!(ctx.is_access_root("/sdcard"));
        assert!(ctx.is_access_root("/sdcard/"));
        assert!(ctx.is_access_root("/sdcard/Download/.."));
        assert!(!ctx.is_access_root("/sdcard/Download"));
        assert!(!ctx.is_access_root("/other"));
    }
}
