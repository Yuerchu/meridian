use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::memories;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = memories)]
pub struct Memory {
    pub id: String,
    pub project_id: String,
    pub key: String,
    pub content: String,
    pub memory_type: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = memories)]
pub struct NewMemory<'a> {
    pub id: &'a str,
    pub project_id: &'a str,
    pub key: &'a str,
    pub content: &'a str,
    pub memory_type: &'a str,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = memories)]
pub struct MemoryUpdate {
    pub content: Option<String>,
    pub memory_type: Option<String>,
    pub updated_at: Option<i64>,
}
