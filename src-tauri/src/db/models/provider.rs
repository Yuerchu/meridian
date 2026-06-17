use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::providers;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = providers)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub is_enabled: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub api_format: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = providers)]
pub struct NewProvider<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub provider_type: &'a str,
    pub base_url: &'a str,
    pub is_enabled: i32,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub api_format: &'a str,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = providers)]
pub struct ProviderUpdate {
    pub name: Option<String>,
    pub provider_type: Option<String>,
    pub base_url: Option<String>,
    pub is_enabled: Option<i32>,
    pub sort_order: Option<i32>,
    pub updated_at: Option<i64>,
    pub api_format: Option<String>,
}
