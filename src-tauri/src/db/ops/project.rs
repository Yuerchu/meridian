use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::project::{NewProject, Project, ProjectUpdate};
#[allow(unused_imports)]
use crate::db::schema::projects;

pub fn list_projects(conn: &mut SqliteConnection) -> QueryResult<Vec<Project>> {
    projects::table
        .order(projects::updated_at.desc())
        .load::<Project>(conn)
}

pub fn get_project(conn: &mut SqliteConnection, id: &str) -> QueryResult<Project> {
    projects::table.find(id).first::<Project>(conn)
}

pub fn find_project_by_source(
    conn: &mut SqliteConnection,
    source_type: &str,
    source_id: &str,
) -> QueryResult<Option<Project>> {
    projects::table
        .filter(projects::source_type.eq(source_type))
        .filter(projects::source_id.eq(source_id))
        .first::<Project>(conn)
        .optional()
}

pub fn create_project(conn: &mut SqliteConnection, new: &NewProject) -> QueryResult<Project> {
    diesel::insert_into(projects::table)
        .values(new)
        .execute(conn)?;
    projects::table.find(new.id).first::<Project>(conn)
}

pub fn update_project(
    conn: &mut SqliteConnection,
    id: &str,
    changeset: &ProjectUpdate,
) -> QueryResult<Project> {
    diesel::update(projects::table.find(id))
        .set(changeset)
        .execute(conn)?;
    projects::table.find(id).first::<Project>(conn)
}

/// Memories are not reachable by foreign key any more (scope_id is polymorphic),
/// so the cascade happens here — in ops rather than in the command layer, so
/// every caller is covered.
pub fn delete_project(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    conn.transaction(|conn| {
        crate::db::ops::memory::delete_project_memories(conn, id)?;
        diesel::delete(projects::table.find(id)).execute(conn)?;
        Ok(())
    })
}
