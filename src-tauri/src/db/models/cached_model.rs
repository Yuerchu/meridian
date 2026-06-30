use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::cached_models;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = cached_models)]
pub struct CachedModel {
    pub id: Option<i32>,
    pub provider_id: String,
    pub model_id: String,
    pub model_name: String,
    pub fetched_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = cached_models)]
pub struct NewCachedModel<'a> {
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub model_name: &'a str,
    pub fetched_at: i64,
}
