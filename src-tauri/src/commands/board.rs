//! The agent board's commands: cards, the columns they are in, and the
//! worktree each started card works in.
//!
//! A card's column is a person's choice, set here and nowhere else; starting a
//! card is the one write that also moves it (to running). Starting makes the
//! worktree first and the conversation second, and undoes the worktree when
//! the conversation cannot be made, so no conversation ever exists that should
//! work in a worktree and does not have one.
//!
//! A started card is deleted together with its conversation, and only once its
//! worktree is gone. Deleting the card alone would leave a conversation that is
//! no longer a card, which the working-directory resolver would then send to
//! the project's main checkout.

use serde::Serialize;

use crate::ServicesExt;
use crate::commands::entity_response::{BoardTaskInfoResponse, BoardTaskListResponse, ConversationInfoResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::acp::{ProjectChoice, SessionOpening};
use meridian_core::db::entity::board_task::{BoardAgentKind, BoardSource, BoardStage};
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::ops::{
    assistant as assistant_ops, board_task, conversation as conversation_ops, project as project_ops,
};
use meridian_core::services::Services;
use meridian_core::util::now_ms;
use meridian_core::worktree;

/// The board's own channel: only these commands change a card, so only they
/// announce one. A payload of `None` asks for the whole board to be read again.
pub const BOARD_UPDATED_CHANNEL: &str = "board-updated";

#[derive(Debug, Clone, Serialize)]
pub struct BoardUpdatedEvent {
    pub task_id: Option<String>,
}

fn announce(services: &Services, task_id: Option<&str>) {
    let _ = services.events.emit_typed(
        BOARD_UPDATED_CHANNEL,
        &BoardUpdatedEvent {
            task_id: task_id.map(str::to_owned),
        },
    );
}

const TITLE_LIMIT: usize = 80;

fn title_of(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("a card needs a title".into());
    }
    Ok(title.chars().take(TITLE_LIMIT).collect())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskCreateRequest {
    project_id: String,
    title: String,
    request: RequiredNullable<String>,
    stage: BoardStage,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskUpdateRequest {
    id: String,
    title: String,
    request: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskMoveRequest {
    id: String,
    stage: BoardStage,
    index: u32,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskStartRequest {
    id: String,
    agent_kind: BoardAgentKind,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskWorktreeRemoveRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardTaskDeleteRequest {
    id: String,
}

#[derive(Debug, Serialize)]
pub struct BoardTaskStartResponse {
    pub task: BoardTaskInfoResponse,
    pub conversation: ConversationInfoResponse,
}

async fn card(services: &Services, id: &str) -> Result<meridian_core::db::entity::board_task::Model, String> {
    board_task::get(&services.db, id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("board card `{id}` not found"))
}

#[tauri::command]
pub async fn board_task_list(app: tauri::AppHandle) -> Result<BoardTaskListResponse, String> {
    let rows = board_task::list(&app.services().db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn board_task_create(
    app: tauri::AppHandle,
    request: BoardTaskCreateRequest,
) -> Result<BoardTaskInfoResponse, String> {
    create(&app.services(), request).await
}

pub(crate) async fn create(
    services: &Services,
    request: BoardTaskCreateRequest,
) -> Result<BoardTaskInfoResponse, String> {
    let title = title_of(&request.title)?;
    let id = uuid::Uuid::new_v4().to_string();
    let row = services
        .db
        .write(async |tx| {
            // The project read under the write that files the card under it.
            if project_ops::get_project(tx, &request.project_id).await?.is_none() {
                return Ok(Err(format!("project `{}` not found", request.project_id)));
            }
            let row = board_task::insert(
                tx,
                &board_task::BoardTaskInsert {
                    id: &id,
                    project_id: &request.project_id,
                    source: BoardSource::Local,
                    title: &title,
                    request: request.request.0.as_deref(),
                    stage: request.stage,
                    now: now_ms(),
                },
            )
            .await?;
            Ok::<_, DbErr>(Ok(row))
        })
        .await
        .map_err(|e| e.to_string())??;
    announce(services, Some(&row.id));
    Ok(row.into())
}

#[tauri::command]
pub async fn board_task_update(
    app: tauri::AppHandle,
    request: BoardTaskUpdateRequest,
) -> Result<BoardTaskInfoResponse, String> {
    let services = app.services();
    let title = title_of(&request.title)?;
    let change = board_task::BoardTaskChangeset {
        title: Some(&title),
        request: Some(request.request.0.as_deref()),
        now: now_ms(),
    };
    let updated = services
        .db
        .write(async |tx| board_task::update(tx, &request.id, &change).await)
        .await
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err(format!("board card `{}` not found", request.id));
    }
    announce(&services, Some(&request.id));
    card(&services, &request.id).await.map(Into::into)
}

#[tauri::command]
pub async fn board_task_move(
    app: tauri::AppHandle,
    request: BoardTaskMoveRequest,
) -> Result<BoardTaskInfoResponse, String> {
    let services = app.services();
    let index = usize::try_from(request.index).map_err(|e| e.to_string())?;
    let moved = services
        .db
        .write(async |tx| board_task::move_to(tx, &request.id, request.stage, index, now_ms()).await)
        .await
        .map_err(|e| e.to_string())?;
    if !moved {
        return Err(format!("board card `{}` not found", request.id));
    }
    // The whole column was renumbered, not just this card.
    announce(&services, None);
    card(&services, &request.id).await.map(Into::into)
}

#[tauri::command]
pub async fn board_task_start(
    app: tauri::AppHandle,
    request: BoardTaskStartRequest,
) -> Result<BoardTaskStartResponse, String> {
    start(&app.services(), request).await
}

fn started<'a>(
    conversation_id: &'a str,
    agent_kind: BoardAgentKind,
    dir: &'a str,
) -> board_task::BoardTaskStartChangeset<'a> {
    board_task::BoardTaskStartChangeset {
        conversation_id,
        agent_kind,
        worktree_path: dir,
        now: now_ms(),
    }
}

/// `set_started` answering 0 is a card started by someone else in between —
/// an error, so the write that made this conversation rolls back with it.
fn started_once(rows: u64) -> Result<(), DbErr> {
    if rows == 0 {
        return Err(DbErr::Custom("this card was started meanwhile".into()));
    }
    Ok(())
}

/// A native card's conversation and the card's claim on it, in the caller's
/// write: either both land or neither does. A card someone else started in
/// between rolls the conversation back with it.
async fn claim_native(
    tx: &meridian_core::db::sea::cap::WriteTx,
    task: &meridian_core::db::entity::board_task::Model,
    conversation_id: &str,
    dir: &str,
) -> Result<(), DbErr> {
    let default_assistant = assistant_ops::get_default_assistant(tx).await?;
    conversation_ops::create_conversation(
        tx,
        conversation_id,
        Some(&task.title),
        default_assistant.as_ref().map(|a| a.id.as_str()),
        Some(&task.project_id),
        now_ms(),
    )
    .await?;
    let rows = board_task::set_started(tx, &task.id, &started(conversation_id, BoardAgentKind::Native, dir)).await?;
    started_once(rows)
}

pub(crate) async fn start(
    services: &Services,
    request: BoardTaskStartRequest,
) -> Result<BoardTaskStartResponse, String> {
    let task = card(services, &request.id).await?;
    if task.conversation_id.is_some() || task.worktree_removed_at.is_some() {
        return Err("this card has already been started".into());
    }
    // pool-read-before-write: the card and its project are read before the
    // worktree is checked out, which takes seconds and must hold no lock; the
    // write that claims the card admits only one that still has no
    // conversation (`set_started`), so a card started in between is refused
    // there and this start undoes its worktree.
    let project = project_ops::get_project(&services.db, &task.project_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project `{}` not found", task.project_id))?;
    let Some(project_path) = project.path else {
        return Err("the card's project has no folder; give the project one before starting a card".into());
    };

    // The worktree first. The card's id names its directory: the branch, and
    // what it starts from, are the agent's to choose once it is in there.
    let name: String = task.id.chars().filter(char::is_ascii_alphanumeric).take(8).collect();
    let made = worktree::add_detached(std::path::Path::new(&project_path), &name, None)
        .await
        .map_err(|e| e.to_string())?;
    let dir = made.dir.to_string_lossy().into_owned();
    let undo_worktree = async || {
        if let Err(e) = worktree::remove(&made.dir, true).await {
            tracing::warn!(error = %e, "could not remove the worktree of a card that failed to start");
        }
    };

    let conversation_id = match request.agent_kind {
        // The conversation and the card's claim on it in one write: there is no
        // moment where the conversation exists and its turns would resolve to
        // the project's main checkout.
        BoardAgentKind::Native => {
            let id = uuid::Uuid::new_v4().to_string();
            let written = services
                .db
                .write(async |tx| claim_native(tx, &task, &id, &dir).await)
                .await;
            if let Err(e) = written {
                undo_worktree().await;
                return Err(e.to_string());
            }
            id
        }
        // A hosted session is opened in the worktree, so its directory is the
        // session's own record; the card's claim follows, and a failure there
        // takes the session, its conversation and the worktree back.
        BoardAgentKind::ClaudeCode => {
            let opening = SessionOpening {
                cwd: &dir,
                project: ProjectChoice::Explicit(Some(&task.project_id)),
                title: Some(&task.title),
            };
            let id = match meridian_core::acp::open_session_as(services, opening).await {
                Ok(id) => id,
                Err(e) => {
                    undo_worktree().await;
                    return Err(e);
                }
            };
            let claimed = services
                .db
                .write(async |tx| {
                    let rows =
                        board_task::set_started(tx, &task.id, &started(&id, BoardAgentKind::ClaudeCode, &dir)).await?;
                    started_once(rows)
                })
                .await;
            if let Err(e) = claimed {
                services.acp.close(&id).await;
                let _ = services
                    .db
                    .write(async |tx| conversation_ops::delete_conversation(tx, &id).await)
                    .await;
                undo_worktree().await;
                return Err(e.to_string());
            }
            id
        }
    };

    announce(services, Some(&task.id));
    let _ = services.events.emit_conversation_updated(&conversation_id);
    let conversation = conversation_ops::get_conversation(&services.db, &conversation_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("conversation `{conversation_id}` not found"))?;
    Ok(BoardTaskStartResponse {
        task: card(services, &task.id).await?.into(),
        conversation: conversation.try_into()?,
    })
}

#[tauri::command]
pub async fn board_task_remove_worktree(
    app: tauri::AppHandle,
    request: BoardTaskWorktreeRemoveRequest,
) -> Result<BoardTaskInfoResponse, String> {
    remove_worktree(&app.services(), &request.id).await
}

/// A person removing a card's worktree. Refused while the agent is working,
/// and — by `worktree::remove` — while the worktree holds uncommitted changes
/// or commits no branch holds. The card moves to done: it has nowhere left to
/// work, and its conversation is refused by the resolver from now on.
pub(crate) async fn remove_worktree(services: &Services, id: &str) -> Result<BoardTaskInfoResponse, String> {
    let task = card(services, id).await?;
    let Some(path) = task.worktree_path.clone() else {
        return Err("this card has no worktree".into());
    };
    // No turn may start on the conversation while its directory goes away.
    let _lease = match task.conversation_id.as_deref() {
        Some(conversation_id) => Some(
            services
                .turns
                .try_acquire_mutations(&[conversation_id.to_owned()], "removing its worktree")
                .map_err(|busy| busy.to_string())?,
        ),
        None => None,
    };
    // A hosted agent's process stands in the worktree, and Windows will not
    // delete a directory a process is standing in.
    if let Some(conversation_id) = task.conversation_id.as_deref() {
        services.acp.close(conversation_id).await;
    }
    worktree::remove(std::path::Path::new(&path), false)
        .await
        .map_err(|e| e.to_string())?;
    services
        .db
        .write(async |tx| {
            board_task::clear_worktree(tx, id, now_ms()).await?;
            board_task::move_to(tx, id, BoardStage::Done, usize::MAX, now_ms()).await
        })
        .await
        .map_err(|e| e.to_string())?;
    announce(services, None);
    card(services, id).await.map(Into::into)
}

#[tauri::command]
pub async fn board_task_delete(app: tauri::AppHandle, request: BoardTaskDeleteRequest) -> Result<(), String> {
    delete(&app.services(), &request.id).await
}

/// A card that never started goes alone. A started one goes with its
/// conversation, and only once its worktree has been removed: the card alone
/// would leave a conversation the resolver sends to the main checkout.
pub(crate) async fn delete(services: &Services, id: &str) -> Result<(), String> {
    let task = card(services, id).await?;
    if task.worktree_path.is_some() {
        return Err("remove the card's worktree before deleting it".into());
    }
    if let Some(conversation_id) = task.conversation_id.as_deref() {
        crate::commands::conversation::delete_conversation_tree(services, conversation_id).await?;
    }
    services
        .db
        .write(async |tx| board_task::delete(tx, id).await)
        .await
        .map_err(|e| e.to_string())?;
    announce(services, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db::sea::cap::Db;
    use meridian_core::db::sea::sea_test_db;

    async fn board() -> (Db, meridian_core::db::entity::board_task::Model) {
        let db = sea_test_db().await;
        let card = db
            .write(async |tx| {
                project_ops::create_project(
                    tx,
                    meridian_core::db::entity::project::Model {
                        id: "p".into(),
                        name: "repo".into(),
                        path: Some("/r".into()),
                        source_type: meridian_core::db::entity::project::ProjectSource::Local,
                        source_id: None,
                        assistant_id: None,
                        description: None,
                        created_at: 1,
                        updated_at: 1,
                    },
                )
                .await?;
                board_task::insert(
                    tx,
                    &board_task::BoardTaskInsert {
                        id: "t1",
                        project_id: "p",
                        source: BoardSource::Local,
                        title: "fix the login loop",
                        request: None,
                        stage: BoardStage::Backlog,
                        now: 1,
                    },
                )
                .await
            })
            .await
            .unwrap();
        (db, card)
    }

    #[test]
    fn a_title_is_trimmed_bounded_and_required() {
        assert_eq!(title_of("  fix it  ").unwrap(), "fix it");
        assert_eq!(title_of(&"x".repeat(200)).unwrap().chars().count(), TITLE_LIMIT);
        assert!(title_of("   ").is_err());
    }

    /// The conversation and the card's claim land together: the card is
    /// running, works in the worktree, and its conversation resolves there.
    #[tokio::test]
    async fn a_native_card_is_claimed_with_its_conversation() {
        let (db, card) = board().await;
        db.write(async |tx| claim_native(tx, &card, "c1", "/r.worktrees/t1").await)
            .await
            .unwrap();
        let card = board_task::get(&db, "t1").await.unwrap().unwrap();
        assert_eq!(
            (card.stage, card.conversation_id.as_deref(), card.agent_kind),
            (BoardStage::Running, Some("c1"), Some(BoardAgentKind::Native))
        );
        let conversation = conversation_ops::get_conversation(&db, "c1").await.unwrap().unwrap();
        assert_eq!(
            (conversation.title.as_deref(), conversation.project_id.as_deref()),
            (Some("fix the login loop"), Some("p"))
        );
        assert_eq!(
            meridian_core::workspace::resolve_workspace_dir(&db, "c1")
                .await
                .unwrap(),
            Some(std::path::PathBuf::from("/r.worktrees/t1"))
        );
    }

    /// A card already started: the second claim fails and its conversation is
    /// not left behind — a conversation without the card's claim would resolve
    /// to the project's main checkout.
    #[tokio::test]
    async fn a_second_claim_takes_its_conversation_back_with_it() {
        let (db, card) = board().await;
        db.write(async |tx| claim_native(tx, &card, "c1", "/r.worktrees/t1").await)
            .await
            .unwrap();
        let second = db.write(async |tx| claim_native(tx, &card, "c2", "/r.worktrees/t1").await);
        assert!(second.await.is_err());
        assert_eq!(conversation_ops::get_conversation(&db, "c2").await.unwrap(), None);
    }
}
