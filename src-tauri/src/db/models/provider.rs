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
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = providers)]
pub struct ProviderUpdate<'a> {
    pub name: Option<&'a str>,
    pub provider_type: Option<&'a str>,
    pub base_url: Option<&'a str>,
    pub is_enabled: Option<i32>,
    pub sort_order: Option<i32>,
    pub updated_at: Option<i64>,
}
