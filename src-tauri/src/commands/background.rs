//! Background commands, from the window: the list above the composer, its stop
//! buttons, and the output behind each row.
//!
//! The rules are in `meridian_core::background`. What is here is the shape of
//! each call and the response contract, which says nothing about where a log
//! lives on disk — a phone asking for output gets the bytes, not a path it
//! could not open.

use crate::ServicesExt;
use meridian_core::background::{self, StoppedBy};
use meridian_core::db::entity::background_task::{self, BackgroundKind, BackgroundRunner, BackgroundState};

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundTaskInfoResponse {
    pub id: String,
    pub conversation_id: String,
    pub runner: BackgroundRunner,
    pub kind: BackgroundKind,
    pub command: Option<String>,
    pub description: Option<String>,
    pub state: BackgroundState,
    pub exit_code: Option<i32>,
    pub ended_reason: Option<String>,
    pub output_bytes: i64,
    pub output_truncated: bool,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// Whether the model has been told this task ended.
    pub notified: bool,
}

pub type BackgroundTaskListResponse = Vec<BackgroundTaskInfoResponse>;

impl From<background_task::Model> for BackgroundTaskInfoResponse {
    fn from(row: background_task::Model) -> Self {
        Self {
            runner: row.runner,
            kind: row.kind,
            state: row.state,
            id: row.id,
            conversation_id: row.conversation_id,
            command: row.command,
            description: row.description,
            exit_code: row.exit_code,
            ended_reason: row.ended_reason,
            output_bytes: row.output_bytes,
            output_truncated: row.output_truncated.get(),
            started_at: row.started_at,
            ended_at: row.ended_at,
            notified: row.notified_at.is_some(),
        }
    }
}

/// How many commands a conversation has running.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundTaskCountInfoResponse {
    pub conversation_id: String,
    pub running: i64,
}

pub type BackgroundTaskCountListResponse = Vec<BackgroundTaskCountInfoResponse>;

/// A slice of a task's output.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundTaskOutputInfoResponse {
    pub task: BackgroundTaskInfoResponse,
    pub offset: u64,
    pub content: String,
    pub next_offset: u64,
    pub total_bytes: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundTaskStopRequest {
    conversation_id: String,
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundTaskOutputReadRequest {
    conversation_id: String,
    id: String,
    offset: u64,
}

/// Every background task a conversation has run, oldest first.
#[tauri::command]
pub async fn list_background_tasks(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<BackgroundTaskListResponse, String> {
    Ok(background::list(&app.services().sea, &conversation_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Every conversation with a command running, and how many — what the sidebar
/// marks. Conversations with none are left out rather than listed at zero.
#[tauri::command]
pub async fn background_task_running_counts(app: tauri::AppHandle) -> Result<BackgroundTaskCountListResponse, String> {
    Ok(background::running_counts(&app.services().sea)
        .await?
        .into_iter()
        .map(|(conversation_id, running)| BackgroundTaskCountInfoResponse {
            conversation_id,
            running,
        })
        .collect())
}

/// Stop one. Its ending is owed to the model like any other — the next turn
/// is told somebody stopped it — but it wakes nothing: the person who pressed
/// stop is the one who decides what happens next.
#[tauri::command]
pub async fn stop_background_task(
    app: tauri::AppHandle,
    request: BackgroundTaskStopRequest,
) -> Result<BackgroundTaskInfoResponse, String> {
    background::Launcher::new(app.services())
        .stop(&request.conversation_id, &request.id, StoppedBy::User)
        .await
        .map(Into::into)
}

/// A task's output from `offset`, without waiting: the window reads again when
/// told the task moved.
#[tauri::command]
pub async fn read_background_task_output(
    app: tauri::AppHandle,
    request: BackgroundTaskOutputReadRequest,
) -> Result<BackgroundTaskOutputInfoResponse, String> {
    let output = background::read(
        &app.services(),
        &request.conversation_id,
        &request.id,
        request.offset,
        background::READ_MAX,
        std::time::Duration::ZERO,
    )
    .await?;
    Ok(BackgroundTaskOutputInfoResponse {
        task: output.row.into(),
        offset: output.offset,
        content: output.text,
        next_offset: output.next_offset,
        total_bytes: output.total,
    })
}
