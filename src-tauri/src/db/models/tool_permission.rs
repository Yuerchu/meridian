use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::tool_permissions;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = tool_permissions)]
pub struct ToolPermission {
    pub id: String,
    pub tool_name: String,
    pub mcp_server_id: Option<String>,
    pub permission: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = tool_permissions)]
pub struct NewToolPermission<'a> {
    pub id: &'a str,
    pub tool_name: &'a str,
    pub mcp_server_id: Option<&'a str>,
    pub permission: &'a str,
    pub created_at: i64,
    pub updated_at: i64,
}
