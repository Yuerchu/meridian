use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::assistant::{Assistant, AssistantUpdate, NewAssistant};
use crate::db::schema::assistants;

pub fn list_assistants(conn: &mut SqliteConnection) -> QueryResult<Vec<Assistant>> {
    assistants::table
        .order(assistants::sort_order.asc())
        .load::<Assistant>(conn)
}

pub fn get_assistant(conn: &mut SqliteConnection, id: &str) -> QueryResult<Assistant> {
    assistants::table.find(id).first::<Assistant>(conn)
}

pub fn get_default_assistant(conn: &mut SqliteConnection) -> QueryResult<Option<Assistant>> {
    assistants::table
        .filter(assistants::is_default.eq(1))
        .first::<Assistant>(conn)
        .optional()
}

pub fn create_assistant(
    conn: &mut SqliteConnection,
    new: &NewAssistant,
) -> QueryResult<Assistant> {
    diesel::insert_into(assistants::table)
        .values(new)
        .execute(conn)?;
    assistants::table.find(new.id).first::<Assistant>(conn)
}

pub fn update_assistant(
    conn: &mut SqliteConnection,
    id: &str,
    changeset: &AssistantUpdate,
) -> QueryResult<Assistant> {
    diesel::update(assistants::table.find(id))
        .set(changeset)
        .execute(conn)?;
    assistants::table.find(id).first::<Assistant>(conn)
}

pub fn delete_assistant(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(assistants::table.find(id)).execute(conn)?;
    Ok(())
}
