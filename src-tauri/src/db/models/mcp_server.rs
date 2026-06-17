use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::mcp_servers;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = mcp_servers)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport_type: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub env: Option<String>,
    pub url: Option<String>,
    pub headers: Option<String>,
    pub is_enabled: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = mcp_servers)]
pub struct NewMcpServer<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub transport_type: &'a str,
    pub command: Option<&'a str>,
    pub args: Option<&'a str>,
    pub env: Option<&'a str>,
    pub url: Option<&'a str>,
    pub headers: Option<&'a str>,
    pub is_enabled: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, AsChangeset, Default)]
#[diesel(table_name = mcp_servers)]
pub struct McpServerUpdate {
    pub name: Option<String>,
    pub transport_type: Option<String>,
    pub command: Option<Option<String>>,
    pub args: Option<Option<String>>,
    pub env: Option<Option<String>>,
    pub url: Option<Option<String>>,
    pub headers: Option<Option<String>>,
    pub is_enabled: Option<i32>,
    pub updated_at: Option<i64>,
}
