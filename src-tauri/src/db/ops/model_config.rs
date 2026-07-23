use diesel::prelude::*;

use crate::db::models::model_config::{ModelConfig, NewModelConfig};
use crate::db::schema::model_configs;

pub fn list_by_provider(
    conn: &mut SqliteConnection,
    provider_id: &str,
) -> QueryResult<Vec<ModelConfig>> {
    model_configs::table
        .filter(model_configs::provider_id.eq(provider_id))
        .order(model_configs::model_id.asc())
        .load(conn)
}

pub fn get_by_provider_and_model(
    conn: &mut SqliteConnection,
    provider_id: &str,
    model_id: &str,
) -> QueryResult<Option<ModelConfig>> {
    model_configs::table
        .filter(model_configs::provider_id.eq(provider_id))
        .filter(model_configs::model_id.eq(model_id))
        .first(conn)
        .optional()
}

pub fn get(conn: &mut SqliteConnection, id: &str) -> QueryResult<ModelConfig> {
    model_configs::table.find(id).first(conn)
}

pub fn upsert(conn: &mut SqliteConnection, new: &NewModelConfig) -> QueryResult<ModelConfig> {
    let existing = model_configs::table
        .filter(model_configs::provider_id.eq(new.provider_id))
        .filter(model_configs::model_id.eq(new.model_id))
        .first::<ModelConfig>(conn)
        .optional()?;

    if let Some(existing) = existing {
        diesel::update(model_configs::table.find(&existing.id))
            .set((
                model_configs::display_name.eq(new.display_name),
                model_configs::context_window.eq(new.context_window),
                model_configs::compact_threshold.eq(new.compact_threshold),
                model_configs::max_output_tokens.eq(new.max_output_tokens),
                model_configs::input_price.eq(new.input_price),
                model_configs::output_price.eq(new.output_price),
                model_configs::cache_price.eq(new.cache_price),
                model_configs::updated_at.eq(new.updated_at),
            ))
            .execute(conn)?;
        model_configs::table.find(&existing.id).first(conn)
    } else {
        diesel::insert_into(model_configs::table)
            .values(new)
            .execute(conn)?;
        model_configs::table.find(new.id).first(conn)
    }
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> QueryResult<usize> {
    diesel::delete(model_configs::table.find(id)).execute(conn)
}
