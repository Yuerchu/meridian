use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::tool_preset::{NewToolPreset, ToolPreset, ToolPresetUpdate};
use crate::db::schema::tool_presets;

pub fn list_presets(conn: &mut SqliteConnection) -> QueryResult<Vec<ToolPreset>> {
    tool_presets::table
        .order(tool_presets::sort_order.asc())
        .load::<ToolPreset>(conn)
}

pub fn get_preset(conn: &mut SqliteConnection, id: &str) -> QueryResult<ToolPreset> {
    tool_presets::table.find(id).first::<ToolPreset>(conn)
}

pub fn create_preset(conn: &mut SqliteConnection, new: &NewToolPreset) -> QueryResult<ToolPreset> {
    diesel::insert_into(tool_presets::table)
        .values(new)
        .execute(conn)?;
    tool_presets::table.find(new.id).first::<ToolPreset>(conn)
}

pub fn update_preset(
    conn: &mut SqliteConnection,
    id: &str,
    changeset: &ToolPresetUpdate,
) -> QueryResult<ToolPreset> {
    diesel::update(tool_presets::table.find(id))
        .set(changeset)
        .execute(conn)?;
    tool_presets::table.find(id).first::<ToolPreset>(conn)
}

pub fn delete_preset(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(tool_presets::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn count_presets(conn: &mut SqliteConnection) -> QueryResult<i64> {
    use diesel::dsl::count_star;
    tool_presets::table.select(count_star()).first(conn)
}
