use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::project::{NewProject, Project, ProjectUpdate};
#[allow(unused_imports)]
use crate::db::schema::projects;

pub fn list_projects(conn: &mut SqliteConnection) -> QueryResult<Vec<Project>> {
    projects::table.order(projects::updated_at.desc()).load::<Project>(conn)
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

/// The project whose working directory is `path`, if there is one.
///
/// Compared in Rust over the whole (small) table rather than in SQL, because
/// the two sides come from different places and rarely agree character for
/// character: one was typed into a directory picker, the other arrives from
/// another program's idea of its own working directory. Separator, trailing
/// slash and — on Windows — case all have to stop mattering, and none of that
/// survives a `WHERE path = ?`.
pub fn find_project_by_path(conn: &mut SqliteConnection, path: &str) -> QueryResult<Option<Project>> {
    let wanted = normalize_path(path);
    if wanted.is_empty() {
        return Ok(None);
    }
    Ok(list_projects(conn)?
        .into_iter()
        .find(|p| p.path.as_deref().map(normalize_path).as_deref() == Some(wanted.as_str())))
}

/// Enough normalisation to compare two paths that name the same directory.
///
/// Deliberately textual: `canonicalize` would be stricter but touches the disk
/// and fails outright on a directory that has been moved or unmounted, which
/// would turn "cannot check right now" into "not this project".
///
/// `pub(crate)` because the file journal keys `journal_files.norm_path` on the
/// same rules — two definitions of "the same path" would disagree exactly when
/// it matters.
///
/// The backslash is a separator only on Windows. On Unix it is an ordinary
/// filename character, and folding it into `/` there would make `a\b` and a
/// real `a/b` the same key — for the journal that is two files sharing one
/// chain, which is misattribution by construction.
pub(crate) fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if cfg!(windows) {
        trimmed.replace('\\', "/").trim_end_matches('/').to_lowercase()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

pub fn create_project(conn: &mut SqliteConnection, new: &NewProject) -> QueryResult<Project> {
    diesel::insert_into(projects::table).values(new).execute(conn)?;
    projects::table.find(new.id).first::<Project>(conn)
}

pub fn update_project(conn: &mut SqliteConnection, id: &str, changeset: &ProjectUpdate) -> QueryResult<Project> {
    diesel::update(projects::table.find(id)).set(changeset).execute(conn)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    fn project(conn: &mut SqliteConnection, id: &str, path: Option<&str>) {
        create_project(
            conn,
            &NewProject {
                id,
                name: "p",
                path,
                source_type: "local",
                source_id: None,
                assistant_id: None,
                description: None,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
    }

    /// The two sides are typed by different programs, so they agree on the
    /// directory without agreeing on the string.
    #[test]
    fn a_path_matches_despite_separators_and_trailing_slash() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        project(&mut conn, "p1", Some(r"C:\Users\me\Code\repo"));

        for asked in [
            r"C:\Users\me\Code\repo",
            "C:/Users/me/Code/repo",
            "C:/Users/me/Code/repo/",
            "  C:/Users/me/Code/repo  ",
        ] {
            let found = find_project_by_path(&mut conn, asked).unwrap();
            assert_eq!(found.map(|p| p.id), Some("p1".into()), "asked `{asked}`");
        }
    }

    #[test]
    fn a_different_directory_is_not_a_match() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        project(&mut conn, "p1", Some("C:/Code/repo"));

        assert!(find_project_by_path(&mut conn, "C:/Code/other").unwrap().is_none());
        // A prefix is a different directory, not the same one.
        assert!(find_project_by_path(&mut conn, "C:/Code").unwrap().is_none());
    }

    #[test]
    fn a_project_without_a_path_never_matches() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        project(&mut conn, "p1", None);

        assert!(find_project_by_path(&mut conn, "C:/Code/repo").unwrap().is_none());
        assert!(find_project_by_path(&mut conn, "").unwrap().is_none());
    }
}
