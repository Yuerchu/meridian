//! The file panel's questions: where is the root, what changed, what is here,
//! what does this file say. All read-only; the one command that runs a program
//! (`open_in_editor`) is marked `local` in the command table, because handing a
//! remote caller "run my configured editor command" is handing them a shell.

use std::path::PathBuf;

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::workspace::{self, WorkspaceRoot};

fn reference_context(
    root: &std::path::Path,
    file_access: meridian_core::tools::FileAccess,
) -> meridian_core::tools::ToolContext {
    meridian_core::tools::ToolContext {
        working_directory: Some(root.to_string_lossy().into_owned()),
        shell: meridian_core::tools::ShellType::default_for_platform(),
        file_access,
        project_id: None,
        conversation_id: None,
        turn_id: None,
        assistant_id: None,
        db_pool: None,
        #[cfg(not(target_os = "android"))]
        sandbox_policy: None,
        tool_secrets: Default::default(),
        cancel: tokio_util::sync::CancellationToken::new(),
        journal: None,
    }
}

/// Resolve a conversation's root and, when there is one, ask git about it.
///
/// The database half runs under `spawn_blocking` (pooled connection), the git
/// half stays async (subprocess) — which is why `resolve_workspace_root` hands
/// back `git_available: false` for the command layer to fill in.
#[tauri::command]
pub async fn workspace_root(app: tauri::AppHandle, conversation_id: String) -> Result<WorkspaceRoot, String> {
    let root = resolve_root(&app, conversation_id).await?;
    match root {
        WorkspaceRoot::Ok { root, .. } => {
            let git_available = workspace::git::git_available().await;
            let is_repo = git_available && workspace::git::is_repo(std::path::Path::new(&root)).await;
            Ok(WorkspaceRoot::Ok {
                root,
                git_available,
                is_repo,
            })
        }
        other => Ok(other),
    }
}

#[tauri::command]
pub async fn workspace_tree(
    app: tauri::AppHandle,
    conversation_id: String,
    dir: Option<String>,
) -> Result<Vec<workspace::tree::TreeEntry>, String> {
    let root = require_root(&app, conversation_id).await?;
    tokio::task::spawn_blocking(move || workspace::tree::list_dir(&root, dir.as_deref().unwrap_or("")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn workspace_read_file(
    app: tauri::AppHandle,
    conversation_id: String,
    rel_path: String,
) -> Result<workspace::read::FileContent, String> {
    let root = require_root(&app, conversation_id).await?;
    tokio::task::spawn_blocking(move || workspace::read::read_file(&root, &rel_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Fuzzy `@` completion for either an existing conversation or the project on
/// the empty-state composer. Exactly one owner is required, so a caller cannot
/// use a valid conversation as cover to enumerate a different project.
#[tauri::command]
pub async fn workspace_suggest_refs(
    app: tauri::AppHandle,
    conversation_id: Option<String>,
    project_id: Option<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<workspace::reference::WorkspaceReferenceSuggestion>, String> {
    let root = require_reference_directory(&app, conversation_id, project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await;
    let context = reference_context(&root, file_access);
    workspace::reference::suggest_references_from_context(&context, &query, limit.unwrap_or(15)).await
}

/// Resolve and read one reference through the same limits and containment
/// checks used when a message is sent. This is the read-only preview endpoint;
/// sending still performs a fresh authoritative preflight.
#[tauri::command]
pub async fn workspace_resolve_ref(
    app: tauri::AppHandle,
    conversation_id: Option<String>,
    project_id: Option<String>,
    reference: workspace::reference::WorkspaceReferenceInput,
) -> Result<workspace::reference::WorkspaceReferencePreview, String> {
    let root = require_reference_directory(&app, conversation_id, project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await;
    let context = reference_context(&root, file_access);
    let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
    let mut prepared = workspace::reference::prepare_references(&context, &[reference], &counter, 100_000).await?;
    prepared
        .pop()
        .map(|item| item.preview())
        .ok_or_else(|| "reference did not produce a snapshot".to_string())
}

/// Confirm that a path-looking Markdown token names a real object under the
/// selected workspace. This performs containment and metadata checks only;
/// unlike `workspace_resolve_ref`, it never reads file contents.
#[tauri::command]
pub async fn workspace_probe_ref(
    app: tauri::AppHandle,
    conversation_id: Option<String>,
    project_id: Option<String>,
    path: String,
) -> Result<workspace::reference::WorkspaceReferenceProbe, String> {
    let root = require_reference_directory(&app, conversation_id, project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await;
    let context = reference_context(&root, file_access);
    workspace::reference::probe_reference(&context, &path).await
}

#[tauri::command]
pub async fn workspace_git_status(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<workspace::git::GitStatus, String> {
    let root = require_root(&app, conversation_id).await?;
    workspace::git::status(&root).await
}

#[tauri::command]
pub async fn workspace_git_diff(
    app: tauri::AppHandle,
    conversation_id: String,
    rel_path: Option<String>,
) -> Result<workspace::git::GitDiffResult, String> {
    let root = require_root(&app, conversation_id).await?;
    workspace::git::diff(&root, rel_path.as_deref()).await
}

/// Launch the user's configured editor on a file.
///
/// The command template lives in the `files.editor_command` preference
/// (`{file}` / `{line}` placeholders). The path is verified against the root
/// before it lands in the template: the template is the user's own to break,
/// but the path came over IPC and must not name something outside the project.
#[tauri::command]
pub async fn open_in_editor(
    app: tauri::AppHandle,
    conversation_id: String,
    rel_path: String,
    line: Option<u32>,
) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let (root, template) = tokio::task::spawn_blocking({
        let conversation_id = conversation_id.clone();
        move || -> Result<(PathBuf, Option<String>), String> {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let root = match workspace::resolve_workspace_root(&mut conn, &conversation_id)? {
                WorkspaceRoot::Ok { root, .. } => PathBuf::from(root),
                _ => return Err("workspace unavailable".into()),
            };
            let template =
                db::ops::preference::get_preference(&mut conn, "files.editor_command").map_err(|e| e.to_string())?;
            Ok((root, template))
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let Some(template) = template.filter(|t| !t.trim().is_empty()) else {
        // A distinguishable error: the frontend routes this one to settings
        // instead of a toast.
        return Err("editor_not_configured".into());
    };

    let file =
        meridian_core::tools::verified::verify_path(&root.join(&rel_path), Some(&root)).map_err(|e| e.message())?;

    let file_str = file.to_string_lossy().into_owned();
    let line_str = line.unwrap_or(1).to_string();
    let parts: Vec<String> = split_template(&template)
        .into_iter()
        .map(|part| part.replace("{file}", &file_str).replace("{line}", &line_str))
        .collect();
    let (program, args) = parts.split_first().ok_or("editor command is empty")?;

    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: an editor launcher (`zed`, `code`) is a CLI shim,
        // and without this every open flashes a console.
        cmd.creation_flags(0x08000000);
    }
    // Detached on purpose: the editor outlives this command and nobody waits.
    cmd.spawn().map_err(|e| format!("could not run `{program}`: {e}"))?;
    Ok(())
}

/// Split the editor template into argv, honouring double quotes.
///
/// `split_whitespace` alone breaks the commonest Windows configuration —
/// `"C:\Program Files\Editor\editor.exe" "{file}"` — into `"C:\Program` and
/// friends. Quotes group, and are not part of the token; placeholders are
/// substituted *after* splitting, so a path with spaces lands in one argument
/// without the user having to quote `{file}` at all.
fn split_template(template: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut saw_any = false;
    for c in template.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                saw_any = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if saw_any {
                    parts.push(std::mem::take(&mut current));
                    saw_any = false;
                }
            }
            c => {
                current.push(c);
                saw_any = true;
            }
        }
    }
    if saw_any {
        parts.push(current);
    }
    parts
}

/// The root or an error naming why there is none, shared by every command that
/// needs a directory to work in — the journal commands included, so "which
/// directory does this conversation mean" cannot fork between the two modules.
pub(crate) async fn require_root(app: &tauri::AppHandle, conversation_id: String) -> Result<PathBuf, String> {
    match resolve_root(app, conversation_id).await? {
        WorkspaceRoot::Ok { root, .. } => Ok(PathBuf::from(root)),
        WorkspaceRoot::NoProject => Err("no_project".into()),
        WorkspaceRoot::NoPath => Err("no_path".into()),
        WorkspaceRoot::MissingDir { path } => Err(format!("missing_dir:{path}")),
    }
}

async fn resolve_root(app: &tauri::AppHandle, conversation_id: String) -> Result<WorkspaceRoot, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        workspace::resolve_workspace_root(&mut conn, &conversation_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn require_reference_directory(
    app: &tauri::AppHandle,
    conversation_id: Option<String>,
    project_id: Option<String>,
) -> Result<PathBuf, String> {
    match (conversation_id, project_id) {
        (Some(conversation_id), None) => {
            let pool = app.services().db.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().map_err(|e| e.to_string())?;
                workspace::resolve_workspace_dir(&mut conn, &conversation_id)?.ok_or_else(|| "no_path".to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        (None, Some(project_id)) => {
            let pool = app.services().db.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = pool.get().map_err(|e| e.to_string())?;
                let project = db::ops::project::get_project(&mut conn, &project_id).map_err(|e| e.to_string())?;
                project.path.map(PathBuf::from).ok_or_else(|| "no_path".to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        _ => Err("exactly one of conversation_id or project_id is required".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::split_template;

    /// The commonest Windows configuration: a quoted program path with spaces.
    /// `split_whitespace` turned it into `"C:\Program` and always failed.
    #[test]
    fn quoted_program_paths_stay_one_token() {
        assert_eq!(
            split_template(r#""C:\Program Files\Editor\editor.exe" "{file}" --line {line}"#),
            vec![r"C:\Program Files\Editor\editor.exe", "{file}", "--line", "{line}"]
        );
    }

    #[test]
    fn unquoted_templates_split_on_whitespace() {
        assert_eq!(split_template("zed {file}:{line}"), vec!["zed", "{file}:{line}"]);
    }

    /// A quoted empty argument is an argument; trailing whitespace is not.
    #[test]
    fn empty_quotes_and_trailing_space() {
        assert_eq!(split_template(r#"editor "" x "#), vec!["editor", "", "x"]);
    }
}
