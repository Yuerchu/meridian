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
    /// Per-conversation reasoning tier. `None` means "fall back to the
    /// assistant's stored default".
    pub thinking_level: Option<String>,
    pub fast_mode: i32,
    /// Which collaboration mode the conversation is in. `None` is the default
    /// (work) mode; see `agent::modes`.
    pub mode: Option<String>,
    /// Leaf the active path ends at. `None` falls back to the highest
    /// `sort_order` row, which is necessarily a leaf, so a missed write costs an
    /// alternative branch rather than the whole transcript.
    pub head_message_id: Option<String>,
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
