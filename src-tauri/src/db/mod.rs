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

pub fn init_db(db_path: &str) -> DbPool {
    let manager = ConnectionManager::<SqliteConnection>::new(db_path);
    let pool = Pool::builder()
        .max_size(5)
        .build(manager)
        .expect("failed to create db pool");

    let mut conn = pool.get().expect("failed to get db connection");
    diesel::sql_query("PRAGMA journal_mode=WAL")
        .execute(&mut conn)
        .ok();
    diesel::sql_query("PRAGMA foreign_keys=ON")
        .execute(&mut conn)
        .ok();

    conn.run_pending_migrations(MIGRATIONS)
        .expect("failed to run migrations");

    pool
}
