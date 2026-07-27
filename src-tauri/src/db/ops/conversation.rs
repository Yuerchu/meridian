use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::conversation::{Conversation, NewConversation};
use crate::db::schema::conversations;

pub fn list_conversations(
    conn: &mut SqliteConnection,
    archived: bool,
) -> QueryResult<Vec<Conversation>> {
    let archived_val = if archived { 1 } else { 0 };
    conversations::table
        .filter(conversations::is_archived.eq(archived_val))
        .order((conversations::is_pinned.desc(), conversations::updated_at.desc()))
        .load::<Conversation>(conn)
}

pub fn get_conversation(
    conn: &mut SqliteConnection,
    id: &str,
) -> QueryResult<Conversation> {
    conversations::table.find(id).first::<Conversation>(conn)
}

pub fn create_conversation(
    conn: &mut SqliteConnection,
    id: &str,
    title: Option<&str>,
    assistant_id: Option<&str>,
    project_id: Option<&str>,
    now: i64,
) -> QueryResult<Conversation> {
    let new = NewConversation {
        id,
        title,
        assistant_id,
        is_pinned: 0,
        is_archived: 0,
        created_at: now,
        updated_at: now,
        project_id,
    };
    diesel::insert_into(conversations::table)
        .values(&new)
        .execute(conn)?;
    conversations::table.find(id).first::<Conversation>(conn)
}

pub fn list_conversations_by_project(
    conn: &mut SqliteConnection,
    project_id: &str,
    archived: bool,
) -> QueryResult<Vec<Conversation>> {
    let archived_val = if archived { 1 } else { 0 };
    conversations::table
        .filter(conversations::project_id.eq(project_id))
        .filter(conversations::is_archived.eq(archived_val))
        .order((conversations::is_pinned.desc(), conversations::updated_at.desc()))
        .load::<Conversation>(conn)
}

pub fn update_title(
    conn: &mut SqliteConnection,
    id: &str,
    title: &str,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::title.eq(title),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_assistant(
    conn: &mut SqliteConnection,
    id: &str,
    assistant_id: Option<&str>,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::assistant_id.eq(assistant_id),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn toggle_pin(
    conn: &mut SqliteConnection,
    id: &str,
    now: i64,
) -> QueryResult<Conversation> {
    let conv = conversations::table.find(id).first::<Conversation>(conn)?;
    let new_pinned = if conv.is_pinned == 0 { 1 } else { 0 };
    diesel::update(conversations::table.find(id))
        .set((
            conversations::is_pinned.eq(new_pinned),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    conversations::table.find(id).first::<Conversation>(conn)
}

pub fn archive_conversation(
    conn: &mut SqliteConnection,
    id: &str,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::is_archived.eq(1),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_compact_cursor(
    conn: &mut SqliteConnection,
    id: &str,
    cursor: Option<i32>,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::compact_cursor.eq(cursor),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

/// Persist the per-conversation reasoning preferences. `thinking_level` of
/// `None` means "inherit the assistant default".
pub fn update_reasoning_prefs(
    conn: &mut SqliteConnection,
    id: &str,
    thinking_level: Option<&str>,
    fast_mode: bool,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::thinking_level.eq(thinking_level),
            conversations::fast_mode.eq(i32::from(fast_mode)),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn delete_conversation(
    conn: &mut SqliteConnection,
    id: &str,
) -> QueryResult<()> {
    diesel::delete(conversations::table.find(id)).execute(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    /// Migrations are plain SQL and Diesel does not check them at compile time,
    /// so this is the only place a broken ALTER TABLE surfaces before runtime.
    #[test]
    fn migrations_apply_and_reasoning_prefs_round_trip() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();

        let conv = create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
        assert_eq!(conv.thinking_level, None, "defaults to inheriting the assistant");
        assert_eq!(conv.fast_mode, 0);

        update_reasoning_prefs(&mut conn, "c1", Some("xhigh"), true, 2).unwrap();
        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.thinking_level.as_deref(), Some("xhigh"));
        assert_eq!(conv.fast_mode, 1);

        // Clearing back to the assistant default must be expressible.
        update_reasoning_prefs(&mut conn, "c1", None, false, 3).unwrap();
        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.thinking_level, None);
        assert_eq!(conv.fast_mode, 0);
    }
}
