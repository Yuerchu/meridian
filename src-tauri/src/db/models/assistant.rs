use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::assistants;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = assistants)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
    pub is_default: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = assistants)]
pub struct NewAssistant<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub avatar: Option<&'a str>,
    pub system_prompt: &'a str,
    pub provider_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
    pub is_default: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}
