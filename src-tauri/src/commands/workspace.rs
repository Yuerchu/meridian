//! The file panel's questions: where is the root, what changed, what is here,
//! what does this file say. All read-only; the one command that runs a program
//! (`open_in_editor`) is marked `local` in the command table, because handing a
//! remote caller "run my configured editor command" is handing them a shell.

use std::path::PathBuf;

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::workspace::{self, WorkspaceRoot};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRootRequest {
    conversation_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WorkspaceRootResponse {
    Ok {
        root: String,
        git_available: bool,
        is_repo: bool,
    },
    NoProject,
    NoPath,
    MissingDir {
        path: String,
    },
}

impl From<WorkspaceRoot> for WorkspaceRootResponse {
    fn from(root: WorkspaceRoot) -> Self {
        match root {
            WorkspaceRoot::Ok {
                root,
                git_available,
                is_repo,
            } => Self::Ok {
                root,
                git_available,
                is_repo,
            },
            WorkspaceRoot::NoProject => Self::NoProject,
            WorkspaceRoot::NoPath => Self::NoPath,
            WorkspaceRoot::MissingDir { path } => Self::MissingDir { path },
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceTreeRequest {
    conversation_id: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    dir: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceTreeEntryInfoResponse {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
}

pub type WorkspaceTreeEntryListResponse = Vec<WorkspaceTreeEntryInfoResponse>;

impl From<workspace::tree::TreeEntry> for WorkspaceTreeEntryInfoResponse {
    fn from(entry: workspace::tree::TreeEntry) -> Self {
        Self {
            name: entry.name,
            rel_path: entry.rel_path,
            is_dir: entry.is_dir,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceFileReadRequest {
    conversation_id: String,
    rel_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceFileContentResponse {
    pub content: String,
    pub truncated: bool,
    pub total_lines: u64,
    pub size_bytes: u64,
    pub binary: bool,
}

impl From<workspace::read::FileContent> for WorkspaceFileContentResponse {
    fn from(file: workspace::read::FileContent) -> Self {
        Self {
            content: file.content,
            truncated: file.truncated,
            total_lines: file.total_lines,
            size_bytes: file.size_bytes,
            binary: file.binary,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceReferenceSuggestRequest {
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    conversation_id: Option<String>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    project_id: Option<String>,
    query: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    limit: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceReferenceSuggestionInfoResponse {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

pub type WorkspaceReferenceSuggestionListResponse = Vec<WorkspaceReferenceSuggestionInfoResponse>;

impl From<workspace::reference::WorkspaceReferenceSuggestion> for WorkspaceReferenceSuggestionInfoResponse {
    fn from(suggestion: workspace::reference::WorkspaceReferenceSuggestion) -> Self {
        Self {
            path: suggestion.path,
            name: suggestion.name,
            is_dir: suggestion.is_dir,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceReferenceResolveRequest {
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    conversation_id: Option<String>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    project_id: Option<String>,
    path: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    line_start: Option<u32>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    line_end: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceReferencePreviewResponse {
    pub kind: workspace::reference::WorkspaceReferenceKind,
    pub path: String,
    pub content: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub byte_count: usize,
    pub line_count: usize,
    pub token_count: usize,
    pub truncated: bool,
}

impl From<workspace::reference::WorkspaceReferencePreview> for WorkspaceReferencePreviewResponse {
    fn from(preview: workspace::reference::WorkspaceReferencePreview) -> Self {
        Self {
            kind: preview.kind,
            path: preview.path,
            content: preview.content,
            line_start: preview.line_start,
            line_end: preview.line_end,
            byte_count: preview.byte_count,
            line_count: preview.line_count,
            token_count: preview.token_count,
            truncated: preview.truncated,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceReferenceProbeRequest {
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    conversation_id: Option<String>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    project_id: Option<String>,
    path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceReferenceProbeResponse {
    pub kind: workspace::reference::WorkspaceReferenceKind,
    pub path: String,
}

impl From<workspace::reference::WorkspaceReferenceProbe> for WorkspaceReferenceProbeResponse {
    fn from(probe: workspace::reference::WorkspaceReferenceProbe) -> Self {
        Self {
            kind: probe.kind,
            path: probe.path,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceGitStatusRequest {
    conversation_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceGitStatusEntryInfoResponse {
    pub path: String,
    pub status: workspace::git::GitFileStatus,
    pub renamed_from: Option<String>,
}

impl From<workspace::git::StatusEntry> for WorkspaceGitStatusEntryInfoResponse {
    fn from(entry: workspace::git::StatusEntry) -> Self {
        Self {
            path: entry.path,
            status: entry.status,
            renamed_from: entry.renamed_from,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WorkspaceGitStatusResponse {
    Ok {
        branch: Option<String>,
        files: Vec<WorkspaceGitStatusEntryInfoResponse>,
    },
    NoGit,
    NotRepo,
}

impl From<workspace::git::GitStatus> for WorkspaceGitStatusResponse {
    fn from(status: workspace::git::GitStatus) -> Self {
        match status {
            workspace::git::GitStatus::Ok { branch, files } => Self::Ok {
                branch,
                files: files.into_iter().map(Into::into).collect(),
            },
            workspace::git::GitStatus::NoGit => Self::NoGit,
            workspace::git::GitStatus::NotRepo => Self::NotRepo,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceGitDiffRequest {
    conversation_id: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    rel_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceGitDiffResponse {
    pub diff_text: String,
    pub truncated: bool,
}

impl From<workspace::git::GitDiffResult> for WorkspaceGitDiffResponse {
    fn from(diff: workspace::git::GitDiffResult) -> Self {
        Self {
            diff_text: diff.diff_text,
            truncated: diff.truncated,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceEditorOpenRequest {
    conversation_id: String,
    rel_path: String,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    line: Option<u32>,
}

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
pub async fn workspace_root(
    app: tauri::AppHandle,
    request: WorkspaceRootRequest,
) -> Result<WorkspaceRootResponse, String> {
    let root = resolve_root(&app, request.conversation_id).await?;
    match root {
        WorkspaceRoot::Ok { root, .. } => {
            let git_available = workspace::git::git_available().await;
            let is_repo = git_available && workspace::git::is_repo(std::path::Path::new(&root)).await;
            Ok(WorkspaceRootResponse::Ok {
                root,
                git_available,
                is_repo,
            })
        }
        other => Ok(other.into()),
    }
}

#[tauri::command]
pub async fn workspace_tree(
    app: tauri::AppHandle,
    request: WorkspaceTreeRequest,
) -> Result<WorkspaceTreeEntryListResponse, String> {
    let root = require_root(&app, request.conversation_id).await?;
    let entries =
        tokio::task::spawn_blocking(move || workspace::tree::list_dir(&root, request.dir.as_deref().unwrap_or("")))
            .await
            .map_err(|e| e.to_string())??;
    Ok(entries.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn workspace_read_file(
    app: tauri::AppHandle,
    request: WorkspaceFileReadRequest,
) -> Result<WorkspaceFileContentResponse, String> {
    let root = require_root(&app, request.conversation_id).await?;
    let file = tokio::task::spawn_blocking(move || workspace::read::read_file(&root, &request.rel_path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(file.into())
}

/// Fuzzy `@` completion for either an existing conversation or the project on
/// the empty-state composer. Exactly one owner is required, so a caller cannot
/// use a valid conversation as cover to enumerate a different project.
#[tauri::command]
pub async fn workspace_suggest_refs(
    app: tauri::AppHandle,
    request: WorkspaceReferenceSuggestRequest,
) -> Result<WorkspaceReferenceSuggestionListResponse, String> {
    let root = require_reference_directory(&app, request.conversation_id, request.project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await?;
    let context = reference_context(&root, file_access);
    let suggestions =
        workspace::reference::suggest_references_from_context(&context, &request.query, request.limit.unwrap_or(15))
            .await?;
    Ok(suggestions.into_iter().map(Into::into).collect())
}

/// Resolve and read one reference through the same limits and containment
/// checks used when a message is sent. This is the read-only preview endpoint;
/// sending still performs a fresh authoritative preflight.
#[tauri::command]
pub async fn workspace_resolve_ref(
    app: tauri::AppHandle,
    request: WorkspaceReferenceResolveRequest,
) -> Result<WorkspaceReferencePreviewResponse, String> {
    let WorkspaceReferenceResolveRequest {
        conversation_id,
        project_id,
        path,
        line_start,
        line_end,
    } = request;
    let root = require_reference_directory(&app, conversation_id, project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await?;
    let context = reference_context(&root, file_access);
    let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
    let reference = workspace::reference::WorkspaceReferenceRequest {
        path,
        line_start,
        line_end,
    };
    let mut prepared = workspace::reference::prepare_references(&context, &[reference], &counter, 100_000).await?;
    prepared
        .pop()
        .map(|item| item.preview())
        .map(Into::into)
        .ok_or_else(|| "reference did not produce a snapshot".to_string())
}

/// Confirm that a path-looking Markdown token names a real object under the
/// selected workspace. This performs containment and metadata checks only;
/// unlike `workspace_resolve_ref`, it never reads file contents.
#[tauri::command]
pub async fn workspace_probe_ref(
    app: tauri::AppHandle,
    request: WorkspaceReferenceProbeRequest,
) -> Result<WorkspaceReferenceProbeResponse, String> {
    let root = require_reference_directory(&app, request.conversation_id, request.project_id).await?;
    let file_access = meridian_core::agent::build_file_access(&app.services().db).await?;
    let context = reference_context(&root, file_access);
    workspace::reference::probe_reference(&context, &request.path)
        .await
        .map(Into::into)
}

#[tauri::command]
pub async fn workspace_git_status(
    app: tauri::AppHandle,
    request: WorkspaceGitStatusRequest,
) -> Result<WorkspaceGitStatusResponse, String> {
    let root = require_root(&app, request.conversation_id).await?;
    workspace::git::status(&root).await.map(Into::into)
}

#[tauri::command]
pub async fn workspace_git_diff(
    app: tauri::AppHandle,
    request: WorkspaceGitDiffRequest,
) -> Result<WorkspaceGitDiffResponse, String> {
    let root = require_root(&app, request.conversation_id).await?;
    workspace::git::diff(&root, request.rel_path.as_deref())
        .await
        .map(Into::into)
}

/// Launch the user's configured editor on a file.
///
/// The command template lives in the `files.editor_command` preference
/// (`{file}` / `{line}` placeholders). The path is verified against the root
/// before it lands in the template: the template is the user's own to break,
/// but the path came over IPC and must not name something outside the project.
#[tauri::command]
pub async fn open_in_editor(app: tauri::AppHandle, request: WorkspaceEditorOpenRequest) -> Result<(), String> {
    let WorkspaceEditorOpenRequest {
        conversation_id,
        rel_path,
        line,
    } = request;
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
    use super::*;

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

    #[test]
    fn workspace_requests_reject_unknown_and_omitted_nullable_fields() {
        let valid = serde_json::json!({
            "conversationId": "conversation-1",
            "projectId": null,
            "path": "src/main.rs",
            "lineStart": null,
            "lineEnd": null
        });
        serde_json::from_value::<WorkspaceReferenceResolveRequest>(valid.clone()).unwrap();

        let mut missing_nullable = valid.clone();
        missing_nullable.as_object_mut().unwrap().remove("lineEnd");
        assert!(serde_json::from_value::<WorkspaceReferenceResolveRequest>(missing_nullable).is_err());

        let mut unknown = valid;
        unknown
            .as_object_mut()
            .unwrap()
            .insert("legacyPath".into(), serde_json::json!("src/old.rs"));
        assert!(serde_json::from_value::<WorkspaceReferenceResolveRequest>(unknown).is_err());
    }

    #[test]
    fn workspace_root_response_is_mapped_field_by_field() {
        let response = WorkspaceRootResponse::from(WorkspaceRoot::Ok {
            root: "C:/repo".into(),
            git_available: true,
            is_repo: false,
        });

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "state": "ok",
                "root": "C:/repo",
                "git_available": true,
                "is_repo": false
            })
        );
    }

    #[test]
    fn workspace_git_response_maps_nested_core_entries() {
        let response = WorkspaceGitStatusResponse::from(workspace::git::GitStatus::Ok {
            branch: Some("main".into()),
            files: vec![workspace::git::StatusEntry {
                path: "src/main.rs".into(),
                status: workspace::git::GitFileStatus::Modified,
                renamed_from: None,
            }],
        });

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "state": "ok",
                "branch": "main",
                "files": [{
                    "path": "src/main.rs",
                    "status": "modified",
                    "renamed_from": null
                }]
            })
        );
    }
}
