use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::memory::{Memory, MemoryUpdate, NewMemory};
use crate::db::schema::memories;

pub fn list_memories(conn: &mut SqliteConnection, project_id: &str) -> QueryResult<Vec<Memory>> {
    memories::table
        .filter(memories::project_id.eq(project_id))
        .order(memories::key.asc())
        .load::<Memory>(conn)
}

pub fn get_memory(conn: &mut SqliteConnection, id: &str) -> QueryResult<Memory> {
    memories::table.find(id).first::<Memory>(conn)
}

pub fn get_memory_by_key(
    conn: &mut SqliteConnection,
    project_id: &str,
    key: &str,
) -> QueryResult<Option<Memory>> {
    memories::table
        .filter(memories::project_id.eq(project_id))
        .filter(memories::key.eq(key))
        .first::<Memory>(conn)
        .optional()
}

pub fn upsert_memory(conn: &mut SqliteConnection, new: &NewMemory) -> QueryResult<Memory> {
    let existing = memories::table
        .filter(memories::project_id.eq(new.project_id))
        .filter(memories::key.eq(new.key))
        .first::<Memory>(conn)
        .optional()?;

    if let Some(existing) = existing {
        diesel::update(memories::table.find(&existing.id))
            .set((
                memories::content.eq(new.content),
                memories::memory_type.eq(new.memory_type),
                memories::updated_at.eq(new.updated_at),
            ))
            .execute(conn)?;
        memories::table.find(&existing.id).first::<Memory>(conn)
    } else {
        diesel::insert_into(memories::table)
            .values(new)
            .execute(conn)?;
        memories::table.find(new.id).first::<Memory>(conn)
    }
}

pub fn update_memory(
    conn: &mut SqliteConnection,
    id: &str,
    changeset: &MemoryUpdate,
) -> QueryResult<Memory> {
    diesel::update(memories::table.find(id))
        .set(changeset)
        .execute(conn)?;
    memories::table.find(id).first::<Memory>(conn)
}

pub fn delete_memory(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(memories::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn delete_memory_by_key(
    conn: &mut SqliteConnection,
    project_id: &str,
    key: &str,
) -> QueryResult<()> {
    diesel::delete(
        memories::table
            .filter(memories::project_id.eq(project_id))
            .filter(memories::key.eq(key)),
    )
    .execute(conn)?;
    Ok(())
}

pub fn count_memories(conn: &mut SqliteConnection, project_id: &str) -> QueryResult<i64> {
    memories::table
        .filter(memories::project_id.eq(project_id))
        .count()
        .get_result(conn)
}

pub fn format_memory_block(memories: &[Memory]) -> Option<String> {
    if memories.is_empty() {
        return None;
    }
    let mut block = String::from("\n\n<project_memories>\n");
    for m in memories {
        block.push_str(&format!("- [{}] {}: {}\n", m.memory_type, m.key, m.content));
    }
    block.push_str("</project_memories>");
    Some(block)
}
