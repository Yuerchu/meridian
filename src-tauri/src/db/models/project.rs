use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::projects;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = projects)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = projects)]
pub struct NewProject<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub path: &'a str,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = projects)]
pub struct ProjectUpdate {
    pub name: Option<String>,
    pub path: Option<String>,
    pub updated_at: Option<i64>,
}
