//! The prompt queue, from the window.
//!
//! Thin, like `acp.rs` next door: the rules live in `meridian_core` because a
//! queue has to be drivable by something without a window before it is one
//! frontend's feature. What is here is the shape of each call and the one
//! decision the shell owns — which of them may move the queue along.

use crate::ServicesExt;
use meridian_core::agent::queue as runner;
use meridian_core::db::models::queue::{Delivery, QueuedPrompt};
use meridian_core::db::ops::queue as ops;
use meridian_core::util::{get_conn, now_ms};

/// Everything queued for a conversation, in the order it will be delivered.
///
/// Settled rows included: the front end draws one leaving, and dropping it here
/// would make an item vanish a beat before the message it became appears.
#[tauri::command]
pub async fn queue_list(app: tauri::AppHandle, conversation_id: String) -> Result<Vec<QueuedPrompt>, String> {
    let pool = app.services().db.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::list(&mut conn, &conversation_id).map_err(|e| e.to_string())
    })
    .await
}

/// Add one to the back, and see whether it can go straight away.
///
/// The pump is the point: an item added while a turn runs is a steer, and one
/// added with nothing running is a turn. Both are somebody typing, which is the
/// only circumstance in which this queue is allowed to move — see the header of
/// `agent::queue`.
#[tauri::command]
pub async fn queue_enqueue(
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    delivery: String,
    context_refs: Option<Vec<meridian_core::workspace::reference::WorkspaceReferenceInput>>,
) -> Result<QueuedPrompt, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("a queued message needs something in it".into());
    }
    let services = app.services();
    let pool = services.db.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let conversation = conversation_id.clone();
    let delivery = Delivery::parse_or_wait(&delivery);

    let parsed = meridian_core::workspace::reference::parse_references(&content);
    let references = meridian_core::workspace::reference::reconcile_references(context_refs, parsed)?;
    if !references.is_empty() && delivery == Delivery::Interject {
        return Err("workspace references can only be queued as follow-up messages".into());
    }
    let prepared = if references.is_empty() {
        Vec::new()
    } else {
        let pool_for_root = services.db.clone();
        let conversation_for_root = conversation_id.clone();
        let working_directory = blocking(move || {
            let mut conn = get_conn(&pool_for_root)?;
            meridian_core::workspace::resolve_workspace_dir(&mut conn, &conversation_for_root)?
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| "workspace unavailable".to_string())
        })
        .await?;
        let file_access = meridian_core::agent::build_file_access(&services.db).await;
        let context = meridian_core::tools::ToolContext {
            working_directory: Some(working_directory),
            shell: meridian_core::tools::ShellType::default_for_platform(),
            file_access,
            project_id: None,
            conversation_id: Some(conversation_id.clone()),
            turn_id: None,
            assistant_id: None,
            db_pool: Some(services.db.clone()),
            #[cfg(not(target_os = "android"))]
            sandbox_policy: None,
            tool_secrets: Default::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            journal: None,
        };
        let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
        meridian_core::workspace::reference::prepare_references(&context, &references, &counter, 128_000).await?
    };

    let item = blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::enqueue_with_context(&mut conn, &id, &conversation, &content, delivery, &prepared, now_ms())
            .map_err(|e| e.to_string())
    })
    .await?;

    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(item)
}

/// Drop one that has not gone anywhere.
///
/// A settled or in-doubt row refuses, and says so rather than reporting a
/// success that did nothing: the second is the record that the agent may be
/// acting on it, and it is the only reason anyone would ever find out.
#[tauri::command]
pub async fn queue_remove(app: tauri::AppHandle, conversation_id: String, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    let removed = blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::remove(&mut conn, &conversation, &id).map_err(|e| e.to_string())
    })
    .await?;

    if removed == 0 {
        return Err("this message has already been sent".into());
    }
    runner::announce(&services, &conversation_id);
    Ok(())
}

/// Rewrite the order, wholesale. The list is what the user dragged into place.
#[tauri::command]
pub async fn queue_reorder(app: tauri::AppHandle, conversation_id: String, ids: Vec<String>) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::reorder(&mut conn, &conversation, &ids).map_err(|e| e.to_string())
    })
    .await?;

    runner::announce(&services, &conversation_id);
    Ok(())
}

/// Change one item's mode while it is still waiting.
///
/// Pumps afterwards, and that is not incidental: switching a row to `interject`
/// *means* "go now", and without it nothing would happen until the running turn
/// ended — at which point the row would go as an ordinary turn and the change
/// would have made no difference at all. Same rule as everywhere else in this
/// file: the queue moves because somebody is here.
#[tauri::command]
pub async fn queue_set_delivery(
    app: tauri::AppHandle,
    conversation_id: String,
    id: String,
    delivery: String,
) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let delivery = Delivery::parse_or_wait(&delivery);
    let conversation = conversation_id.clone();
    let changed = blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::set_delivery(&mut conn, &conversation, &id, delivery).map_err(|e| e.to_string())
    })
    .await?;

    if changed == 0 {
        return Err("this message has already been sent".into());
    }
    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(())
}

/// Let a held queue go again.
///
/// The queue stops itself whenever a turn fails or is stopped, because what
/// comes after a failed step usually assumed it worked. Starting again is a
/// person's decision, and this is them making it — so it pumps.
#[tauri::command]
pub async fn queue_release(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let conversation = conversation_id.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        ops::release_all(&mut conn, &conversation).map_err(|e| e.to_string())
    })
    .await?;

    runner::announce(&services, &conversation_id);
    runner::pump_later(&services, &conversation_id);
    Ok(())
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}
