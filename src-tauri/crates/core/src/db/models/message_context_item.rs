use crate::db::schema::message_context_items;
use diesel::prelude::*;

/// A frozen, user-provided context block bound to one message branch.
///
/// `content` is intentionally an internal field. Transcript DTOs expose only
/// [`descriptor`](MessageContextItem::descriptor), so repository text and
/// shell output do not leak through ordinary snapshots, audit or export.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = message_context_items)]
pub struct MessageContextItem {
    pub id: String,
    pub message_id: String,
    pub position: i32,
    pub kind: String,
    pub content: String,
    pub display_path: Option<String>,
    pub line_start: Option<i32>,
    pub line_end: Option<i32>,
    pub content_hash: String,
    pub byte_count: i32,
    pub line_count: i32,
    pub token_count: i32,
    pub truncated: i32,
    pub metadata: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MessageContextDescriptor {
    pub id: String,
    pub position: i32,
    pub kind: String,
    pub display_path: Option<String>,
    pub line_start: Option<i32>,
    pub line_end: Option<i32>,
    pub byte_count: i32,
    pub line_count: i32,
    pub token_count: i32,
    pub truncated: bool,
}

impl MessageContextItem {
    pub fn descriptor(&self) -> MessageContextDescriptor {
        MessageContextDescriptor {
            id: self.id.clone(),
            position: self.position,
            kind: self.kind.clone(),
            display_path: self.display_path.clone(),
            line_start: self.line_start,
            line_end: self.line_end,
            byte_count: self.byte_count,
            line_count: self.line_count,
            token_count: self.token_count,
            truncated: self.truncated != 0,
        }
    }
}

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = message_context_items)]
pub struct NewMessageContextItem<'a> {
    pub id: &'a str,
    pub message_id: &'a str,
    pub position: i32,
    pub kind: &'a str,
    pub content: &'a str,
    pub display_path: Option<&'a str>,
    pub line_start: Option<i32>,
    pub line_end: Option<i32>,
    pub content_hash: &'a str,
    pub byte_count: i32,
    pub line_count: i32,
    pub token_count: i32,
    pub truncated: i32,
    pub metadata: Option<&'a str>,
    pub created_at: i64,
}
