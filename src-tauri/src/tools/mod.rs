pub mod app_logs;
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
pub mod plan;
pub mod read_file;
pub mod reach;
#[cfg(not(target_os = "android"))]
pub mod run_command;
pub mod search_files;
pub mod skill;
pub mod sub_agent;
pub mod todo;
pub mod verified;
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

/// A target that is not merely validated but *open*, with the check applied to
/// the handle that will do the work.
///
/// The distinction from `ResolvedTarget` is the whole point of this layer. A
/// resolved path was correct when it was checked; an opened target is correct
/// when it is used, because there is no second resolution in between. Tools
/// that may run without asking the user must use this. Tools that always ask
/// may use `ResolvedTarget`, since a person is watching the gap.
#[derive(Debug)]
pub enum OpenedTarget {
    Real(verified::VerifiedFile),
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

    /// The project directory as the OS spells it, or None when the session is
    /// not bound to a project.
    ///
    /// Resolved on every call rather than cached at construction: it is one
    /// open plus one query, and caching it would mean a project directory that
    /// gets replaced mid-session keeps being compared against the old object.
    pub fn verified_root(&self) -> Result<Option<PathBuf>, String> {
        let Some(ref wd) = self.working_directory else { return Ok(None) };
        // A project directory that cannot be opened is a broken configuration,
        // not a traversal attempt; the message should say so rather than
        // blaming the file the model asked for.
        verified::resolve_root(Path::new(wd))
            .map(Some)
            .map_err(|e| format!("project directory is unusable: {}", e.message()))
    }

    pub fn working_dir_or_current(&self) -> PathBuf {
        self.working_directory
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    }

    /// Records a refusal.
    ///
    /// The three access modes fail for entirely different reasons, and from the
    /// outside they all read as "Access denied" — an Android user who has
    /// granted a folder and a model walking out of the project directory produce
    /// the same message. `mode` and `reason` are what tell them apart. This is
    /// also the only signal that a path traversal was attempted at all.
    fn log_denied(&self, path: &str, mode: &'static str, reason: &'static str, root_count: usize) {
        tracing::warn!(
            denied_path = %path,
            access_mode = mode,
            reason,
            // Not the roots themselves: those spell out the user's directory
            // layout.
            root_count,
            "file access denied"
        );
    }

    /// Resolve a model-supplied path and enforce file access policy.
    /// All file tools must go through this instead of resolve_path/validate_path.
    pub fn resolve_and_validate(&self, path: &str) -> Result<ResolvedTarget, String> {
        match &self.file_access {
            FileAccess::Unrestricted => {
                let resolved = self.resolve_path(path);
                let root = self.verified_root()?;
                // Returns the path the OS confirmed, not the one that was asked
                // for, so path-based I/O downstream operates on the spelling
                // that was actually checked.
                let real = verified::verify_path(&resolved, root.as_deref())
                    .map_err(|e| e.message())?;
                Ok(ResolvedTarget::Real(real))
            }
            FileAccess::Roots(roots) => {
                // An empty root set is the OneBot path and an Android install
                // with nothing granted; worth telling apart from a path that
                // simply missed.
                let mode = if roots.is_empty() { "roots_empty" } else { "roots" };
                if !(path.starts_with('/') || path.starts_with('\\')) {
                    self.log_denied(path, mode, "relative_path_in_roots_mode", roots.len());
                    return Err(self.roots_denied_message(path, roots));
                }
                let segs = normalize_segments(path).ok_or_else(|| {
                    self.log_denied(path, mode, "escapes_filesystem_root", roots.len());
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
                self.log_denied(path, mode, "no_matching_root", roots.len());
                Err(self.roots_denied_message(path, roots))
            }
        }
    }

    /// Resolve, verify, and open a path for reading in one step.
    ///
    /// Policy still comes from `resolve_and_validate` — it knows about SAF
    /// roots and the Android whitelist. What this adds is that the file is then
    /// opened and re-confirmed against the handle, so the read cannot land
    /// anywhere other than what was approved.
    pub fn open_read(&self, path: &str) -> Result<OpenedTarget, String> {
        match self.resolve_and_validate(path)? {
            ResolvedTarget::Real(p) => {
                let root = self.verified_root()?;
                let vf = verified::open_read(&p, root.as_deref()).map_err(|e| e.message())?;
                Ok(OpenedTarget::Real(vf))
            }
            ResolvedTarget::Saf { tree_uri, rel, display } => {
                Ok(OpenedTarget::Saf { tree_uri, rel, display })
            }
        }
    }

    /// The same for writing. The file is created if absent but never truncated
    /// before the check passes.
    pub fn open_write(&self, path: &str) -> Result<OpenedTarget, String> {
        match self.resolve_and_validate(path)? {
            ResolvedTarget::Real(p) => {
                let root = self.verified_root()?;
                let vf = verified::open_write(&p, root.as_deref()).map_err(|e| e.message())?;
                Ok(OpenedTarget::Real(vf))
            }
            ResolvedTarget::Saf { tree_uri, rel, display } => {
                Ok(OpenedTarget::Saf { tree_uri, rel, display })
            }
        }
    }

    /// Create a file that must not already exist. The refusal is atomic with
    /// the creation, so it cannot approve an overwrite of something that
    /// appeared after the check.
    pub fn open_create_new(&self, path: &str) -> Result<OpenedTarget, String> {
        match self.resolve_and_validate(path)? {
            ResolvedTarget::Real(p) => {
                let root = self.verified_root()?;
                let vf = verified::open_create_new(&p, root.as_deref()).map_err(|e| e.message())?;
                Ok(OpenedTarget::Real(vf))
            }
            ResolvedTarget::Saf { tree_uri, rel, display } => {
                Ok(OpenedTarget::Saf { tree_uri, rel, display })
            }
        }
    }

    /// The same for editing: the file must already exist, and is never created.
    pub fn open_edit(&self, path: &str) -> Result<OpenedTarget, String> {
        match self.resolve_and_validate(path)? {
            ResolvedTarget::Real(p) => {
                let root = self.verified_root()?;
                let vf = verified::open_edit(&p, root.as_deref()).map_err(|e| e.message())?;
                Ok(OpenedTarget::Real(vf))
            }
            ResolvedTarget::Saf { tree_uri, rel, display } => {
                Ok(OpenedTarget::Saf { tree_uri, rel, display })
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

    /// What this particular call would touch.
    ///
    /// The default is the conservative answer: a tool that has not worked out
    /// where it lands is always asked about. Only tools whose `Permission` is
    /// `Ask` need to override it — for `Always` and `Never` the reach changes
    /// nothing.
    fn reach(&self, _args: &serde_json::Value, _context: &ToolContext) -> reach::Reach {
        reach::Reach::Outside
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String>;
}

pub struct ToolRegistry {
    builtin: Vec<Arc<dyn Tool>>,
    custom: std::sync::RwLock<Vec<Arc<dyn Tool>>>,
}

impl ToolRegistry {
    /// `skills_root` and `logs_dir` are where skill directories and the
    /// application log live on disk (`{app_data_dir}/skills` and `/logs`). Both
    /// are app-global rather than per-request, so the tools hold them instead of
    /// reading them out of `ToolContext` — and both sit outside every
    /// `FileAccess` root, which is why these two tools resolve their own paths.
    pub fn new(skills_root: std::path::PathBuf, logs_dir: std::path::PathBuf) -> Self {
        #[allow(unused_mut)]
        let mut tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(ask_user::AskUserTool),
            Arc::new(skill::LoadSkillTool::new(skills_root)),
            // Registered unconditionally: unlike run_command, this one matters
            // most exactly where the file tools cannot reach.
            Arc::new(app_logs::ReadAppLogsTool::new(logs_dir)),
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
            Arc::new(plan::EnterPlanTool),
            Arc::new(plan::ExitPlanTool),
            // In the registry like anything else, but only ever offered to a
            // runner that has somewhere to run a sub-agent. Which runners those
            // are is decided in `TurnConfigInput`, not here and not at dispatch:
            // `PlanTransitions` rebuilds the tool set mid-turn and would undo
            // any filtering a call site did.
            Arc::new(sub_agent::RunAgentTool),
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
