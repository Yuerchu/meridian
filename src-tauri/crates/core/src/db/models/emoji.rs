use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::emojis;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = emojis)]
pub struct Emoji {
    pub id: String,
    pub pack_id: String,
    pub name: String,
    pub tags: Option<String>,
    pub file_name: String,
    pub file_format: String,
    pub sort_order: i32,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = emojis)]
pub struct NewEmoji<'a> {
    pub id: &'a str,
    pub pack_id: &'a str,
    pub name: &'a str,
    pub tags: Option<&'a str>,
    pub file_name: &'a str,
    pub file_format: &'a str,
    pub sort_order: i32,
    pub created_at: i64,
}
