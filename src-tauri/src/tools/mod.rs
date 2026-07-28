pub mod apply_patch;
pub mod ask_user;
pub mod backend;
pub mod custom;
pub mod delete_file;
pub mod edit_file;
pub mod glob_files;
pub mod list_directory;
pub mod memory;
pub mod move_file;
pub mod read_file;
#[cfg(not(target_os = "android"))]
pub mod run_command;
pub mod search_files;
pub mod skill;
pub mod todo;
pub mod web_search;
pub mod write_file;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Permission {
    Always,
    Ask,
    Never,
}

#[derive(Clone)]
pub struct ToolContext {
    pub working_directory: Option<String>,
    pub shell: ShellType,
    pub file_access: FileAccess,
    pub project_id: Option<String>,
    /// The turn's conversation. Anchors state that belongs to this thread of
    /// work rather than to the project, such as the todo checklist.
    pub conversation_id: Option<String>,
    /// Needed to resolve which skills are bound for this turn; skill bindings
    /// are anchored on the assistant as well as the project.
    pub assistant_id: Option<String>,
    pub db_pool: Option<crate::db::DbPool>,
    pub edit_session: Option<Arc<tokio::sync::Mutex<crate::edit_session::EditSession>>>,
    #[cfg(not(target_os = "android"))]
    pub sandbox_policy: Option<crate::sandbox::SandboxPolicy>,
    pub tool_secrets: HashMap<String, String>,
    /// Cancelled when the owning chat turn is stopped; long-running tools must
    /// observe it and terminate their work.
    pub cancel: tokio_util::sync::CancellationToken,
}

impl ToolContext {
    /// Clone of this context with the sandbox disabled — used for the
    /// user-approved "retry without sandbox" escalation path.
    pub fn without_sandbox(&self) -> Self {
        #[allow(unused_mut)]
        let mut ctx = self.clone();
        #[cfg(not(target_os = "android"))]
        {
            ctx.sandbox_policy = None;
        }
        ctx
    }
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
    Saf { tree_uri: String, rel: String, display: String },
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
                                display: format!("{}/{}", root.virtual_prefix, rest.join("/")),
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

/// Sentinel marking a tool error as "blocked by the sandbox" so the agent loop
/// can offer a user-approved retry without sandbox. Control characters keep
/// real tool output from colliding with the marker.
pub const SANDBOX_DENIED_MARKER: &str = "\u{1}SANDBOX_DENIED\u{1}";

pub fn encode_sandbox_denied(output: &str) -> String {
    format!("{SANDBOX_DENIED_MARKER}{output}")
}

pub fn decode_sandbox_denied(err: &str) -> Option<&str> {
    err.strip_prefix(SANDBOX_DENIED_MARKER)
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
    builtin: Vec<Arc<dyn Tool>>,
    custom: std::sync::RwLock<Vec<Arc<dyn Tool>>>,
}

impl ToolRegistry {
    /// `skills_root` is where skill directories live on disk
    /// (`{app_data_dir}/skills`). It is app-global rather than per-request, so
    /// the tool holds it instead of reading it out of `ToolContext`.
    pub fn new(skills_root: std::path::PathBuf) -> Self {
        #[allow(unused_mut)]
        let mut tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(ask_user::AskUserTool),
            Arc::new(skill::LoadSkillTool::new(skills_root)),
            Arc::new(read_file::ReadFileTool),
            Arc::new(write_file::WriteFileTool),
            Arc::new(list_directory::ListDirectoryTool),
            Arc::new(search_files::SearchFilesTool),
            Arc::new(apply_patch::ApplyPatchTool),
            Arc::new(edit_file::EditFileTool),
            Arc::new(glob_files::GlobFilesTool),
            Arc::new(delete_file::DeleteFileTool),
            Arc::new(move_file::MoveFileTool),
            Arc::new(memory::SaveMemoryTool),
            Arc::new(memory::RecallMemoryTool),
            Arc::new(memory::ListMemoriesTool),
            Arc::new(memory::DeleteMemoryTool),
            Arc::new(todo::UpdateTodosTool),
            Arc::new(web_search::WebSearchTool::new()),
        ];
        #[cfg(not(target_os = "android"))]
        tools.push(Arc::new(run_command::RunCommandTool));
        Self { builtin: tools, custom: std::sync::RwLock::new(Vec::new()) }
    }

    /// Replace the set of user-defined tools. Called at startup and after every
    /// create/update/delete so permission changes and deletions take effect
    /// without an app restart.
    pub fn set_custom_tools(&self, tools: Vec<Arc<dyn Tool>>) {
        *self.custom.write().unwrap() = tools;
    }

    pub fn definitions(&self) -> Vec<crate::provider::ToolDefinition> {
        let def = |t: &Arc<dyn Tool>| crate::provider::ToolDefinition {
            name: t.name().to_string(),
            description: t.description().to_string(),
            parameters: t.parameters_schema(),
        };
        let mut out: Vec<_> = self.builtin.iter().map(def).collect();
        out.extend(self.custom.read().unwrap().iter().map(def));
        out
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        // Builtins first, so a custom tool can never shadow a builtin.
        if let Some(t) = self.builtin.iter().find(|t| t.name() == name) {
            return Some(t.clone());
        }
        self.custom.read().unwrap().iter().find(|t| t.name() == name).cloned()
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
            project_id: None,
            conversation_id: None,
            assistant_id: None,
            db_pool: None,
            edit_session: None,
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: HashMap::new(),
            cancel: tokio_util::sync::CancellationToken::new(),
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
            project_id: None,
            conversation_id: None,
            assistant_id: None,
            db_pool: None,
            edit_session: None,
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: HashMap::new(),
            cancel: tokio_util::sync::CancellationToken::new(),
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
                display: "/saf/Download/sub/a.txt".to_string(),
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
