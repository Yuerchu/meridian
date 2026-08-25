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
    /// Which entry in `provider_catalog.json` this row is an instance of, or
    /// `None` for one the catalog does not describe.
    ///
    /// Display and prefill only — it never reaches `create_provider`, which
    /// picks an adapter from `provider_type` and `api_format`. `None` is
    /// ordinary: hand-made providers and anything pointing at a relay have it,
    /// and both behave exactly as they did before the column existed.
    pub catalog_id: Option<String>,
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
    pub catalog_id: Option<&'a str>,
}

/// Deliberately without `catalog_id`: identity is settled when the row is made
/// and an ordinary edit does not restate it.
///
/// Pointing a row at a relay does not stop it being the vendor the user picked
/// — they are reaching OpenAI through a proxy, and the panel should keep saying
/// OpenAI. The id is a claim about *whose service this is*, not an assertion
/// about the address, so editing the address must not silently retract it.
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
