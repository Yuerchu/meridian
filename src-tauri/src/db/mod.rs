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

    pool
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
