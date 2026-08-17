use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::provider::{NewProvider, Provider, ProviderUpdate};
#[allow(unused_imports)]
use crate::db::schema::providers;

pub fn list_providers(conn: &mut SqliteConnection) -> QueryResult<Vec<Provider>> {
    providers::table
        .order(providers::sort_order.asc())
        .load::<Provider>(conn)
}

pub fn get_provider(conn: &mut SqliteConnection, id: &str) -> QueryResult<Provider> {
    providers::table.find(id).first::<Provider>(conn)
}

pub fn create_provider(conn: &mut SqliteConnection, new: &NewProvider) -> QueryResult<Provider> {
    diesel::insert_into(providers::table).values(new).execute(conn)?;
    providers::table.find(new.id).first::<Provider>(conn)
}

pub fn update_provider(conn: &mut SqliteConnection, id: &str, changeset: &ProviderUpdate) -> QueryResult<Provider> {
    diesel::update(providers::table.find(id)).set(changeset).execute(conn)?;
    providers::table.find(id).first::<Provider>(conn)
}

pub fn delete_provider(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(providers::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn count_providers(conn: &mut SqliteConnection) -> QueryResult<i64> {
    providers::table.count().get_result(conn)
}
