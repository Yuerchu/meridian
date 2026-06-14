use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::custom_tool::{CustomTool, CustomToolUpdate, NewCustomTool};
use crate::db::schema::custom_tools;

pub fn list_tools(conn: &mut SqliteConnection) -> QueryResult<Vec<CustomTool>> {
    custom_tools::table
        .order(custom_tools::sort_order.asc())
        .load::<CustomTool>(conn)
}

pub fn list_enabled_tools(conn: &mut SqliteConnection) -> QueryResult<Vec<CustomTool>> {
    custom_tools::table
        .filter(custom_tools::is_enabled.eq(1))
        .order(custom_tools::sort_order.asc())
        .load::<CustomTool>(conn)
}

pub fn get_tool(conn: &mut SqliteConnection, id: &str) -> QueryResult<CustomTool> {
    custom_tools::table.find(id).first::<CustomTool>(conn)
}

pub fn create_tool(conn: &mut SqliteConnection, new: &NewCustomTool) -> QueryResult<CustomTool> {
    diesel::insert_into(custom_tools::table)
        .values(new)
        .execute(conn)?;
    custom_tools::table.find(new.id).first::<CustomTool>(conn)
}

pub fn update_tool(
    conn: &mut SqliteConnection,
    id: &str,
    changeset: &CustomToolUpdate,
) -> QueryResult<CustomTool> {
    diesel::update(custom_tools::table.find(id))
        .set(changeset)
        .execute(conn)?;
    custom_tools::table.find(id).first::<CustomTool>(conn)
}

pub fn delete_tool(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(custom_tools::table.find(id)).execute(conn)?;
    Ok(())
}
