//! Unsent composer drafts, from the window.
//!
//! The rules — one row per composer, empty means no row, a stale revision
//! changes nothing — live in `meridian_core::db::sea::ops::composer_draft`. What is
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
use meridian_core::db::entity::composer_draft::DraftAttachment;
use meridian_core::db::sea::DbErr;
use meridian_core::db::sea::cap::{Db, Snapshot};
use meridian_core::db::sea::ops::composer_draft as ops;
use meridian_core::db::sea::ops::composer_draft::{ComposerDraftContent, DraftSlot, DraftWriteOutcome};
use meridian_core::db::sea::ops::{conversation, emoji};
use meridian_core::util::now_ms;

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

/// What the database says about a draft, read in one snapshot: the row, and
/// today's state of each conversation and sticker it points at. Whether the
/// attached files are still there is asked afterwards, outside the transaction.
struct StoredDraft {
    conversation_id: Option<String>,
    revision: i64,
    updated_at: i64,
    content: ComposerDraftContent,
    conversation_refs: Vec<ComposerDraftConversationRefInfoResponse>,
    sticker: Option<EmojiInfoResponse>,
}

/// Several statements whose answers are put together, so a snapshot: on the
/// pool, a conversation deleted between the draft read and its title lookup
/// would be reported as present with no title.
async fn read_stored(db: &impl Snapshot, slot: &DraftSlot) -> Result<Option<StoredDraft>, DbErr> {
    let Some(row) = ops::get(db, slot).await? else {
        return Ok(None);
    };
    let (conversation_id, revision, updated_at) = (row.conversation_id.clone(), row.revision, row.updated_at);
    let content = ComposerDraftContent::from(row);

    let mut conversation_refs = Vec::with_capacity(content.conversation_refs.len());
    for id in &content.conversation_refs {
        let found = conversation::get_conversation(db, id).await?;
        conversation_refs.push(ComposerDraftConversationRefInfoResponse {
            id: id.clone(),
            exists: found.is_some(),
            title: found.and_then(|c| c.title),
        });
    }

    let sticker = match &content.sticker_id {
        // The foreign key clears this when the sticker goes, so a dangling id
        // is not a state to tolerate.
        Some(id) => Some(
            emoji::get_emoji(db, id)
                .await?
                .ok_or_else(|| DbErr::RecordNotFound(format!("sticker `{id}` on a composer draft")))?
                .into(),
        ),
        None => None,
    };

    Ok(Some(StoredDraft {
        conversation_id,
        revision,
        updated_at,
        content,
        conversation_refs,
        sticker,
    }))
}

async fn read_draft(db: &Db, slot: &DraftSlot) -> Result<Option<ComposerDraftInfoResponse>, String> {
    let Some(stored) = db
        .read(async |tx| read_stored(tx, slot).await)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };

    let mut attachments = Vec::with_capacity(stored.content.attachments.len());
    for a in stored.content.attachments {
        let exists = tokio::fs::metadata(&a.path).await.is_ok_and(|m| m.is_file());
        attachments.push(ComposerDraftAttachmentInfoResponse {
            path: a.path,
            name: a.name,
            exists,
        });
    }

    Ok(Some(ComposerDraftInfoResponse {
        conversation_id: stored.conversation_id,
        body: stored.content.body,
        attachments,
        conversation_refs: stored.conversation_refs,
        sticker: stored.sticker,
        revision: stored.revision,
        updated_at: stored.updated_at,
    }))
}

async fn write_draft(
    db: &Db,
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
    let outcome = db
        .write(async |tx| ops::save(tx, &slot, &content, revision, now).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(write_response(outcome, revision))
}

async fn delete_draft(
    db: &Db,
    request: ComposerDraftDeleteRequest,
    now: i64,
) -> Result<ComposerDraftWriteResponse, String> {
    let ComposerDraftDeleteRequest {
        conversation_id: RequiredNullable(conversation_id),
        revision,
    } = request;
    validate_revision(revision)?;
    let slot = DraftSlot::for_conversation(conversation_id);
    let outcome = db
        .write(async |tx| ops::clear(tx, &slot, revision, now).await)
        .await
        .map_err(|e| e.to_string())?;
    Ok(write_response(outcome, revision))
}

/// The draft a composer should open with, or `null` for none.
#[tauri::command]
pub async fn get_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftReadRequest,
) -> Result<Option<ComposerDraftInfoResponse>, String> {
    let RequiredNullable(conversation_id) = request.conversation_id;
    read_draft(&app.services().db, &DraftSlot::for_conversation(conversation_id)).await
}

/// Store what a composer holds. An empty draft removes the row.
#[tauri::command]
pub async fn save_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftUpsertRequest,
) -> Result<ComposerDraftWriteResponse, String> {
    write_draft(&app.services().db, request, now_ms()).await
}

/// Forget a draft once what it held has been sent.
#[tauri::command]
pub async fn clear_composer_draft(
    app: tauri::AppHandle,
    request: ComposerDraftDeleteRequest,
) -> Result<ComposerDraftWriteResponse, String> {
    delete_draft(&app.services().db, request, now_ms()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_core::db::sea::{execute_for_tests, sea_test_db};

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
    #[tokio::test]
    async fn a_relative_or_uri_attachment_is_refused() {
        let db = sea_test_db().await;
        for path in ["notes.md", "content://media/external/images/1"] {
            let mut request = upsert(None, "x", 1);
            request.attachments = vec![ComposerDraftAttachmentRequest {
                path: path.to_string(),
                name: "a".to_string(),
            }];
            assert!(write_draft(&db, request, 1).await.is_err(), "{path} must be refused");
        }
        assert!(read_draft(&db, &DraftSlot::NewConversation).await.unwrap().is_none());
    }

    /// What a stored draft says about the things it points at is read now: a
    /// file that has gone is marked, a conversation that has gone is marked,
    /// and neither is dropped.
    #[tokio::test]
    async fn a_read_marks_what_has_gone() {
        let db = sea_test_db().await;
        execute_for_tests(
            &db,
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c1', 'Draft', 0, 0), ('c2', 'Cited', 0, 0)",
        )
        .await
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
            write_draft(&db, request, 10).await.unwrap(),
            ComposerDraftWriteResponse {
                applied: true,
                revision: 1
            }
        );

        let draft = read_draft(&db, &DraftSlot::Conversation("c1".to_string()))
            .await
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
    #[tokio::test]
    async fn a_stale_write_reports_the_winning_revision() {
        let db = sea_test_db().await;
        write_draft(&db, upsert(None, "newest", 7), 1).await.unwrap();
        assert_eq!(
            write_draft(&db, upsert(None, "older", 3), 2).await.unwrap(),
            ComposerDraftWriteResponse {
                applied: false,
                revision: 7
            }
        );
        let clear: ComposerDraftDeleteRequest =
            serde_json::from_value(serde_json::json!({ "conversationId": null, "revision": 8 })).unwrap();
        assert!(delete_draft(&db, clear, 3).await.unwrap().applied);
        assert!(read_draft(&db, &DraftSlot::NewConversation).await.unwrap().is_none());
        assert!(
            write_draft(&db, upsert(None, "x", 0), 4).await.is_err(),
            "revisions start at 1"
        );
    }
}
