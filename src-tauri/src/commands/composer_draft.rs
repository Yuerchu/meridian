//! Unsent composer drafts, from the window.
//!
//! The rules — one row per composer, empty means no row, a stale revision
//! changes nothing — live in `meridian_core::db::ops::composer_draft`. What is
//! here is the boundary: which attachments may be stored at all, and what a
//! stored draft looks like once the things it points at have moved on.
//!
//! Reachable from a remote client, deliberately. A draft belongs to a
//! conversation, and the conversation lives on this host; a phone typing into
//! it is the same person at another screen, and the phone's WebView is the one
//! most likely to be killed halfway through a sentence. Keeping the draft here
//! means switching device picks it up where it was left.

use crate::ServicesExt;
use crate::commands::entity_response::EmojiInfoResponse;
use crate::commands::model_config::RequiredNullable;
use diesel::sqlite::SqliteConnection;
use meridian_core::db::models::composer_draft::{ComposerDraftContent, DraftAttachment, DraftSlot};
use meridian_core::db::ops::composer_draft as ops;
use meridian_core::db::ops::composer_draft::DraftWriteOutcome;
use meridian_core::util::{get_conn, now_ms};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftReadRequest {
    /// `null` is the welcome composer, which has no conversation yet.
    conversation_id: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposerDraftAttachmentRequest {
    /// Absolute, on this host. Anything else could not be opened again.
    path: String,
    name: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftUpsertRequest {
    conversation_id: RequiredNullable<String>,
    body: String,
    attachments: Vec<ComposerDraftAttachmentRequest>,
    conversation_refs: Vec<String>,
    sticker_id: RequiredNullable<String>,
    /// Chosen by the writer, strictly increasing per composer.
    revision: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftDeleteRequest {
    conversation_id: RequiredNullable<String>,
    revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ComposerDraftAttachmentInfoResponse {
    pub path: String,
    pub name: String,
    /// Whether a file is still there. A draft outlives what it attached, and
    /// the composer marks a missing one rather than dropping it unannounced.
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ComposerDraftConversationRefInfoResponse {
    pub id: String,
    /// Today's title, read now rather than stored with the draft.
    pub title: Option<String>,
    /// `false` once the referenced conversation has been deleted.
    pub exists: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ComposerDraftInfoResponse {
    pub conversation_id: Option<String>,
    pub body: String,
    pub attachments: Vec<ComposerDraftAttachmentInfoResponse>,
    pub conversation_refs: Vec<ComposerDraftConversationRefInfoResponse>,
    pub sticker: Option<EmojiInfoResponse>,
    pub revision: i64,
    pub updated_at: i64,
}

/// What a guarded write did. `revision` is what is stored now: the one that
/// was asked for when `applied`, the newer one that won otherwise.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ComposerDraftWriteResponse {
    pub applied: bool,
    pub revision: i64,
}

fn write_response(outcome: DraftWriteOutcome, revision: i64) -> ComposerDraftWriteResponse {
    match outcome {
        DraftWriteOutcome::Applied => ComposerDraftWriteResponse {
            applied: true,
            revision,
        },
        DraftWriteOutcome::Stale { current_revision } => ComposerDraftWriteResponse {
            applied: false,
            revision: current_revision,
        },
    }
}

fn validate_revision(revision: i64) -> Result<(), String> {
    if revision <= 0 {
        return Err(format!("composer draft revision must be positive, got {revision}"));
    }
    Ok(())
}

/// The request's attachments as they will be stored, or the reason one cannot
/// be. Refused rather than filtered: the client decides what it offers, and a
/// silently shortened list would be a draft that comes back missing a file
/// with nothing having said so.
fn stored_attachments(attachments: Vec<ComposerDraftAttachmentRequest>) -> Result<Vec<DraftAttachment>, String> {
    attachments
        .into_iter()
        .map(|a| {
            if !std::path::Path::new(&a.path).is_absolute() {
                return Err(format!(
                    "composer draft attachment `{}` is not an absolute path and cannot be kept",
                    a.name
                ));
            }
            if a.name.is_empty() {
                return Err("composer draft attachment has an empty name".to_string());
            }
            Ok(DraftAttachment {
                path: a.path,
                name: a.name,
            })
        })
        .collect()
}

fn read_draft(conn: &mut SqliteConnection, slot: &DraftSlot) -> Result<Option<ComposerDraftInfoResponse>, String> {
    let Some(row) = ops::get(conn, slot).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let content = row.content()?;

    let attachments = content
        .attachments
        .into_iter()
        .map(|a| ComposerDraftAttachmentInfoResponse {
            exists: std::path::Path::new(&a.path).is_file(),
            path: a.path,
            name: a.name,
        })
        .collect();

    let mut conversation_refs = Vec::with_capacity(content.conversation_refs.len());
    for id in content.conversation_refs {
        let found = meridian_core::db::ops::conversation::get_conversation(conn, &id);
        let (title, exists) = match found {
            Ok(conv) => (conv.title, true),
            Err(diesel::result::Error::NotFound) => (None, false),
            Err(e) => return Err(e.to_string()),
        };
        conversation_refs.push(ComposerDraftConversationRefInfoResponse { id, title, exists });
    }

    let sticker = match content.sticker_id {
        // The foreign key clears this when the sticker goes, so a dangling id
        // is not a state to tolerate.
        Some(id) => Some(
            meridian_core::db::ops::emoji::get_emoji(conn, &id)
                .map_err(|e| e.to_string())?
                .try_into()?,
        ),
        None => None,
    };

    Ok(Some(ComposerDraftInfoResponse {
        conversation_id: row.conversation_id,
        body: content.body,
        attachments,
        conversation_refs,
        sticker,
        revision: row.revision,
        updated_at: row.updated_at,
    }))
}

fn write_draft(
    conn: &mut SqliteConnection,
    request: ComposerDraftUpsertRequest,
    now: i64,
) -> Result<ComposerDraftWriteResponse, String> {
    let ComposerDraftUpsertRequest {
        conversation_id: RequiredNullable(conversation_id),
        body,
        attachments,
        conversation_refs,
        sticker_id: RequiredNullable(sticker_id),
        revision,
    } = request;
    validate_revision(revision)?;
    let slot = DraftSlot::for_conversation(conversation_id);
    let content = ComposerDraftContent {
        body,
        attachments: stored_attachments(attachments)?,
        conversation_refs,
        sticker_id,
    };
    let outcome = ops::save(conn, &slot, &content, revision, now).map_err(|e| e.to_string())?;
    Ok(write_response(outcome, revision))
}

fn delete_draft(
    conn: &mut SqliteConnection,
    request: ComposerDraftDeleteRequest,
    now: i64,
) -> Result<ComposerDraftWriteResponse, String> {
    let ComposerDraftDeleteRequest {
        conversation_id: RequiredNullable(conversation_id),
        revision,
    } = request;
    validate_revision(revision)?;
    let slot = DraftSlot::for_conversation(conversation_id);
    let outcome = ops::clear(conn, &slot, revision, now).map_err(|e| e.to_string())?;
    Ok(write_response(outcome, revision))
}

/// The draft a composer should open with, or `null` for none.
#[tauri::command]
pub async fn get_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftReadRequest,
) -> Result<Option<ComposerDraftInfoResponse>, String> {
    let pool = app.services().db.clone();
    let RequiredNullable(conversation_id) = request.conversation_id;
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        read_draft(&mut conn, &DraftSlot::for_conversation(conversation_id))
    })
    .await
}

/// Store what a composer holds. An empty draft removes the row.
#[tauri::command]
pub async fn save_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftUpsertRequest,
) -> Result<ComposerDraftWriteResponse, String> {
    let pool = app.services().db.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        write_draft(&mut conn, request, now_ms())
    })
    .await
}

/// Forget a draft once what it held has been sent.
#[tauri::command]
pub async fn clear_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftDeleteRequest,
) -> Result<ComposerDraftWriteResponse, String> {
    let pool = app.services().db.clone();
    blocking(move || {
        let mut conn = get_conn(&pool)?;
        delete_draft(&mut conn, request, now_ms())
    })
    .await
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db::test_db;

    fn upsert(conversation_id: Option<&str>, body: &str, revision: i64) -> ComposerDraftUpsertRequest {
        serde_json::from_value(serde_json::json!({
            "conversationId": conversation_id,
            "body": body,
            "attachments": [],
            "conversationRefs": [],
            "stickerId": null,
            "revision": revision,
        }))
        .unwrap()
    }

    #[test]
    fn requests_are_strict() {
        let complete = serde_json::json!({
            "conversationId": null, "body": "x", "attachments": [], "conversationRefs": [],
            "stickerId": null, "revision": 1,
        });
        assert!(serde_json::from_value::<ComposerDraftUpsertRequest>(complete.clone()).is_ok());
        for key in ["conversationId", "stickerId"] {
            let mut missing = complete.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<ComposerDraftUpsertRequest>(missing).is_err(),
                "a nullable key may not be omitted: {key}"
            );
        }
        let mut unknown = complete;
        unknown["future"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ComposerDraftUpsertRequest>(unknown).is_err());
        assert!(serde_json::from_value::<ComposerDraftReadRequest>(serde_json::json!({})).is_err());
        assert!(
            serde_json::from_value::<ComposerDraftDeleteRequest>(serde_json::json!({ "conversationId": null }))
                .is_err()
        );
    }

    /// An attachment that could not be opened again after a restart is refused
    /// at the boundary, not dropped on the way to the table.
    #[test]
    fn a_relative_or_uri_attachment_is_refused() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        for path in ["notes.md", "content://media/external/images/1"] {
            let mut request = upsert(None, "x", 1);
            request.attachments = vec![ComposerDraftAttachmentRequest {
                path: path.to_string(),
                name: "a".to_string(),
            }];
            assert!(write_draft(&mut conn, request, 1).is_err(), "{path} must be refused");
        }
        assert!(read_draft(&mut conn, &DraftSlot::NewConversation).unwrap().is_none());
    }

    /// What a stored draft says about the things it points at is read now: a
    /// file that has gone is marked, a conversation that has gone is marked,
    /// and neither is dropped.
    #[test]
    fn a_read_marks_what_has_gone() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        meridian_core::db::ops::conversation::create_conversation(&mut conn, "c1", Some("Draft"), None, None, 0)
            .unwrap();
        meridian_core::db::ops::conversation::create_conversation(&mut conn, "c2", Some("Cited"), None, None, 0)
            .unwrap();

        let present = std::env::temp_dir().join(format!("composer-draft-present-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&present, "x").unwrap();
        let absent = std::env::temp_dir().join(format!("composer-draft-absent-{}.txt", uuid::Uuid::new_v4()));

        let mut request = upsert(Some("c1"), "look at these", 1);
        request.attachments = vec![
            ComposerDraftAttachmentRequest {
                path: present.to_string_lossy().into_owned(),
                name: "present.txt".to_string(),
            },
            ComposerDraftAttachmentRequest {
                path: absent.to_string_lossy().into_owned(),
                name: "absent.txt".to_string(),
            },
        ];
        request.conversation_refs = vec!["c2".to_string(), "gone".to_string()];
        assert_eq!(
            write_draft(&mut conn, request, 10).unwrap(),
            ComposerDraftWriteResponse {
                applied: true,
                revision: 1
            }
        );

        let draft = read_draft(&mut conn, &DraftSlot::Conversation("c1".to_string()))
            .unwrap()
            .expect("stored");
        std::fs::remove_file(&present).ok();
        assert_eq!(draft.body, "look at these");
        assert_eq!(
            draft.attachments.iter().map(|a| a.exists).collect::<Vec<_>>(),
            vec![true, false]
        );
        assert_eq!(
            draft.conversation_refs,
            vec![
                ComposerDraftConversationRefInfoResponse {
                    id: "c2".to_string(),
                    title: Some("Cited".to_string()),
                    exists: true,
                },
                ComposerDraftConversationRefInfoResponse {
                    id: "gone".to_string(),
                    title: None,
                    exists: false,
                },
            ]
        );
    }

    /// A stale write reports the revision that beat it, so the writer can
    /// continue above it.
    #[test]
    fn a_stale_write_reports_the_winning_revision() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        write_draft(&mut conn, upsert(None, "newest", 7), 1).unwrap();
        assert_eq!(
            write_draft(&mut conn, upsert(None, "older", 3), 2).unwrap(),
            ComposerDraftWriteResponse {
                applied: false,
                revision: 7
            }
        );
        let clear: ComposerDraftDeleteRequest =
            serde_json::from_value(serde_json::json!({ "conversationId": null, "revision": 8 })).unwrap();
        assert!(delete_draft(&mut conn, clear, 3).unwrap().applied);
        assert!(read_draft(&mut conn, &DraftSlot::NewConversation).unwrap().is_none());
        assert!(
            write_draft(&mut conn, upsert(None, "x", 0), 4).is_err(),
            "revisions start at 1"
        );
    }
}
