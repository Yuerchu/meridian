use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::messages;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = messages)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub tool_calls: Option<String>,
    pub tool_call_id: Option<String>,
    /// Insertion order within the conversation, assigned by a trigger. Since
    /// messages became a tree this no longer means "position in the transcript"
    /// — sibling branches interleave their ranges. It still orders siblings for
    /// the version pager, and still identifies the newest row, which is what
    /// `resolve_head` falls back to. To read a conversation in order, walk the
    /// path with `active_context`.
    pub sort_order: i32,
    pub created_at: i64,
    pub reasoning_content: Option<String>,
    pub rating: Option<i32>,
    pub schema_version: i32,
    pub is_compact_summary: i32,
    /// Platform id of whoever sent this, when there is a trustworthy one.
    /// `None` for desktop chats, assistant/tool rows, and anything written
    /// before the identity pipeline existed.
    pub sender_id: Option<i64>,
    /// The message this one answers or follows. `None` marks a root: the first
    /// message of the conversation, or a second root created by editing it.
    /// Siblings under one parent are alternative versions.
    pub parent_id: Option<String>,
    /// Set only on compaction summaries: the first message on the path that this
    /// summary stands in front of. A summary whose anchor is not on the active
    /// path does not apply.
    pub compact_anchor_id: Option<String>,
    /// How this message was produced. `None` means typed; `"voice"` marks
    /// offline speech-to-text, whose transcripts may carry homophone errors.
    pub source: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = messages)]
pub struct NewMessage<'a> {
    pub id: &'a str,
    pub conversation_id: &'a str,
    pub role: &'a str,
    pub content: &'a str,
    pub provider_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub tool_calls: Option<&'a str>,
    pub tool_call_id: Option<&'a str>,
    pub sort_order: i32,
    pub created_at: i64,
    pub reasoning_content: Option<&'a str>,
    pub rating: Option<i32>,
    pub schema_version: i32,
    pub is_compact_summary: i32,
    pub sender_id: Option<i64>,
    pub parent_id: Option<&'a str>,
    pub compact_anchor_id: Option<&'a str>,
    pub source: Option<&'a str>,
}
