use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::assistant_emoji_packs;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = assistant_emoji_packs)]
pub struct AssistantEmojiPack {
    pub assistant_id: String,
    pub pack_id: String,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = assistant_emoji_packs)]
pub struct NewAssistantEmojiPack<'a> {
    pub assistant_id: &'a str,
    pub pack_id: &'a str,
    pub created_at: i64,
}
