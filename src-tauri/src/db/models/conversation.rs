use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::conversations;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = conversations)]
pub struct Conversation {
    pub id: String,
    pub title: Option<String>,
    pub assistant_id: Option<String>,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub message_count: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<String>,
    pub compact_cursor: Option<i32>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = conversations)]
pub struct NewConversation<'a> {
    pub id: &'a str,
    pub title: Option<&'a str>,
    pub assistant_id: Option<&'a str>,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<&'a str>,
}
