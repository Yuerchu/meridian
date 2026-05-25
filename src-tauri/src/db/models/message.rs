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
    pub sort_order: i32,
    pub created_at: i64,
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
}
