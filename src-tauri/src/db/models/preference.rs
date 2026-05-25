use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::preferences;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = preferences)]
pub struct Preference {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = preferences)]
pub struct NewPreference<'a> {
    pub key: &'a str,
    pub value: &'a str,
    pub updated_at: i64,
}
