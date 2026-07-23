use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::db::schema::model_configs;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = model_configs)]
pub struct ModelConfig {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: Option<String>,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: Option<i32>,
    pub input_price: f64,
    pub output_price: f64,
    pub cache_price: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = model_configs)]
pub struct NewModelConfig<'a> {
    pub id: &'a str,
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub display_name: Option<&'a str>,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: Option<i32>,
    pub input_price: f64,
    pub output_price: f64,
    pub cache_price: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct ModelConfigInput {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: Option<String>,
    pub context_window: i32,
    pub compact_threshold: i32,
    pub max_output_tokens: Option<i32>,
    pub input_price: f64,
    pub output_price: f64,
    pub cache_price: Option<f64>,
}
