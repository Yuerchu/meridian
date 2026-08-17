use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::mcp_server::{McpServer, McpServerUpdate, NewMcpServer};
use crate::db::schema::mcp_servers;

pub fn list_mcp_servers(conn: &mut SqliteConnection) -> QueryResult<Vec<McpServer>> {
    mcp_servers::table
        .order(mcp_servers::sort_order.asc())
        .load::<McpServer>(conn)
}

pub fn get_mcp_server(conn: &mut SqliteConnection, id: &str) -> QueryResult<McpServer> {
    mcp_servers::table.find(id).first::<McpServer>(conn)
}

pub fn create_mcp_server(conn: &mut SqliteConnection, new: &NewMcpServer) -> QueryResult<McpServer> {
    diesel::insert_into(mcp_servers::table).values(new).execute(conn)?;
    mcp_servers::table.find(new.id).first::<McpServer>(conn)
}

pub fn update_mcp_server(conn: &mut SqliteConnection, id: &str, changeset: &McpServerUpdate) -> QueryResult<McpServer> {
    diesel::update(mcp_servers::table.find(id))
        .set(changeset)
        .execute(conn)?;
    mcp_servers::table.find(id).first::<McpServer>(conn)
}

pub fn delete_mcp_server(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(mcp_servers::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn list_enabled_mcp_servers(conn: &mut SqliteConnection) -> QueryResult<Vec<McpServer>> {
    mcp_servers::table
        .filter(mcp_servers::is_enabled.eq(1))
        .order(mcp_servers::sort_order.asc())
        .load::<McpServer>(conn)
}
