pub mod models;
pub mod ops;
pub mod schema;

use diesel::r2d2::{ConnectionManager, Pool, PooledConnection};
use diesel::sqlite::SqliteConnection;
use diesel::RunQueryDsl;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

const MIGRATIONS: EmbeddedMigrations = embed_migrations!();

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;
pub type PooledConn = PooledConnection<ConnectionManager<SqliteConnection>>;

/// SQLite pragmas are per-connection, so they must run on every connection the
/// pool hands out — running them once on a single connection leaves the other
/// pooled connections without foreign key enforcement.
#[derive(Debug)]
struct ConnectionCustomizer;

impl diesel::r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error> for ConnectionCustomizer {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        diesel::sql_query("PRAGMA foreign_keys=ON")
            .execute(conn)
            .map_err(diesel::r2d2::Error::QueryError)?;
        Ok(())
    }
}

pub fn init_db(db_path: &str) -> DbPool {
    let manager = ConnectionManager::<SqliteConnection>::new(db_path);
    let pool = Pool::builder()
        .max_size(5)
        .connection_customizer(Box::new(ConnectionCustomizer))
        .build(manager)
        .expect("failed to create db pool");

    let mut conn = pool.get().expect("failed to get db connection");
    // journal_mode is persistent (stored in the db file), one connection suffices.
    diesel::sql_query("PRAGMA journal_mode=WAL")
        .execute(&mut conn)
        .ok();

    // Migrations that rebuild tables via DROP TABLE must not fire ON DELETE
    // actions on referencing rows (migration 11 nulled conversations.project_id
    // this way), so foreign keys are off for the migration run only.
    diesel::sql_query("PRAGMA foreign_keys=OFF")
        .execute(&mut conn)
        .ok();
    conn.run_pending_migrations(MIGRATIONS)
        .expect("failed to run migrations");
    diesel::sql_query("PRAGMA foreign_keys=ON")
        .execute(&mut conn)
        .ok();

    // Memories no longer hang off projects by foreign key, and migrations run
    // with foreign keys off anyway, so a table rebuild can leave orphans behind.
    let now = crate::util::now_ms();
    let _ = ops::memory::purge_orphan_project_memories(&mut conn);
    let _ = ops::memory::expire_proposals(&mut conn, now);
    // Bounded-growth housekeeping. Kept off the write path: neither sweep
    // depends on what was just written, and the trash purge has no usable index
    // (both are partial on `deleted_at IS NULL`), so doing it per write meant a
    // full table scan each time.
    let _ = ops::memory::sweep_untracked_subjects(&mut conn, now);

    pool
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::migration::{Migration, MigrationSource};
    use diesel::prelude::*;
    use diesel::sql_types::{BigInt, Nullable, Text};

    #[derive(QueryableByName)]
    struct MemoryRow {
        #[diesel(sql_type = Text)]
        scope_type: String,
        #[diesel(sql_type = Text)]
        scope_id: String,
        #[diesel(sql_type = Nullable<Text>)]
        subject_scope_id: Option<String>,
        #[diesel(sql_type = Text)]
        origin: String,
    }

    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = BigInt)]
        n: i64,
    }

    /// Bring a database up to migration 18 only, so migration 19 can be tested
    /// against realistic pre-existing rows rather than against an empty schema.
    /// Running the whole migration set (as `test_db` does) would never exercise
    /// the data-mapping half of the migration.
    fn conn_at_18() -> SqliteConnection {
        conn_before("00000000000019")
    }

    fn conn_before(version: &str) -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        let all = MigrationSource::<diesel::sqlite::Sqlite>::migrations(&MIGRATIONS).unwrap();
        for m in all {
            if m.name().version().as_owned() >= version.into() {
                break;
            }
            m.run(&mut conn).unwrap();
        }
        conn
    }

    fn run_migration(conn: &mut SqliteConnection, version: &str) {
        let all = MigrationSource::<diesel::sqlite::Sqlite>::migrations(&MIGRATIONS).unwrap();
        for m in all {
            if m.name().version().as_owned() == version.into() {
                m.run(conn).unwrap();
                return;
            }
        }
        panic!("migration {version} not found");
    }

    fn seed_pre19(conn: &mut SqliteConnection) {
        conn.batch_execute(
            "INSERT INTO projects (id, name, path, source_type, source_id, created_at, updated_at)
             VALUES ('p-desk', 'Desktop', '/tmp', 'local', NULL, 1, 1),
                    ('p-priv', 'QQ Alice', NULL, 'onebot_private', '10001', 1, 1),
                    ('p-grp',  'QQ Group', NULL, 'onebot_group',   '20002', 1, 1);

             INSERT INTO memories (id, project_id, key, content, memory_type, created_at, updated_at)
             VALUES ('m-desk', 'p-desk', 'style', 'terse', 'preference', 1, 1),
                    ('m-priv', 'p-priv', 'tz',    'UTC+8', 'fact',       1, 1),
                    ('m-grp',  'p-grp',  'slang', 'in-joke','general',   1, 1);",
        )
        .unwrap();
    }

    fn run_19(conn: &mut SqliteConnection) {
        let all = MigrationSource::<diesel::sqlite::Sqlite>::migrations(&MIGRATIONS).unwrap();
        for m in all {
            if m.name().version().as_owned() == "00000000000019".into() {
                m.run(conn).unwrap();
                return;
            }
        }
        panic!("migration 19 not found");
    }

    fn fetch(conn: &mut SqliteConnection, id: &str) -> MemoryRow {
        diesel::sql_query(
            "SELECT scope_type, scope_id, subject_scope_id, origin FROM memories WHERE id = ?",
        )
        .bind::<Text, _>(id)
        .get_result(conn)
        .unwrap()
    }

    /// The whole point of the data mapping: a private-chat memory becomes a
    /// memory about that person, so /memory me and opt-out can reach it.
    #[test]
    fn private_chat_memories_become_per_person() {
        let mut conn = conn_at_18();
        seed_pre19(&mut conn);
        run_19(&mut conn);

        let row = fetch(&mut conn, "m-priv");
        assert_eq!(row.scope_type, "onebot_user");
        assert_eq!(row.scope_id, "onebot:10001");
        assert_eq!(row.subject_scope_id.as_deref(), Some("onebot:10001"));
        assert_eq!(row.origin, "private");
    }

    /// Old group rows carry no trustworthy sender, so they must not pass as
    /// `group` — that would let them act as evidence from the identity pipeline.
    #[test]
    fn group_memories_are_marked_legacy() {
        let mut conn = conn_at_18();
        seed_pre19(&mut conn);
        run_19(&mut conn);

        let row = fetch(&mut conn, "m-grp");
        assert_eq!(row.scope_type, "project");
        assert_eq!(row.scope_id, "p-grp");
        assert_eq!(row.subject_scope_id, None);
        assert_eq!(row.origin, "legacy");
    }

    #[test]
    fn desktop_memories_stay_on_their_project() {
        let mut conn = conn_at_18();
        seed_pre19(&mut conn);
        run_19(&mut conn);

        let row = fetch(&mut conn, "m-desk");
        assert_eq!(row.scope_type, "project");
        assert_eq!(row.scope_id, "p-desk");
        assert_eq!(row.origin, "desktop");
    }

    /// A soft-deleted key must be creatable again; a plain unique index would
    /// force upsert to resurrect tombstones and break the trash.
    #[test]
    fn unique_index_only_constrains_live_rows() {
        let mut conn = conn_at_18();
        seed_pre19(&mut conn);
        run_19(&mut conn);

        conn.batch_execute(
            "UPDATE memories SET deleted_at = 99, deleted_by = 'self' WHERE id = 'm-desk';
             INSERT INTO memories (id, scope_type, scope_id, key, content, memory_type,
                                   origin, visibility, created_at, updated_at)
             VALUES ('m-desk2', 'project', 'p-desk', 'style', 'verbose', 'preference',
                     'desktop', 'normal', 2, 2);",
        )
        .expect("re-creating a soft-deleted key must be allowed");

        let live: CountRow = diesel::sql_query(
            "SELECT COUNT(*) AS n FROM memories \
             WHERE scope_id='p-desk' AND key='style' AND deleted_at IS NULL",
        )
        .get_result(&mut conn)
        .unwrap();
        assert_eq!(live.n, 1);
    }

    /// Proposal ids must never be reused: a stale "同意 N" would otherwise
    /// approve a completely different proposal.
    #[test]
    fn proposal_ids_are_not_reused() {
        let mut conn = conn_at_18();
        run_19(&mut conn);

        conn.batch_execute(
            "INSERT INTO memory_proposals (key, content, memory_type, status, created_at, expires_at)
             VALUES ('a', 'x', 'general', 'pending', 1, 2);
             DELETE FROM memory_proposals;
             INSERT INTO memory_proposals (key, content, memory_type, status, created_at, expires_at)
             VALUES ('b', 'y', 'general', 'pending', 1, 2);",
        )
        .unwrap();

        let row: CountRow =
            diesel::sql_query("SELECT id AS n FROM memory_proposals WHERE key = 'b'")
                .get_result(&mut conn)
                .unwrap();
        assert_eq!(row.n, 2, "AUTOINCREMENT must not hand out id 1 again");
    }

    #[derive(QueryableByName)]
    struct IdRow {
        #[diesel(sql_type = Nullable<Text>)]
        id: Option<String>,
    }

    fn conn_at_20() -> SqliteConnection {
        conn_before("00000000000021")
    }

    /// Two conversations, one of them compacted, so the backfill has to keep the
    /// chains apart and place the summary anchor.
    fn seed_pre21(conn: &mut SqliteConnection) {
        conn.batch_execute(
            "INSERT INTO conversations (id, title, is_pinned, is_archived, message_count,
                                        created_at, updated_at, compact_cursor, fast_mode)
             VALUES ('c-a', 'A', 0, 0, 4, 1, 1, 3, 0),
                    ('c-b', 'B', 0, 0, 2, 1, 1, NULL, 0);

             INSERT INTO messages (id, conversation_id, role, content, sort_order, created_at,
                                   schema_version, is_compact_summary)
             VALUES ('a1', 'c-a', 'user',      'q1', 1, 10, 2, 0),
                    ('a2', 'c-a', 'assistant', 'r1', 2, 11, 2, 0),
                    ('a3', 'c-a', 'user',      'q2', 3, 12, 2, 0),
                    ('a4', 'c-a', 'assistant', 'r2', 4, 13, 2, 0),
                    ('asum', 'c-a', 'user', 'summary', -1, 14, 2, 1),
                    ('b1', 'c-b', 'user',      'q1', 1, 10, 2, 0),
                    ('b2', 'c-b', 'assistant', 'r1', 2, 11, 2, 0);",
        )
        .unwrap();
    }

    fn parent_of(conn: &mut SqliteConnection, id: &str) -> Option<String> {
        diesel::sql_query("SELECT parent_id AS id FROM messages WHERE id = ?")
            .bind::<Text, _>(id)
            .get_result::<IdRow>(conn)
            .unwrap()
            .id
    }

    #[test]
    fn backfill_chains_existing_messages_in_order() {
        let mut conn = conn_at_20();
        seed_pre21(&mut conn);
        run_migration(&mut conn, "00000000000021");

        assert_eq!(parent_of(&mut conn, "a1"), None, "the first message is a root");
        assert_eq!(parent_of(&mut conn, "a2").as_deref(), Some("a1"));
        assert_eq!(parent_of(&mut conn, "a3").as_deref(), Some("a2"));
        assert_eq!(parent_of(&mut conn, "a4").as_deref(), Some("a3"));
    }

    /// The correlated subquery has to filter on conversation_id; without it every
    /// conversation would splice onto the globally previous message.
    #[test]
    fn backfill_keeps_conversations_apart() {
        let mut conn = conn_at_20();
        seed_pre21(&mut conn);
        run_migration(&mut conn, "00000000000021");

        assert_eq!(parent_of(&mut conn, "b1"), None);
        assert_eq!(parent_of(&mut conn, "b2").as_deref(), Some("b1"));
    }

    /// A summary sits beside the tree, not in it. Chaining it would make the
    /// first real message look like it had a sibling.
    #[test]
    fn backfill_leaves_summaries_off_the_chain() {
        let mut conn = conn_at_20();
        seed_pre21(&mut conn);
        run_migration(&mut conn, "00000000000021");

        assert_eq!(parent_of(&mut conn, "asum"), None);
        let children: CountRow =
            diesel::sql_query("SELECT COUNT(*) AS n FROM messages WHERE parent_id = 'asum'")
                .get_result(&mut conn)
                .unwrap();
        assert_eq!(children.n, 0);
    }

    /// The old cursor names a sort_order; the anchor is the first message at or
    /// past it.
    #[test]
    fn backfill_translates_the_compact_cursor_to_an_anchor() {
        let mut conn = conn_at_20();
        seed_pre21(&mut conn);
        run_migration(&mut conn, "00000000000021");

        let anchor = diesel::sql_query("SELECT compact_anchor_id AS id FROM messages WHERE id = 'asum'")
            .get_result::<IdRow>(&mut conn)
            .unwrap()
            .id;
        assert_eq!(anchor.as_deref(), Some("a3"), "cursor 3 maps to the row at sort_order 3");
    }

    #[test]
    fn backfill_points_head_at_the_last_message() {
        let mut conn = conn_at_20();
        seed_pre21(&mut conn);
        run_migration(&mut conn, "00000000000021");

        let head = diesel::sql_query("SELECT head_message_id AS id FROM conversations WHERE id = 'c-a'")
            .get_result::<IdRow>(&mut conn)
            .unwrap()
            .id;
        assert_eq!(head.as_deref(), Some("a4"));
    }
}

#[cfg(test)]
pub(crate) fn test_db() -> DbPool {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder()
        .max_size(1)
        .connection_customizer(Box::new(ConnectionCustomizer))
        .build(manager)
        .expect("failed to create test db pool");

    let mut conn = pool.get().expect("failed to get test db connection");
    conn.run_pending_migrations(MIGRATIONS)
        .expect("failed to run test migrations");

    pool
}
