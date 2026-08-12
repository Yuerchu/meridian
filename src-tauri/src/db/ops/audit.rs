use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::audit::{AuditMessage, NewAuditMessage};
use crate::db::models::message::Message;
use crate::db::schema::{audit_messages, conversations, memory_subjects, projects, turns};
use crate::util::now_ms;

/// What a row needs beside itself to be readable once everything it points at is
/// gone.
///
/// Read here rather than passed in, because no caller has all four: the writer
/// of a user row knows the conversation but not the turn's origin, and the one
/// that completes an assistant row knows neither the project nor the speaker's
/// nickname. Four small lookups against primary keys and one index, once per
/// message — the alternative is four more parameters on every write path and a
/// new way for each of them to be forgotten.
struct Snapshot {
    source_type: Option<String>,
    source_id: Option<String>,
    turn_origin: Option<String>,
    sender_name: Option<String>,
}

fn snapshot(conn: &mut SqliteConnection, msg: &Message) -> Snapshot {
    // Every one of these is best-effort. A missing project or a turn row that has
    // not been written yet is a gap in the record, not a reason to refuse to keep
    // the record at all.
    let project: Option<(String, Option<String>)> = conversations::table
        .find(&msg.conversation_id)
        .select(conversations::project_id)
        .first::<Option<String>>(conn)
        .ok()
        .flatten()
        .and_then(|pid| {
            projects::table
                .find(pid)
                .select((projects::source_type, projects::source_id))
                .first(conn)
                .ok()
        });

    let turn_origin = msg.turn_id.as_ref().and_then(|tid| {
        turns::table.find(tid).select(turns::origin).first::<String>(conn).ok()
    });

    let sender_name = msg.sender_id.and_then(|uid| {
        let scope = crate::db::models::memory::onebot_user_scope_id(uid);
        memory_subjects::table
            .find(scope)
            .select(memory_subjects::display_name)
            .first::<Option<String>>(conn)
            .ok()
            .flatten()
    });

    Snapshot {
        source_type: project.as_ref().map(|(t, _)| t.clone()),
        source_id: project.and_then(|(_, id)| id),
        turn_origin,
        sender_name,
    }
}

/// Copy a message into the audit log.
///
/// Called once per message, after the row it describes is final: a user message
/// as soon as it is appended, an assistant reply once the model has finished with
/// it. Never an update — an edited or regenerated message produces a second
/// record rather than replacing the first, because the question this table
/// answers is "what happened" and not "what does the transcript say now".
///
/// Returns the error rather than swallowing it so the caller can log it. No
/// caller should let it fail a turn: a database that cannot take the audit copy
/// is a problem to be shouted about, but refusing to answer the user because of
/// it would turn a bookkeeping fault into an outage.
pub fn record(conn: &mut SqliteConnection, msg: &Message) -> QueryResult<()> {
    let snap = snapshot(conn, msg);
    let id = uuid::Uuid::new_v4().to_string();
    diesel::insert_into(audit_messages::table)
        .values(&NewAuditMessage {
            id: &id,
            recorded_at: now_ms(),
            message_id: &msg.id,
            conversation_id: &msg.conversation_id,
            turn_id: msg.turn_id.as_deref(),
            source_type: snap.source_type.as_deref(),
            source_id: snap.source_id.as_deref(),
            turn_origin: snap.turn_origin.as_deref(),
            role: &msg.role,
            content: &msg.content,
            sender_id: msg.sender_id,
            sender_name: snap.sender_name.as_deref(),
            provider_id: msg.provider_id.as_deref(),
            provider_name: msg.provider_name.as_deref(),
            model_id: msg.model_id.as_deref(),
            input_tokens: msg.input_tokens,
            output_tokens: msg.output_tokens,
            cache_read_tokens: msg.cache_read_tokens,
            cache_write_tokens: msg.cache_write_tokens,
            created_at: msg.created_at,
        })
        .execute(conn)?;
    Ok(())
}

/// Drop everything recorded before `cutoff`, and say how much went.
///
/// The only way rows leave this table. Retention is the operator's decision and
/// has to be expressible; without this the log grows without bound and the people
/// in it have no way to ever be forgotten. Modelled on `purge_memories` — by time
/// rather than by person, because an audit trail with one participant quietly
/// removed reads as though they were never there.
pub fn purge_before(conn: &mut SqliteConnection, cutoff: i64) -> QueryResult<usize> {
    diesel::delete(audit_messages::table.filter(audit_messages::created_at.lt(cutoff)))
        .execute(conn)
}

/// Newest first, for an operator reading the log back.
pub fn list_recent(conn: &mut SqliteConnection, limit: i64) -> QueryResult<Vec<AuditMessage>> {
    audit_messages::table
        .order(audit_messages::created_at.desc())
        .limit(limit)
        .select(AuditMessage::as_select())
        .load(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ops::conversation::{create_conversation, delete_conversation};
    use crate::db::ops::message::append_message;
    use crate::db::test_db;

    fn user_row<'a>(id: &'a str, conv: &'a str) -> crate::db::models::message::NewMessage<'a> {
        crate::db::models::message::NewMessage {
            id,
            conversation_id: conv,
            role: "user",
            content: "what did you do",
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 1_000,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: Some(12345),
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            provider_name: None,
        }
    }

    /// The reason the table exists. Everything else about a conversation goes
    /// when the conversation does; this does not.
    ///
    /// No explicit `record` call: appending a user message is what files it, and
    /// a test that recorded by hand would pass even if that wiring were removed.
    #[test]
    fn an_audit_record_survives_deleting_its_conversation() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();

        delete_conversation(&mut conn, "c1").unwrap();

        assert!(
            crate::db::ops::message::list_messages(&mut conn, "c1").unwrap().is_empty(),
            "the transcript really did go",
        );
        let kept = list_recent(&mut conn, 10).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].message_id, "m1");
        assert_eq!(kept[0].content, "what did you do");
        assert_eq!(kept[0].sender_id, Some(12345));
        assert_eq!(kept[0].conversation_id, "c1", "still names what it was about");
    }

    /// Retention has to be expressible, or the people in the log can never be
    /// forgotten.
    #[test]
    fn purging_removes_only_what_is_older_than_the_cutoff() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();

        let mut old = user_row("m1", "c1");
        old.created_at = 1_000;
        let old = append_message(&mut conn, &old, None).unwrap();

        let mut new = user_row("m2", "c1");
        new.created_at = 9_000;
        append_message(&mut conn, &new, Some(&old.id)).unwrap();

        assert_eq!(purge_before(&mut conn, 5_000).unwrap(), 1);
        let left = list_recent(&mut conn, 10).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].message_id, "m2");
    }

    /// An edit writes a second record rather than rewriting the first: the
    /// question is what happened, not what the transcript says now.
    #[test]
    fn a_second_record_for_one_message_is_kept_alongside_the_first() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        // One from the append, one from the explicit call standing in for the
        // message being edited and recorded again.
        let msg = append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();
        record(&mut conn, &msg).unwrap();

        assert_eq!(list_recent(&mut conn, 10).unwrap().len(), 2);
    }
}
