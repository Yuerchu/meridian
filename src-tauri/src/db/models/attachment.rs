use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::attachments;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = attachments)]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = attachments)]
pub struct NewAttachment<'a> {
    pub id: &'a str,
    pub message_id: &'a str,
    pub file_name: &'a str,
    pub file_path: &'a str,
    pub mime_type: &'a str,
    pub file_size: i64,
    pub created_at: i64,
}
