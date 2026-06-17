use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::tool_category::{NewToolCategory, ToolCategory};
use crate::db::schema::tool_categories;

pub fn list_categories(conn: &mut SqliteConnection) -> QueryResult<Vec<ToolCategory>> {
    tool_categories::table
        .order(tool_categories::sort_order.asc())
        .load::<ToolCategory>(conn)
}

pub fn get_category(conn: &mut SqliteConnection, id: &str) -> QueryResult<ToolCategory> {
    tool_categories::table.find(id).first::<ToolCategory>(conn)
}

pub fn create_category(conn: &mut SqliteConnection, new: &NewToolCategory) -> QueryResult<ToolCategory> {
    diesel::insert_into(tool_categories::table)
        .values(new)
        .execute(conn)?;
    tool_categories::table.find(new.id).first::<ToolCategory>(conn)
}

pub fn delete_category(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(tool_categories::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn count_categories(conn: &mut SqliteConnection) -> QueryResult<i64> {
    use diesel::dsl::count_star;
    tool_categories::table.select(count_star()).first(conn)
}
